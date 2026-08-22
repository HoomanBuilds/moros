import assert from "node:assert/strict";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FilePaymentSyncStore,
  MemoryPaymentSyncStore,
  PaymentSyncService,
  decodeEncryptedArchivePage,
} from "./payment-sync.mjs";

const PAGE_DOMAIN = Buffer.from("moros/payment-archive/page/v1");
const CHALLENGE_DOMAIN = Buffer.from("moros/payment-sync/challenge/v1");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const seed = Buffer.alloc(32, 7);
const privateKey = createPrivateKey({
  key: Buffer.concat([PKCS8_PREFIX, seed]),
  format: "der",
  type: "pkcs8",
});
const signingKey = Buffer.from(
  createPublicKey(privateKey).export({ format: "der", type: "spki" }),
).subarray(-32);
const locator = Buffer.alloc(32, 8);
const zeroHash = Buffer.alloc(32);

function u64(value) {
  const output = Buffer.alloc(8);
  output.writeBigUInt64BE(BigInt(value));
  return output;
}

function signatureFor(challenge, expiresAt) {
  return sign(
    null,
    Buffer.concat([CHALLENGE_DOMAIN, locator, challenge, u64(expiresAt)]),
    privateKey,
  );
}

function archivePage({ epoch, generation, page, previousHash, fill }) {
  const output = Buffer.alloc(4_221);
  output[0] = 1;
  output.writeBigUInt64BE(BigInt(epoch), 1);
  output.writeBigUInt64BE(BigInt(generation), 9);
  output.writeUInt32BE(page, 17);
  output.fill(fill, 21, 45);
  previousHash.copy(output, 45);
  output.fill(fill + 1, 77, 4_189);
  const hash = createHash("sha256")
    .update(PAGE_DOMAIN)
    .update(locator)
    .update(output.subarray(0, 77))
    .update(output.subarray(77, 4_189))
    .digest();
  hash.copy(output, 4_189);
  return { output, hash };
}

function deterministicRandom() {
  let value = 20;
  return (length) => Buffer.alloc(length, value++);
}

let now = 1_780_000_000;
const store = new MemoryPaymentSyncStore();
const service = new PaymentSyncService({
  store,
  network: "stellar:pubnet",
  vault: "CA_PAYMENT_VAULT",
  now: () => now,
  random: deterministicRandom(),
});

function login(target = service) {
  const issued = target.issueChallenge({ locator, signingKey });
  return target.authenticate({
    locator,
    signingKey,
    challenge: issued.challenge,
    expiresAt: issued.expiresAt,
    signature: signatureFor(issued.challenge, issued.expiresAt),
  });
}

const firstChallenge = service.issueChallenge({ locator, signingKey });
const session = service.authenticate({
  locator,
  signingKey,
  challenge: firstChallenge.challenge,
  expiresAt: firstChallenge.expiresAt,
  signature: signatureFor(firstChallenge.challenge, firstChallenge.expiresAt),
});
assert.equal(service.manifest(session.token).generation, 0);
assert.throws(
  () => service.authenticate({
    locator,
    signingKey,
    challenge: firstChallenge.challenge,
    expiresAt: firstChallenge.expiresAt,
    signature: signatureFor(firstChallenge.challenge, firstChallenge.expiresAt),
  }),
  /invalid or expired sync challenge/,
);

const pageZero = archivePage({ epoch: 2, generation: 1, page: 0, previousHash: zeroHash, fill: 1 });
const pageOne = archivePage({ epoch: 2, generation: 1, page: 1, previousHash: pageZero.hash, fill: 2 });
assert.equal(decodeEncryptedArchivePage(pageZero.output, locator).encoded.length > 5_000, true);
assert.equal(service.putPage(session.token, pageZero.output).page, 0);
assert.equal(service.putPage(session.token, pageZero.output).page, 0);
assert.equal(service.manifest(session.token).generation, 0);
assert.throws(
  () => service.commitGeneration(session.token, {
    generation: 1,
    pageCount: 2,
    headHash: pageOne.hash,
    expectedParentHash: zeroHash,
  }),
  /incomplete/,
);
assert.equal(service.putPage(session.token, pageOne.output).page, 1);
const manifest = service.commitGeneration(session.token, {
  generation: 1,
  pageCount: 2,
  headHash: pageOne.hash,
  expectedParentHash: zeroHash,
});
assert.equal(manifest.generation, 1);
assert.equal(manifest.epoch, 2);
assert.equal(manifest.pageCount, 2);
assert.equal(service.pages(session.token, { limit: 1 }).hasMore, true);
assert.equal(service.pages(session.token, { fromPage: 1 }).pages.length, 1);

