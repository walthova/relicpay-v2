import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_KEYPAIR_DIR, loadThrowaway, safeKeypairDir } from "./keys";
import { PROGRAM_ID } from "./flow";

export async function buildDevnet(keypairDir = DEFAULT_KEYPAIR_DIR) {
  const directory = await safeKeypairDir(keypairDir);
  const programKey = await loadThrowaway(directory, "program");
  const payer = await loadThrowaway(directory, "payer");
  if (programKey.publicKey.equals(PROGRAM_ID)) throw new Error("Devnet requires a separate throwaway program ID");
  const programId = programKey.publicKey.toBase58();
  const root = resolve(__dirname, "../..");
  const out = resolve(__dirname, "out");
  await mkdir(out, { recursive: true });
  const workspace = await mkdtemp(join(out, "devnet-build-"));
  await mkdir(join(workspace, "programs"));
  for (const name of ["Cargo.toml", "Cargo.lock", ".cargo"]) await cp(join(root, name), join(workspace, name), { recursive: true });
  await cp(join(root, "programs/relicpay"), join(workspace, "programs/relicpay"), { recursive: true });
  const sourcePath = join(workspace, "programs/relicpay/src/lib.rs");
  const source = await readFile(sourcePath, "utf8");
  const expectedDeclaration = `declare_id!("${PROGRAM_ID.toBase58()}");`;
  if (!source.includes(expectedDeclaration)) throw new Error("Unexpected source program declaration; refusing to patch build copy");
  await writeFile(sourcePath, source.replace(expectedDeclaration, `declare_id!("${programId}");`));
  const config = (await readFile(join(root, "Anchor.toml"), "utf8"))
    .split(PROGRAM_ID.toBase58()).join(programId)
    .replace('wallet = "~/.config/solana/id.json"', `wallet = ${JSON.stringify(join(directory, "payer.json"))}`);
  await writeFile(join(workspace, "Anchor.toml"), config);
  await mkdir(join(workspace, "target/deploy"), { recursive: true });
  await copyFile(join(directory, "program.json"), join(workspace, "target/deploy/relicpay-keypair.json"));
  console.log(`Building isolated devnet program ${programId} in ${workspace}`);
  const built = spawnSync("anchor", ["build", "--program-name", "relicpay", "--provider.wallet", join(directory, "payer.json")], {
    cwd: workspace, stdio: "inherit", env: { ...process.env, ANCHOR_WALLET: join(directory, "payer.json") },
  });
  if (built.error) throw built.error;
  if (built.status !== 0) throw new Error(`Devnet build exited ${built.status}`);
  const binary = join(workspace, "target/deploy/relicpay.so");
  const idlPath = join(workspace, "target/idl/relicpay.json");
  const bytes = await readFile(binary);
  const idl = JSON.parse(await readFile(idlPath, "utf8"));
  const declaredId = /declare_id!\("([^"]+)"\)/.exec(await readFile(sourcePath, "utf8"))?.[1];
  if (declaredId !== programId || idl.address !== programId || !bytes.includes(programKey.publicKey.toBuffer())) {
    throw new Error("Built devnet declaration, IDL, binary ID bytes and throwaway program key do not agree");
  }
  const manifest = { programId, declaredId, idlAddress: idl.address, binaryContainsProgramId: true,
    payer: payer.publicKey.toBase58(), binary, idl: idlPath, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
  const manifestPath = join(workspace, "build.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Devnet build verified: ${JSON.stringify(manifest)}`);
  console.log(`Build manifest: ${manifestPath}`);
  return { ...manifest, directory };
}
