const STATES = new Set([
  "draft",
  "proving",
  "ready",
  "submitting",
  "submitted",
  "confirmed",
  "failed",
  "cancelled",
]);
const ALLOWED = Object.freeze({
  draft: new Set(["proving", "cancelled"]),
  proving: new Set(["ready", "failed", "cancelled"]),
  ready: new Set(["submitting", "proving", "cancelled"]),
  submitting: new Set(["submitted", "ready", "failed"]),
  submitted: new Set(["confirmed", "failed"]),
  confirmed: new Set(),
  failed: new Set(["proving", "ready", "cancelled"]),
  cancelled: new Set(),
});

function actionId(value) {
  if (Buffer.isBuffer(value)) value = value.toString("hex");
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value) || /^0+$/.test(value)) {
    throw new Error("invalid payment action id");
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function mapClone(values) {
  return new Map([...values].map(([key, value]) => [key, clone(value)]));
}

function listFrom(values) {
  return [...values.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(clone);
}

export class PaymentOperationJournal {
  constructor({ operations = [], save = async () => {}, now = Date.now } = {}) {
    if (!Array.isArray(operations) || operations.length > 1_000 || typeof save !== "function") {
      throw new Error("invalid payment operation journal");
    }
    this.operations = new Map();
    for (const operation of operations) {
      const id = actionId(operation.actionId);
      if (this.operations.has(id) || !STATES.has(operation.state)) {
        throw new Error("invalid payment operation journal");
      }
      this.operations.set(id, clone(operation));
    }
    this.save = save;
    this.now = now;
    this.writeQueue = Promise.resolve();
  }

  async create({ actionId: value, kind }) {
    const id = actionId(value);
    return this.mutate((operations) => {
      if (!["deposit", "transfer", "withdraw"].includes(kind) || operations.has(id)) {
        throw new Error("payment operation already exists or is invalid");
      }
      const timestamp = this.now();
      const operation = {
        actionId: id,
        kind,
        state: "draft",
        createdAt: timestamp,
        updatedAt: timestamp,
        attempts: 0,
      };
      operations.set(id, operation);
      return operation;
    });
  }

  async transition(value, state, details = {}) {
    const id = actionId(value);
    const allowedDetails = new Set(["errorCode", "ledger", "transactionHash"]);
    if (Object.keys(details).some((key) => !allowedDetails.has(key))) {
      throw new Error("invalid payment operation details");
    }
    if (
      details.ledger !== undefined &&
      (!Number.isSafeInteger(details.ledger) || details.ledger < 1)
    ) {
      throw new Error("invalid payment operation ledger");
    }
    if (
      details.transactionHash !== undefined &&
      (typeof details.transactionHash !== "string" || !/^[0-9a-f]{64}$/.test(details.transactionHash))
    ) {
      throw new Error("invalid payment transaction hash");
    }
    return this.mutate((operations) => {
      const operation = operations.get(id);
      if (!operation || !STATES.has(state) || !ALLOWED[operation.state].has(state)) {
        throw new Error("invalid payment operation transition");
      }
      operation.state = state;
      operation.updatedAt = this.now();
      if (state === "submitting") operation.attempts++;
      if (details.errorCode !== undefined) operation.errorCode = String(details.errorCode).slice(0, 64);
      if (details.ledger !== undefined) operation.ledger = details.ledger;
      if (details.transactionHash !== undefined) operation.transactionHash = details.transactionHash;
      return operation;
    });
  }

  async recoverInterrupted() {
    return this.mutate((operations) => {
      for (const operation of operations.values()) {
        if (operation.state === "submitting") {
          operation.state = "ready";
          operation.updatedAt = this.now();
          operation.errorCode = "submission_interrupted";
        }
      }
      return listFrom(operations);
    }, { resultIsList: true });
  }

  get(value) {
    const operation = this.operations.get(actionId(value));
    return operation ? clone(operation) : null;
  }

  list() {
    return listFrom(this.operations);
  }

  mutate(change, { resultIsList = false } = {}) {
    const operation = this.writeQueue.then(async () => {
      const next = mapClone(this.operations);
      const result = change(next);
      await this.save(listFrom(next));
      this.operations = next;
      return resultIsList ? listFrom(next) : clone(result);
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }
}
