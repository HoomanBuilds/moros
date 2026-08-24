import { StrKey } from "@stellar/stellar-sdk";
import {
  base64UrlToBytes,
  bytesToHex,
  type PaymentDeployment,
} from "@moros/payments-client";
import { createPaymentClient } from "./payment-client";
import {
  decryptPrivateProfile,
  encryptPrivateProfile,
  mergePrivateProfiles,
  privateProfileHeadHash,
  savePrivateProfileRecord,
  validateEncryptedPrivateProfileRecord,
  withPrivateProfileLock,
  type EncryptedPrivateProfileRecord,
  type PrivateProfile,
} from "./private-profile";

const PROFILE_PAGES = 8;
const PROFILE_PAGE_BYTES = 4_221;
const ZERO_HASH = new Uint8Array(32);

let initialized: Promise<typeof import("@moros/payments-crypto-web")> | null = null;

async function cryptoCore(): Promise<typeof import("@moros/payments-crypto-web")> {
  if (!initialized) {
    initialized = import("@moros/payments-crypto-web").then(async (module) => {
      await module.default();
      return module;
    });
  }
  return initialized;
}

function networkId(deployment: Pick<PaymentDeployment, "network">): number {
  return deployment.network === "stellar:pubnet" ? 2 : 1;
}

function contractBytes(contract: string): Uint8Array {
  const bytes = StrKey.decodeContract(contract);
  if (bytes.length !== 32) throw new Error("invalid contract identifier");
  return bytes;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`Private sync ${label} is invalid.`);
  }
  return Number(value);
}

function hexBytes(value: unknown, label: string): Uint8Array {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`Private sync ${label} is invalid.`);
  }
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function canonicalBase64(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length !== 5_628 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error("Private sync page is invalid.");
  }
  const decoded = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (decoded.length !== PROFILE_PAGE_BYTES) throw new Error("Private sync page is invalid.");
  return decoded;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameProfile(left: PrivateProfile, right: PrivateProfile): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface SyncManifest {
  network: string;
  vault: string;
  generation: number;
  epoch: number;
  pageCount: number;
  parentHash?: string;
  headHash: string;
}

interface SyncClient {
  syncChallenge(input: { locator: Uint8Array; signingKey: Uint8Array }, options?: object): Promise<unknown>;
  syncAuthenticate(input: {
    locator: Uint8Array;
    signingKey: Uint8Array;
    challenge: Uint8Array;
    expiresAt: number;
    signature: Uint8Array;
  }, options?: object): Promise<unknown>;
  syncManifest(token: string, options?: object): Promise<unknown>;
  syncPages(token: string, input: { generation: number; fromPage: number; limit: number }, options?: object): Promise<unknown>;
  syncPutPage(token: string, page: Uint8Array, options?: object): Promise<unknown>;
  syncPutPages?(token: string, pages: Uint8Array[], options?: object): Promise<unknown>;
  syncCommit(token: string, input: {
    generation: number;
    pageCount: number;
    headHash: Uint8Array;
    expectedParentHash: Uint8Array;
  }, options?: object): Promise<unknown>;
  syncDeleteGenerationsBefore?(token: string, minimumGeneration: number, options?: object): Promise<unknown>;
}

