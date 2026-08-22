import { PaymentHttpClient } from "./http.mjs";
import { validatePaymentDeployment } from "./config.mjs";

function hex(value, bytes, label) {
  if (Buffer.isBuffer(value)) value = value.toString("hex");
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function base64url(value, bytes, label) {
  if (Buffer.isBuffer(value)) value = value.toString("base64url");
  const decoded = typeof value === "string" ? Buffer.from(value, "base64url") : null;
  if (
    typeof value !== "string" ||
    decoded.length !== bytes ||
    decoded.toString("base64url") !== value
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
    const encoded = Buffer.isBuffer(page) ? page.toString("base64") : page;
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
