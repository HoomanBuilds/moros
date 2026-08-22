import { PaymentHttpClient } from "./http.mjs";
import { validatePaymentDeployment } from "./config.mjs";
import {
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
} from "./encoding.mjs";

function hex(value, bytes, label) {
  if (value instanceof Uint8Array) value = bytesToHex(value);
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function base64url(value, bytes, label) {
  if (value instanceof Uint8Array) value = bytesToBase64Url(value);
  let decoded;
  try {
    decoded = typeof value === "string" ? base64UrlToBytes(value) : null;
  } catch {
    throw new Error(`invalid ${label}`);
  }
  if (
    typeof value !== "string" ||
    decoded.length !== bytes
  ) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

export class MorosPaymentClient {
  constructor({ deployment, fetchImpl, timeoutMs, attempts, now }) {
    this.deployment = validatePaymentDeployment(deployment);
    this.http = new PaymentHttpClient({
      endpoints: this.deployment.apiUrls,
      fetchImpl,
      timeoutMs,
      attempts,
      now,
    });
  }

  health(options) {
    return this.http.request("/v1/health", options);
  }

  quote({ actionId, actionExpiry }, options) {
    return this.http.request("/v1/relay/quote", {
      ...options,
      method: "POST",
      body: { actionId: hex(actionId, 32, "action id"), actionExpiry },
    });
  }

  relay({ method, args }, options) {
    return this.http.request("/v1/relay/submit", {
      ...options,
      method: "POST",
      body: { contract: this.deployment.vault, method, args },
    });
  }

  outputs({ fromLeafIndex = 0, limit = 100 } = {}, options) {
    return this.http.request(`/v1/outputs?from=${fromLeafIndex}&limit=${limit}`, options);
  }

  attachment(actionId, options) {
    return this.http.request(`/v1/attachments/${hex(actionId, 32, "action id")}`, options);
  }

  action(actionId, options) {
    return this.http.request(`/v1/actions/${hex(actionId, 32, "action id")}`, options);
  }

  syncChallenge({ locator, signingKey }, options) {
    return this.http.request("/v1/sync/challenge", {
      ...options,
      method: "POST",
      body: {
        locator: base64url(locator, 32, "archive locator"),
        signingKey: base64url(signingKey, 32, "archive signing key"),
      },
    });
  }

  syncAuthenticate({ locator, signingKey, challenge, expiresAt, signature }, options) {
    return this.http.request("/v1/sync/authenticate", {
      ...options,
      method: "POST",
      body: {
        locator: base64url(locator, 32, "archive locator"),
        signingKey: base64url(signingKey, 32, "archive signing key"),
        challenge: base64url(challenge, 32, "sync challenge"),
        expiresAt,
        signature: base64url(signature, 64, "sync signature"),
      },
    });
  }

  syncManifest(token, options) {
    return this.http.request("/v1/sync/manifest", { ...options, token });
  }

  syncPages(token, { generation, fromPage = 0, limit = 32 } = {}, options) {
    const generationQuery = generation === undefined ? "" : `&generation=${generation}`;
    return this.http.request(`/v1/sync/pages?from=${fromPage}&limit=${limit}${generationQuery}`, {
      ...options,
      token,
    });
  }

  syncPutPage(token, page, options) {
    const encoded = page instanceof Uint8Array ? bytesToBase64(page) : page;
    return this.http.request("/v1/sync/pages", {
      ...options,
      method: "PUT",
      token,
      body: { page: encoded },
    });
  }

  syncCommit(token, commit, options) {
    return this.http.request("/v1/sync/commit", {
      ...options,
      method: "POST",
      token,
      body: {
        ...commit,
        headHash: hex(commit.headHash, 32, "archive head hash"),
        expectedParentHash: hex(commit.expectedParentHash, 32, "archive parent hash"),
      },
    });
  }
}
