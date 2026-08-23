import { StrKey } from "@stellar/stellar-sdk";
import type { PaymentDeployment } from "@moros/payments-client";
import { PRIVATE_PROFILE_STORE, transactPaymentStore } from "./wallet-store";

const PROFILE_KEY = "primary";
const PROFILE_FORMAT = 1;
const PROFILE_PAGES = 8;
const PAGE_CONTENT_BYTES = 4_092;
const ENCRYPTED_PAGE_BYTES = 4_221;
const PROFILE_BYTES = PROFILE_PAGES * PAGE_CONTENT_BYTES;
const MAX_CHILD_INDEX = 1_000;
const MAX_CONTACTS = 20;
const MAX_RECENT_RECIPIENTS = 8;
const MAX_CONTACT_TOMBSTONES = 40;
const MAX_PAYMENT_REQUESTS = 12;

let initialized: Promise<typeof import("@moros/payments-crypto-web")> | null = null;
let profileQueue: Promise<void> = Promise.resolve();

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

function nonzeroNonce(): Uint8Array {
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  if (nonce.some(Boolean)) return nonce;
  nonce[0] = 1;
  return nonce;
}

function sameCode(left: PrivateRecipient, right: PrivateRecipient): boolean {
  return left.paymentCode === right.paymentCode;
}

function safeText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string") throw new Error(`Private ${label} is invalid.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`Private ${label} is invalid.`);
  return normalized;
}

function safeTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("Private profile timestamp is invalid.");
  return Number(value);
}

function safeIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_CHILD_INDEX) {
    throw new Error("Private receive identity index is invalid.");
  }
  return Number(value);
}

function normalizeRecipient(value: unknown): PrivateRecipient {
  if (!value || typeof value !== "object") throw new Error("Private recipient is invalid.");
  const recipient = value as Record<string, unknown>;
  return {
    paymentCode: safeText(recipient.paymentCode, 320, "payment code"),
    recipientFingerprint: safeText(recipient.recipientFingerprint, 32, "recipient fingerprint"),
    label: safeText(recipient.label, 64, "recipient label"),
    updatedAt: safeTimestamp(recipient.updatedAt),
  };
}

export interface PrivateRecipient {
  paymentCode: string;
  recipientFingerprint: string;
  label: string;
  updatedAt: number;
}

export interface PrivateProfile {
  format: 1;
  activeReceiveIndex: number;
  nextChildIndex: number;
  contacts: PrivateRecipient[];
  contactTombstones: PrivateContactTombstone[];
  recentRecipients: PrivateRecipient[];
  paymentRequests: PrivatePaymentRequest[];
}

export type PrivatePaymentRequestStatus = "active" | "cancelled" | "paid";

export interface PrivatePaymentRequest {
  requestId: string;
  paymentLink: string;
  recipientFingerprint: string;
  label?: string;
  amountAtomic?: string;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  status: PrivatePaymentRequestStatus;
}

export interface PrivateContactTombstone {
  paymentCode: string;
  deletedAt: number;
}

export interface EncryptedPrivateProfileRecord {
  format: 1;
  generation: number;
  pages: Uint8Array[];
}

export function privateProfileHeadHash(record: EncryptedPrivateProfileRecord): Uint8Array {
  validateEncryptedPrivateProfileRecord(record);
  return record.pages[record.pages.length - 1].slice(-32);
}

export function emptyPrivateProfile(): PrivateProfile {
  return {
    format: PROFILE_FORMAT,
    activeReceiveIndex: 0,
    nextChildIndex: 1,
    contacts: [],
    contactTombstones: [],
    recentRecipients: [],
    paymentRequests: [],
  };
}

