import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

const STATE_FORMAT = 1;
const PAYMENT_ENVELOPE_BYTES = 480;
const PAYMENT_ATTACHMENT_BYTES = 128;
const MAX_PAGE_SIZE = 500;
const MAX_EVENTS_PER_SYNC = 10_000;
const BN254_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function requireInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function requireString(value, maximum, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function requireHex(value, bytes, label) {
  if (Buffer.isBuffer(value)) value = value.toString("hex");
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function requireField(value, label) {
  let field;
  try {
    field = BigInt(value);
  } catch {
    throw new Error(`invalid ${label}`);
  }
  if (field < 0n || field >= BN254_SCALAR_FIELD) throw new Error(`invalid ${label}`);
  return field.toString();
}

function requireAmount(value, label) {
  let amount;
  try {
    amount = BigInt(value);
  } catch {
    throw new Error(`invalid ${label}`);
  }
  if (amount < -(1n << 127n) || amount >= 1n << 127n) throw new Error(`invalid ${label}`);
  return amount.toString();
}

function requireBufferHex(value, bytes, label) {
  if (Buffer.isBuffer(value)) value = value.toString("hex");
  return requireHex(value, bytes, label);
}

function eventKey(event) {
  return `${event.txHash}:${event.eventIndex}`;
}

function eventPosition(event) {
  return [event.ledger, event.txIndex, event.eventIndex];
}

function comparePosition(left, right) {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function normalizeEvent(raw, vault) {
  if (!raw || raw.contractId !== vault) throw new Error("payment event is from the wrong vault");
  const base = {
    cursor: requireString(raw.cursor, 256, "payment event cursor"),
    ledger: requireInteger(raw.ledger, 1, Number.MAX_SAFE_INTEGER, "payment event ledger"),
    txIndex: requireInteger(raw.txIndex, 0, 1_000_000, "payment event transaction index"),
    eventIndex: requireInteger(raw.eventIndex, 0, 1_000_000, "payment event index"),
    txHash: requireHex(raw.txHash, 32, "payment event transaction hash"),
    contractId: vault,
    topic: raw.topic,
    actionId: requireHex(raw.actionId, 32, "payment action id"),
  };
  if (raw.topic === "payment_output") {
    return {
      ...base,
      outputIndex: requireInteger(raw.outputIndex, 0, 3, "payment output index"),
      leafIndex: requireInteger(raw.leafIndex, 0, 2 ** 31 - 1, "payment leaf index"),
      commitment: requireField(raw.commitment, "payment commitment"),
      encryptedOutput: requireBufferHex(raw.encryptedOutput, PAYMENT_ENVELOPE_BYTES, "payment envelope"),
    };
  }
  if (raw.topic === "payment_attachment") {
    return {
      ...base,
      attachmentHash: requireField(raw.attachmentHash, "payment attachment hash"),
      encryptedAttachment: requireBufferHex(
        raw.encryptedAttachment,
        PAYMENT_ATTACHMENT_BYTES,
        "payment attachment",
      ),
    };
  }
  if (raw.topic === "payment_action") {
    return {
      ...base,
      action: requireInteger(raw.action, 0, 2, "payment action"),
      firstLeafIndex: requireInteger(raw.firstLeafIndex, 0, 2 ** 31 - 1, "first payment leaf index"),
      outputCount: requireInteger(raw.outputCount, 0, 4, "payment output count"),
      newRoot: requireField(raw.newRoot, "payment root"),
      publicAmount: requireAmount(raw.publicAmount, "public payment amount"),
    };
  }
  throw new Error("unsupported payment event");
}

function emptyState(network, vault, startLedger) {
  return {
    format: STATE_FORMAT,
    network,
    vault,
    startLedger,
    latestScannedLedger: startLedger - 1,
    resumeCursor: null,
    nextLeafIndex: 0,
    currentRoot: null,
    eventKeys: {},
    outputs: [],
    attachments: {},
    actions: {},
  };
}

function validateState(state, network, vault, startLedger) {
  if (
    !state ||
    state.format !== STATE_FORMAT ||
    state.network !== network ||
    state.vault !== vault ||
    state.startLedger !== startLedger ||
    !Array.isArray(state.outputs) ||
    typeof state.eventKeys !== "object" ||
    typeof state.attachments !== "object" ||
    typeof state.actions !== "object" ||
    state.nextLeafIndex !== state.outputs.length
  ) {
    throw new Error("payment index state does not match this deployment");
  }
  for (let index = 0; index < state.outputs.length; index++) {
    const output = normalizeEvent(state.outputs[index], vault);
    if (output.topic !== "payment_output" || output.leafIndex !== index) {
      throw new Error("payment index contains a leaf gap");
    }
    state.outputs[index] = output;
  }
  for (const [actionId, value] of Object.entries(state.attachments)) {
    const attachment = normalizeEvent(value, vault);
    if (attachment.topic !== "payment_attachment" || attachment.actionId !== actionId) {
      throw new Error("payment index contains an invalid attachment");
    }
    state.attachments[actionId] = attachment;
  }
  for (const [actionId, value] of Object.entries(state.actions)) {
    const action = normalizeEvent(value, vault);
    if (action.topic !== "payment_action" || action.actionId !== actionId) {
      throw new Error("payment index contains an invalid action");
    }
    state.actions[actionId] = action;
  }
  return structuredClone(state);
}

export class MemoryPaymentIndexStore {
  constructor(state = null) {
    this.state = state ? structuredClone(state) : null;
  }

  load() {
    return this.state ? structuredClone(this.state) : null;
  }

  save(state) {
    this.state = structuredClone(state);
  }
}

export class FilePaymentIndexStore {
  constructor(path) {
    this.path = requireString(path, 4096, "payment index path");
  }

  load() {
    if (!existsSync(this.path)) return null;
    return JSON.parse(readFileSync(this.path, "utf8"));
  }

  save(state) {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

export class PaymentEventIndexer {
  constructor({ source, store, network, vault, startLedger, pageSize = 200 }) {
    if (!source || typeof source.getEvents !== "function") throw new Error("payment event source is required");
    if (!store || typeof store.load !== "function" || typeof store.save !== "function") {
      throw new Error("payment index store is required");
    }
    this.source = source;
    this.store = store;
    this.network = requireString(network, 128, "payment network");
    this.vault = requireString(vault, 128, "payment vault");
    this.startLedger = requireInteger(startLedger, 1, Number.MAX_SAFE_INTEGER, "payment start ledger");
    this.pageSize = requireInteger(pageSize, 1, MAX_PAGE_SIZE, "payment event page size");
    const saved = store.load();
    this.state = saved
      ? validateState(saved, this.network, this.vault, this.startLedger)
      : emptyState(this.network, this.vault, this.startLedger);
    this.syncPending = null;
    this.lastError = null;
  }

  sync() {
    if (!this.syncPending) {
      this.syncPending = this.syncCurrent()
        .then((summary) => {
          this.lastError = null;
          return summary;
        })
        .catch((error) => {
          this.lastError = error instanceof Error ? error.message : "payment index refresh failed";
          throw error;
        })
        .finally(() => {
          this.syncPending = null;
        });
    }
    return this.syncPending;
  }

  async syncCurrent() {
    let processed = 0;
    let cursor = this.state.resumeCursor;
    let previousPosition = this.state.lastEventPosition || null;
    do {
      const page = await this.source.getEvents({
        network: this.network,
        contractId: this.vault,
        startLedger: this.state.latestScannedLedger + 1,
        cursor,
        limit: this.pageSize,
      });
      if (!page || !Array.isArray(page.events) || typeof page.hasMore !== "boolean") {
        throw new Error("invalid payment event page");
      }
      requireInteger(page.latestLedger, this.state.latestScannedLedger, Number.MAX_SAFE_INTEGER, "latest payment ledger");
      if (page.events.length > this.pageSize || (page.hasMore && page.events.length === 0)) {
        throw new Error("invalid payment event pagination");
      }
      for (const raw of page.events) {
        const event = normalizeEvent(raw, this.vault);
        if (event.ledger <= this.state.latestScannedLedger || event.ledger > page.latestLedger) {
          throw new Error("payment event is outside the requested ledger range");
        }
        const position = eventPosition(event);
        if (previousPosition && comparePosition(previousPosition, position) >= 0) {
          throw new Error("payment events are not strictly ordered");
        }
        previousPosition = position;
        this.state.lastEventPosition = position;
        this.applyEvent(event);
        processed++;
        if (processed > MAX_EVENTS_PER_SYNC) throw new Error("payment event sync limit exceeded");
      }
      const nextCursor = page.nextCursor || null;
      if (page.hasMore && (!nextCursor || nextCursor === cursor)) {
        throw new Error("payment event cursor did not advance");
      }
      cursor = nextCursor;
      this.state.resumeCursor = page.hasMore ? cursor : null;
      if (!page.hasMore) this.state.latestScannedLedger = page.latestLedger;
      this.state.updatedAt = new Date().toISOString();
      this.store.save(this.state);
      if (!page.hasMore) break;
    } while (true);
    return this.summary();
  }

  applyEvent(event) {
    const key = eventKey(event);
    const priorDigest = this.state.eventKeys[key];
    const digest = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    if (priorDigest) {
      if (priorDigest !== digest) throw new Error("conflicting duplicate payment event");
      return;
    }
    if (event.topic === "payment_output") {
      if (event.leafIndex !== this.state.nextLeafIndex) throw new Error("payment output leaf gap");
      if (event.outputIndex !== this.outputsForAction(event.actionId).length) {
        throw new Error("payment action output gap");
      }
      this.state.outputs.push(event);
      this.state.nextLeafIndex++;
    } else if (event.topic === "payment_attachment") {
      if (this.state.attachments[event.actionId]) throw new Error("duplicate payment attachment");
      this.state.attachments[event.actionId] = event;
    } else {
      if (this.state.actions[event.actionId]) throw new Error("duplicate payment action");
      const outputs = this.outputsForAction(event.actionId);
      const expectedOutputCount = event.action === 0
        ? 2
        : event.action === 1
          ? 4
          : event.outputCount === 0 ? 0 : 3;
      if (
        event.outputCount !== expectedOutputCount ||
        (event.action === 0 && BigInt(event.publicAmount) <= 0n) ||
        (event.action === 1 && BigInt(event.publicAmount) !== 0n) ||
        (event.action === 2 && BigInt(event.publicAmount) >= 0n) ||
        outputs.length !== event.outputCount ||
        (outputs.length > 0 && outputs[0].leafIndex !== event.firstLeafIndex) ||
        (event.action === 1 && !this.state.attachments[event.actionId]) ||
        (event.action !== 1 && this.state.attachments[event.actionId])
      ) {
        throw new Error("incomplete payment action events");
      }
      this.state.actions[event.actionId] = event;
      this.state.currentRoot = event.newRoot;
    }
    this.state.eventKeys[key] = digest;
  }

  outputsForAction(actionId) {
    return this.state.outputs.filter((output) => output.actionId === actionId);
  }

  outputs({ fromLeafIndex = 0, limit = 100 } = {}) {
    requireInteger(fromLeafIndex, 0, this.state.nextLeafIndex, "payment output cursor");
    requireInteger(limit, 1, MAX_PAGE_SIZE, "payment output page size");
    const values = this.state.outputs.slice(fromLeafIndex, fromLeafIndex + limit);
    const nextLeafIndex = fromLeafIndex + values.length;
    return {
      network: this.network,
      vault: this.vault,
      fromLeafIndex,
      nextLeafIndex,
      hasMore: nextLeafIndex < this.state.nextLeafIndex,
      currentRoot: this.state.currentRoot,
      outputs: structuredClone(values),
    };
  }

  attachment(actionId) {
    const id = requireHex(actionId, 32, "payment action id");
    const value = this.state.attachments[id];
    return value ? structuredClone(value) : null;
  }

  action(actionId) {
    const id = requireHex(actionId, 32, "payment action id");
    const value = this.state.actions[id];
    return value ? structuredClone(value) : null;
  }

  summary() {
    return {
      network: this.network,
      vault: this.vault,
      latestScannedLedger: this.state.latestScannedLedger,
      nextLeafIndex: this.state.nextLeafIndex,
      currentRoot: this.state.currentRoot,
      actions: Object.keys(this.state.actions).length,
      updatedAt: this.state.updatedAt,
      error: this.lastError,
    };
  }

  digest() {
    return createHash("sha256")
      .update(JSON.stringify({
        nextLeafIndex: this.state.nextLeafIndex,
        currentRoot: this.state.currentRoot,
        outputs: this.state.outputs,
        attachments: this.state.attachments,
        actions: this.state.actions,
      }))
      .digest("hex");
  }
}

export async function auditPaymentIndex({ primary, independent }) {
  await Promise.all([primary.sync(), independent.sync()]);
  const left = primary.digest();
  const right = independent.digest();
  if (left !== right) throw new Error("independent payment indexes disagree");
  return left;
}
