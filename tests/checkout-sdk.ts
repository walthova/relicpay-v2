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
  getMerchantDashboard,
  summarizeMerchant,
  toMerchantRows,
  formatUsdc,
  toDashboardView,
  AGREEMENT_MERCHANT_OFFSET,
  buildCheckout,
  buildCreateAgreementKamino,
  kaminoConfigAddress,
  protocolConfigAddress,
  kaminoCollateralAddress,
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
    const conf = { commitment: "confirmed" as const, preflightCommitment: "confirmed" as const };
    const mint = await createMint(provider.connection, buyer, buyer.publicKey, null, 6, undefined, conf);
    const buyerUsdc = await createAccount(provider.connection, buyer, mint, buyer.publicKey, undefined, conf);
    await mintTo(provider.connection, buyer, mint, buyerUsdc, buyer, 500_000_000, [], conf);

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

    // Use a confirmed blockhash and confirmed preflight; the default "processed" lookup can lag the validator after long suites.
    const createSig = await provider.sendAndConfirm(new Transaction().add(built.instruction), [buyer], { commitment: "confirmed", preflightCommitment: "confirmed" });

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

    // Merchant dashboard: the memcmp offset must hit the real merchant field on a live account.
    const dash = await getMerchantDashboard(program, merchant.publicKey, Number(acct.startTime));
    assert.equal(dash.rows.length, 1);
    assert.isTrue(dash.rows[0].address.equals(built.agreement));
    assert.isTrue(dash.rows[0].buyer.equals(buyer.publicKey));
    assert.equal(dash.summary.counts.active, 1);
    assert.equal(dash.summary.outstandingReceivable, req.totalPrice - built.quote.upfront);
    assert.equal(dash.summary.nextDueAt, st0!.nextDueAt);
    assert.equal((await getMerchantDashboard(program, Keypair.generate().publicKey)).rows.length, 0);

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

  describe("kamino-aware builder", () => {
    const pk = () => Keypair.generate().publicKey;
    const cfg = { enabled: true, kaminoProgram: pk(), lendingMarket: pk(), lendingMarketAuthority: pk(), reserve: pk(), reserveLiquiditySupply: pk(), reserveCollateralMint: pk() };
    const fakeProgram = (cfgAcct: any, fetchThrows = false) => {
      const calls: any = {};
      const chain = (name: string) => (...args: any[]) => ({
        accounts: (a: any) => { calls.name = name; calls.args = args; calls.accounts = a; return { instruction: async () => ({ name }) }; },
      });
      return {
        calls,
        programId: pk(),
        account: { kaminoConfig: { fetchNullable: async () => { if (fetchThrows) throw new Error("rpc down"); return cfgAcct; } } },
        methods: { createAgreement: chain("createAgreement"), createAgreementKamino: chain("createAgreementKamino") },
      };
    };
    const params = (program: any) => ({ program, request: req, buyer: pk(), merchant: pk(), usdcMint: pk(), buyerUsdc: pk() });

    it("passes the governance-approved accounts and derived PDAs to create_agreement_kamino", async () => {
      const prog = fakeProgram({ ...cfg });
      const built: any = await buildCheckout(params(prog));
      assert.isTrue(built.kamino);
      assert.equal(prog.calls.name, "createAgreementKamino");
      const a = prog.calls.accounts;
      assert.isTrue(a.kaminoReserve.equals(cfg.reserve));
      assert.isTrue(a.kaminoProgram.equals(cfg.kaminoProgram));
      assert.isTrue(a.config.equals(kaminoConfigAddress(prog.programId)));
      assert.isTrue(a.protocolConfig.equals(protocolConfigAddress(prog.programId)));
      assert.isTrue(a.escrowKaminoCollateral.equals(kaminoCollateralAddress(prog.programId, built.agreement)));
      assert.equal(prog.calls.args[1], req.installmentCount);
    });

    it("falls back to plain create_agreement when config is missing, disabled, or unreadable", async () => {
      for (const prog of [fakeProgram(null), fakeProgram({ ...cfg, enabled: false }), fakeProgram(null, true)]) {
        const built: any = await buildCheckout(params(prog));
        assert.isFalse(built.kamino);
        assert.equal(prog.calls.name, "createAgreement");
      }
    });

    it("validates before any RPC and rejects bad requests in the kamino builder", async () => {
      const prog = fakeProgram({ ...cfg });
      let err: any;
      try { await buildCheckout({ ...params(prog), request: { ...req, installmentCount: 1 } }); } catch (e) { err = e; }
      assert.match(String(err), /invalid checkout request/);
      err = undefined;
      try { await buildCreateAgreementKamino({ ...params(prog), request: { ...req, totalPrice: 0n }, kaminoConfig: cfg }); } catch (e) { err = e; }
      assert.match(String(err), /invalid checkout request/);
      assert.isUndefined(prog.calls.name);
    });
  });

  describe("merchant dashboard", () => {
    const pk = () => Keypair.generate().publicKey;
    const G = GRACE_PERIOD_SECONDS;
    const acct = (o: any = {}) => ({
      buyer: pk(), productId: "p", state: { active: {} }, paidInstallments: 1, installmentCount: 3, intervalSeconds: 100, startTime: 1000,
      totalPrice: 90n, installmentAmount: 30n, escrowDeposited: 30n, merchantWithdrawn: false, yieldSource: 0, yieldAccrued: 0n, ...o,
    });

    it("pins the merchant memcmp offset to the account layout", () => {
      const src = fs.readFileSync(path.join(__dirname, "..", "programs/relicpay/src/state.rs"), "utf8");
      const body = src.slice(src.indexOf("pub struct BnplAgreement"));
      assert.isTrue(body.indexOf("pub buyer: Pubkey") < body.indexOf("pub merchant: Pubkey"));
      assert.isTrue(body.indexOf("pub merchant: Pubkey") < body.indexOf("pub usdc_mint: Pubkey"));
      assert.equal(AGREEMENT_MERCHANT_OFFSET, 8 + 32);
    });

    it("aggregates receivables, overdue exposure, default recovery, and pending payouts", () => {
      const now = 1000 + 2 * 100 + G + 1; // agreement A (paid 1) is past grace
      const accounts = [
        { publicKey: pk(), account: acct() }, // defaultable: owes 60, escrow 30
        { publicKey: pk(), account: acct({ paidInstallments: 2, startTime: now - 150, escrowDeposited: 60n }) }, // next due at now+50: not overdue, owes 30
        { publicKey: pk(), account: acct({ state: { completed: {} }, paidInstallments: 3, escrowDeposited: 90n }) }, // payout pending 90
        { publicKey: pk(), account: acct({ state: { completed: {} }, paidInstallments: 3, merchantWithdrawn: true }) },
        { publicKey: pk(), account: acct({ state: { defaulted: {} } }) },
        { publicKey: pk(), account: acct({ state: { cancelled: {} } }) },
      ];
      const rows = toMerchantRows(accounts, now);
      assert.equal(rows[0].status.nextDueAt, 1200); // earliest due first; finished agreements last
      assert.isNull(rows[rows.length - 1].status.nextDueAt);
      const s = summarizeMerchant(rows);
      assert.deepEqual(s.counts, { active: 2, completed: 2, defaulted: 1, cancelled: 1 });
      assert.equal(s.outstandingReceivable, 90n);
      assert.equal(s.overdueCount, 1);
      assert.equal(s.overdueExposure, 60n);
      assert.equal(s.defaultableCount, 1);
      assert.equal(s.recoverableOnDefault, 30n);
      assert.equal(s.pendingPayouts, 90n);
      assert.equal(s.nextDueAt, 1200);
    });

    it("formats USDC base units and builds a display view with per-row actions", () => {
      assert.equal(formatUsdc(0n), "0.00");
      assert.equal(formatUsdc(1_234_500_000n), "1,234.50");
      assert.equal(formatUsdc(9_999n), "0.00"); // sub-cent dust truncated
      assert.equal(formatUsdc(-5_000_000n), "-5.00");
      const now = 1000 + 2 * 100 + G + 1;
      const rows = toMerchantRows([
        { publicKey: pk(), account: acct() }, // past grace
        { publicKey: pk(), account: acct({ paidInstallments: 2, startTime: now - 150 }) }, // on schedule
        { publicKey: pk(), account: acct({ paidInstallments: 1, startTime: now - 300 }) }, // overdue within grace
        { publicKey: pk(), account: acct({ state: { completed: {} }, paidInstallments: 3 }) }, // payout pending
        { publicKey: pk(), account: acct({ state: { completed: {} }, paidInstallments: 3, merchantWithdrawn: true }) },
        { publicKey: pk(), account: acct({ state: { defaulted: {} } }) },
      ], now);
      const v = toDashboardView(rows, summarizeMerchant(rows));
      const by = (l: string) => v.rows.filter((r) => r.label === l);
      assert.equal(by("Past grace, can default")[0].action, "default");
      assert.equal(by("Overdue, in grace")[0].tone, "overdue");
      assert.equal(by("On schedule").length, 1);
      assert.equal(by("Payout ready")[0].action, "withdraw");
      assert.equal(by("Settled")[0].action, "none");
      assert.equal(by("Defaulted")[0].tone, "danger");
      assert.equal(v.headline[0].value, "3");
      assert.equal(v.headline.length, 5);
    });

    it("returns an empty summary for a merchant with no agreements and queries by merchant filter", async () => {
      assert.deepEqual(summarizeMerchant([]).counts, { active: 0, completed: 0, defaulted: 0, cancelled: 0 });
      assert.isNull(summarizeMerchant([]).nextDueAt);
      let filters: any;
      const m = pk();
      const prog = { account: { bnplAgreement: { all: async (f: any) => { filters = f; return []; } } } };
      const d = await getMerchantDashboard(prog, m, 5);
      assert.equal(d.rows.length, 0);
      assert.equal(filters[0].memcmp.offset, 40);
      assert.equal(filters[0].memcmp.bytes, m.toBase58());
    });
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