function validateManifest(value: unknown, deployment: PaymentDeployment): SyncManifest {
  if (!value || typeof value !== "object") throw new Error("Private sync manifest is invalid.");
  const manifest = value as Record<string, unknown>;
  if (manifest.network !== deployment.network || manifest.vault !== deployment.vault) {
    throw new Error("Private sync deployment does not match this wallet.");
  }
  const generation = integer(manifest.generation, 0, Number.MAX_SAFE_INTEGER, "generation");
  const epoch = integer(manifest.epoch, 0, Number.MAX_SAFE_INTEGER, "epoch");
  const pageCount = integer(manifest.pageCount, 0, PROFILE_PAGES, "page count");
  const headHash = bytesToHex(hexBytes(manifest.headHash, "head hash"));
  if (generation === 0) {
    if (epoch !== 0 || pageCount !== 0 || headHash !== "00".repeat(32)) {
      throw new Error("Private sync empty manifest is invalid.");
    }
  } else if (epoch < 1 || pageCount !== PROFILE_PAGES || typeof manifest.parentHash !== "string") {
    throw new Error("Private sync manifest is incomplete.");
  }
  if (manifest.parentHash !== undefined) hexBytes(manifest.parentHash, "parent hash");
  return {
    network: deployment.network,
    vault: deployment.vault,
    generation,
    epoch,
    pageCount,
    parentHash: manifest.parentHash as string | undefined,
    headHash,
  };
}

function validateRemoteRecord(manifest: SyncManifest, pages: Uint8Array[]): EncryptedPrivateProfileRecord {
  const record = validateEncryptedPrivateProfileRecord({ format: 1, generation: manifest.generation, pages });
  const parentHash = hexBytes(manifest.parentHash, "parent hash");
  if (!equalBytes(record.pages[0].slice(45, 77), parentHash)) {
    throw new Error("Private sync generation ancestry is invalid.");
  }
  if (!equalBytes(privateProfileHeadHash(record), hexBytes(manifest.headHash, "head hash"))) {
    throw new Error("Private sync generation head is invalid.");
  }
  return record;
}

export interface PrivateProfileSyncResult {
  profile: PrivateProfile;
  generation: number;
  uploaded: boolean;
}

export interface PrivateProfileSyncSession {
  sync(profile: PrivateProfile, signal?: AbortSignal): Promise<PrivateProfileSyncResult>;
  dispose(): void;
}

class BrowserPrivateProfileSyncSession implements PrivateProfileSyncSession {
  private phrase: string;
  private readonly deployment: PaymentDeployment;
  private readonly client: SyncClient;
  private readonly saveRecord: (record: EncryptedPrivateProfileRecord) => Promise<void>;
  private archive: import("@moros/payments-crypto-web").PaymentArchiveIdentity;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private disposed = false;

  constructor(input: {
    phrase: string;
    deployment: PaymentDeployment;
    client: SyncClient;
    archive: import("@moros/payments-crypto-web").PaymentArchiveIdentity;
    saveRecord: (record: EncryptedPrivateProfileRecord) => Promise<void>;
  }) {
    this.phrase = input.phrase;
    this.deployment = input.deployment;
    this.client = input.client;
    this.archive = input.archive;
    this.saveRecord = input.saveRecord;
  }

  sync(profile: PrivateProfile, signal?: AbortSignal): Promise<PrivateProfileSyncResult> {
    if (this.disposed) return Promise.reject(new Error("Private sync session is closed."));
    return withPrivateProfileLock(() => this.syncCurrent(profile, signal));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.archive.free();
    this.phrase = "";
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  private async authenticatedToken(signal?: AbortSignal): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    if (this.token && this.tokenExpiresAt > now + 30) return this.token;
    const locator = this.archive.locator;
    const signingKey = this.archive.signing_public_key;
    const challengeValue = await this.client.syncChallenge({ locator, signingKey }, { signal });
    if (!challengeValue || typeof challengeValue !== "object") throw new Error("Private sync challenge is invalid.");
    const challengeResult = challengeValue as Record<string, unknown>;
    const challenge = typeof challengeResult.challenge === "string"
      ? base64UrlToBytes(challengeResult.challenge)
      : new Uint8Array();
    if (challenge.length !== 32) throw new Error("Private sync challenge is invalid.");
    const expiresAt = integer(challengeResult.expiresAt, now, now + 300, "challenge expiry");
    const signature = this.archive.sign_challenge(challenge, BigInt(expiresAt));
    const sessionValue = await this.client.syncAuthenticate({
      locator,
      signingKey,
      challenge,
      expiresAt,
      signature,
    }, { signal });
    if (!sessionValue || typeof sessionValue !== "object") throw new Error("Private sync session is invalid.");
    const session = sessionValue as Record<string, unknown>;
    if (typeof session.token !== "string" || session.token.length < 32 || session.token.length > 256) {
      throw new Error("Private sync session is invalid.");
    }
    this.tokenExpiresAt = integer(session.expiresAt, now + 1, now + 3_600, "session expiry");
    this.token = session.token;
    return this.token;
  }

