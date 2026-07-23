"use client";
import { computeCommitment } from "@/lib/zk/commit";
import { proveEncryptOrder } from "@/lib/zk/prove";
import { getPk, getProof, postOrder, registerPool } from "@/lib/committee/client";
import { placeOrder } from "@/lib/stellar/write";
import { addPosition, updatePosition } from "@/lib/positions/book";
import { savePositionBackup } from "@/lib/positions/backup";
import type { PrivateArchiveKeys } from "@/lib/private-sync/crypto";
import type { Position } from "@/lib/positions/book";
import { NETWORK, type CollateralAsset } from "@/lib/network";
import { parsePrivatePositionQuantity, privacyStakeForOrder } from "@/lib/stellar/amount";
import { getPrivateConfig } from "@/lib/private/client";
import { placePrivateOrder } from "@/lib/private/actions";

const R = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;

function rand(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return ((BigInt("0x" + hex) % (R - 1n)) + 1n).toString();
}

export type BetSide = "0" | "1";
export type BetStage = "securing" | "hashing" | "placing" | "waiting" | "proving" | "submitting" | "done";

export async function runBet(
  { side, amount, address, collateral, marketId, poolId, backupKey, onStage }:
  { side: BetSide; amount: string; address: string; collateral: CollateralAsset; marketId: string; poolId: string; backupKey: PrivateArchiveKeys; onStage: (s: BetStage) => void }
) {
  if (collateral.sac !== NETWORK.collateral.sac) throw new Error("Moros testnet markets require Stellar USDC");
  const privateConfig = await getPrivateConfig();
  if (poolId === privateConfig.contracts.sharedVault) {
    const quantity = parsePrivatePositionQuantity(amount);
    onStage("hashing");
    onStage("placing");
    const placed = await placePrivateOrder({
      address,
      market: marketId,
      side: side === "1" ? 1 : 0,
      quantity,
      onStatus: (status) => {
        if (status.includes("Waiting")) onStage("waiting");
        else if (status.includes("Generating")) onStage("proving");
        else if (status.includes("Relaying")) onStage("submitting");
      },
    });
    const stakeUnits = (
      (placed.positionBudget + 10n ** BigInt(collateral.decimals) - 1n) /
      10n ** BigInt(collateral.decimals)
    ).toString();
    const position: Position = {
      address,
      market: marketId,
      pool: poolId,
      side,
      amount,
      stakeAmount: stakeUnits,
      stakeAmountAtomic: placed.positionBudget.toString(),
      collateralCode: collateral.code,
      secret: placed.encryptionRandomness.toString(),
      nullifier: placed.positionNullifier.toString(),
      executionChangeNullifier: placed.executionChangeNullifier.toString(),
      commitment: placed.positionCommitment.toString(),
      txHash: placed.hash,
      placedAt: Date.now(),
      status: "submitted",
      backupStatus: "local",
      protocol: "shared-vault",
      privateEpoch: placed.epoch.toString(),
      privateSequence: placed.sequence.toString(),
    };
    addPosition(position);
    let backupSynced = false;
    try {
      await savePositionBackup(position, backupKey);
      backupSynced = true;
    } catch (cause) {
      updatePosition(address, position.commitment, {
        backupStatus: "local",
        backupError: cause instanceof Error ? cause.message : "Encrypted backup failed",
      });
    }
    onStage("done");
    return { backupSynced };
  }
  await registerPool(marketId, poolId);
  const pk = await getPk();

  const privateStake = privacyStakeForOrder(amount, collateral.decimals);
  const secret = rand();
  const nullifier = rand();
  onStage("hashing");
  const { commitment } = await computeCommitment({ amount: privateStake.orderAmount, side, secret, nullifier });
  onStage("placing");
  const txHash = await placeOrder(commitment, privateStake.stakeAtomic, poolId);
  const position: Position = {
    address,
    market: marketId,
    pool: poolId,
    side,
    amount: privateStake.orderAmount,
    stakeAmount: privateStake.stakeAmount,
    collateralCode: collateral.code,
    secret,
    nullifier,
    commitment,
    txHash,
    placedAt: Date.now(),
    status: "placed",
    backupStatus: "local",
  };
  addPosition(position);
  let backupSynced = false;
  try {
    await savePositionBackup(position, backupKey);
    backupSynced = true;
  } catch (cause) {
    updatePosition(address, commitment, {
      backupStatus: "local",
      backupError: cause instanceof Error ? cause.message : "Encrypted backup failed",
    });
  }
  onStage("proving");
  const { pathIndex, siblings, orderRoot } = await getProof(commitment, poolId);
  const input = { orderRoot, amount: privateStake.orderAmount, side, secret, nullifier, ryes: rand(), rno: rand(), pk, pathIndex, siblings };
  const { proof, publicSignals } = await proveEncryptOrder(input);
  onStage("submitting");
  try {
    await postOrder({ proof, publicSignals, poolId });
    updatePosition(address, commitment, { status: "submitted", submissionError: undefined });
    if (backupSynced) {
      try {
        await savePositionBackup({ ...position, status: "submitted", backupStatus: "synced" }, backupKey);
      } catch (cause) {
        backupSynced = false;
        updatePosition(address, commitment, {
          backupStatus: "local",
          backupError: cause instanceof Error ? cause.message : "Encrypted backup update failed",
        });
      }
    }
  } catch (cause) {
    updatePosition(address, commitment, {
      submissionError: cause instanceof Error ? cause.message : "Committee submission failed",
    });
    throw cause;
  }
  onStage("done");
  return { backupSynced };
}

export async function retryBetSubmission({
  position,
  poolId,
  backupKey,
  onStage,
}: {
  position: Position;
  poolId: string;
  backupKey?: PrivateArchiveKeys;
  onStage: (stage: BetStage) => void;
}) {
  await registerPool(position.market, poolId);
  const pk = await getPk();
  onStage("proving");
  const { pathIndex, siblings, orderRoot } = await getProof(position.commitment, poolId);
  const input = {
    orderRoot,
    amount: position.amount,
    side: position.side,
    secret: position.secret,
    nullifier: position.nullifier,
    ryes: rand(),
    rno: rand(),
    pk,
    pathIndex,
    siblings,
  };
  const { proof, publicSignals } = await proveEncryptOrder(input);
  onStage("submitting");
  await postOrder({ proof, publicSignals, poolId });
  updatePosition(position.address, position.commitment, { status: "submitted", submissionError: undefined });
  if (backupKey) {
    await savePositionBackup({ ...position, pool: poolId, status: "submitted" }, backupKey);
  }
  onStage("done");
}
