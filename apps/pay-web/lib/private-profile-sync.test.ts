import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { bytesToBase64Url } from "@moros/payments-client";
import { initSync, recovery_phrase_from_entropy } from "@moros/payments-crypto-web";
import { createPrivateProfileSyncSession } from "./private-profile-sync";
import { emptyPrivateProfile, privateProfileHeadHash, withContact } from "./private-profile";
import { testDeployment } from "./test-deployment";

Object.defineProperty(globalThis, "crypto", { value: webcrypto });
initSync({
  module: readFileSync(new URL("../../../packages/payments-crypto-web/moros_payments_core_bg.wasm", import.meta.url)),
});

const deployment = testDeployment();
const phrase = recovery_phrase_from_entropy(new Uint8Array(32).fill(44));
const challenge = new Uint8Array(32).fill(9);
const uploaded: Uint8Array[] = [];
let generation = 0;
let parentHash = "00".repeat(32);
let headHash = parentHash;
let committedPages: Uint8Array[] = [];
let saved = 0;
const retainedFrom: number[] = [];

const client = {
  async syncChallenge() {
    return { challenge: bytesToBase64Url(challenge), expiresAt: Math.floor(Date.now() / 1_000) + 60 };
  },
  async syncAuthenticate() {
    return { token: "s".repeat(43), expiresAt: Math.floor(Date.now() / 1_000) + 900 };
  },
  async syncManifest() {
    return generation === 0
      ? { network: deployment.network, vault: deployment.vault, generation: 0, epoch: 0, pageCount: 0, headHash }
      : { network: deployment.network, vault: deployment.vault, generation, epoch: 1, pageCount: 8, parentHash, headHash };
  },
  async syncPages() {
    return {
      pages: committedPages.map((page) => Buffer.from(page).toString("base64")),
      hasMore: false,
    };
  },
  async syncPutPage(_token: string, page: Uint8Array) {
    uploaded.push(page.slice());
    return { page: uploaded.length - 1 };
  },
  async syncPutPages(_token: string, pages: Uint8Array[]) {
    uploaded.push(...pages.map((page) => page.slice()));
    return { pages: pages.map((_, pageIndex) => ({ page: pageIndex })) };
  },
  async syncCommit(_token: string, input: { generation: number; headHash: Uint8Array; expectedParentHash: Uint8Array }) {
    parentHash = Buffer.from(input.expectedParentHash).toString("hex");
    headHash = Buffer.from(input.headHash).toString("hex");
    generation = input.generation;
    committedPages = uploaded.splice(0);
    return { generation };
  },
  async syncDeleteGenerationsBefore(_token: string, minimumGeneration: number) {
    retainedFrom.push(minimumGeneration);
    return { removed: 1 };
  },
};

const session = await createPrivateProfileSyncSession({
  phrase,
  deployment,
  client,
  saveRecord: async (record) => {
    assert.equal(Buffer.from(privateProfileHeadHash(record)).toString("hex"), headHash);
    saved += 1;
  },
});

const profile = emptyPrivateProfile();
const first = await session.sync(profile);
assert.equal(first.uploaded, true);
assert.equal(first.generation, 1);
assert.equal(committedPages.length, 8);
assert.equal(saved, 1);

const unchanged = await session.sync(profile);
assert.equal(unchanged.uploaded, false);
assert.equal(unchanged.generation, 1);
assert.equal(saved, 2);

const changed = withContact(profile, {
  paymentCode: `moros_pay_${"b".repeat(280)}`,
  recipientFingerprint: "AAAA-BBBB-CCCC",
  label: "Supplier",
  updatedAt: 1_780_000_000_000,
});
const second = await session.sync(changed);
assert.equal(second.uploaded, true);
assert.equal(second.generation, 2);
assert.equal(second.profile.contacts.length, 1);
assert.equal(Buffer.from(committedPages[0].slice(45, 77)).toString("hex"), parentHash);

const thirdProfile = withContact(second.profile, {
  paymentCode: `moros_pay_${"c".repeat(280)}`,
  recipientFingerprint: "CCCC-DDDD-EEEE",
  label: "Treasury",
  updatedAt: 1_780_000_000_100,
});
assert.equal((await session.sync(thirdProfile)).generation, 3);
const fourthProfile = withContact(thirdProfile, {
  paymentCode: `moros_pay_${"d".repeat(280)}`,
  recipientFingerprint: "EEEE-FFFF-GGGG",
  label: "Operations",
  updatedAt: 1_780_000_000_200,
});
assert.equal((await session.sync(fourthProfile)).generation, 4);
assert.deepEqual(retainedFrom, [2]);

session.dispose();
await assert.rejects(() => session.sync(profile), /closed/);

process.stdout.write("private profile sync tests passed\n");
