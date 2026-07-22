import assert from "node:assert";
import {
  ensureMarketRegistrySession,
  marketRegistryErrorMessage,
} from "./markets-meta.ts";

const creator = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function authClient(wallets: Array<string | null>, errors: Array<string | null> = []) {
  let call = 0;
  return {
    auth: {
      getUser: async () => {
        const index = call++;
        const message = errors[index] ?? null;
        return {
          data: {
            user: wallets[index]
              ? { app_metadata: { wallet: wallets[index] } }
              : null,
          },
          error: message ? { message } : null,
        };
      },
    },
  };
}

async function main() {
  let signIns = 0;
  await ensureMarketRegistrySession(authClient([creator]), creator, async () => {
    signIns += 1;
    return { ok: true };
  });
  assert.equal(signIns, 0);

  await ensureMarketRegistrySession(authClient([null, creator], ["expired token"]), creator, async () => {
    signIns += 1;
    return { ok: true };
  });
  assert.equal(signIns, 1);

  await assert.rejects(
    ensureMarketRegistrySession(authClient([null]), creator, async () => ({ ok: false, error: "signature canceled" })),
    /signature canceled/,
  );

  await assert.rejects(
    ensureMarketRegistrySession(authClient([null, "GOTHER"]), creator, async () => ({ ok: true })),
    /does not match the connected Stellar wallet/,
  );

  assert.match(
    marketRegistryErrorMessage({ code: "42501", message: "row-level security" }),
    /approve wallet sign-in/,
  );
  assert.match(
    marketRegistryErrorMessage({ code: "PGRST204", message: "missing column" }),
    /missing a required database migration/,
  );
  assert.match(
    marketRegistryErrorMessage({ code: "XX000", message: "database unavailable" }),
    /database unavailable \(XX000\)/,
  );

  console.log("market registry session ok");
}

void main();
