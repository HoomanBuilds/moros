import { existsSync, readFileSync } from "node:fs";
import * as snarkjs from "snarkjs";
import { proofBytes } from "../circuits/private/artifacts.mjs";
import {
  batchPublicSignals,
  buildBatchStatement,
  decryptBatchSides,
  invocationResultValue,
} from "./private-protocol.mjs";

async function send(transaction) {
  return (await transaction).signAndSend();
}

export function phaseName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.tag === "string") return value.tag;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  throw new Error("unknown private epoch phase");
}

export function createBatchProver({ wasmPath, zkeyPath, vkeyPath }) {
  if (
    !existsSync(wasmPath) ||
    !existsSync(zkeyPath) ||
    !existsSync(vkeyPath)
  ) {
    throw new Error("private batch proving artifacts are incomplete");
  }
  const vkey = JSON.parse(readFileSync(vkeyPath, "utf8"));
  return async (witness) => {
    const expected = batchPublicSignals(witness);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      witness,
      wasmPath,
      zkeyPath,
    );
    const actual = publicSignals.map((value) => BigInt(value));
    if (
      actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])
    ) {
      throw new Error("batch prover returned unexpected public signals");
    }
    if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) {
      throw new Error("batch proof failed local verification");
    }
    return proofBytes(proof);
  };
}

export class PrivateBatchCoordinator {
  constructor({
    vault,
    vaultId,
    networkDomain,
    committeeSecret,
    marketClient,
    prove,
    publishAllocations = async () => {},
    submit = send,
    now = () => Math.floor(Date.now() / 1_000),
  }) {
    if (
      !vault ||
      !vaultId ||
      !networkDomain ||
      !committeeSecret ||
      !marketClient ||
      !prove
    ) {
      throw new Error("private batch coordinator configuration is incomplete");
    }
    this.vault = vault;
    this.vaultId = vaultId;
    this.networkDomain = networkDomain;
    this.committeeSecret = committeeSecret;
    this.marketClient = marketClient;
    this.prove = prove;
    this.publishAllocations = publishAllocations;
    this.submit = submit;
    this.now = now;
    this.processing = new Set();
  }

  async process(market) {
    if (this.processing.has(market)) return { status: "busy" };
    this.processing.add(market);
    try {
      return await this.processUnlocked(market);
    } finally {
      this.processing.delete(market);
    }
  }

  async processUnlocked(market) {
    const registration = invocationResultValue(
      await this.vault.registration({ market }),
    );
    if (!registration) throw new Error("market is not registered");
    if (registration.finalized) return { status: "finalized" };
    const marketContract = await this.marketClient(market);
    const outcome = invocationResultValue(await marketContract.outcome());
    if (outcome !== undefined && outcome !== null) {
      await this.submit(this.vault.finalize_market({ market }));
      return { status: "finalized" };
    }
    const epochNumber = BigInt(registration.current_epoch);
    let epoch = invocationResultValue(
      await this.vault.epoch({
        market,
        epoch_number: epochNumber,
      }),
    );
    if (!epoch) throw new Error("current private epoch is unavailable");
    let phase = phaseName(epoch.phase);
    const now = this.now();

    if (
      phase === "Collecting" &&
      (
        Number(epoch.accepted_count) >=
          Number(registration.fixed_batch_size) ||
        now >= Number(epoch.cutoff)
      )
    ) {
      await this.submit(this.vault.seal_epoch({
        market,
        epoch_number: epochNumber,
      }));
      epoch = invocationResultValue(
        await this.vault.epoch({
          market,
          epoch_number: epochNumber,
        }),
      );
      phase = phaseName(epoch.phase);
    }

    if (phase === "Collecting") {
      return {
        status: "collecting",
        epoch: epochNumber.toString(),
        accepted: Number(epoch.accepted_count),
      };
    }

    if (phase === "Sealed" && now >= Number(epoch.refund_at)) {
      await this.submit(this.vault.make_epoch_refundable({
        market,
        epoch_number: epochNumber,
      }));
      return {
        status: "refundable",
        epoch: epochNumber.toString(),
        accepted: Number(epoch.accepted_count),
      };
    }

    if (
      phase === "Sealed" &&
      Number(epoch.accepted_count) ===
        Number(registration.fixed_batch_size)
    ) {
      const orders = [];
      for (
        let sequence = BigInt(epoch.first_sequence);
        sequence <= BigInt(epoch.last_sequence);
        sequence++
      ) {
        const order = invocationResultValue(
          await this.vault.order({ market, sequence }),
        );
        if (!order) throw new Error(`private order ${sequence} is unavailable`);
        orders.push(order);
      }
      const sides = decryptBatchSides(orders, this.committeeSecret);
      const yesCount = sides.filter((side) => side === 1).length;
      const noCount = sides.length - yesCount;
      if (
        yesCount < Number(registration.minimum_side_count) ||
        noCount < Number(registration.minimum_side_count)
      ) {
        return {
          status: "sealed-one-sided",
          epoch: epochNumber.toString(),
          accepted: orders.length,
        };
      }
      const quote = invocationResultValue(
        await marketContract.quote_private_batch({
          expected_version: BigInt(epoch.market_state_version),
          yes_count: yesCount,
          no_count: noCount,
        }),
      );
      const statement = buildBatchStatement({
        networkDomain: this.networkDomain,
        vault: this.vaultId,
        market,
        registration,
        epoch,
        orders,
        quote,
        committeeSecret: this.committeeSecret,
      });
      const proof = await this.prove(statement.witness);
      await this.publishAllocations(statement.allocationPackages);
      await this.submit(this.vault.submit_batch({
        market,
        epoch_number: epochNumber,
        submission: {
          yes_count: yesCount,
          no_count: noCount,
          committee_epoch: BigInt(registration.committee_epoch),
          aggregate_ciphertext: {
            c1_x: statement.aggregate.c1[0],
            c1_y: statement.aggregate.c1[1],
            c2_x: statement.aggregate.c2[0],
            c2_y: statement.aggregate.c2[1],
          },
          decryption_proof_hash: statement.decryptionProofHash,
          committee_statement_hash: statement.committeeStatementHash,
          allocation_root: statement.allocationRoot,
          included_root: statement.includedRoot,
          proof,
        },
      }));
      return {
        status: "executed",
        epoch: epochNumber.toString(),
        yesCount,
        noCount,
      };
    }

    if (phase === "Sealed") {
      return {
        status: "sealed-incomplete",
        epoch: epochNumber.toString(),
        accepted: Number(epoch.accepted_count),
      };
    }

    if (
      (phase === "Executed" || phase === "Refundable") &&
      now < Number(registration.expiry)
    ) {
      const next = invocationResultValue(
        await this.submit(this.vault.open_next_epoch({
          market,
          prior_epoch: epochNumber,
        })),
      );
      return {
        status: "opened",
        epoch: String(next?.epoch ?? epochNumber + 1n),
      };
    }

    return {
      status: phase.toLowerCase(),
      epoch: epochNumber.toString(),
    };
  }
}
