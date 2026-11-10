import assert from "node:assert/strict";
import nextConfig from "../next.config";

const redirects = await nextConfig.redirects!();

for (const host of ["predict.moros.fun", "www.moros.fun"]) {
  const redirect = redirects.find((rule) => rule.has?.some((condition) => condition.type === "host" && condition.value === host));
  assert.equal(redirect?.source, "/:path*");
  assert.equal(redirect?.destination, "https://moros.fun/:path*");
  assert.equal(redirect?.permanent, true);
}

for (const host of ["moros.fun", "pay.moros.fun"]) {
  assert.equal(redirects.some((rule) => rule.has?.some((condition) => condition.type === "host" && condition.value === host)), false);
}

for (const route of ["create", "portfolio", "liquidity", "markets", "market"]) {
  assert.equal(redirects.find((rule) => rule.source === `/app/${route}/:path*`)?.destination, "/app");
}
for (const route of ["send", "receive", "request", "activity", "contacts", "deposit", "withdraw", "settings"]) {
  assert.equal(redirects.find((rule) => rule.source === `/${route}`)?.destination, `/app/${route}`);
  assert.equal(redirects.some((rule) => rule.source === `/app/${route}`), false);
}
assert.equal(redirects.find((rule) => rule.source === "/whitepaper.pdf")?.destination, "/");

console.log("payment site routing tests passed");
