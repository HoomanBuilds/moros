import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const destination = resolve(
  process.env.MOROS_PTAU ||
    resolve(here, "../ptau/powersOfTau28_hez_final_18.ptau"),
);
const url =
  "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_18.ptau";
const expected =
  "7e6a9c2e5f05179ddfc923f38f917c9e6831d16922a902b0b4758b8e79c2ab8a81bb5f29952e16ee6c5067ed044d7857b5de120a90704c1d3b637fd94b95b13e";

async function digest(path) {
  const hash = createHash("blake2b512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

if (existsSync(destination) && (await digest(destination)) === expected) {
  console.log(destination);
  process.exit(0);
}

mkdirSync(dirname(destination), { recursive: true });
const partial = `${destination}.download`;
const response = await fetch(url);
if (!response.ok || !response.body) {
  throw new Error(`Powers of Tau download failed with HTTP ${response.status}`);
}
await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
if ((await digest(partial)) !== expected) {
  throw new Error("downloaded Powers of Tau transcript failed BLAKE2b verification");
}
renameSync(partial, destination);
console.log(destination);
