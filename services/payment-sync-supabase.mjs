const MAX_RESPONSE_BYTES = 2_000_000;

function text(value, maximum, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function integer(value, minimum, maximum, label) {
  const parsed = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`invalid ${label}`);
  }
  return parsed;
}

function hex(value, bytes, label) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${bytes * 2}}$`, "u").test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function base64url(value, bytes, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error(`invalid ${label}`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== bytes || decoded.toString("base64url") !== value) throw new Error(`invalid ${label}`);
  return value;
}

function deployment(network, vault) {
  if (network !== "stellar:testnet" && network !== "stellar:pubnet") {
    throw new Error("invalid payment sync network");
  }
  if (!/^C[A-Z2-7]{55}$/u.test(vault || "")) throw new Error("invalid payment sync vault");
  return { network, vault };
}

export function paymentSyncSupabaseConfig(env = process.env) {
  const url = env.PAYMENT_SYNC_SUPABASE_URL || env.PRIVATE_SYNC_SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = env.PAYMENT_SYNC_SUPABASE_SERVICE_ROLE_KEY || env.PRIVATE_SYNC_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url && !key) return null;
  if (!url || !key) throw new Error("private payment sync Supabase configuration is incomplete");
  return { url: url.replace(/\/+$/u, ""), key };
}

export class SupabasePaymentSyncRepository {
  constructor({ network, vault, env = process.env, fetchImpl = fetch, timeoutMs = 8_000 }) {
    const target = deployment(network, vault);
    const config = paymentSyncSupabaseConfig(env);
    if (!config) throw new Error("private payment sync Supabase is not configured");
    if (typeof fetchImpl !== "function") throw new Error("payment sync fetch implementation is required");
    this.network = target.network;
    this.vault = target.vault;
    this.url = config.url;
    this.key = config.key;
    this.fetch = fetchImpl;
    this.timeoutMs = integer(timeoutMs, 1_000, 30_000, "payment sync timeout");
  }

  async request(path, { method = "GET", body, prefer } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("payment sync database timed out")), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.url}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          apikey: this.key,
          authorization: `Bearer ${this.key}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(prefer ? { prefer } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`private payment sync database failed with HTTP ${response.status}`);
      if (response.status === 204) return null;
      const raw = await response.text();
      if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error("private payment sync response is too large");
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      if (error?.message?.startsWith("private payment sync")) throw error;
      throw new Error("private payment sync database is unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  scope(locator) {
    return `network=eq.${encodeURIComponent(this.network)}&vault=eq.${encodeURIComponent(this.vault)}&locator=eq.${encodeURIComponent(base64url(locator, 32, "archive locator"))}`;
  }

  async account(locator) {
    const records = await this.request(`/rest/v1/payment_sync_accounts?${this.scope(locator)}&select=signing_key,current_generation,current_epoch,head_hash,total_pages`);
    if (!Array.isArray(records) || records.length > 1) throw new Error("payment sync account response is invalid");
    if (records.length === 0) return null;
    return this.validateAccount(records[0]);
  }

  async registerAccount(locator, signingKey) {
    const records = await this.request("/rest/v1/rpc/register_payment_sync_account", {
      method: "POST",
      body: {
        target_network: this.network,
        target_vault: this.vault,
        target_locator: base64url(locator, 32, "archive locator"),
        target_signing_key: base64url(signingKey, 32, "archive signing key"),
      },
    });
    if (!Array.isArray(records) || records.length !== 1) throw new Error("payment sync account response is invalid");
    return this.validateAccount({ ...records[0], signing_key: signingKey });
  }

  validateAccount(value) {
    if (!value || typeof value !== "object") throw new Error("payment sync account response is invalid");
    return {
      signingKey: base64url(value.signing_key, 32, "archive signing key"),
      currentGeneration: integer(value.current_generation, 0, Number.MAX_SAFE_INTEGER, "archive generation"),
      currentEpoch: integer(value.current_epoch, 0, Number.MAX_SAFE_INTEGER, "archive epoch"),
      headHash: hex(value.head_hash, 32, "archive head hash"),
      totalPages: integer(value.total_pages, 0, 4_096, "archive page count"),
    };
  }

  async createSession({ tokenHash, locator, expiresAt }) {
    await this.request(`/rest/v1/payment_sync_sessions?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    await this.request("/rest/v1/payment_sync_sessions", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        token_hash: hex(tokenHash, 32, "sync session hash"),
        network: this.network,
        vault: this.vault,
        locator: base64url(locator, 32, "archive locator"),
        expires_at: new Date(integer(expiresAt, 1, Number.MAX_SAFE_INTEGER, "sync session expiry") * 1_000).toISOString(),
      },
    });
  }

  async session(tokenHash, now) {
    const hash = hex(tokenHash, 32, "sync session hash");
    const records = await this.request(`/rest/v1/payment_sync_sessions?token_hash=eq.${hash}&expires_at=gt.${encodeURIComponent(new Date(now * 1_000).toISOString())}&select=locator,expires_at`);
    if (!Array.isArray(records) || records.length > 1) throw new Error("payment sync session response is invalid");
    if (records.length === 0) return null;
    return {
      locator: base64url(records[0].locator, 32, "archive locator"),
      expiresAt: Math.floor(new Date(text(records[0].expires_at, 64, "sync session expiry")).getTime() / 1_000),
    };
  }

  async putPage(locator, page) {
    const generation = integer(page.generation, 1, Number.MAX_SAFE_INTEGER, "archive generation");
    const epoch = integer(page.epoch, 1, Number.MAX_SAFE_INTEGER, "archive epoch");
    const parentHash = hex(page.generationParentHash, 32, "archive generation parent hash");
    const pageNumber = integer(page.page, 0, 255, "archive page number");
    const pageHash = hex(page.hash, 32, "archive page hash");
    const previousHash = hex(page.previousHash, 32, "previous archive page hash");
    const encoded = text(page.encoded, 5_628, "encrypted archive page");
    if (encoded.length !== 5_628) throw new Error("invalid encrypted archive page");
    const targetLocator = base64url(locator, 32, "archive locator");
    await this.request("/rest/v1/payment_sync_generations?on_conflict=network,vault,locator,generation", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: {
        network: this.network,
        vault: this.vault,
        locator: targetLocator,
        generation,
        epoch,
        parent_hash: parentHash,
      },
    });
    const generations = await this.request(`/rest/v1/payment_sync_generations?${this.scope(targetLocator)}&generation=eq.${generation}&select=epoch,parent_hash,committed_at`);
    if (
      !Array.isArray(generations) ||
      generations.length !== 1 ||
      integer(generations[0].epoch, 1, Number.MAX_SAFE_INTEGER, "archive epoch") !== epoch ||
      generations[0].parent_hash !== parentHash
    ) {
      throw new Error("conflicting archive generation");
    }
    await this.request("/rest/v1/payment_sync_pages?on_conflict=network,vault,locator,generation,page_number", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: {
        network: this.network,
        vault: this.vault,
        locator: targetLocator,
        generation,
        page_number: pageNumber,
        epoch,
        previous_hash: previousHash,
        page_hash: pageHash,
        encoded_page: encoded,
      },
    });
    const records = await this.request(`/rest/v1/payment_sync_pages?${this.scope(targetLocator)}&generation=eq.${generation}&page_number=eq.${pageNumber}&select=epoch,previous_hash,page_hash,encoded_page`);
    if (
      !Array.isArray(records) ||
      records.length !== 1 ||
      integer(records[0].epoch, 1, Number.MAX_SAFE_INTEGER, "archive epoch") !== epoch ||
      records[0].previous_hash !== previousHash ||
      records[0].page_hash !== pageHash ||
      records[0].encoded_page !== encoded
    ) {
      throw new Error("conflicting archive page");
    }
    return { generation, page: pageNumber, hash: pageHash };
  }

  async putPages(locator, pages) {
    if (!Array.isArray(pages) || pages.length === 0 || pages.length > 64) {
      throw new Error("invalid encrypted archive page batch");
    }
    const normalized = pages.map((page) => ({
      generation: integer(page.generation, 1, Number.MAX_SAFE_INTEGER, "archive generation"),
      epoch: integer(page.epoch, 1, Number.MAX_SAFE_INTEGER, "archive epoch"),
      parentHash: hex(page.generationParentHash, 32, "archive generation parent hash"),
      pageNumber: integer(page.page, 0, 255, "archive page number"),
      pageHash: hex(page.hash, 32, "archive page hash"),
      previousHash: hex(page.previousHash, 32, "previous archive page hash"),
      encoded: text(page.encoded, 5_628, "encrypted archive page"),
    }));
    const first = normalized[0];
    if (normalized.some((page, index) => (
      page.generation !== first.generation ||
      page.epoch !== first.epoch ||
      page.parentHash !== first.parentHash ||
      page.pageNumber !== index ||
      page.encoded.length !== 5_628
    ))) {
      throw new Error("invalid encrypted archive page batch");
    }
    const targetLocator = base64url(locator, 32, "archive locator");
    await this.request("/rest/v1/payment_sync_generations?on_conflict=network,vault,locator,generation", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: {
        network: this.network,
        vault: this.vault,
        locator: targetLocator,
        generation: first.generation,
        epoch: first.epoch,
        parent_hash: first.parentHash,
      },
    });
    const generations = await this.request(`/rest/v1/payment_sync_generations?${this.scope(targetLocator)}&generation=eq.${first.generation}&select=epoch,parent_hash`);
    if (
      !Array.isArray(generations) ||
      generations.length !== 1 ||
      integer(generations[0].epoch, 1, Number.MAX_SAFE_INTEGER, "archive epoch") !== first.epoch ||
      generations[0].parent_hash !== first.parentHash
    ) {
      throw new Error("conflicting archive generation");
    }
    await this.request("/rest/v1/payment_sync_pages?on_conflict=network,vault,locator,generation,page_number", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: normalized.map((page) => ({
        network: this.network,
        vault: this.vault,
        locator: targetLocator,
        generation: page.generation,
        page_number: page.pageNumber,
        epoch: page.epoch,
        previous_hash: page.previousHash,
        page_hash: page.pageHash,
        encoded_page: page.encoded,
      })),
    });
    const records = await this.request(`/rest/v1/payment_sync_pages?${this.scope(targetLocator)}&generation=eq.${first.generation}&page_number=gte.0&page_number=lt.${normalized.length}&select=page_number,epoch,previous_hash,page_hash,encoded_page&order=page_number.asc`);
    if (!Array.isArray(records) || records.length !== normalized.length) {
      throw new Error("conflicting archive page batch");
    }
    records.forEach((record, index) => {
      const expected = normalized[index];
      if (
        record.page_number !== expected.pageNumber ||
        integer(record.epoch, 1, Number.MAX_SAFE_INTEGER, "archive epoch") !== expected.epoch ||
        record.previous_hash !== expected.previousHash ||
        record.page_hash !== expected.pageHash ||
        record.encoded_page !== expected.encoded
      ) {
        throw new Error("conflicting archive page batch");
      }
    });
    return normalized.map((page) => ({
      generation: page.generation,
      page: page.pageNumber,
      hash: page.pageHash,
    }));
  }

  async commit(locator, input) {
    const records = await this.request("/rest/v1/rpc/commit_payment_sync_generation", {
      method: "POST",
      body: {
        target_network: this.network,
        target_vault: this.vault,
        target_locator: base64url(locator, 32, "archive locator"),
        target_generation: integer(input.generation, 1, Number.MAX_SAFE_INTEGER, "archive generation"),
        target_epoch: integer(input.epoch, 1, Number.MAX_SAFE_INTEGER, "archive epoch"),
        target_page_count: integer(input.pageCount, 1, 256, "archive page count"),
        target_parent_hash: hex(input.parentHash, 32, "archive parent hash"),
        target_head_hash: hex(input.headHash, 32, "archive head hash"),
      },
    });
    if (!Array.isArray(records) || records.length !== 1) throw new Error("archive commit response is invalid");
    return {
      applied: Boolean(records[0].applied),
      currentGeneration: integer(records[0].current_generation, 1, Number.MAX_SAFE_INTEGER, "archive generation"),
    };
  }

  async generation(locator, generation) {
    const records = await this.request(`/rest/v1/payment_sync_generations?${this.scope(locator)}&generation=eq.${integer(generation, 1, Number.MAX_SAFE_INTEGER, "archive generation")}&committed_at=not.is.null&select=generation,epoch,parent_hash,head_hash,page_count,committed_at`);
    if (!Array.isArray(records) || records.length > 1) throw new Error("archive generation response is invalid");
    if (records.length === 0) return null;
    return {
      generation: integer(records[0].generation, 1, Number.MAX_SAFE_INTEGER, "archive generation"),
      epoch: integer(records[0].epoch, 1, Number.MAX_SAFE_INTEGER, "archive epoch"),
      parentHash: hex(records[0].parent_hash, 32, "archive parent hash"),
      headHash: hex(records[0].head_hash, 32, "archive head hash"),
      pageCount: integer(records[0].page_count, 1, 256, "archive page count"),
      committedAt: Math.floor(new Date(text(records[0].committed_at, 64, "archive commit time")).getTime() / 1_000),
    };
  }

  async draft(locator, generation) {
    const records = await this.request(`/rest/v1/payment_sync_generations?${this.scope(locator)}&generation=eq.${integer(generation, 1, Number.MAX_SAFE_INTEGER, "archive generation")}&select=generation,epoch,parent_hash,head_hash,page_count,committed_at`);
    if (!Array.isArray(records) || records.length > 1) throw new Error("archive generation response is invalid");
    if (records.length === 0) return null;
    return {
      generation: integer(records[0].generation, 1, Number.MAX_SAFE_INTEGER, "archive generation"),
      epoch: integer(records[0].epoch, 1, Number.MAX_SAFE_INTEGER, "archive epoch"),
      parentHash: hex(records[0].parent_hash, 32, "archive parent hash"),
      committed: records[0].committed_at !== null,
    };
  }

  async pages(locator, generation, fromPage, limit) {
    const start = integer(fromPage, 0, 256, "archive page cursor");
    const count = integer(limit, 1, 64, "archive page limit");
    const records = await this.request(`/rest/v1/payment_sync_pages?${this.scope(locator)}&generation=eq.${integer(generation, 1, Number.MAX_SAFE_INTEGER, "archive generation")}&page_number=gte.${start}&page_number=lt.${start + count}&select=page_number,encoded_page&order=page_number.asc`);
    if (!Array.isArray(records) || records.length > count) throw new Error("archive page response is invalid");
    records.forEach((record, index) => {
      if (record.page_number !== start + index || typeof record.encoded_page !== "string" || record.encoded_page.length !== 5_628) {
        throw new Error("archive page response is invalid");
      }
    });
    return records.map((record) => record.encoded_page);
  }

  async deleteGenerationsBefore(locator, minimumGeneration) {
    const records = await this.request("/rest/v1/rpc/delete_payment_sync_generations_before", {
      method: "POST",
      body: {
        target_network: this.network,
        target_vault: this.vault,
        target_locator: base64url(locator, 32, "archive locator"),
        minimum_generation: integer(minimumGeneration, 1, Number.MAX_SAFE_INTEGER, "minimum archive generation"),
      },
    });
    if (!Array.isArray(records) || records.length !== 1) throw new Error("archive deletion response is invalid");
    return {
      removed: integer(records[0].removed, 0, Number.MAX_SAFE_INTEGER, "removed archive generations"),
      totalPages: integer(records[0].total_pages, 0, 4_096, "archive page count"),
    };
  }
}
