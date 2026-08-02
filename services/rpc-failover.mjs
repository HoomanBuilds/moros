const INSTALLED = Symbol.for("moros.rpcFailover");

function normalized(value) {
  return String(value).replace(/\/+$/u, "");
}

function requestUrl(input) {
  return normalized(
    typeof input === "string" || input instanceof URL
      ? input
      : input.url,
  );
}

function requestFor(url, input) {
  if (typeof input === "string" || input instanceof URL) return url;
  return new Request(url, input.clone());
}

function attemptSignal(callerSignal, timeoutMs) {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(callerSignal.reason);
  if (callerSignal) {
    if (callerSignal.aborted) {
      onCallerAbort();
    } else {
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }
  const timer = setTimeout(
    () => controller.abort(new Error("RPC attempt timed out")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}

export async function rpcFetch(
  urls,
  input,
  init,
  fetchImpl = globalThis.fetch,
  { attemptTimeoutMs = 8_000 } = {},
) {
  if (!Number.isSafeInteger(attemptTimeoutMs) || attemptTimeoutMs < 1) {
    throw new Error("RPC attempt timeout must be a positive integer");
  }
  const candidates = [...new Set(urls)];
  const target = requestUrl(input);
  if (!candidates.some((url) => normalized(url) === target)) {
    return fetchImpl(input, init);
  }
  const callerSignal = init?.signal;
  let lastResponse;
  let lastError;
  for (const url of candidates) {
    if (callerSignal?.aborted) {
      throw callerSignal.reason || new Error("RPC request was aborted");
    }
    const attempt = attemptSignal(callerSignal, attemptTimeoutMs);
    try {
      const response = await fetchImpl(requestFor(url, input), {
        ...init,
        signal: attempt.signal,
      });
      if (response.status !== 429 && response.status < 500) {
        return response;
      }
      lastResponse = response;
    } catch (error) {
      if (callerSignal?.aborted) throw error;
      lastError = error;
    } finally {
      attempt.clear();
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError || new Error("RPC endpoints are unavailable");
}

export function configureRpcFailover(network) {
  const urls = [...new Set(network.rpcUrls || [network.rpcUrl])];
  if (urls.length < 2) return urls[0];
  if (!globalThis[INSTALLED]) {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) =>
      rpcFetch(urls, input, init, originalFetch);
    globalThis[INSTALLED] = true;
  }
  return urls[0];
}
