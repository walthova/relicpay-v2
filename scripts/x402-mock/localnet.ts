import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";
import { Connection } from "@solana/web3.js";
import { createServer } from "node:net";
import { DEFAULT_KEYPAIR_DIR, loadThrowaway } from "./keys";
import { PROGRAM_ID } from "./flow";

async function main() {
  const root = resolve(__dirname, "../..");
  const payer = await loadThrowaway(DEFAULT_KEYPAIR_DIR, "payer");
  const out = resolve(__dirname, "out");
  await mkdir(out, { recursive: true });
  const file = await open(resolve(out, "validator.log"), "w");
  for (const port of [18999, 19000]) {
    const probe = createServer();
    await new Promise<void>((ready, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => probe.close((error) => error ? reject(error) : ready()));
    });
  }
  const validator = spawn("solana-test-validator", ["--reset", "--ledger", resolve(out, "ledger"),
    "--rpc-port", "18999", "--faucet-port", "18901", "--gossip-port", "18902", "--dynamic-port-range", "19100-19150",
    "--upgradeable-program", PROGRAM_ID.toBase58(), resolve(root, "target/deploy/relicpay.so"), payer.publicKey.toBase58(),
    "--quiet"], { cwd: root, stdio: ["ignore", file.fd, file.fd] });
  const exited = new Promise<void>((resolveExit) => validator.once("exit", () => resolveExit()));
  let startupError: Error | undefined;
  validator.on("error", (error) => { startupError = error; });
  const stop = () => { validator.kill("SIGTERM"); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const connection = new Connection("http://127.0.0.1:18999", "confirmed");
    const deadline = Date.now() + 60_000;
    while (true) {
      if (startupError) throw startupError;
      if (validator.exitCode !== null) throw new Error(`Validator exited; see ${out}/validator.log`);
      try {
        const info = await connection.getAccountInfo(PROGRAM_ID);
        if (info?.executable) break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
      }
      if (Date.now() >= deadline) throw new Error("Timed out starting validator");
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    }
    const run = spawn(process.execPath, ["-r", "ts-node/register", resolve(__dirname, "run.ts"), "--cluster", "localnet"], { cwd: root, stdio: "inherit" });
    const code = await new Promise<number>((resolveExit, reject) => { run.once("error", reject); run.once("exit", (status) => resolveExit(status ?? 1)); });
    if (code !== 0) throw new Error(`Flow exited ${code}`);
  } finally {
    stop();
    if (validator.exitCode === null && !startupError) await exited;
    await file.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
