// Tests for @relicpay/checkout (v2.2 groundwork). Pure-logic cases need no
// validator; the final case builds an instruction with the SDK and executes it
// on localnet to prove the SDK and the program agree.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
  quote,
  validateCheckout,
  buildCreateAgreement,
  deriveStatus,
  getAgreementStatus,
  decodeEvents,
  agreementAddress,
  escrowAddress,
  MIN_INSTALLMENTS,
  MAX_INSTALLMENTS,
  MAX_PRODUCT_ID_LEN,
  MAX_MERCHANT_NAME_LEN,
  CANCEL_FEE_BPS,
  GRACE_PERIOD_SECONDS,
  DEFAULT_YIELD_RATE_BPS,
} from "../packages/checkout/src";

describe("@relicpay/checkout SDK", () => {
  const req = {
    totalPrice: 100_000_000n,
    installmentCount: 3,
    intervalSeconds: 86_400,
    productId: "sdk-order-1",
    merchantName: "IBG Collection",
  };

  it("pins constants to programs/relicpay/src/constants.rs", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "programs/relicpay/src/constants.rs"), "utf8");
    const num = (name: string) => BigInt(src.match(new RegExp(`${name}:[^=]+=\\s*([0-9_ *]+);`))![1].replace(/[_ ]/g, "").split("*").reduce((a, b) => String(BigInt(a) * BigInt(b))));
    assert.equal(num("MIN_INSTALLMENTS"), BigInt(MIN_INSTALLMENTS));
    assert.equal(num("MAX_INSTALLMENTS"), BigInt(MAX_INSTALLMENTS));
    assert.equal(num("MAX_PRODUCT_ID_LEN"), BigInt(MAX_PRODUCT_ID_LEN));
    assert.equal(num("MAX_MERCHANT_NAME_LEN"), BigInt(MAX_MERCHANT_NAME_LEN));
    assert.equal(num("CANCEL_FEE_BPS"), CANCEL_FEE_BPS);
    assert.equal(num("GRACE_PERIOD_SECONDS"), BigInt(GRACE_PERIOD_SECONDS));
    assert.equal(num("DEFAULT_YIELD_RATE_BPS"), DEFAULT_YIELD_RATE_BPS);
  });

  it("puts the integer-division remainder on the final installment", () => {
    const q = quote(req);
    assert.deepEqual(q.installments.map((i) => i.amount), [33_333_333n, 33_333_333n, 33_333_334n]);
    assert.equal(q.installments.reduce((s, i) => s + i.amount, 0n), req.totalPrice);
    assert.equal(q.upfront, 33_333_333n);
    assert.deepEqual(q.installments.map((i) => i.dueOffsetSeconds), [0, 172_800, 259_200]);
    assert.equal(q.cancelFeeIfCancelledNow, 10_000_000n);
  });

  it("estimates simple-interest yield from escrow balance over time", () => {
    // 2 installments of 50 USDC, interval 1 year. Installment 2 is due at 2 * interval
    // (program rule), so the first 50 sits 2 years at 3% = 3.0 USDC.
    const q = quote({ ...req, totalPrice: 100_000_000n, installmentCount: 2, intervalSeconds: 31_536_000 });
    assert.equal(q.estimatedYieldAtSimulatedRate, 3_000_000n);
  });

  it("rejects the same bad inputs the program rejects", () => {
    assert.isNotEmpty(validateCheckout({ ...req, totalPrice: 0n }));
    assert.isNotEmpty(validateCheckout({ ...req, installmentCount: 1 }));
    assert.isNotEmpty(validateCheckout({ ...req, installmentCount: 13 }));
    assert.isNotEmpty(validateCheckout({ ...req, intervalSeconds: 0 }));
    assert.isNotEmpty(validateCheckout({ ...req, productId: "x".repeat(65) }));
    assert.isNotEmpty(validateCheckout({ ...req, merchantName: "x".repeat(65) }));
    assert.isNotEmpty(validateCheckout(req, 50_000_000n)); // per-agreement cap
    assert.isEmpty(validateCheckout(req));
    assert.isEmpty(validateCheckout({ ...req, productId: "x".repeat(64) }));
    assert.throws(() => quote({ ...req, installmentCount: 1 }), /invalid checkout request/);
  });

  it("builds an instruction that executes on-chain and matches the quote", async () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Relicpay as Program<any>;
    const buyer = Keypair.generate();
    const merchant = Keypair.generate();
    const latest = await provider.connection.getLatestBlockhash();
    const sig = await provider.connection.requestAirdrop(buyer.publicKey, 5 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    const mint = await createMint(provider.connection, buyer, buyer.publicKey, null, 6);
    const buyerUsdc = await createAccount(provider.connection, buyer, mint, buyer.publicKey);
    await mintTo(provider.connection, buyer, mint, buyerUsdc, buyer, 500_000_000);

    const built = await buildCreateAgreement({
      program,
      request: req,
      buyer: buyer.publicKey,
      merchant: merchant.publicKey,
      usdcMint: mint,
      buyerUsdc,
    });
    assert.isTrue(built.agreement.equals(agreementAddress(program.programId, buyer.publicKey, req.productId)));
    assert.isTrue(built.escrow.equals(escrowAddress(program.programId, built.agreement)));

    const createSig = await provider.sendAndConfirm(new Transaction().add(built.instruction), [buyer], { commitment: "confirmed" });

    const acct = await program.account.bnplAgreement.fetch(built.agreement);
    // Quote due offsets must match the program's due-time rule.
    const st0 = await getAgreementStatus(program, built.agreement, Number(acct.startTime));
    assert.equal(st0!.nextDueAt! - Number(acct.startTime), built.quote.installments[1].dueOffsetSeconds);
    assert.isFalse(st0!.payable);
    assert.equal(st0!.remainingToPay, req.totalPrice - built.quote.upfront);
    assert.equal(st0!.yieldSource, "simulated");
    assert.isNull(await getAgreementStatus(program, Keypair.generate().publicKey));

    // Events decode from the creating transaction's logs.
    const tx = await provider.connection.getTransaction(createSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const evs = decodeEvents(program, tx!.meta!.logMessages!);
    const created = evs.find((e) => e.name.toLowerCase() === "agreementcreated");
    assert.exists(created);
    assert.equal(created!.data.productId, req.productId);
    assert.isEmpty(decodeEvents(program, ["Program 11111111111111111111111111111111 invoke [1]", "Program 11111111111111111111111111111111 success"]));

    assert.equal(acct.installmentAmount.toString(), built.quote.upfront.toString());
    assert.equal(acct.totalPrice.toString(), req.totalPrice.toString());
    const escrow = await getAccount(provider.connection, built.escrow);
    assert.equal(escrow.amount, built.quote.upfront);
  });

  it("refuses to build for an invalid request without touching the program", async () => {
    let called = false;
    const fake = { programId: Keypair.generate().publicKey, get methods() { called = true; return {}; } };
    let err: any;
    try {
      await buildCreateAgreement({ program: fake, request: { ...req, installmentCount: 99 }, buyer: fake.programId, merchant: fake.programId, usdcMint: fake.programId, buyerUsdc: fake.programId });
    } catch (e) { err = e; }
    assert.match(String(err), /invalid checkout request/);
    assert.isFalse(called);
  });

  describe("deriveStatus", () => {
    const base = (o: any = {}) => ({
      state: { active: {} }, paidInstallments: 1, installmentCount: 3, intervalSeconds: 100, startTime: 1000,
      totalPrice: 90n, installmentAmount: 30n, merchantWithdrawn: false, yieldSource: 0, yieldAccrued: 5n, ...o,
    });
    const G = GRACE_PERIOD_SECONDS;

    it("tracks the due window, grace window, and default eligibility", () => {
      // installment 2 due at start + 2 * interval = 1200
      let s = deriveStatus(base(), 1199);
      assert.equal(s.nextInstallmentNumber, 2);
      assert.equal(s.nextDueAt, 1200);
      assert.isFalse(s.payable);
      assert.equal(s.remainingToPay, 60n);
      s = deriveStatus(base(), 1200);
      assert.isTrue(s.payable);
      assert.isFalse(s.overdue);
      s = deriveStatus(base(), 1201);
      assert.isTrue(s.overdue);
      assert.isFalse(s.defaultable);
      assert.isFalse(deriveStatus(base(), 1200 + G).defaultable); // strict >, as on-chain
      assert.isTrue(deriveStatus(base(), 1200 + G + 1).defaultable);
    });

    it("handles terminal phases, merchant payout, and the kamino source", () => {
      const done = deriveStatus(base({ state: { completed: {} }, paidInstallments: 3, yieldSource: 1 }), 9999);
      assert.equal(done.phase, "completed");
      assert.equal(done.yieldSource, "kamino");
      assert.isNull(done.nextDueAt);
      assert.isFalse(done.defaultable);
      assert.equal(done.remainingToPay, 0n);
      assert.isTrue(done.merchantPayoutPending);
      assert.isFalse(deriveStatus(base({ state: { completed: {} }, paidInstallments: 3, merchantWithdrawn: true }), 0).merchantPayoutPending);
      assert.equal(deriveStatus(base({ state: { defaulted: {} } }), 1e9).defaultable, false);
    });
  });
});
