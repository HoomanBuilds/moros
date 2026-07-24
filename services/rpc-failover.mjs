import http from "node:http";

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("RPC request is too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function startRpcFailover(network) {
  const urls = [...new Set(network.rpcUrls || [network.rpcUrl])];
  if (urls.length < 2) return urls[0];
  const timeoutMs = Number(
    process.env.MOROS_RPC_FAILOVER_TIMEOUT_MS || "5000",
  );
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let body;
    try {
      body = await requestBody(request);
    } catch {
      response.writeHead(413).end();
      return;
    }
    for (const url of urls) {
      try {
        const upstream = await fetch(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (upstream.status === 429 || upstream.status >= 500) {
          continue;
        }
        const result = Buffer.from(await upstream.arrayBuffer());
        response.writeHead(upstream.status, {
          "content-type":
            upstream.headers.get("content-type") || "application/json",
        });
        response.end(result);
        return;
      } catch {}
    }
    response.writeHead(503, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: `${network.id} RPC endpoints are unavailable`,
        },
      }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}
