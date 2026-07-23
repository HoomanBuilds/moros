import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { resolve, sep } from "node:path";

function fileSha256(path) {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

export function parseRange(value, size) {
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match) throw new Error("invalid range");
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) {
      throw new Error("invalid range");
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    throw new Error("range is outside the artifact");
  }
  return { start, end: Math.min(end, size - 1), partial: true };
}

export class PrivateArtifactStore {
  constructor({ root, deployment }) {
    this.root = resolve(root);
    const manifestPath = resolve(this.root, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error("private proving artifact manifest is missing");
    }
    this.manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
      this.manifest.network !== "testnet" ||
      this.manifest.mainnet_ready !== false ||
      this.manifest.setup_manifest_sha256 !==
        deployment.provingManifestSha256
    ) {
      throw new Error("private proving artifacts do not match the deployment");
    }
    this.files = new Map([["manifest.json", manifestPath]]);
    for (const circuit of this.manifest.circuits || []) {
      const entries = [
        ["wasm", "wasm_sha256"],
        ["proving_key", "proving_key_sha256"],
        ["verification_key", "verification_key_sha256"],
      ];
      for (const [kind, hashField] of entries) {
        const relative = circuit.artifacts?.[kind];
        const path = resolve(this.root, relative || "");
        if (
          !relative ||
          !path.startsWith(`${this.root}${sep}`) ||
          !existsSync(path) ||
          fileSha256(path) !== circuit[hashField]
        ) {
          throw new Error(`${circuit.name} ${kind} artifact is invalid`);
        }
        this.files.set(relative, path);
      }
    }
  }

  path(relative) {
    return this.files.get(relative);
  }

  serve(request, response, relative, responseHeaders = {}) {
    const path = this.path(relative);
    if (!path) return false;
    const size = statSync(path).size;
    let range;
    try {
      range = parseRange(request.headers.range, size);
    } catch {
      response.writeHead(416, {
        ...responseHeaders,
        "content-range": `bytes */${size}`,
      });
      response.end();
      return true;
    }
    const contentType = relative.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "application/octet-stream";
    const headers = {
      ...responseHeaders,
      "accept-ranges": "bytes",
      "cache-control": relative === "manifest.json"
        ? "no-cache"
        : "public, max-age=31536000, immutable",
      "content-length": range.end - range.start + 1,
      "content-type": contentType,
    };
    if (range.partial) {
      headers["content-range"] =
        `bytes ${range.start}-${range.end}/${size}`;
    }
    response.writeHead(range.partial ? 206 : 200, headers);
    if (request.method === "HEAD") {
      response.end();
    } else {
      createReadStream(path, {
        start: range.start,
        end: range.end,
      }).pipe(response);
    }
    return true;
  }
}