function normalizePaymentRequest(value: unknown): PrivatePaymentRequest {
  if (!value || typeof value !== "object") throw new Error("Private payment request is invalid.");
  const request = value as Record<string, unknown>;
  const amountAtomic = request.amountAtomic === undefined
    ? undefined
    : safeText(request.amountAtomic, 40, "request amount");
  if (amountAtomic !== undefined && !/^\d+$/.test(amountAtomic)) {
    throw new Error("Private payment request amount is invalid.");
  }
  const label = request.label === undefined ? undefined : safeText(request.label, 64, "request label");
  if (request.status !== "active" && request.status !== "cancelled" && request.status !== "paid") {
    throw new Error("Private payment request status is invalid.");
  }
  const createdAt = safeTimestamp(request.createdAt);
  const expiresAt = safeTimestamp(request.expiresAt);
  if (expiresAt <= createdAt) throw new Error("Private payment request expiry is invalid.");
  return {
    requestId: safeText(request.requestId, 48, "request identifier"),
    paymentLink: safeText(request.paymentLink, 4_096, "request link"),
    recipientFingerprint: safeText(request.recipientFingerprint, 32, "request recipient fingerprint"),
    label,
    amountAtomic,
    createdAt,
    expiresAt,
    updatedAt: safeTimestamp(request.updatedAt),
    status: request.status,
  };
}

function normalizeTombstone(value: unknown): PrivateContactTombstone {
  if (!value || typeof value !== "object") throw new Error("Private contact removal is invalid.");
  const tombstone = value as Record<string, unknown>;
  return {
    paymentCode: safeText(tombstone.paymentCode, 320, "payment code"),
    deletedAt: safeTimestamp(tombstone.deletedAt),
  };
}

export function validatePrivateProfile(value: unknown): PrivateProfile {
  if (!value || typeof value !== "object") throw new Error("Private profile is invalid.");
  const profile = value as Record<string, unknown>;
  if (profile.format !== PROFILE_FORMAT) throw new Error("Private profile format is unsupported.");
  const activeReceiveIndex = safeIndex(profile.activeReceiveIndex);
  const nextChildIndex = safeIndex(profile.nextChildIndex);
  if (nextChildIndex <= activeReceiveIndex) throw new Error("Private receive identity sequence is invalid.");
  if (!Array.isArray(profile.contacts) || profile.contacts.length > MAX_CONTACTS) {
    throw new Error("Private contact list is invalid.");
  }
  const rawTombstones = profile.contactTombstones ?? [];
  if (!Array.isArray(rawTombstones) || rawTombstones.length > MAX_CONTACT_TOMBSTONES) {
    throw new Error("Private contact removal list is invalid.");
  }
  if (!Array.isArray(profile.recentRecipients) || profile.recentRecipients.length > MAX_RECENT_RECIPIENTS) {
    throw new Error("Private recent recipient list is invalid.");
  }
  const rawPaymentRequests = profile.paymentRequests ?? [];
  if (!Array.isArray(rawPaymentRequests) || rawPaymentRequests.length > MAX_PAYMENT_REQUESTS) {
    throw new Error("Private payment request list is invalid.");
  }
  const contacts = profile.contacts.map(normalizeRecipient);
  const contactTombstones = rawTombstones.map(normalizeTombstone);
  const recentRecipients = profile.recentRecipients.map(normalizeRecipient);
  const paymentRequests = rawPaymentRequests.map(normalizePaymentRequest);
  if (new Set(contacts.map((contact) => contact.paymentCode)).size !== contacts.length) {
    throw new Error("Private contact list contains duplicates.");
  }
  if (new Set(recentRecipients.map((contact) => contact.paymentCode)).size !== recentRecipients.length) {
    throw new Error("Private recent recipient list contains duplicates.");
  }
  if (new Set(contactTombstones.map((entry) => entry.paymentCode)).size !== contactTombstones.length) {
    throw new Error("Private contact removal list contains duplicates.");
  }
  if (new Set(paymentRequests.map((request) => request.requestId)).size !== paymentRequests.length) {
    throw new Error("Private payment request list contains duplicates.");
  }
  const removedAt = new Map(contactTombstones.map((entry) => [entry.paymentCode, entry.deletedAt]));
  const liveContacts = contacts.filter((contact) => (removedAt.get(contact.paymentCode) ?? -1) < contact.updatedAt);
  return {
    format: PROFILE_FORMAT,
    activeReceiveIndex,
    nextChildIndex,
    contacts: liveContacts,
    contactTombstones,
    recentRecipients,
    paymentRequests,
  };
}

