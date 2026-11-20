import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Connection } from "@solana/web3.js";
import { DEFAULT_KEYPAIR_DIR } from "./keys";
import { buildDevnet } from "./build-devnet";

async function main() {
  const { values } = parseArgs({ options: {
    "approved-by-walter": { type: "boolean", default: false },
    "build-only": { type: "boolean", default: false },
    "keypair-dir": { type: "string", default: DEFAULT_KEYPAIR_DIR },
  } });
  if (!values["build-only"] && !values["approved-by-walter"]) throw new Error("Deployment requires Walter's explicit approval, then --approved-by-walter. This flag does not grant approval. Use --build-only for an offline build without deployment.");
  const artifact = await buildDevnet(values["keypair-dir"]);
  if (values["build-only"]) {
    console.log("Build only: no deployment or devnet transaction attempted.");
    return;
  }
  const { directory, binary, bytes: size } = artifact;
  const programKeyPath = join(directory, "program.json");
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const rent = await connection.getMinimumBalanceForRentExemption(size + 45);
  console.log(`Devnet deploy payer (throwaway): ${artifact.payer}. Program: ${artifact.programId}. Retained rent: ${rent / 1e9} SOL + program account/fees; approximately 5.51 SOL for the current build. Buffer may need additional temporary funding.`);
  const result = spawnSync("solana", ["program", "deploy", binary, "--url", "devnet", "--keypair", join(directory, "payer.json"),
    "--upgrade-authority", join(directory, "payer.json"), "--program-id", programKeyPath, "--max-len", String(size)], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Deploy exited ${result.status}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
