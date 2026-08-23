import { randomBytes, verify } from "node:crypto";
import {
  challengeMessage,
  decodeEncryptedArchivePage,
  hashToken,
  publicKeyFromRaw,
} from "./payment-sync.mjs";

const MAX_CHALLENGES = 10_000;
const MAX_SESSIONS = 10_000;
const ZERO_HASH = "00".repeat(32);

function bytes(value, length, label) {
  if (!Buffer.isBuffer(value) || value.length !== length) throw new Error(`invalid ${label}`);
  return value;
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`invalid ${label}`);
  return value;
}

function string(value, maximum, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw new Error(`invalid ${label}`);
  return value;
}

function hash(value, label) {
  if (Buffer.isBuffer(value)) value = value.toString("hex");
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function asManifest(network, vault, generation) {
  return {
    network,
    vault,
    generation: generation.generation,
    epoch: generation.epoch,
    pageCount: generation.pageCount,
    parentHash: generation.parentHash,
    headHash: generation.headHash,
    committedAt: generation.committedAt,
  };
}

export class DatabasePaymentSyncService {
  constructor({
    repository,
    network,
    vault,
    now = () => Math.floor(Date.now() / 1_000),
    random = randomBytes,
    challengeTtlSeconds = 60,
    sessionTtlSeconds = 900,
  }) {
    if (!repository) throw new Error("payment sync database repository is required");
    this.repository = repository;
    this.network = string(network, 128, "payment network");
    this.vault = string(vault, 128, "payment vault");
    this.now = now;
    this.random = random;
    this.challengeTtlSeconds = integer(challengeTtlSeconds, 15, 300, "sync challenge lifetime");
    this.sessionTtlSeconds = integer(sessionTtlSeconds, 60, 3_600, "sync session lifetime");
    this.challenges = new Map();
    this.sessions = new Map();
  }

  async issueChallenge({ locator, signingKey }) {
    this.pruneEphemeral();
    if (this.challenges.size >= MAX_CHALLENGES) throw new Error("sync challenge capacity reached");
    const locatorBytes = bytes(locator, 32, "archive locator");
    const signingKeyBytes = bytes(signingKey, 32, "archive signing key");
    const locatorValue = locatorBytes.toString("base64url");
    const signingKeyValue = signingKeyBytes.toString("base64url");
    const account = await this.repository.account(locatorValue);
    if (account && account.signingKey !== signingKeyValue) throw new Error("archive signing key does not match");
    publicKeyFromRaw(signingKeyBytes);
    const challenge = bytes(this.random(32), 32, "sync challenge");
    if (challenge.every((value) => value === 0)) throw new Error("invalid sync challenge");
    const expiresAt = this.now() + this.challengeTtlSeconds;
    this.challenges.set(`${locatorValue}:${challenge.toString("hex")}`, {
      locator: locatorValue,
      signingKey: signingKeyValue,
      expiresAt,
    });
    return { challenge, expiresAt };
  }

  async authenticate({ locator, signingKey, challenge, expiresAt, signature }) {
    this.pruneEphemeral();
    const locatorBytes = bytes(locator, 32, "archive locator");
    const signingKeyBytes = bytes(signingKey, 32, "archive signing key");
    const challengeBytes = bytes(challenge, 32, "sync challenge");
    const signatureBytes = bytes(signature, 64, "sync challenge signature");
    integer(expiresAt, 1, Number.MAX_SAFE_INTEGER, "sync challenge expiry");
    const locatorValue = locatorBytes.toString("base64url");
    const signingKeyValue = signingKeyBytes.toString("base64url");
    const key = `${locatorValue}:${challengeBytes.toString("hex")}`;
    const issued = this.challenges.get(key);
    this.challenges.delete(key);
    if (
      !issued ||
      issued.expiresAt !== expiresAt ||
      expiresAt < this.now() ||
      issued.signingKey !== signingKeyValue
    ) {
      throw new Error("invalid or expired sync challenge");
    }
    if (!verify(null, challengeMessage(locatorBytes, challengeBytes, expiresAt), publicKeyFromRaw(signingKeyBytes), signatureBytes)) {
      throw new Error("invalid sync challenge signature");
    }
    await this.repository.registerAccount(locatorValue, signingKeyValue);
    if (this.sessions.size >= MAX_SESSIONS) throw new Error("sync session capacity reached");
    const token = bytes(this.random(32), 32, "sync session token").toString("base64url");
    if (Buffer.from(token, "base64url").every((value) => value === 0)) throw new Error("invalid sync session token");
    const tokenHash = hashToken(token);
    const session = { locator: locatorValue, expiresAt: this.now() + this.sessionTtlSeconds };
    await this.repository.createSession({ tokenHash, ...session });
    this.sessions.set(tokenHash, session);
    return { token, expiresAt: session.expiresAt };
  }

  async manifest(token) {
    const locator = await this.locatorForSession(token);
    const account = await this.repository.account(locator);
    if (!account) throw new Error("sync account is unavailable");
    if (account.currentGeneration === 0) {
      return {
        network: this.network,
        vault: this.vault,
        generation: 0,
        epoch: 0,
        pageCount: 0,
        headHash: ZERO_HASH,
      };
    }
    const generation = await this.repository.generation(locator, account.currentGeneration);
    if (!generation) throw new Error("archive generation is unavailable");
    return asManifest(this.network, this.vault, generation);
  }

  async putPage(token, encoded) {
    const locator = await this.locatorForSession(token);
    const page = decodeEncryptedArchivePage(encoded, Buffer.from(locator, "base64url"));
    const account = await this.repository.account(locator);
    if (!account) throw new Error("sync account is unavailable");
    let parentHash = account.headHash;
    if (page.generation <= account.currentGeneration) {
      const committed = await this.repository.generation(locator, page.generation);
      if (!committed) throw new Error("stale archive generation");
      parentHash = committed.parentHash;
    } else {
      if (page.generation !== account.currentGeneration + 1) throw new Error("stale archive generation");
      if (page.epoch < account.currentEpoch) throw new Error("archive epoch rollback");
      const draft = await this.repository.draft(locator, page.generation);
      if (draft) {
        if (draft.epoch !== page.epoch) throw new Error("archive epoch rollback");
        parentHash = draft.parentHash;
      }
    }
    return this.repository.putPage(locator, {
      ...page,
      generationParentHash: parentHash,
    });
  }

  async putPages(token, encodedPages) {
    if (!Array.isArray(encodedPages) || encodedPages.length === 0 || encodedPages.length > 64) {
      throw new Error("invalid encrypted archive page batch");
    }
    const locator = await this.locatorForSession(token);
    const locatorBytes = Buffer.from(locator, "base64url");
    const pages = encodedPages.map((encoded) => decodeEncryptedArchivePage(encoded, locatorBytes));
    const account = await this.repository.account(locator);
    if (!account) throw new Error("sync account is unavailable");
    let parentHash = account.headHash;
    if (pages[0].generation <= account.currentGeneration) {
      const committed = await this.repository.generation(locator, pages[0].generation);
      if (!committed) throw new Error("stale archive generation");
      parentHash = committed.parentHash;
    } else if (
      pages[0].generation !== account.currentGeneration + 1 ||
      pages[0].epoch < account.currentEpoch
    ) {
      throw new Error("stale archive generation");
    }
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      if (
        page.generation !== pages[0].generation ||
        page.epoch !== pages[0].epoch ||
        page.page !== index ||
        page.previousHash !== (index === 0 ? parentHash : pages[index - 1].hash)
      ) {
        throw new Error("archive page chain is broken");
      }
    }
    if (typeof this.repository.putPages !== "function") {
      const results = [];
      for (const page of pages) {
        results.push(await this.repository.putPage(locator, { ...page, generationParentHash: parentHash }));
      }
      return results;
    }
    return this.repository.putPages(locator, pages.map((page) => ({
      ...page,
      generationParentHash: parentHash,
    })));
  }

  async commitGeneration(token, { generation, pageCount, headHash, expectedParentHash }) {
    const locator = await this.locatorForSession(token);
    integer(generation, 1, Number.MAX_SAFE_INTEGER, "archive generation");
    integer(pageCount, 1, 256, "archive page count");
    const head = hash(headHash, "archive head hash");
    const parent = hash(expectedParentHash, "archive parent hash");
    const draft = await this.repository.draft(locator, generation);
    if (!draft || draft.parentHash !== parent) throw new Error("archive generation is incomplete");
    await this.repository.commit(locator, {
      generation,
      epoch: draft.epoch,
      pageCount,
      parentHash: parent,
      headHash: head,
    });
    const committed = await this.repository.generation(locator, generation);
    if (!committed) throw new Error("archive generation is unavailable");
    return asManifest(this.network, this.vault, committed);
  }

  async pages(token, { generation, fromPage = 0, limit = 32 } = {}) {
    const locator = await this.locatorForSession(token);
    const account = await this.repository.account(locator);
    if (!account || account.currentGeneration === 0) throw new Error("archive generation is unavailable");
    const selected = generation === undefined ? account.currentGeneration : generation;
    integer(selected, 1, account.currentGeneration, "archive generation");
    const committed = await this.repository.generation(locator, selected);
    if (!committed) throw new Error("archive generation is unavailable");
    integer(fromPage, 0, committed.pageCount, "archive page cursor");
    integer(limit, 1, 64, "archive page limit");
    const values = await this.repository.pages(locator, selected, fromPage, limit);
    return {
      manifest: asManifest(this.network, this.vault, committed),
      fromPage,
      nextPage: fromPage + values.length,
      hasMore: fromPage + values.length < committed.pageCount,
      pages: values,
    };
  }

  async deleteGenerationsBefore(token, minimumGeneration) {
    const locator = await this.locatorForSession(token);
    return this.repository.deleteGenerationsBefore(locator, minimumGeneration);
  }

  async locatorForSession(token) {
    this.pruneEphemeral();
    const value = string(token, 256, "sync session");
    const tokenHash = hashToken(value);
    const cached = this.sessions.get(tokenHash);
    if (cached && cached.expiresAt >= this.now()) return cached.locator;
    const stored = await this.repository.session(tokenHash, this.now());
    if (!stored || stored.expiresAt < this.now()) throw new Error("invalid or expired sync session");
    this.sessions.set(tokenHash, stored);
    return stored.locator;
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
