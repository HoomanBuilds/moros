import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { DatabasePaymentSyncService } from "./payment-sync-database.mjs";

const PAGE_DOMAIN = Buffer.from("moros/payment-archive/page/v1");
const CHALLENGE_DOMAIN = Buffer.from("moros/payment-sync/challenge/v1");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const privateKey = createPrivateKey({
  key: Buffer.concat([PKCS8_PREFIX, Buffer.alloc(32, 41)]),
  format: "der",
  type: "pkcs8",
});
const signingKey = Buffer.from(createPublicKey(privateKey).export({ format: "der", type: "spki" })).subarray(-32);
const locator = Buffer.alloc(32, 42);
const zeroHash = Buffer.alloc(32);

function u64(value) {
  const output = Buffer.alloc(8);
  output.writeBigUInt64BE(BigInt(value));
  return output;
}

function signatureFor(challenge, expiresAt) {
  return sign(null, Buffer.concat([CHALLENGE_DOMAIN, locator, challenge, u64(expiresAt)]), privateKey);
}

function archivePage() {
  const output = Buffer.alloc(4_221);
  output[0] = 1;
  output.writeBigUInt64BE(2n, 1);
  output.writeBigUInt64BE(1n, 9);
  output.writeUInt32BE(0, 17);
  output.fill(7, 21, 45);
  zeroHash.copy(output, 45);
  output.fill(8, 77, 4_189);
  const hash = createHash("sha256")
    .update(PAGE_DOMAIN)
    .update(locator)
    .update(output.subarray(0, 77))
    .update(output.subarray(77, 4_189))
    .digest();
  hash.copy(output, 4_189);
  return { output, hash };
}

class Repository {
  constructor() {
    this.value = null;
    this.sessions = new Map();
    this.drafts = new Map();
    this.committed = new Map();
  }

  async account() {
    return this.value ? structuredClone(this.value) : null;
  }

  async registerAccount(_locator, signingKeyValue) {
    if (this.value && this.value.signingKey !== signingKeyValue) throw new Error("archive signing key does not match");
    this.value ??= { signingKey: signingKeyValue, currentGeneration: 0, currentEpoch: 0, headHash: "00".repeat(32), totalPages: 0 };
    return structuredClone(this.value);
  }

  async createSession(session) {
    this.sessions.set(session.tokenHash, session);
  }

  async session(tokenHash) {
    return this.sessions.get(tokenHash) ?? null;
  }

  async draft(_locator, generation) {
    const value = this.drafts.get(generation) ?? this.committed.get(generation);
    return value ? { generation, epoch: value.epoch, parentHash: value.parentHash, committed: Boolean(value.committedAt) } : null;
  }

  async putPage(_locator, page) {
    let draft = this.drafts.get(page.generation);
    if (!draft) {
      draft = { epoch: page.epoch, parentHash: page.generationParentHash, pages: [] };
      this.drafts.set(page.generation, draft);
    }
    draft.pages[page.page] = page.encoded;
    return { generation: page.generation, page: page.page, hash: page.hash };
  }

  async commit(_locator, input) {
    const draft = this.drafts.get(input.generation);
    const committed = {
      generation: input.generation,
      epoch: input.epoch,
      parentHash: input.parentHash,
      headHash: input.headHash,
      pageCount: input.pageCount,
      committedAt: 1_780_000_000,
      pages: draft.pages,
    };
    this.committed.set(input.generation, committed);
    this.drafts.delete(input.generation);
    this.value.currentGeneration = input.generation;
    this.value.currentEpoch = input.epoch;
    this.value.headHash = input.headHash;
    this.value.totalPages += input.pageCount;
    return { applied: true, currentGeneration: input.generation };
  }

  async generation(_locator, generation) {
    return this.committed.get(generation) ?? null;
  }

  async pages(_locator, generation, fromPage, limit) {
    return this.committed.get(generation).pages.slice(fromPage, fromPage + limit);
  }

  async deleteGenerationsBefore(_locator, minimum) {
    let removed = 0;
    for (const generation of this.committed.keys()) {
      if (generation < minimum) {
        this.committed.delete(generation);
        removed += 1;
      }
    }
    return { removed, totalPages: this.value.totalPages };
  }
}

let randomFill = 50;
const repository = new Repository();
const service = new DatabasePaymentSyncService({
  repository,
  network: "stellar:pubnet",
  vault: "CA_PAYMENT_VAULT",
  now: () => 1_780_000_000,
  random: (length) => Buffer.alloc(length, randomFill++),
});
const issued = await service.issueChallenge({ locator, signingKey });
const session = await service.authenticate({
  locator,
  signingKey,
  challenge: issued.challenge,
  expiresAt: issued.expiresAt,
  signature: signatureFor(issued.challenge, issued.expiresAt),
});
assert.equal((await service.manifest(session.token)).generation, 0);
const page = archivePage();
assert.equal((await service.putPage(session.token, page.output)).page, 0);
const manifest = await service.commitGeneration(session.token, {
  generation: 1,
  pageCount: 1,
  headHash: page.hash,
  expectedParentHash: zeroHash,
});
assert.equal(manifest.generation, 1);
assert.equal((await service.pages(session.token)).pages.length, 1);
assert.equal(repository.value.signingKey, signingKey.toString("base64url"));

process.stdout.write("database payment sync tests passed\n");