function encodeProfile(profile: PrivateProfile): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(validatePrivateProfile(profile)));
  if (payload.length > PROFILE_BYTES - 4) throw new Error("Private profile is full.");
  const encoded = new Uint8Array(PROFILE_BYTES);
  new DataView(encoded.buffer).setUint32(0, payload.length, false);
  encoded.set(payload, 4);
  return encoded;
}

function decodeProfile(encoded: Uint8Array): PrivateProfile {
  if (encoded.length !== PROFILE_BYTES) throw new Error("Private profile page set is invalid.");
  const length = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).getUint32(0, false);
  if (length > PROFILE_BYTES - 4 || encoded.slice(4 + length).some(Boolean)) {
    throw new Error("Private profile padding is invalid.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encoded.slice(4, 4 + length)));
  } catch {
    throw new Error("Private profile content is invalid.");
  }
  return validatePrivateProfile(parsed);
}

export async function encryptPrivateProfile(input: {
  phrase: string;
  deployment: PaymentDeployment;
  profile: PrivateProfile;
  generation: number;
  parentHash?: Uint8Array;
}): Promise<EncryptedPrivateProfileRecord> {
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
    throw new Error("Private profile generation is invalid.");
  }
  const core = await cryptoCore();
  const archive = core.payment_archive_from_phrase(
    input.phrase,
    networkId(input.deployment),
    contractBytes(input.deployment.vault),
  );
  const content = encodeProfile(input.profile);
  const pages: Uint8Array[] = [];
  if (input.parentHash && input.parentHash.length !== 32) {
    archive.free();
    content.fill(0);
    throw new Error("Private profile parent hash is invalid.");
  }
  let previousHash = input.parentHash?.slice() ?? new Uint8Array(32);
  try {
    for (let page = 0; page < PROFILE_PAGES; page += 1) {
      const encrypted = archive.encrypt_page(
        1n,
        BigInt(input.generation),
        page,
        previousHash,
        nonzeroNonce(),
        content.slice(page * PAGE_CONTENT_BYTES, (page + 1) * PAGE_CONTENT_BYTES),
      );
      if (encrypted.length !== ENCRYPTED_PAGE_BYTES) throw new Error("Private profile encryption failed.");
      pages.push(encrypted);
      previousHash = encrypted.slice(-32);
    }
  } finally {
    archive.free();
    content.fill(0);
    previousHash.fill(0);
  }
  return { format: PROFILE_FORMAT, generation: input.generation, pages };
}

export function validateEncryptedPrivateProfileRecord(
  record: EncryptedPrivateProfileRecord,
): EncryptedPrivateProfileRecord {
  if (
    record.format !== PROFILE_FORMAT ||
    !Number.isSafeInteger(record.generation) ||
    record.generation < 1 ||
    !Array.isArray(record.pages) ||
    record.pages.length !== PROFILE_PAGES ||
    record.pages.some((page) => !(page instanceof Uint8Array) || page.length !== ENCRYPTED_PAGE_BYTES)
  ) {
    throw new Error("Encrypted private profile is invalid.");
  }
  for (let pageNumber = 0; pageNumber < record.pages.length; pageNumber += 1) {
    const page = record.pages[pageNumber];
    const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
    const generation = Number(view.getBigUint64(9, false));
    if (page[0] !== 1 || generation !== record.generation || view.getUint32(17, false) !== pageNumber) {
      throw new Error("Encrypted private profile page header is invalid.");
    }
    if (pageNumber > 0) {
      const expected = record.pages[pageNumber - 1].slice(-32);
      const previous = page.slice(45, 77);
      if (previous.some((value, index) => value !== expected[index])) {
        throw new Error("Encrypted private profile page chain is invalid.");
      }
    }
  }
  return record;
}

