import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync, readFileSync } from "fs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

function loadEnv() {
  const f = resolve(here, ".env");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

export const cfg = {
  repo,
  network: process.env.MOROS_PAYMENT_NETWORK || process.env.MOROS_NETWORK || "testnet",
};
