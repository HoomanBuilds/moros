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

export async function rpcFetch(
  urls,
  input,
  init,
  fetchImpl = globalThis.fetch,
) {
  const candidates = [...new Set(urls)];
  const target = requestUrl(input);
  if (!candidates.some((url) => normalized(url) === target)) {
    return fetchImpl(input, init);
  }
  let lastResponse;
  let lastError;
  for (const url of candidates) {
    try {
      const response = await fetchImpl(requestFor(url, input), init);
      if (response.status !== 429 && response.status < 500) {
        return response;
      }
      lastResponse = response;
    } catch (error) {
      lastError = error;
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