export async function decryptPrivateProfile(input: {
  phrase: string;
  deployment: PaymentDeployment;
  record: EncryptedPrivateProfileRecord;
}): Promise<PrivateProfile> {
  validateEncryptedPrivateProfileRecord(input.record);
  const core = await cryptoCore();
  const archive = core.payment_archive_from_phrase(
    input.phrase,
    networkId(input.deployment),
    contractBytes(input.deployment.vault),
  );
  const content = new Uint8Array(PROFILE_BYTES);
  try {
    for (let page = 0; page < PROFILE_PAGES; page += 1) {
      const decrypted = archive.decrypt_page(input.record.pages[page]);
      if (decrypted.length !== PAGE_CONTENT_BYTES) throw new Error("Private profile page is invalid.");
      content.set(decrypted, page * PAGE_CONTENT_BYTES);
      decrypted.fill(0);
    }
    return decodeProfile(content);
  } finally {
    archive.free();
    content.fill(0);
  }
}

export async function loadPrivateProfileRecord(): Promise<EncryptedPrivateProfileRecord | null> {
  const record = await transactPaymentStore<EncryptedPrivateProfileRecord | undefined>(
    PRIVATE_PROFILE_STORE,
    "readonly",
    (store) => store.get(PROFILE_KEY),
  );
  return record ?? null;
}

export async function savePrivateProfileRecord(record: EncryptedPrivateProfileRecord): Promise<void> {
  validateEncryptedPrivateProfileRecord(record);
  await transactPaymentStore<IDBValidKey>(PRIVATE_PROFILE_STORE, "readwrite", (store) => store.put(record, PROFILE_KEY));
}

export async function loadPrivateProfile(
  phrase: string,
  deployment: PaymentDeployment,
): Promise<{ profile: PrivateProfile; generation: number }> {
  const record = await loadPrivateProfileRecord();
  if (!record) return { profile: emptyPrivateProfile(), generation: 0 };
  return { profile: await decryptPrivateProfile({ phrase, deployment, record }), generation: record.generation };
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = profileQueue.then(operation, operation);
  profileQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function withPrivateProfileLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("moros-private-payment-profile", operation);
  }
  return serialize(operation);
}

export async function updatePrivateProfile(
  phrase: string,
  deployment: PaymentDeployment,
  update: (current: PrivateProfile) => PrivateProfile,
): Promise<PrivateProfile> {
  return withPrivateProfileLock(async () => {
    const currentRecord = await loadPrivateProfileRecord();
    const current = currentRecord
      ? {
          profile: await decryptPrivateProfile({ phrase, deployment, record: currentRecord }),
          generation: currentRecord.generation,
        }
      : { profile: emptyPrivateProfile(), generation: 0 };
    const next = validatePrivateProfile(update(current.profile));
    const record = await encryptPrivateProfile({
      phrase,
      deployment,
      profile: next,
      generation: current.generation + 1,
      parentHash: currentRecord ? privateProfileHeadHash(currentRecord) : undefined,
    });
    await savePrivateProfileRecord(record);
    return next;
  });
}

export function withContact(profile: PrivateProfile, recipient: PrivateRecipient): PrivateProfile {
  const normalized = normalizeRecipient(recipient);
  return validatePrivateProfile({
    ...profile,
    contacts: [normalized, ...profile.contacts.filter((contact) => !sameCode(contact, normalized))].slice(0, MAX_CONTACTS),
    contactTombstones: profile.contactTombstones.filter((entry) => (
      entry.paymentCode !== normalized.paymentCode || entry.deletedAt >= normalized.updatedAt
    )),
  });
}

export function withoutContact(profile: PrivateProfile, paymentCode: string, deletedAt = Date.now()): PrivateProfile {
  const normalizedCode = safeText(paymentCode, 320, "payment code");
  const normalizedDeletedAt = safeTimestamp(deletedAt);
  return validatePrivateProfile({
    ...profile,
    contacts: profile.contacts.filter((contact) => contact.paymentCode !== normalizedCode),
    contactTombstones: [
      { paymentCode: normalizedCode, deletedAt: normalizedDeletedAt },
      ...profile.contactTombstones.filter((entry) => entry.paymentCode !== normalizedCode),
    ].slice(0, MAX_CONTACT_TOMBSTONES),
  });
}

