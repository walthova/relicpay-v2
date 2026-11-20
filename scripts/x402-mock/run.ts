import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DEFAULT_KEYPAIR_DIR, loadThrowaway, safeKeypairDir } from "./keys";
import { PROGRAM_ID, RelicpayProgram, runFlow } from "./flow";
import { assertCluster } from "./cluster";

async function main() {
  const { values } = parseArgs({ options: {
    cluster: { type: "string", default: "localnet" },
    "rpc-url": { type: "string" },
    "program-id": { type: "string" },
    "keypair-dir": { type: "string", default: DEFAULT_KEYPAIR_DIR },
  } });
  if (values.cluster !== "localnet" && values.cluster !== "devnet") throw new Error("--cluster must be localnet or devnet");
  const directory = await safeKeypairDir(values["keypair-dir"]);
  const payer = await loadThrowaway(directory, "payer");
  console.log(`Throwaway payer: ${payer.publicKey.toBase58()}; keys: ${directory}`);
  const connection = new Connection(values["rpc-url"] ?? (values.cluster === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:18999"), "confirmed");
  const genesis = await connection.getGenesisHash();
  assertCluster(values.cluster, genesis);
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  const idl = JSON.parse(await readFile(resolve(__dirname, "../../target/idl/relicpay.json"), "utf8"));
  if (idl.address !== PROGRAM_ID.toBase58()) throw new Error("Build IDL program address mismatch");
  const programId = values["program-id"] ? new PublicKey(values["program-id"])
    : values.cluster === "devnet" ? (await loadThrowaway(directory, "program")).publicKey : PROGRAM_ID;
  if (values.cluster === "localnet" && !programId.equals(PROGRAM_ID)) throw new Error("Localnet uses the fixed source program ID");
  if (values.cluster === "devnet" && programId.equals(PROGRAM_ID)) throw new Error("Devnet requires a separate throwaway program ID");
  idl.address = programId.toBase58();
  console.log(`Program ID: ${idl.address}`);
  await runFlow({ program: new anchor.Program(idl, provider) as RelicpayProgram, payer,
    owner: await loadThrowaway(directory, "owner"), agent: await loadThrowaway(directory, "agent"),
    merchant: await loadThrowaway(directory, "merchant"), cluster: values.cluster,
    outputDir: resolve(__dirname, "out") });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
