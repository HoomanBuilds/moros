import {
  Keypair,
  TransactionBuilder,
  contract,
  rpc,
} from "@stellar/stellar-sdk";
import {
  readFileSync,
} from "node:fs";
import {
  resolve,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";
import {
  assertDeploymentNetwork,
  assertRpcNetwork,
  networkConfig,
} from "./network-config.mjs";

const CONTRACT_ID = /^C[A-Z2-7]{55}$/u;
const SYMBOL = /^[A-Z0-9_]{1,32}$/u;

function boolean(value, label) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${label} must be true or false`);
}

function json(value) {
  return JSON.stringify(
    value,
    (_, entry) => typeof entry === "bigint" ? entry.toString() : entry,
    2,
  );
}

function signingOptions(source, network) {
  return {
    publicKey: source.publicKey(),
    networkPassphrase: network.passphrase,
    rpcUrl: network.rpcUrl,
    signTransaction: async (transactionXdr, options = {}) => {
      const transaction = TransactionBuilder.fromXDR(
        transactionXdr,
        options.networkPassphrase || network.passphrase,
      );
      transaction.sign(source);
      return {
        signedTxXdr: transaction.toXDR(),
        signerAddress: source.publicKey(),
      };
    },
  };
}

async function main() {
  const network = networkConfig();
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const deployment = assertDeploymentNetwork(
    JSON.parse(
      readFileSync(resolve(repo, network.deploymentPath), "utf8"),
    ),
    network,
  );
  const registryId = deployment.contracts?.resolverRegistry;
  if (!CONTRACT_ID.test(registryId || "")) {
    throw new Error("resolver registry contract ID is invalid");
  }
  const action = process.argv[2] || "status";
  const asset = String(process.argv[3] || "").toUpperCase();
  if (!SYMBOL.test(asset)) {
    throw new Error("asset must be a 1 to 32 character Stellar symbol");
  }
  const server = new rpc.Server(network.rpcUrl);
  await assertRpcNetwork(server, network);
  const source = network.funderSecret
    ? Keypair.fromSecret(network.funderSecret)
    : undefined;
  if (action !== "status" && !source) {
    throw new Error(`${network.id} governance signer is required`);
  }
  const wasm = await server.getContractWasmByContractId(registryId);
  const client = await contract.Client.fromWasm(wasm, {
    ...(source
      ? signingOptions(source, network)
      : {
          publicKey: deployment.deployedBy,
          networkPassphrase: network.passphrase,
          rpcUrl: network.rpcUrl,
        }),
    contractId: registryId,
  });

  if (action === "status") {
    const [config, route, pending] = await Promise.all([
      client.config(),
      client.route({ asset }),
      client.pending_route({ asset }),
    ]);
    process.stdout.write(`${json({
      network: network.id,
      registry: registryId,
      config: config.result,
      route: route.result,
      pending: pending.result,
    })}\n`);
    return;
  }

  if (action === "propose") {
    const resolver = String(process.argv[4] || "");
    const riskGroup = String(process.argv[5] || "").toUpperCase();
    if (!CONTRACT_ID.test(resolver) || !SYMBOL.test(riskGroup)) {
      throw new Error("resolver contract ID or risk group is invalid");
    }
    const registrationRequired = boolean(
      process.argv[6],
      "registration required",
    );
    const enabled = boolean(process.argv[7], "enabled");
    const transaction = await client.propose_route(
      {
        governance: source.publicKey(),
        asset,
        resolver,
        risk_group: riskGroup,
        registration_required: registrationRequired,
        enabled,
      },
      { timeoutInSeconds: 300 },
    );
    const result = await transaction.signAndSend();
    process.stdout.write(`${json(result.result)}\n`);
    return;
  }

  if (action === "execute") {
    const transaction = await client.execute_route(
      { asset },
      { timeoutInSeconds: 300 },
    );
    const result = await transaction.signAndSend();
    process.stdout.write(`${json(result.result)}\n`);
    return;
  }

  if (action === "cancel") {
    const transaction = await client.cancel_route(
      {
        governance: source.publicKey(),
        asset,
      },
      { timeoutInSeconds: 300 },
    );
    const result = await transaction.signAndSend();
    process.stdout.write(`${json(result.result)}\n`);
    return;
  }

  throw new Error("action must be status, propose, execute, or cancel");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