  private async remoteProfile(token: string, manifest: SyncManifest, signal?: AbortSignal): Promise<{
    profile: PrivateProfile;
    record: EncryptedPrivateProfileRecord;
  } | null> {
    if (manifest.generation === 0) return null;
    const value = await this.client.syncPages(token, {
      generation: manifest.generation,
      fromPage: 0,
      limit: PROFILE_PAGES,
    }, { signal });
    if (!value || typeof value !== "object") throw new Error("Private sync pages are invalid.");
    const result = value as Record<string, unknown>;
    if (!Array.isArray(result.pages) || result.pages.length !== PROFILE_PAGES || result.hasMore !== false) {
      throw new Error("Private sync pages are incomplete.");
    }
    const record = validateRemoteRecord(manifest, result.pages.map(canonicalBase64));
    return {
      profile: await decryptPrivateProfile({ phrase: this.phrase, deployment: this.deployment, record }),
      record,
    };
  }

  private async syncCurrent(profile: PrivateProfile, signal?: AbortSignal): Promise<PrivateProfileSyncResult> {
    const token = await this.authenticatedToken(signal);
    const manifest = validateManifest(await this.client.syncManifest(token, { signal }), this.deployment);
    const remote = await this.remoteProfile(token, manifest, signal);
    const merged = remote ? mergePrivateProfiles(profile, remote.profile) : profile;
    if (remote && sameProfile(merged, remote.profile)) {
      await this.saveRecord(remote.record);
      return { profile: merged, generation: manifest.generation, uploaded: false };
    }
    const parentHash = manifest.generation === 0 ? ZERO_HASH : hexBytes(manifest.headHash, "head hash");
    const record = await encryptPrivateProfile({
      phrase: this.phrase,
      deployment: this.deployment,
      profile: merged,
      generation: manifest.generation + 1,
      parentHash,
    });
    if (this.client.syncPutPages) {
      await this.client.syncPutPages(token, record.pages, { signal });
    } else {
      for (const page of record.pages) await this.client.syncPutPage(token, page, { signal });
    }
    const headHash = privateProfileHeadHash(record);
    await this.client.syncCommit(token, {
      generation: record.generation,
      pageCount: record.pages.length,
      headHash,
      expectedParentHash: parentHash,
    }, { signal });
    if (record.generation > 3 && this.client.syncDeleteGenerationsBefore) {
      await this.client.syncDeleteGenerationsBefore(token, record.generation - 2, { signal }).catch(() => undefined);
    }
    await this.saveRecord(record);
    return { profile: merged, generation: record.generation, uploaded: true };
  }
}

export async function createPrivateProfileSyncSession(input: {
  phrase: string;
  deployment: PaymentDeployment;
  client?: SyncClient;
  saveRecord?: (record: EncryptedPrivateProfileRecord) => Promise<void>;
}): Promise<PrivateProfileSyncSession> {
  const core = await cryptoCore();
  const archive = core.payment_archive_from_phrase(
    input.phrase,
    networkId(input.deployment),
    contractBytes(input.deployment.vault),
  );
  return new BrowserPrivateProfileSyncSession({
    phrase: input.phrase,
    deployment: input.deployment,
    client: input.client ?? createPaymentClient(input.deployment, { timeoutMs: 5_000, attempts: 1 }),
    archive,
    saveRecord: input.saveRecord ?? savePrivateProfileRecord,
  });
}
