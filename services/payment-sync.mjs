import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const SYNC_FORMAT = 1;
const ARCHIVE_VERSION = 1;
const ARCHIVE_PAGE_BYTES = 4_221;
const ARCHIVE_HEADER_BYTES = 77;
const ARCHIVE_HASH_BYTES = 32;
const ARCHIVE_CIPHERTEXT_BYTES = 4_112;
const MAX_GENERATION_PAGES = 256;
const MAX_STORED_PAGES = 4_096;
const MAX_CHALLENGES = 10_000;
const MAX_SESSIONS = 10_000;
const ARCHIVE_PAGE_DOMAIN = Buffer.from("moros/payment-archive/page/v1");
const SYNC_CHALLENGE_DOMAIN = Buffer.from("moros/payment-sync/challenge/v1");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ZERO_HASH = "00".repeat(32);

function requireString(value, maximum, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function requireInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function requireBytes(value, length, label) {
  if (!Buffer.isBuffer(value) || value.length !== length) throw new Error(`invalid ${label}`);
  return value;
}

function requireHex(value, length, label) {
  if (Buffer.isBuffer(value)) value = value.toString("hex");
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length * 2}}$`).test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function u64(value) {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(BigInt(value));
  return encoded;
}

function challengeMessage(locator, challenge, expiresAt) {
  return Buffer.concat([SYNC_CHALLENGE_DOMAIN, locator, challenge, u64(expiresAt)]);
}

function publicKeyFromRaw(raw) {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function emptySyncState(network, vault) {
  return { format: SYNC_FORMAT, network, vault, accounts: {} };
}

function validateSyncState(state, network, vault) {
  if (
    !state ||
    state.format !== SYNC_FORMAT ||
    state.network !== network ||
    state.vault !== vault ||
    typeof state.accounts !== "object"
  ) {
    throw new Error("payment sync state does not match this deployment");
  }
  return structuredClone(state);
}

export class MemoryPaymentSyncStore {
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

export class FilePaymentSyncStore {
  constructor(path) {
    this.path = requireString(path, 4096, "payment sync path");
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

export function decodeEncryptedArchivePage(encoded, locator) {
  const page = requireBytes(encoded, ARCHIVE_PAGE_BYTES, "encrypted archive page");
  const locatorBytes = requireBytes(locator, 32, "archive locator");
  if (page[0] !== ARCHIVE_VERSION) throw new Error("invalid archive page version");
  const epoch = Number(page.readBigUInt64BE(1));
  const generation = Number(page.readBigUInt64BE(9));
  const pageNumber = page.readUInt32BE(17);
  const nonce = page.subarray(21, 45);
  const previousHash = page.subarray(45, 77).toString("hex");
  const ciphertext = page.subarray(ARCHIVE_HEADER_BYTES, ARCHIVE_HEADER_BYTES + ARCHIVE_CIPHERTEXT_BYTES);
  const hash = page.subarray(ARCHIVE_PAGE_BYTES - ARCHIVE_HASH_BYTES).toString("hex");
  if (
    epoch < 1 ||
    generation < 1 ||
    !Number.isSafeInteger(epoch) ||
    !Number.isSafeInteger(generation) ||
    nonce.every((value) => value === 0)
  ) {
    throw new Error("invalid archive page header");
  }
  const expected = createHash("sha256")
    .update(ARCHIVE_PAGE_DOMAIN)
    .update(locatorBytes)
    .update(page.subarray(0, ARCHIVE_HEADER_BYTES))
    .update(ciphertext)
    .digest("hex");
  if (hash !== expected) throw new Error("invalid archive page hash");
  return {
    epoch,
    generation,
    page: pageNumber,
    previousHash,
    hash,
    encoded: page.toString("base64"),
  };
}

export class PaymentSyncService {
  constructor({
    store,
    network,
    vault,
    now = () => Math.floor(Date.now() / 1_000),
    random = randomBytes,
    challengeTtlSeconds = 60,
    sessionTtlSeconds = 900,
  }) {
    if (!store || typeof store.load !== "function" || typeof store.save !== "function") {
      throw new Error("payment sync store is required");
    }
    this.store = store;
    this.network = requireString(network, 128, "payment network");
    this.vault = requireString(vault, 128, "payment vault");
    this.now = now;
    this.random = random;
    this.challengeTtlSeconds = requireInteger(challengeTtlSeconds, 15, 300, "sync challenge lifetime");
    this.sessionTtlSeconds = requireInteger(sessionTtlSeconds, 60, 3_600, "sync session lifetime");
    const saved = store.load();
    this.state = saved
      ? validateSyncState(saved, this.network, this.vault)
      : emptySyncState(this.network, this.vault);
    this.challenges = new Map();
    this.sessions = new Map();
  }

  issueChallenge({ locator, signingKey }) {
    this.pruneEphemeral();
    if (this.challenges.size >= MAX_CHALLENGES) throw new Error("sync challenge capacity reached");
    const locatorBytes = requireBytes(locator, 32, "archive locator");
    const signingKeyBytes = requireBytes(signingKey, 32, "archive signing key");
    const locatorHex = locatorBytes.toString("hex");
    const account = this.state.accounts[locatorHex];
    if (account && account.signingKey !== signingKeyBytes.toString("hex")) {
      throw new Error("archive signing key does not match");
    }
    publicKeyFromRaw(signingKeyBytes);
    const challenge = requireBytes(this.random(32), 32, "sync challenge");
    if (challenge.every((value) => value === 0)) throw new Error("invalid sync challenge");
    const expiresAt = this.now() + this.challengeTtlSeconds;
    const key = `${locatorHex}:${challenge.toString("hex")}`;
    this.challenges.set(key, {
      locator: locatorHex,
      signingKey: signingKeyBytes.toString("hex"),
      expiresAt,
    });
    return { challenge, expiresAt };
  }

  authenticate({ locator, signingKey, challenge, expiresAt, signature }) {
    this.pruneEphemeral();
    const locatorBytes = requireBytes(locator, 32, "archive locator");
    const signingKeyBytes = requireBytes(signingKey, 32, "archive signing key");
    const challengeBytes = requireBytes(challenge, 32, "sync challenge");
    const signatureBytes = requireBytes(signature, 64, "sync challenge signature");
    requireInteger(expiresAt, 1, Number.MAX_SAFE_INTEGER, "sync challenge expiry");
    const locatorHex = locatorBytes.toString("hex");
    const key = `${locatorHex}:${challengeBytes.toString("hex")}`;
    const issued = this.challenges.get(key);
    this.challenges.delete(key);
    if (
      !issued ||
      issued.expiresAt !== expiresAt ||
      expiresAt < this.now() ||
      issued.signingKey !== signingKeyBytes.toString("hex")
    ) {
      throw new Error("invalid or expired sync challenge");
    }
    if (!verify(null, challengeMessage(locatorBytes, challengeBytes, expiresAt), publicKeyFromRaw(signingKeyBytes), signatureBytes)) {
      throw new Error("invalid sync challenge signature");
    }
    const account = this.state.accounts[locatorHex];
    if (account && account.signingKey !== issued.signingKey) {
      throw new Error("archive signing key does not match");
    }
    if (!account) {
      this.state.accounts[locatorHex] = {
        signingKey: issued.signingKey,
        latestGeneration: 0,
        latestEpoch: 0,
        headHash: ZERO_HASH,
        totalPages: 0,
        drafts: {},
        generations: {},
      };
      this.store.save(this.state);
    }
    if (this.sessions.size >= MAX_SESSIONS) throw new Error("sync session capacity reached");
    const token = requireBytes(this.random(32), 32, "sync session token").toString("base64url");
    if (Buffer.from(token, "base64url").every((value) => value === 0)) {
      throw new Error("invalid sync session token");
    }
    this.sessions.set(hashToken(token), {
      locator: locatorHex,
      expiresAt: this.now() + this.sessionTtlSeconds,
    });
    return { token, expiresAt: this.now() + this.sessionTtlSeconds };
  }

  manifest(token) {
    const account = this.accountForSession(token);
    if (account.latestGeneration === 0) {
      return {
        network: this.network,
        vault: this.vault,
        generation: 0,
        epoch: 0,
        pageCount: 0,
        headHash: ZERO_HASH,
      };
    }
    return structuredClone(account.generations[String(account.latestGeneration)].manifest);
  }

  putPage(token, encoded) {
    const { account } = this.sessionAndAccount(token);
    const locator = Buffer.from(this.sessions.get(hashToken(token)).locator, "hex");
    const page = decodeEncryptedArchivePage(encoded, locator);
    if (page.page >= MAX_GENERATION_PAGES) throw new Error("archive page limit exceeded");
    if (page.generation <= account.latestGeneration) {
      const committed = account.generations[String(page.generation)];
      const prior = committed?.pages[page.page];
      if (prior?.hash === page.hash && prior.encoded === page.encoded) {
        return { generation: page.generation, page: page.page, hash: page.hash };
      }
      throw new Error("stale archive generation");
    }
    if (page.generation !== account.latestGeneration + 1) throw new Error("stale archive generation");
    if (page.epoch < account.latestEpoch) throw new Error("archive epoch rollback");
    const generationKey = String(page.generation);
    let draft = account.drafts[generationKey];
    if (!draft) {
      if (page.page !== 0 || page.previousHash !== account.headHash) {
        throw new Error("archive generation does not extend the current head");
      }
      draft = {
        epoch: page.epoch,
        parentHash: page.previousHash,
        pages: [],
      };
      account.drafts[generationKey] = draft;
    }
    if (page.epoch !== draft.epoch) {
      throw new Error("archive epoch rollback");
    }
    const prior = draft.pages[page.page];
    if (prior) {
      if (prior.hash !== page.hash || prior.encoded !== page.encoded) {
        throw new Error("conflicting archive page");
      }
      return { generation: page.generation, page: page.page, hash: page.hash };
    }
    if (page.page !== draft.pages.length) throw new Error("archive page gap");
    const expectedPrevious = page.page === 0
      ? draft.parentHash
      : draft.pages[page.page - 1].hash;
    if (page.previousHash !== expectedPrevious) throw new Error("archive page chain is broken");
    draft.pages.push(page);
    this.store.save(this.state);
    return { generation: page.generation, page: page.page, hash: page.hash };
  }

  commitGeneration(token, { generation, pageCount, headHash, expectedParentHash }) {
    const { account } = this.sessionAndAccount(token);
    requireInteger(generation, 1, Number.MAX_SAFE_INTEGER, "archive generation");
    requireInteger(pageCount, 1, MAX_GENERATION_PAGES, "archive page count");
    const head = requireHex(headHash, 32, "archive head hash");
    const parent = requireHex(expectedParentHash, 32, "archive parent hash");
    if (generation <= account.latestGeneration) {
      const committed = account.generations[String(generation)]?.manifest;
      if (
        committed &&
        committed.pageCount === pageCount &&
        committed.headHash === head &&
        committed.parentHash === parent
      ) {
        return structuredClone(committed);
      }
      throw new Error("stale archive generation");
    }
    if (generation !== account.latestGeneration + 1 || parent !== account.headHash) {
      throw new Error("stale archive generation");
    }
    const key = String(generation);
    const draft = account.drafts[key];
    if (
      !draft ||
      draft.parentHash !== parent ||
      draft.pages.length !== pageCount ||
      draft.pages[pageCount - 1].hash !== head
    ) {
      throw new Error("archive generation is incomplete");
    }
    if (account.totalPages + pageCount > MAX_STORED_PAGES) {
      throw new Error("archive storage capacity reached");
    }
    const manifest = {
      network: this.network,
      vault: this.vault,
      generation,
      epoch: draft.epoch,
      pageCount,
      parentHash: parent,
      headHash: head,
      committedAt: this.now(),
    };
    account.generations[key] = { manifest, pages: draft.pages };
    delete account.drafts[key];
    account.latestGeneration = generation;
    account.latestEpoch = draft.epoch;
    account.headHash = head;
    account.totalPages += pageCount;
    this.store.save(this.state);
    return structuredClone(manifest);
  }

  pages(token, { generation, fromPage = 0, limit = 32 } = {}) {
    const account = this.accountForSession(token);
    const selected = generation === undefined ? account.latestGeneration : generation;
    requireInteger(selected, 1, account.latestGeneration, "archive generation");
    const committed = account.generations[String(selected)];
    if (!committed) throw new Error("archive generation is unavailable");
    requireInteger(fromPage, 0, committed.pages.length, "archive page cursor");
    requireInteger(limit, 1, 64, "archive page limit");
    const values = committed.pages.slice(fromPage, fromPage + limit);
    return {
      manifest: structuredClone(committed.manifest),
      fromPage,
      nextPage: fromPage + values.length,
      hasMore: fromPage + values.length < committed.pages.length,
      pages: values.map((page) => page.encoded),
    };
  }

  deleteGenerationsBefore(token, minimumGeneration) {
    const account = this.accountForSession(token);
    requireInteger(minimumGeneration, 1, account.latestGeneration, "minimum archive generation");
    let removed = 0;
    for (const [generation, committed] of Object.entries(account.generations)) {
      if (Number(generation) < minimumGeneration) {
        account.totalPages -= committed.pages.length;
        delete account.generations[generation];
        removed++;
      }
    }
    this.store.save(this.state);
    return { removed, totalPages: account.totalPages };
  }

  revokeSession(token) {
    return this.sessions.delete(hashToken(requireString(token, 256, "sync session")));
  }

  accountForSession(token) {
    return this.sessionAndAccount(token).account;
  }

  sessionAndAccount(token) {
    this.pruneEphemeral();
    const value = requireString(token, 256, "sync session");
    const session = this.sessions.get(hashToken(value));
    if (!session || session.expiresAt < this.now()) throw new Error("invalid or expired sync session");
    const account = this.state.accounts[session.locator];
    if (!account) throw new Error("sync account is unavailable");
    return { session, account };
  }

  pruneEphemeral() {
    const now = this.now();
    for (const [key, challenge] of this.challenges) {
      if (challenge.expiresAt < now) this.challenges.delete(key);
    }
    for (const [key, session] of this.sessions) {
      if (session.expiresAt < now) this.sessions.delete(key);
    }
  }
}
