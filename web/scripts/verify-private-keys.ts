import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Keypair } from "@stellar/stellar-sdk";
import {
  installLocalStorage,
  log,
  parseArgs,
  recoveryMessage,
  reportSignatureHelp,
  resolveSession,
  runScript,
  sep53Signature,
  usdc,
} from "./private-drain-runtime";

// Every wallet encodes its message signature differently and only the encoding
// the browser used reproduces the note keys, so each known shape is tried
// against the live tree before any drain script is pointed at one.
function localCandidates(signer: Keypair, message: string): Array<{
  name: string;
  signature: string;
}> {
  const raw = signer.sign(Buffer.from(message, "utf8"));
  return [
    {
      name: "SEP-53 base64(sign(sha256(prefix+message)))",
      signature: sep53Signature(signer, message),
    },
    { name: "base64(sign(utf8(message)))", signature: raw.toString("base64") },
    { name: "base64url(sign(utf8(message)))", signature: raw.toString("base64url") },
    { name: "hex(sign(utf8(message)))", signature: raw.toString("hex") },
    {
      name: "base64(sign(sha256(message)))",
      signature: signer
        .sign(createHash("sha256").update(message, "utf8").digest())
        .toString("base64"),
    },
    {
      name: "base64(sign(utf8(base64(message))))",
      signature: signer
        .sign(Buffer.from(Buffer.from(message, "utf8").toString("base64"), "utf8"))
        .toString("base64"),
    },
    {
      name: "base64(sign(base64-decoded message))",
      signature: signer.sign(Buffer.from(message, "base64")).toString("base64"),
    },
  ];
}

async function main(): Promise<void> {
  const { values } = parseArgs(process.argv.slice(2));
  installLocalStorage();
  const session = resolveSession(values);
  const address = session.address;

  const [
    { NETWORK },
    { getPrivateConfig, getPrivateTree },
    { derivePrivateArchiveKeys },
    { resolveArchiveVault },
    primitives,
  ] = await Promise.all([
    import("@/lib/network"),
    import("@/lib/private/client"),
    import("@/lib/private-sync/crypto"),
    import("@/lib/positions/backup-vault"),
    import("@/lib/private/primitives"),
  ]);

  const config = await getPrivateConfig();
  const tree = await getPrivateTree();
  const vault = resolveArchiveVault(undefined, config.contracts.sharedVault);
  const message = await recoveryMessage(address);
  log(`network ${NETWORK.id} - wallet ${address}`);
  log(`archive vault ${vault}`);
  log(`tree has ${tree.outputs.length} encrypted outputs`);

  const domain = primitives.noteDomain([
    1n,
    ...primitives.bytes32Limbs(primitives.hexToBytes(config.networkDomain)),
    ...await primitives.addressLimbs(config.contracts.sharedVault),
    ...await primitives.addressLimbs(config.collateral.contract),
    ...primitives.bytes32Limbs(primitives.hexToBytes(config.verifierDomain)),
  ]);

  const candidates = session.keypair
    ? localCandidates(session.keypair, message)
    : [{ name: "supplied recovery signature", signature: session.signMessage(message) }];

  let matched = false;
  for (const candidate of candidates) {
    const keys = await derivePrivateArchiveKeys(
      address,
      NETWORK.id,
      vault,
      candidate.signature,
    );
    const ownerSpendPublicKey = primitives.spendPublicKey(keys.noteSpendSecret);
    let decrypted = 0;
    let liquid = 0n;
    for (const output of tree.outputs) {
      const note = primitives.decryptOutputNote(
        primitives.envelopeToFields(output.encryptedOutput),
        keys.noteViewingSecret,
        domain,
        BigInt(output.commitment),
        ownerSpendPublicKey,
      );
      if (!note) continue;
      decrypted++;
      if ([1n, 6n, 7n].includes(note.purpose)) liquid += note.amount;
    }
    if (decrypted > 0) matched = true;
    log(
      `${decrypted > 0 ? "MATCH  " : "no hit "} ${candidate.name}: ${decrypted} notes, ${usdc(liquid)} USDC lifetime liquid value`,
    );
  }

  if (!matched) {
    reportSignatureHelp(address, message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScript(main);
}
