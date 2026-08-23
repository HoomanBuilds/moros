import assert from "node:assert/strict";

const moduleUrl = new URL("./stellar-walletconnect.ts", import.meta.url).href;
const {
  freighterPairingUrl,
  pairingTopicFromUri,
  parseWalletConnectProjectId,
  selectWalletConnectSession,
  signedXdrFromWalletConnect,
  stellarWalletConnectChain,
  walletConnectAccountFromEvent,
  walletConnectSessionAddress,
} = await import(moduleUrl);

const account = `G${"A".repeat(55)}`;
const topic = "a".repeat(64);
const pairingUri = `wc:${topic}@2?relay-protocol=irn&symKey=${"b".repeat(64)}`;
const session = {
  topic: "session-topic",
  expiry: 2_000,
  namespaces: {
    stellar: {
      accounts: [`stellar:pubnet:${account}`],
      methods: ["stellar_signXDR"],
      events: ["accountsChanged"],
    },
  },
  peer: { metadata: { name: "Existing wallet" } },
};

assert.equal(parseWalletConnectProjectId("A".repeat(32)), "a".repeat(32));
assert.equal(parseWalletConnectProjectId("invalid"), null);
assert.equal(stellarWalletConnectChain("mainnet", "mainnet"), "stellar:pubnet");
assert.equal(stellarWalletConnectChain("testnet", "testnet"), "stellar:testnet");
assert.equal(stellarWalletConnectChain("local", "local"), null);
assert.equal(walletConnectSessionAddress(session, "stellar:pubnet"), account);
assert.equal(walletConnectSessionAddress(session, "stellar:testnet"), null);
assert.equal(walletConnectSessionAddress({ ...session, namespaces: { stellar: { ...session.namespaces.stellar, methods: [] } } }, "stellar:pubnet"), null);
assert.equal(selectWalletConnectSession([session], "stellar:pubnet", 1_000), session);
assert.equal(selectWalletConnectSession([session], "stellar:pubnet", 3_000), null);
assert.equal(selectWalletConnectSession([{ ...session, topic: "older", expiry: 1_500 }, session], "stellar:pubnet", 1_000), session);
assert.equal(walletConnectAccountFromEvent([`stellar:pubnet:${account}`], "stellar:pubnet"), account);
assert.equal(walletConnectAccountFromEvent(`stellar:testnet:${account}`, "stellar:pubnet"), null);
assert.equal(walletConnectAccountFromEvent({}, "stellar:pubnet"), null);
assert.equal(signedXdrFromWalletConnect({ signedXDR: "A".repeat(16) }), "A".repeat(16));
assert.throws(() => signedXdrFromWalletConnect({ signedTxXdr: "A".repeat(16) }));
assert.throws(() => signedXdrFromWalletConnect({ signedXDR: "short" }));
assert.equal(pairingTopicFromUri(pairingUri), topic);
assert.equal(freighterPairingUrl(pairingUri), `freighterwallet://wc?uri=${encodeURIComponent(pairingUri)}`);
assert.throws(() => freighterPairingUrl("not-walletconnect"));

console.log("Stellar WalletConnect tests passed");
