import { Keypair } from "@solana/web3.js";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

export const DEFAULT_KEYPAIR_DIR = resolve(__dirname, "keys");

export async function safeKeypairDir(input: string): Promise<string> {
  const expanded = input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
  const directory = resolve(expanded);
  const forbidden = join(homedir(), ".config", "solana");
  const rejectStandardDirectory = (path: string) => {
    if (path === forbidden || path.startsWith(forbidden + sep)) throw new Error("Refusing ~/.config/solana: use a dedicated throwaway directory");
  };
  rejectStandardDirectory(directory);
  let ancestor = directory;
  const suffix: string[] = [];
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      suffix.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
  const canonical = resolve(ancestor, ...suffix);
  rejectStandardDirectory(canonical);
  await mkdir(canonical, { recursive: true, mode: 0o700 });
  return canonical;
}

export async function loadThrowaway(directory: string, role: string): Promise<Keypair> {
  const path = join(await safeKeypairDir(directory), `${role}.json`);
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing non-regular key file: ${path}`);
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path, "utf8"))));
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    const key = Keypair.generate();
    await writeFile(path, JSON.stringify(Array.from(key.secretKey)), { flag: "wx", mode: 0o600 });
    return key;
  }
}