const gap = archivePage({ epoch: 3, generation: 2, page: 1, previousHash: pageOne.hash, fill: 3 });
assert.throws(() => service.putPage(session.token, gap.output), /does not extend/);
const rollback = archivePage({ epoch: 1, generation: 2, page: 0, previousHash: pageOne.hash, fill: 4 });
assert.throws(() => service.putPage(session.token, rollback.output), /epoch rollback/);
const second = archivePage({ epoch: 3, generation: 2, page: 0, previousHash: pageOne.hash, fill: 5 });
const tampered = Buffer.from(second.output);
tampered[100] ^= 1;
assert.throws(() => service.putPage(session.token, tampered), /page hash/);
service.putPage(session.token, second.output);
assert.throws(
  () => service.commitGeneration(session.token, {
    generation: 2,
    pageCount: 1,
    headHash: second.hash,
    expectedParentHash: zeroHash,
  }),
  /stale archive generation/,
);
service.commitGeneration(session.token, {
  generation: 2,
  pageCount: 1,
  headHash: second.hash,
  expectedParentHash: pageOne.hash,
});
assert.equal(service.putPage(session.token, second.output).hash, second.hash.toString("hex"));
assert.equal(service.commitGeneration(session.token, {
  generation: 2,
  pageCount: 1,
  headHash: second.hash,
  expectedParentHash: pageOne.hash,
}).generation, 2);
assert.deepEqual(service.deleteGenerationsBefore(session.token, 2), { removed: 1, totalPages: 1 });
assert.throws(() => service.pages(session.token, { generation: 1 }), /unavailable/);

const restarted = new PaymentSyncService({
  store,
  network: "stellar:pubnet",
  vault: "CA_PAYMENT_VAULT",
  now: () => now,
  random: deterministicRandom(),
});
const restartedSession = login(restarted);
assert.equal(restarted.manifest(restartedSession.token).generation, 2);
assert.equal(restarted.pages(restartedSession.token).pages.length, 1);

const wrongKey = Buffer.alloc(32, 99);
assert.throws(
  () => restarted.issueChallenge({ locator, signingKey: wrongKey }),
  /does not match/,
);

const expiring = restarted.issueChallenge({ locator, signingKey });
now = expiring.expiresAt + 1;
assert.throws(
  () => restarted.authenticate({
    locator,
    signingKey,
    challenge: expiring.challenge,
    expiresAt: expiring.expiresAt,
    signature: signatureFor(expiring.challenge, expiring.expiresAt),
  }),
  /invalid or expired/,
);
now = 1_780_000_100;
const revoked = login(restarted);
assert.equal(restarted.revokeSession(revoked.token), true);
assert.throws(() => restarted.manifest(revoked.token), /invalid or expired sync session/);

const serialized = JSON.stringify(store.load());
assert.equal(serialized.includes("email"), false);
assert.equal(serialized.includes("paymentCode"), false);
assert.equal(serialized.includes("wallet"), false);
assert.equal(serialized.includes(seed.toString("hex")), false);

const temporary = mkdtempSync(join(tmpdir(), "moros-payment-sync-"));
try {
  const fileStore = new FilePaymentSyncStore(join(temporary, "sync.json"));
  const fileService = new PaymentSyncService({
    store: fileStore,
    network: "stellar:testnet",
    vault: "CA_TEST_PAYMENT_VAULT",
    now: () => now,
    random: deterministicRandom(),
  });
  assert.equal(fileStore.load(), null);
  const issued = fileService.issueChallenge({ locator, signingKey });
  fileService.authenticate({
    locator,
    signingKey,
    challenge: issued.challenge,
    expiresAt: issued.expiresAt,
    signature: signatureFor(issued.challenge, issued.expiresAt),
  });
  assert.equal(Object.keys(fileStore.load().accounts).length, 1);
} finally {
  rmSync(temporary, { recursive: true });
}

process.stdout.write("payment sync tests passed\n");
