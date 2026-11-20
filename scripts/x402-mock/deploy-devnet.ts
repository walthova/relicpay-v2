import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { Connection, Keypair } from "@solana/web3.js";
import { DEFAULT_KEYPAIR_DIR, loadThrowaway, safeKeypairDir } from "./keys";
import { PROGRAM_ID } from "./flow";

async function main() {
  const { values } = parseArgs({ options: {
    "approved-by-walter": { type: "boolean", default: false },
    "keypair-dir": { type: "string", default: DEFAULT_KEYPAIR_DIR },
  } });
  if (!values["approved-by-walter"]) throw new Error("Deployment requires Walter's explicit approval, then --approved-by-walter. This flag does not grant approval.");
  const directory = await safeKeypairDir(values["keypair-dir"]);
  const payer = await loadThrowaway(directory, "payer");
  const programKeyPath = join(directory, "program.json");
  let programKey: Keypair;
  try {
    programKey = await loadThrowaway(directory, "program");
  } catch (error) { throw new Error(`Cannot load throwaway program key: ${error}`); }
  if (!programKey.publicKey.equals(PROGRAM_ID)) throw new Error(
    `Throwaway program key is ${programKey.publicKey.toBase58()}, not the fixed source ID ${PROGRAM_ID.toBase58()}. ` +
    "Cannot deploy this binary at that ID without its matching program keypair. Stop and obtain a decision; this helper never rewrites program IDs or uses real keys.");
  const binary = resolve(__dirname, "../../target/deploy/relicpay.so");
  const size = (await readFile(binary)).length;
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const rent = await connection.getMinimumBalanceForRentExemption(size + 45);
  console.log(`Devnet deploy payer (throwaway): ${payer.publicKey.toBase58()}. Retained rent: ${rent / 1e9} SOL + program account/fees; approximately 5.51 SOL for the current build. Buffer may need additional temporary funding.`);
  const result = spawnSync("solana", ["program", "deploy", binary, "--url", "devnet", "--keypair", join(directory, "payer.json"),
    "--upgrade-authority", join(directory, "payer.json"), "--program-id", programKeyPath, "--max-len", String(size)], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Deploy exited ${result.status}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
