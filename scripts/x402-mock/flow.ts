import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import type { Relicpay } from "../../target/types/relicpay";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
  VersionedMessage, LoadedAddresses,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE, MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeAccountInstruction,
  createInitializeMintInstruction, createMintToInstruction, getAccount, unpackAccount,
} from "@solana/spl-token";

export const PROGRAM_ID = new PublicKey("5GPVYpyzdosbzWcdttcCdziJVqUCCARf98J857C3T6Gi");
export const INITIAL_TOKENS = 1_000_000;
export const PRICE = 20_000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pda = (program: PublicKey, ...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program)[0];

export interface Requirements {
  scheme: "relicpay-bnpl";
  network: string;
  payTo: string;
  owner: string;
  agent: string;
  mint: string;
  price: number;
  installments: number;
  interval: number;
  nonce: string;
  resource: string;
}
export interface PaymentProof { agreement: string; signature: string; nonce: string }

export function assertAgreement(account: any, req: Requirements): void {
  if (!account.merchant.equals(new PublicKey(req.payTo)) ||
      !account.buyer.equals(new PublicKey(req.owner)) ||
      !account.usdcMint.equals(new PublicKey(req.mint)) ||
      !account.totalPrice.eq(new BN(req.price)) ||
      account.installmentCount !== req.installments ||
      !account.intervalSeconds.eq(new BN(req.interval)) ||
      account.productId !== req.nonce || !account.state.active ||
      account.paidInstallments !== 1 ||
      !account.escrowDeposited.eq(new BN(Math.floor(req.price / req.installments)))) {
    throw new Error("Agreement does not match payment requirements");
  }
}

export type RelicpayProgram = anchor.Program<Relicpay>;

export function getTransactionKeys(message: VersionedMessage, loadedAddresses?: LoadedAddresses) {
  const resolved = message.version === 0
    ? message.getAccountKeys({ accountKeysFromLookups: loadedAddresses })
    : message.getAccountKeys();
  return Array.from({ length: resolved.length }, (_, index) => resolved.get(index)!);
}

export async function verifyPayment(program: RelicpayProgram, req: Requirements, proof: PaymentProof) {
  if (proof.nonce !== req.nonce) throw new Error("Unknown nonce");
  const agreement = new PublicKey(proof.agreement);
  if (!agreement.equals(pda(program.programId, Buffer.from("agreement"),
    new PublicKey(req.owner).toBuffer(), Buffer.from(req.nonce)))) throw new Error("Wrong agreement PDA");
  const connection = program.provider.connection;
  const tx = await connection.getTransaction(proof.signature, {
    commitment: "confirmed", maxSupportedTransactionVersion: 0,
  });
  if (!tx || !tx.meta || tx.meta.err) throw new Error("Payment transaction not confirmed successfully");
  const message = tx.transaction.message;
  const keys = getTransactionKeys(message, tx.meta.loadedAddresses);
  const agentSigned = keys.slice(0, message.header.numRequiredSignatures)
    .some((key) => key.toBase58() === req.agent);
  const purchase = program.idl.instructions.find((ix) => ix.name.replace(/_/g, "").toLowerCase() === "agentcreateagreement");
  const agreementIndex = purchase?.accounts.findIndex((account) => account.name === "agreement");
  const matches = message.compiledInstructions.some((ix) => {
    if (!keys[ix.programIdIndex].equals(program.programId)) return false;
    const decoded = new anchor.BorshInstructionCoder(program.idl).decode(Buffer.from(ix.data));
    return decoded?.name.replace(/_/g, "").toLowerCase() === "agentcreateagreement" &&
      agreementIndex >= 0 && keys[ix.accountKeyIndexes[agreementIndex]]?.equals(agreement);
  });
  if (!agentSigned || !matches) throw new Error("Transaction is not the agent's agreement purchase");
  const info = await connection.getAccountInfo(agreement, { commitment: "confirmed", minContextSlot: tx.slot });
  if (!info || !info.owner.equals(program.programId)) throw new Error("Missing program-owned agreement");
  const account: any = program.coder.accounts.decode("bnplAgreement", info.data);
  assertAgreement(account, req);
  const escrow = pda(program.programId, Buffer.from("escrow"), agreement.toBuffer());
  const tokens = await getAccount(connection, escrow, "confirmed");
  if (!tokens.owner.equals(agreement) || tokens.mint.toBase58() !== req.mint ||
      tokens.amount < BigInt(Math.floor(req.price / req.installments))) throw new Error("First installment not in escrow");
}

