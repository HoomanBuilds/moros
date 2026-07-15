import {
  rpc,
  TransactionBuilder,
  Operation,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";
import { getKit } from "@/lib/wallet";
import {
  MARKET_WASM_HASH,
  POOL_WASM_HASH,
  COMMITTEE_MEMBERS,
  COMMITTEE_THRESHOLD,
  LMSR_B,
  POOL_CAP,
  MAIN_VK,
  DEPOSIT_VK,
  REDEEMV2_VK,
  RESOLVER_ID,
  RESOLVABLE_ASSETS,
} from "./deploy-constants";

const server = new rpc.Server(NETWORK.rpcUrl);

export type DeployStep = "market" | "pool" | "batcher" | "committee" | "redeemvk" | "resolver" | "done";

function bytesArg(hex: string): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
}

function addr(a: string): xdr.ScVal {
  return Address.fromString(a).toScVal();
}

function randomSalt(): Buffer {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export function strikeToRaw(strikeUsd: number): bigint {
  return BigInt(Math.round(strikeUsd * 1e4)) * 10_000_000_000n;
}

async function signSend(tx: import("@stellar/stellar-sdk").Transaction, address: string) {
  const prepared = await server.prepareTransaction(tx);
  const { signedTxXdr } = await getKit().signTransaction(prepared.toXDR(), {
    networkPassphrase: NETWORK.passphrase,
    address,
  });
  const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK.passphrase));
  if (sent.status === "ERROR") throw new Error("transaction rejected by network");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const g = await server.getTransaction(sent.hash);
    if (g.status === "SUCCESS") return g;
    if (g.status === "FAILED") throw new Error("transaction failed on-chain");
  }
  throw new Error("transaction timed out");
}

async function deployByHash(wasmHash: string, ctorArgs: xdr.ScVal[], address: string): Promise<string> {
  const acc = await server.getAccount(address);
  const tx = new TransactionBuilder(acc, { fee: "3000000", networkPassphrase: NETWORK.passphrase })
    .addOperation(
      Operation.createCustomContract({
        address: Address.fromString(address),
        wasmHash: Buffer.from(wasmHash, "hex"),
        salt: randomSalt(),
        constructorArgs: ctorArgs,
      }),
    )
    .setTimeout(120)
    .build();
  const g = await signSend(tx, address);
  return scValToNative(g.returnValue!) as string;
}

async function invokeSigned(contractId: string, method: string, args: xdr.ScVal[], address: string) {
  const acc = await server.getAccount(address);
  const c = new Contract(contractId);
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
    .addOperation(c.call(method, ...args))
    .setTimeout(120)
    .build();
  return signSend(tx, address);
}

export async function deployShieldedMarket({
  address,
  asset,
  strikeUsd,
  expiryUnix,
  onStep,
}: {
  address: string;
  asset: string;
  strikeUsd: number;
  expiryUnix: number;
  onStep: (s: DeployStep) => void;
}): Promise<{ marketId: string; poolId: string }> {
  onStep("market");
  const marketId = await deployByHash(
    MARKET_WASM_HASH,
    [
      addr(address),
      addr(NETWORK.xlmSac),
      nativeToScVal(BigInt(LMSR_B), { type: "i128" }),
      nativeToScVal(asset, { type: "symbol" }),
      nativeToScVal(strikeToRaw(strikeUsd), { type: "i128" }),
      nativeToScVal(BigInt(expiryUnix), { type: "u64" }),
    ],
    address,
  );

  onStep("pool");
  const poolId = await deployByHash(
    POOL_WASM_HASH,
    [
      bytesArg(MAIN_VK),
      bytesArg(DEPOSIT_VK),
      addr(NETWORK.xlmSac),
      addr(address),
      addr(marketId),
      nativeToScVal(BigInt(POOL_CAP), { type: "i128" }),
    ],
    address,
  );

  onStep("batcher");
  await invokeSigned(marketId, "set_batcher", [addr(address), addr(poolId)], address);

  onStep("committee");
  await invokeSigned(
    poolId,
    "set_committee",
    [
      addr(address),
      xdr.ScVal.scvVec(COMMITTEE_MEMBERS.map((m) => addr(m))),
      nativeToScVal(COMMITTEE_THRESHOLD, { type: "u32" }),
    ],
    address,
  );

  onStep("redeemvk");
  await invokeSigned(poolId, "set_redeem_v2_vk", [addr(address), bytesArg(REDEEMV2_VK)], address);

  if (RESOLVABLE_ASSETS.includes(asset.toUpperCase())) {
    onStep("resolver");
    await invokeSigned(marketId, "set_resolver", [addr(address), addr(RESOLVER_ID)], address);
  }

  onStep("done");
  return { marketId, poolId };
}