export function withRecentRecipient(profile: PrivateProfile, recipient: PrivateRecipient): PrivateProfile {
  const normalized = normalizeRecipient(recipient);
  return validatePrivateProfile({
    ...profile,
    recentRecipients: [
      normalized,
      ...profile.recentRecipients.filter((contact) => !sameCode(contact, normalized)),
    ].slice(0, MAX_RECENT_RECIPIENTS),
  });
}

export function withPaymentRequest(profile: PrivateProfile, request: PrivatePaymentRequest): PrivateProfile {
  const normalized = normalizePaymentRequest(request);
  return validatePrivateProfile({
    ...profile,
    paymentRequests: [
      normalized,
      ...profile.paymentRequests.filter((current) => current.requestId !== normalized.requestId),
    ].slice(0, MAX_PAYMENT_REQUESTS),
  });
}

export function withPaymentRequestStatus(
  profile: PrivateProfile,
  requestId: string,
  status: PrivatePaymentRequestStatus,
  updatedAt = Date.now(),
): PrivateProfile {
  const normalizedId = safeText(requestId, 48, "request identifier");
  if (status !== "active" && status !== "cancelled" && status !== "paid") {
    throw new Error("Private payment request status is invalid.");
  }
  const normalizedUpdatedAt = safeTimestamp(updatedAt);
  if (!profile.paymentRequests.some((request) => request.requestId === normalizedId)) {
    throw new Error("Private payment request was not found.");
  }
  return validatePrivateProfile({
    ...profile,
    paymentRequests: profile.paymentRequests.map((request) => request.requestId === normalizedId
      ? { ...request, status, updatedAt: normalizedUpdatedAt }
      : request),
  });
}

export function mergePrivateProfiles(left: PrivateProfile, right: PrivateProfile): PrivateProfile {
  const first = validatePrivateProfile(left);
  const second = validatePrivateProfile(right);
  const newestByCode = <T extends { paymentCode: string }>(
    values: T[],
    timestamp: (value: T) => number,
    maximum: number,
  ): T[] => {
    const merged = new Map<string, T>();
    for (const value of values) {
      const current = merged.get(value.paymentCode);
      if (!current || timestamp(value) > timestamp(current)) merged.set(value.paymentCode, value);
    }
    return [...merged.values()].sort((a, b) => timestamp(b) - timestamp(a)).slice(0, maximum);
  };
  const contactTombstones = newestByCode(
    [...first.contactTombstones, ...second.contactTombstones],
    (entry) => entry.deletedAt,
    MAX_CONTACT_TOMBSTONES,
  );
  const removedAt = new Map(contactTombstones.map((entry) => [entry.paymentCode, entry.deletedAt]));
  const contacts = newestByCode(
    [...first.contacts, ...second.contacts],
    (contact) => contact.updatedAt,
    MAX_CONTACTS,
  ).filter((contact) => (removedAt.get(contact.paymentCode) ?? -1) < contact.updatedAt);
  const nextChildIndex = Math.max(first.nextChildIndex, second.nextChildIndex);
  const activeReceiveIndex = first.nextChildIndex > second.nextChildIndex
    ? first.activeReceiveIndex
    : second.nextChildIndex > first.nextChildIndex
      ? second.activeReceiveIndex
      : Math.max(first.activeReceiveIndex, second.activeReceiveIndex);
  const paymentRequests = new Map<string, PrivatePaymentRequest>();
  for (const request of [...first.paymentRequests, ...second.paymentRequests]) {
    const current = paymentRequests.get(request.requestId);
    if (!current || request.updatedAt > current.updatedAt) paymentRequests.set(request.requestId, request);
  }
  return validatePrivateProfile({
    format: PROFILE_FORMAT,
    activeReceiveIndex,
    nextChildIndex,
    contacts,
    contactTombstones,
    recentRecipients: newestByCode(
      [...first.recentRecipients, ...second.recentRecipients],
      (contact) => contact.updatedAt,
      MAX_RECENT_RECIPIENTS,
    ),
    paymentRequests: [...paymentRequests.values()]
      .sort((leftRequest, rightRequest) => rightRequest.createdAt - leftRequest.createdAt)
      .slice(0, MAX_PAYMENT_REQUESTS),
  });
}