export async function startMerchant(program: RelicpayProgram, requirements: Requirements) {
  let consumed = false;
  let verifying = false;
  const server = createServer(async (request, response) => {
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "GET" || request.url !== "/resource") return reply(404, { error: "Not found" });
    const header = request.headers["x-payment"];
    if (!header) return reply(402, { x402Version: "mock", accepts: [requirements] });
    if (consumed || verifying) return reply(402, { error: "Nonce already used or in flight" });
    verifying = true;
    try {
      if (typeof header !== "string" || header.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) throw new Error("Invalid X-PAYMENT");
      const proof = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
      if (!proof || typeof proof.agreement !== "string" || typeof proof.signature !== "string" || typeof proof.nonce !== "string") throw new Error("Invalid payment proof");
      await verifyPayment(program, requirements, proof);
      consumed = true;
      reply(200, { resource: requirements.resource, content: "Mock merchant resource unlocked", agreement: proof.agreement });
    } catch (error) {
      reply(402, { error: String(error), accepts: [requirements] });
    } finally {
      verifying = false;
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing merchant server address");
  return {
    url: `http://127.0.0.1:${address.port}/resource`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

export interface FlowOptions {
  program: RelicpayProgram;
  payer: Keypair;
  owner: Keypair;
  agent: Keypair;
  merchant: Keypair;
  cluster: "localnet" | "devnet";
  outputDir: string;
  log?: (line: string) => void;
}

export async function runFlow(options: FlowOptions) {
  const { program, payer, owner, agent, merchant, cluster, outputDir } = options;
  const connection = program.provider.connection;
  const log = options.log ?? console.log;
  const report: any = { startedAt: new Date().toISOString(), cluster, rpc: connection.rpcEndpoint,
    program: program.programId.toBase58(), transactions: [], checks: {}, status: "running" };
  const explorer = (signature: string) => `https://explorer.solana.com/tx/${signature}?${cluster === "devnet" ? "cluster=devnet" : `cluster=custom&customUrl=${encodeURIComponent(connection.rpcEndpoint)}`}`;
  async function record(step: string, signature: string) {
    let tx: Awaited<ReturnType<Connection["getTransaction"]>> = null;
    for (let attempt = 0; attempt < 30 && !tx; attempt++) {
      tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx) await delay(400);
    }
    if (!tx?.meta || tx.meta.err) throw new Error(`${step}: cannot obtain successful transaction logs: ${signature}`);
    const entry = { step, signature, explorer: explorer(signature), logs: tx.meta.logMessages ?? [] };
    report.transactions.push(entry);
    log(`${step}: ${signature}`);
    for (const line of entry.logs) log(`  ${line}`);
  }
  async function send(step: string, instructions: TransactionInstruction[], signers: Keypair[] = []) {
    const unique = [payer, ...signers].filter((key, index, all) => all.findIndex((other) => other.publicKey.equals(key.publicKey)) === index);
    const memo = new TransactionInstruction({ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      keys: [], data: Buffer.from(`${nonce}:${step}`) });
    const signature = await sendAndConfirmTransaction(connection, new Transaction().add(memo, ...instructions), unique, { commitment: "confirmed" });
    await record(step, signature);
    return signature;
  }
  const mint = Keypair.generate();
  const ownerToken = Keypair.generate();
  const merchantToken = Keypair.generate();
  const nonce = randomBytes(12).toString("hex");
  const agreement = pda(program.programId, Buffer.from("agreement"), owner.publicKey.toBuffer(), Buffer.from(nonce));
  const escrow = pda(program.programId, Buffer.from("escrow"), agreement.toBuffer());
  const mandate = pda(program.programId, Buffer.from("agent_mandate"), owner.publicKey.toBuffer(), agent.publicKey.toBuffer());
  const protocol = pda(program.programId, Buffer.from("protocol_config"));
  const requirements: Requirements = { scheme: "relicpay-bnpl", network: `solana:${cluster}`,
    payTo: merchant.publicKey.toBase58(), owner: owner.publicKey.toBase58(), agent: agent.publicKey.toBase58(),
    mint: mint.publicKey.toBase58(), price: PRICE, installments: 2, interval: 1, nonce, resource: "mock-research-report" };
  Object.assign(report, { requirements, owner: requirements.owner, agent: requirements.agent,
    merchant: requirements.payTo, payer: payer.publicKey.toBase58(), agreement: agreement.toBase58(),
    escrow: escrow.toBase58(), mandate: mandate.toBase58() });
  let merchantServer: Awaited<ReturnType<typeof startMerchant>> | undefined;
  const check = (name: string, condition: boolean) => {
    report.checks[name] = condition;
    if (!condition) throw new Error(`Check failed: ${name}`);
  };
  try {
    if (!(await connection.getAccountInfo(program.programId, "confirmed"))?.executable) throw new Error("Program is not deployed on this RPC. No deployment attempted.");
    if (await connection.getBalance(payer.publicKey, "confirmed") < LAMPORTS_PER_SOL / 2) {
      try {
        const signature = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
        const result = await connection.confirmTransaction(signature, "confirmed");
        if (result.value.err) throw new Error(JSON.stringify(result.value.err));
        await record("airdrop_payer", signature);
      } catch (error) {
        throw new Error(`Airdrop unavailable (possibly rate-limited): ${error}. Fund throwaway payer ${payer.publicKey.toBase58()} manually on ${cluster}, then rerun. No real keys are needed.`);
      }
    }
    await send("fund_roles", [owner, agent, merchant].map((key) => SystemProgram.transfer({
      fromPubkey: payer.publicKey, toPubkey: key.publicKey, lamports: LAMPORTS_PER_SOL / 20,
    })));
    if (await connection.getAccountInfo(protocol, "confirmed")) {
      report.protocolConfig = "existing (not modified)";
    } else {
      const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
      const programData = pda(loader, program.programId.toBuffer());
      const data = await connection.getAccountInfo(programData, "confirmed");
      const isAuthority = data && data.owner.equals(loader) && data.data.length >= 45 &&
        data.data.readUInt32LE(0) === 3 && data.data[12] === 1 &&
        new PublicKey(data.data.subarray(13, 45)).equals(payer.publicKey);
      if (isAuthority) {
        await send("init_protocol_config", [await program.methods.initProtocolConfig().accountsPartial({
          config: protocol, authority: payer.publicKey, upgradeAuthority: payer.publicKey, programData,
        }).instruction()]);
        report.protocolConfig = "initialized";
      } else {
        report.protocolConfig = "skipped: payer is not upgrade authority (or immutable loader)";
      }
    }
    log(`ProtocolConfig: ${report.protocolConfig}`);
    await send("create_mock_mint", [
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE), space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMintInstruction(mint.publicKey, 6, payer.publicKey, null),
    ], [mint]);
    for (const [name, key, authority] of [["owner", ownerToken, owner], ["merchant", merchantToken, merchant]] as const) {
      await send(`create_${name}_token_account`, [
        SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: key.publicKey,
          lamports: await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE), space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
        createInitializeAccountInstruction(key.publicKey, mint.publicKey, authority.publicKey),
      ], [key]);
    }
    await send("mint_mock_usdc", [createMintToInstruction(mint.publicKey, ownerToken.publicKey, payer.publicKey, INITIAL_TOKENS)]);
    const previousMandate = await program.account.agentMandate.fetchNullable(mandate);
    report.recoveredMandate = previousMandate !== null;
    if (previousMandate) {
      const accounts = await connection.getTokenAccountsByOwner(owner.publicKey, { programId: TOKEN_PROGRAM_ID }, "confirmed");
      const delegated = accounts.value.filter(({ pubkey, account }) =>
        unpackAccount(pubkey, account).delegate?.equals(mandate));
      const sources = delegated.length ? delegated.map(({ pubkey }) => pubkey) : [ownerToken.publicKey];
      for (const [index, source] of sources.entries()) {
        await send(`recover_revoke_mandate_${index + 1}`, [await program.methods.revokeAgentMandate().accountsPartial({
          mandate, owner: owner.publicKey, ownerUsdc: source,
        }).instruction()], [owner]);
      }
      await send("recover_close_mandate", [await program.methods.closeAgentMandate().accountsPartial({
        mandate, owner: owner.publicKey,
      }).instruction()], [owner]);
    }
    await send("request_credit_create_mandate", [await program.methods.createAgentMandate({
      perPurchaseCap: new BN(PRICE), periodCap: new BN(PRICE * 2), periodSeconds: new BN(3600),
      maxPurchasesPerPeriod: 2, approvalThreshold: new BN(PRICE), expiresAt: new BN(0),
      delegatedAllowance: new BN(PRICE * 2), allowedMerchants: [merchant.publicKey],
    }).accountsPartial({ mandate, owner: owner.publicKey, agent: agent.publicKey, ownerUsdc: ownerToken.publicKey }).instruction()], [owner]);
    merchantServer = await startMerchant(program, requirements);
    const initial = await fetch(merchantServer.url);
    check("initial402", initial.status === 402);
    const challenge: any = await initial.json();
    const offered: Requirements = challenge.accepts[0];
    check("requirementsMatch", JSON.stringify(offered) === JSON.stringify(requirements));
    const signature = await send("agent_create_agreement", [await program.methods.agentCreateAgreement(
      new BN(offered.price), offered.installments, new BN(offered.interval), offered.nonce, "Mock x402 merchant",
    ).accountsPartial({ mandate, agent: agent.publicKey, owner: owner.publicKey, agreement,
      merchant: new PublicKey(offered.payTo), usdcMint: new PublicKey(offered.mint), ownerUsdc: ownerToken.publicKey,
      escrowUsdc: escrow, protocolConfig: protocol }).instruction()], [agent]);
    const proof: PaymentProof = { agreement: agreement.toBase58(), signature, nonce: offered.nonce };
    const request = async (payment: unknown) => {
      const response = await fetch(merchantServer!.url, { headers: { "X-PAYMENT": Buffer.from(JSON.stringify(payment)).toString("base64") } });
      return { status: response.status, body: await response.json() };
    };
    check("malformedProof402", (await request({})).status === 402);
    check("wrongNonce402", (await request({ ...proof, nonce: "wrong" })).status === 402);
    check("unrelatedTransaction402", (await request({ ...proof, signature: report.transactions.find((entry: any) => entry.step === "mint_mock_usdc").signature })).status === 402);
    for (const [name, changed] of [["wrongPrice402", { price: PRICE + 1 }], ["wrongMerchant402", { payTo: owner.publicKey.toBase58() }]] as const) {
      const mismatched = await startMerchant(program, { ...requirements, ...changed });
      try {
        const response = await fetch(mismatched.url, { headers: { "X-PAYMENT": Buffer.from(JSON.stringify(proof)).toString("base64") } });
        await response.json();
        check(name, response.status === 402);
      } finally { await mismatched.close(); }
    }
    const attempts = await Promise.all([request(proof), request(proof)]);
    check("paid200", attempts.filter((response) => response.status === 200).length === 1);
    check("concurrentReplay402", attempts.filter((response) => response.status === 402).length === 1);
    report.resource = attempts.find((response) => response.status === 200)!.body;
    check("replay402", (await request(proof)).status === 402);
    let account: any = await program.account.bnplAgreement.fetch(agreement);
    for (let next = 2; next <= offered.installments; next++) {
      const due = account.startTime.toNumber() + (next - 1) * offered.interval;
      const deadline = Date.now() + 90_000;
      while (true) {
        const slot = await connection.getSlot("confirmed");
        const now = await connection.getBlockTime(slot);
        if (now !== null && now >= due + 1) break;
        if (Date.now() >= deadline) throw new Error("Timed out waiting for installment due time");
        await delay(500);
      }
      await send(`pay_installment_${next}`, [await program.methods.payInstallment().accountsPartial({
        agreement, buyer: owner.publicKey, buyerUsdc: ownerToken.publicKey, escrowUsdc: escrow, protocolConfig: protocol,
      }).instruction()], [owner]);
    }
    account = await program.account.bnplAgreement.fetch(agreement);
    check("completed", !!account.state.completed);
    await send("merchant_withdraw", [await program.methods.merchantWithdraw().accountsPartial({ agreement,
      merchant: merchant.publicKey, escrowUsdc: escrow, merchantUsdc: merchantToken.publicKey, protocolConfig: protocol,
    }).instruction()], [merchant]);
    if (!account.yieldAccrued.isZero()) {
      await send("claim_simulated_yield_record_only", [await program.methods.claimYield().accountsPartial({ agreement, buyer: owner.publicKey }).instruction()], [owner]);
    }
    await send("close_agreement", [await program.methods.closeAgreement().accountsPartial({ agreement,
      buyer: owner.publicKey, escrowUsdc: escrow }).instruction()], [owner]);
    await send("revoke_agent_mandate", [await program.methods.revokeAgentMandate().accountsPartial({ mandate,
      owner: owner.publicKey, ownerUsdc: ownerToken.publicKey }).instruction()], [owner]);
    const revoked: any = await program.account.agentMandate.fetch(mandate);
    check("revoked", revoked.revoked && revoked.delegatedAllowance.isZero());
    await send("close_agent_mandate", [await program.methods.closeAgentMandate().accountsPartial({ mandate, owner: owner.publicKey }).instruction()], [owner]);
    const ownerBalance = await getAccount(connection, ownerToken.publicKey, "confirmed");
    const merchantBalance = await getAccount(connection, merchantToken.publicKey, "confirmed");
    report.balances = { ownerMockUsdcBaseUnits: ownerBalance.amount.toString(), merchantMockUsdcBaseUnits: merchantBalance.amount.toString(), solLamports: {} };
    for (const [role, key] of Object.entries({ payer, owner, agent, merchant })) report.balances.solLamports[role] = await connection.getBalance(key.publicKey, "confirmed");
    check("merchantPaid", merchantBalance.amount === BigInt(PRICE));
    check("ownerDebited", ownerBalance.amount === BigInt(INITIAL_TOKENS - PRICE));
    check("delegateCleared", ownerBalance.delegate === null && ownerBalance.delegatedAmount === BigInt(0));
    check("agreementClosed", await connection.getAccountInfo(agreement, "confirmed") === null);
    check("escrowClosed", await connection.getAccountInfo(escrow, "confirmed") === null);
    check("mandateClosed", await connection.getAccountInfo(mandate, "confirmed") === null);
    report.status = "passed";
    log(`Checks: ${JSON.stringify(report.checks)}`);
    log(`Final balances: ${JSON.stringify(report.balances)}`);
    return report;
  } catch (error) {
    report.status = "failed";
    report.error = String(error);
    throw error;
  } finally {
    if (merchantServer) await merchantServer.close();
    report.finishedAt = new Date().toISOString();
    await mkdir(outputDir, { recursive: true });
    const stem = join(outputDir, `run-${nonce}`);
    await writeFile(`${stem}.json`, JSON.stringify(report, null, 2));
    const markdown = [`# Mock x402 BNPL flow: ${report.status}`, "", `Cluster: ${cluster}; RPC: ${connection.rpcEndpoint}`,
      "", "Not standard x402 or collateralized credit. Merchant is paid only after owner repayment. Mock tokens only.",
      "", `ProtocolConfig: ${report.protocolConfig ?? "not reached"}`, "", "## Checks", "```json", JSON.stringify(report.checks, null, 2), "```",
      "", "## Transactions", ...report.transactions.flatMap((entry: any) => [`### ${entry.step}`, `[${entry.signature}](${entry.explorer})`, "```text", ...entry.logs, "```"]),
      "", "## Final balances (base units / lamports)", "```json", JSON.stringify(report.balances ?? {}, null, 2), "```",
      ...(report.error ? ["", `Error: ${report.error}`] : [])].join("\n");
    await writeFile(`${stem}.md`, markdown + "\n");
    log(`Reports: ${stem}.json ${stem}.md`);
  }
}
