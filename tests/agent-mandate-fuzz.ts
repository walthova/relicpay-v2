import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { assert } from "chai";
import { createAccount, createMint, getAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

const MAX_PRICE = 200_000;
const BALANCE = BigInt(100_000_000);
const SEEDS = [0x6a09e667, 0xbb67ae85, 0x3c6ef372];
const SPL_INSUFFICIENT_FUNDS = 1;
const scenarios = [
  ["period spend", "AgentPeriodCapExceeded"],
  ["purchase count", "AgentPurchaseLimitReached"],
  ["SPL allowance", SPL_INSUFFICIENT_FUNDS],
] as const;

function rng(seed: number) {
  let state = seed;
  return (min: number, max: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return min + (state >>> 0) % (max - min + 1);
  };
}

describe("agent mandate fuzz (localnet)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Relicpay as anchor.Program<any>;
  const { connection } = provider;
  const commitment = "confirmed";
  const pda = (prefix: string, ...seeds: Buffer[]) =>
    PublicKey.findProgramAddressSync([Buffer.from(prefix), ...seeds], program.programId)[0];

  const seeds = [...SEEDS];
  if (process.env.RELICPAY_FUZZ_SEED !== undefined) {
    const seed = Number(process.env.RELICPAY_FUZZ_SEED);
    if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) {
      throw new Error("RELICPAY_FUZZ_SEED must be a nonzero uint32");
    }
    if (!seeds.includes(seed)) seeds.push(seed);
  }

  for (const [limit, rejection] of scenarios) {
    for (const seed of seeds) {
      it(`bounds repeated agent purchases by ${limit} (seed ${seed})`, async () => {
        const random = rng(seed);
        const purchase = () => ({ price: random(10_000, MAX_PRICE), installments: random(2, 5) });
        const accepted = Array.from({ length: random(3, 5) }, purchase);
        const totalPrice = accepted.reduce((sum, p) => sum + p.price, 0);
        const totalEscrow = accepted.reduce((sum, p) => sum + Math.floor(p.price / p.installments), 0);
        const periodCap = limit === "period spend" ? totalPrice : 10 * MAX_PRICE;
        const countCap = limit === "purchase count" ? accepted.length : 20;
        // Leave one unit delegated so the next transfer fails for insufficient allowance.
        const allowance = limit === "SPL allowance" ? totalEscrow + 1 : 10 * MAX_PRICE;

        const owner = Keypair.generate();
        const agent = Keypair.generate();
        const merchant = Keypair.generate().publicKey;
        const unapprovedMerchant = Keypair.generate().publicKey;
        await provider.sendAndConfirm(new Transaction().add(...[owner, agent].map((wallet) =>
          SystemProgram.transfer({
            fromPubkey: provider.publicKey,
            toPubkey: wallet.publicKey,
            lamports: LAMPORTS_PER_SOL,
          })
        )));

        const mint = await createMint(connection, owner, owner.publicKey, null, 6);
        const ownerToken = await createAccount(connection, owner, mint, owner.publicKey);
        await mintTo(connection, owner, mint, ownerToken, owner, BALANCE);
        const mandate = pda("agent_mandate", owner.publicKey.toBuffer(), agent.publicKey.toBuffer());
        await program.methods.createAgentMandate({
          perPurchaseCap: new BN(MAX_PRICE),
          periodCap: new BN(periodCap),
          periodSeconds: new BN(86_400),
          maxPurchasesPerPeriod: countCap,
          approvalThreshold: new BN(0),
          expiresAt: new BN(0),
          delegatedAllowance: new BN(allowance),
          allowedMerchants: [merchant],
        }).accounts({
          mandate, owner: owner.publicKey, agent: agent.publicKey, ownerUsdc: ownerToken,
        }).signers([owner]).rpc();

        let step = 0;
        let spent = 0;
        let escrowed = BigInt(0);
        let purchases = 0;
        async function checkPurchase(
          { price, installments }: ReturnType<typeof purchase>,
          shop: PublicKey,
          reject?: string | number,
        ) {
          const product = `fuzz-${++step}`;
          const agreement = pda("agreement", owner.publicKey.toBuffer(), Buffer.from(product));
          const escrow = pda("escrow", agreement.toBuffer());
          const ix = await program.methods.agentCreateAgreement(new BN(price), installments, new BN(86_400), product, "Test merchant")
            .accounts({ mandate, agent: agent.publicKey, owner: owner.publicKey,
              agreement, merchant: shop, usdcMint: mint, ownerUsdc: ownerToken, escrowUsdc: escrow,
            }).instruction();
          const block = await connection.getLatestBlockhash(commitment);
          const tx = new Transaction({ ...block, feePayer: agent.publicKey }).add(ix);
          tx.sign(agent);
          // Land rejected transactions on the validator to check runtime rollback, not just simulation.
          const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
          const { value } = await connection.confirmTransaction({ ...block, signature }, commitment);
          const context = `seed ${seed}, ${limit}, step ${step}, price ${price}, installments ${installments}`;

          if (reject !== undefined) {
            const code = typeof reject === "number" ? reject : program.rawIdl.errors?.find((e) => e.name === reject)?.code;
            assert.isDefined(code, `${context}: expected error ${reject} in IDL`);
            assert.deepEqual(value.err, { InstructionError: [0, { Custom: code }] }, `${context}: ${reject}`);
            assert.deepEqual(await connection.getMultipleAccountsInfo([agreement, escrow], commitment),
              [null, null], `${context}: rejection must not create agreement or escrow accounts`);
          } else {
            assert.isNull(value.err, `${context}: valid purchase`);
            const first = BigInt(Math.floor(price / installments));
            const [token, plan] = await Promise.all([
              getAccount(connection, escrow, commitment),
              program.account.bnplAgreement.fetch(agreement, commitment),
            ]);
            assert.equal(token.amount, first, `${context}: only first installment enters escrow`);
            assert.isTrue(token.owner.equals(agreement), `${context}: escrow authority`);
            assert.isTrue(plan.buyer.equals(owner.publicKey), `${context}: agreement belongs to owner`);
            assert.isTrue(plan.merchant.equals(merchant), `${context}: recorded merchant`);
            spent += price;
            escrowed += first;
            purchases++;
          }

          const [token, state] = await Promise.all([
            getAccount(connection, ownerToken, commitment),
            program.account.agentMandate.fetch(mandate, commitment),
          ]);
          assert.equal(token.amount, BALANCE - escrowed, `${context}: owner balance`);
          assert.equal(token.delegatedAmount, BigInt(allowance) - escrowed, `${context}: allowance`);
          assert.isTrue(token.delegate?.equals(mandate), `${context}: delegate`);
          assert.equal(state.periodSpent.toNumber(), spent, `${context}: full price counts toward limit`);
          assert.equal(state.totalSpent.toNumber(), spent, `${context}: lifetime spend`);
          assert.equal(state.periodPurchases, purchases, `${context}: period count`);
          assert.equal(state.totalPurchases, purchases, `${context}: lifetime count`);
        }

        for (const p of accepted) {
          if (random(0, 1)) await checkPurchase(purchase(), unapprovedMerchant, "MerchantNotApproved");
          await checkPurchase(p, merchant);
        }
        for (let i = 0; i < 6; i++) {
          await checkPurchase(purchase(), merchant, rejection);
        }
      });
    }
  }
});
