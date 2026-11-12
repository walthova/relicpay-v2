// ─── V2 FEATURE TESTS ─────────────────────────────────────────────────────────
// New behavior added in the ground-up rebuild, beyond the v1 characterization
// suite: exact remainder collection, double-withdraw guard, rent reclamation
// via close_agreement, governance rate updates, and input validation.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("relicpay v2 features", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Relicpay as Program<any>;

  const buyer = Keypair.generate();
  const merchant = Keypair.generate();

  let usdcMint: PublicKey;
  let buyerUsdc: PublicKey;
  let merchantUsdc: PublicKey;

  // KaminoConfig is a program-wide singleton PDA (seeds = ["kamino_config"]).
  // It is initialized once by the "kamino config (v2.1 groundwork)" describe
  // block below; the "kamino CPI probe" describe block reuses this same
  // authority to reconfigure it rather than re-initializing (init would fail
  // — the account already exists).
  let kaminoConfigAuthority: Keypair;

  // ProtocolConfig governance authority, assigned by the "protocol config
  // (risk controls)" describe so later describes (Kamino variants) can flip
  // the pause flag / caps.
  let protocolGovAuthority: Keypair;

  const MERCHANT_NAME = "IBG Collection";

  const agreementPDA = (productId: string): PublicKey =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("agreement"), buyer.publicKey.toBuffer(), Buffer.from(productId)],
      program.programId
    )[0];

  const escrowPDA = (agreement: PublicKey): PublicKey =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), agreement.toBuffer()],
      program.programId
    )[0];

  async function createAgreement(
    productId: string,
    totalPrice: BN,
    count: number,
    intervalSeconds: BN
  ) {
    const agreement = agreementPDA(productId);
    const escrow = escrowPDA(agreement);
    await program.methods
      .createAgreement(totalPrice, count, intervalSeconds, productId, MERCHANT_NAME)
      .accounts({
        agreement,
        buyer: buyer.publicKey,
        merchant: merchant.publicKey,
        usdcMint,
        buyerUsdc,
        escrowUsdc: escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([buyer])
      .rpc();
    return { agreement, escrow };
  }

  async function payInstallment(agreement: PublicKey, escrow: PublicKey) {
    await program.methods
      .payInstallment()
      .accounts({
        agreement,
        buyer: buyer.publicKey,
        buyerUsdc,
        escrowUsdc: escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();
  }

  before(async () => {
    const latest = await provider.connection.getLatestBlockhash();
    const sigs = await Promise.all([
      provider.connection.requestAirdrop(buyer.publicKey, 10 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(merchant.publicKey, 2 * LAMPORTS_PER_SOL),
    ]);
    await Promise.all(
      sigs.map((sig) =>
        provider.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed")
      )
    );

    usdcMint = await createMint(provider.connection, buyer, buyer.publicKey, null, 6);
    buyerUsdc = await createAccount(provider.connection, buyer, usdcMint, buyer.publicKey);
    merchantUsdc = await createAccount(provider.connection, merchant, usdcMint, merchant.publicKey);
    await mintTo(provider.connection, buyer, usdcMint, buyerUsdc, buyer, 5_000_000_000);
  });

  // ── Exact remainder collection ────────────────────────────────────────────

  it("collects the integer-division remainder in the final installment", async () => {
    // $100 across 3 → 33.333333 + 33.333333 + 33.333334 = exactly $100
    const { agreement, escrow } = await createAgreement(
      "v2-remainder-001",
      new BN(100_000_000),
      3,
      new BN(1)
    );

    for (let i = 0; i < 2; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      await payInstallment(agreement, escrow);
    }

    const acct = await program.account.bnplAgreement.fetch(agreement);
    assert.deepEqual(acct.state, { completed: {} });

    const escrowAcct = await getAccount(provider.connection, escrow);
    assert.equal(
      escrowAcct.amount.toString(),
      "100000000",
      "Escrow must hold exactly total_price despite the 33.33.. split"
    );
  });

  // ── yield_source field (DEVELOPMENT_PLAN.md v2.1 item 4) ─────────────────
  // Every agreement now records whether its escrow yield is simulated
  // on-chain interest math or real Kamino Lend CPI yield. Until the Kamino
  // CPI deposit path lands, every agreement is YIELD_SOURCE_SIMULATED (0).

  it("records yield_source = Simulated (0) on every new agreement", async () => {
    const { agreement } = await createAgreement(
      "v2-yield-source-001",
      new BN(90_000_000),
      3,
      new BN(1)
    );

    const acct = await program.account.bnplAgreement.fetch(agreement);
    assert.equal(acct.yieldSource, 0, "yield_source must default to Simulated (0)");
  });

  // ── Double merchant_withdraw guard ────────────────────────────────────────

  it("blocks a second merchant_withdraw with AlreadyWithdrawn", async () => {
    // Reuse the completed agreement from the previous test
    const agreement = agreementPDA("v2-remainder-001");
    const escrow = escrowPDA(agreement);

    await program.methods
      .merchantWithdraw()
      .accounts({
        agreement,
        merchant: merchant.publicKey,
        escrowUsdc: escrow,
        merchantUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([merchant])
      .rpc();

    const acct = await program.account.bnplAgreement.fetch(agreement);
    assert.isTrue(acct.merchantWithdrawn, "merchant_withdrawn flag must be set");

    try {
      await program.methods
        .merchantWithdraw()
        .accounts({
          agreement,
          merchant: merchant.publicKey,
          escrowUsdc: escrow,
          merchantUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([merchant])
        .rpc();
      assert.fail("Expected AlreadyWithdrawn");
    } catch (err: any) {
      assert.include(err.message, "AlreadyWithdrawn");
    }
  });

  // ── close_agreement: rent reclamation ─────────────────────────────────────

  it("closes a settled (completed + withdrawn) agreement and refunds rent", async () => {
    const agreement = agreementPDA("v2-remainder-001");
    const escrow = escrowPDA(agreement);

    const lamportsBefore = await provider.connection.getBalance(buyer.publicKey);

    await program.methods
      .closeAgreement()
      .accounts({
        agreement,
        buyer: buyer.publicKey,
        escrowUsdc: escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    const closed = await program.account.bnplAgreement.fetchNullable(agreement);
    assert.isNull(closed, "Agreement account must be closed");

    const escrowInfo = await provider.connection.getAccountInfo(escrow);
    assert.isNull(escrowInfo, "Escrow token account must be closed");

    const lamportsAfter = await provider.connection.getBalance(buyer.publicKey);
    assert.isTrue(lamportsAfter > lamportsBefore, "Buyer must receive rent back");
  });

  it("closes a cancelled agreement", async () => {
    const { agreement, escrow } = await createAgreement(
      "v2-close-cancel-001",
      new BN(100_000_000),
      3,
      new BN(1)
    );

    await program.methods
      .cancelAgreement()
      .accounts({
        agreement,
        buyer: buyer.publicKey,
        buyerUsdc,
        escrowUsdc: escrow,
        merchantUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    await program.methods
      .closeAgreement()
      .accounts({
        agreement,
        buyer: buyer.publicKey,
        escrowUsdc: escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    const closed = await program.account.bnplAgreement.fetchNullable(agreement);
    assert.isNull(closed, "Cancelled agreement must be closeable");
  });

  it("rejects close_agreement while the agreement is Active", async () => {
    const { agreement, escrow } = await createAgreement(
      "v2-close-active-001",
      new BN(100_000_000),
      3,
      new BN(1)
    );

    try {
      await program.methods
        .closeAgreement()
        .accounts({
          agreement,
          buyer: buyer.publicKey,
          escrowUsdc: escrow,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();
      assert.fail("Expected AgreementNotSettled");
    } catch (err: any) {
      assert.include(err.message, "AgreementNotSettled");
    }
  });

  // ── Cancellation fee routing ──────────────────────────────────────────────

  it("rejects cancel_agreement when the fee destination is not the merchant's", async () => {
    const { agreement, escrow } = await createAgreement(
      "v2-cancel-fee-001",
      new BN(100_000_000),
      4,
      new BN(60)
    );

    const buyerOwnedUsdc = await createAccount(
      provider.connection,
      buyer,
      usdcMint,
      buyer.publicKey,
      Keypair.generate()
    );

    try {
      await program.methods
        .cancelAgreement()
        .accounts({
          agreement,
          buyer: buyer.publicKey,
          buyerUsdc,
          escrowUsdc: escrow,
          merchantUsdc: buyerOwnedUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();
      assert.fail("Expected ConstraintTokenOwner");
    } catch (err: any) {
      assert.include(err.message, "ConstraintTokenOwner");
    }

    const feeAcct = await getAccount(provider.connection, buyerOwnedUsdc);
    assert.equal(feeAcct.amount.toString(), "0", "Fee must not reach a buyer-owned account");
  });

  // ── update_pool_rate governance ───────────────────────────────────────────

  it("rejects update_pool_rate from a non-authority wallet", async () => {
    // Stake pool was initialized by the characterization suite's authority
    const [poolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_pool")],
      program.programId
    );

    try {
      await program.methods
        .updatePoolRate(500)
        .accounts({ stakePool: poolPDA, authority: buyer.publicKey })
        .signers([buyer])
        .rpc();
      assert.fail("Expected Unauthorized");
    } catch (err: any) {
      assert.include(err.message, "Unauthorized");
    }
  });

  // ── Input validation ──────────────────────────────────────────────────────

  it("rejects invalid create_agreement inputs", async () => {
    const cases: Array<{ price: BN; count: number; interval: BN; err: string }> = [
      { price: new BN(0), count: 3, interval: new BN(1), err: "InvalidAmount" },
      { price: new BN(100_000_000), count: 1, interval: new BN(1), err: "InvalidInstallments" },
      { price: new BN(100_000_000), count: 13, interval: new BN(1), err: "InvalidInstallments" },
      { price: new BN(100_000_000), count: 3, interval: new BN(0), err: "InvalidInterval" },
    ];

    for (const [i, c] of cases.entries()) {
      try {
        await createAgreement(`v2-invalid-${i}`, c.price, c.count, c.interval);
        assert.fail(`Expected ${c.err}`);
      } catch (err: any) {
        assert.include(err.message, c.err);
      }
    }
  });

  // ── v2.1: ProtocolConfig risk controls (DEVELOPMENT_PLAN.md v2.1 item 5) ──
  // Standalone in this increment — not yet wired into create_agreement /
  // stake_usdc (see state.rs for why). These tests cover the governance
  // surface: init, pause toggle, risk-limit updates, and authority gating.

  describe("protocol config (risk controls)", () => {
    const govAuthority = Keypair.generate();
    protocolGovAuthority = govAuthority;
    const attacker = Keypair.generate();

    const configPDA = (): PublicKey =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("protocol_config")],
        program.programId
      )[0];

    before(async () => {
      const latest = await provider.connection.getLatestBlockhash();
      const sigs = await Promise.all([
        provider.connection.requestAirdrop(govAuthority.publicKey, 2 * LAMPORTS_PER_SOL),
        provider.connection.requestAirdrop(attacker.publicKey, 2 * LAMPORTS_PER_SOL),
      ]);
      await Promise.all(
        sigs.map((sig) =>
          provider.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed")
        )
      );
    });

    it("rejects init_protocol_config from anyone but the program upgrade authority", async () => {
      try {
        await program.methods
          .initProtocolConfig()
          .accounts({
            config: configPDA(),
            authority: attacker.publicKey,
            upgradeAuthority: attacker.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Expected Unauthorized");
      } catch (err: any) {
        assert.include(err.message, "Unauthorized");
      }
      const info = await provider.connection.getAccountInfo(configPDA());
      assert.isNull(info, "a front-runner must not be able to create the singleton");
    });

    it("initializes the ProtocolConfig PDA with permissive defaults", async () => {
      const config = configPDA();
      await program.methods
        .initProtocolConfig()
        .accounts({
          config,
          authority: govAuthority.publicKey,
          upgradeAuthority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([govAuthority])
        .rpc();

      const acct = await program.account.protocolConfig.fetch(config);
      assert.equal(acct.authority.toBase58(), govAuthority.publicKey.toBase58());
      assert.isFalse(acct.paused);
      assert.equal(acct.maxAgreementDeposit.toString(), "0");
      assert.equal(acct.tvlCap.toString(), "0");
      assert.equal(acct.currentTvl.toString(), "0");
    });

    it("rejects set_protocol_paused from a non-authority wallet", async () => {
      const config = configPDA();
      try {
        await program.methods
          .setProtocolPaused(true)
          .accounts({ config, authority: attacker.publicKey })
          .signers([attacker])
          .rpc();
        assert.fail("Expected Unauthorized");
      } catch (err: any) {
        assert.include(err.message, "Unauthorized");
      }
    });

    it("lets the governance authority toggle the pause flag", async () => {
      const config = configPDA();
      await program.methods
        .setProtocolPaused(true)
        .accounts({ config, authority: govAuthority.publicKey })
        .signers([govAuthority])
        .rpc();

      let acct = await program.account.protocolConfig.fetch(config);
      assert.isTrue(acct.paused);

      await program.methods
        .setProtocolPaused(false)
        .accounts({ config, authority: govAuthority.publicKey })
        .signers([govAuthority])
        .rpc();

      acct = await program.account.protocolConfig.fetch(config);
      assert.isFalse(acct.paused);
    });

    it("rejects update_risk_limits from a non-authority wallet", async () => {
      const config = configPDA();
      try {
        await program.methods
          .updateRiskLimits(new BN(1_000_000_000), new BN(10_000_000_000))
          .accounts({ config, authority: attacker.publicKey })
          .signers([attacker])
          .rpc();
        assert.fail("Expected Unauthorized");
      } catch (err: any) {
        assert.include(err.message, "Unauthorized");
      }
    });

    it("lets the governance authority update the deposit and TVL caps", async () => {
      const config = configPDA();
      await program.methods
        .updateRiskLimits(new BN(1_000_000_000), new BN(10_000_000_000))
        .accounts({ config, authority: govAuthority.publicKey })
        .signers([govAuthority])
        .rpc();

      const acct = await program.account.protocolConfig.fetch(config);
      assert.equal(acct.maxAgreementDeposit.toString(), "1000000000");
      assert.equal(acct.tvlCap.toString(), "10000000000");
    });

    // ── create_agreement enforcement (DEVELOPMENT_PLAN.md v2.1 item 5) ──────
    // ProtocolConfig is a constant-seed PDA — Anchor's TS client auto-derives
    // and injects it into create_agreement even though these tests (and the
    // frozen characterization suite) never list it in `.accounts()`. These
    // tests exercise the actual enforcement path: pause blocks new
    // agreements, and the per-agreement deposit cap rejects oversized ones.
    // Each test restores permissive defaults afterward so it doesn't leak
    // into other tests.

    it("blocks create_agreement while the protocol is paused", async () => {
      const config = configPDA();
      await program.methods
        .setProtocolPaused(true)
        .accounts({ config, authority: govAuthority.publicKey })
        .signers([govAuthority])
        .rpc();

      try {
        await createAgreement("v2-riskctl-paused", new BN(50_000_000), 2, new BN(1));
        assert.fail("Expected ProtocolPaused");
      } catch (err: any) {
        assert.include(err.message, "ProtocolPaused");
      } finally {
        await program.methods
          .setProtocolPaused(false)
          .accounts({ config, authority: govAuthority.publicKey })
          .signers([govAuthority])
          .rpc();
      }
    });

    it("blocks create_agreement above the per-agreement deposit cap", async () => {
      const config = configPDA();
      await program.methods
        .updateRiskLimits(new BN(10_000_000), new BN(0)) // $10 cap, TVL cap unlimited
        .accounts({ config, authority: govAuthority.publicKey })
        .signers([govAuthority])
        .rpc();

      try {
        // $50 total_price exceeds the $10 max_agreement_deposit cap
        await createAgreement("v2-riskctl-cap", new BN(50_000_000), 2, new BN(1));
        assert.fail("Expected DepositCapExceeded");
      } catch (err: any) {
        assert.include(err.message, "DepositCapExceeded");
      } finally {
        // Restore permissive defaults (0 = unlimited) so nothing leaks.
        await program.methods
          .updateRiskLimits(new BN(0), new BN(0))
          .accounts({ config, authority: govAuthority.publicKey })
          .signers([govAuthority])
          .rpc();
      }
    });

    it("allows create_agreement again once pause/caps are reset to permissive", async () => {
      const { agreement } = await createAgreement(
        "v2-riskctl-ok",
        new BN(50_000_000),
        2,
        new BN(1)
      );
      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(acct.state, { active: {} });
    });

    // ── pay_installment enforcement (DEVELOPMENT_PLAN.md v2.1 item 5) ───────
    // Same constant-seed-PDA auto-derivation as create_agreement: an
    // emergency pause must also halt USDC moving into escrow on agreements
    // that already exist, not just block new ones.

    it("blocks pay_installment while the protocol is paused", async () => {
      const config = configPDA();

      // Create the agreement while unpaused, then pause before the 2nd payment.
      // No need to wait out the full due-time window here: the pause check
      // runs before the due-time check in the handler, so this proves pause
      // blocks the call regardless of whether installment 2 is actually due.
      const { agreement, escrow } = await createAgreement(
        "v2-riskctl-pay-paused",
        new BN(90_000_000),
        3,
        new BN(1)
      );
      await new Promise((r) => setTimeout(r, 1100));

      await program.methods
        .setProtocolPaused(true)
        .accounts({ config, authority: govAuthority.publicKey })
        .signers([govAuthority])
        .rpc();

      try {
        await payInstallment(agreement, escrow);
        assert.fail("Expected ProtocolPaused");
      } catch (err: any) {
        assert.include(err.message, "ProtocolPaused");
      } finally {
        await program.methods
          .setProtocolPaused(false)
          .accounts({ config, authority: govAuthority.publicKey })
          .signers([govAuthority])
          .rpc();
      }

      // Still active and still on installment 1 — the paused call had no effect.
      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(acct.state, { active: {} });
      assert.equal(acct.paidInstallments, 1);
    });

    it("allows pay_installment again once the protocol is unpaused", async () => {
      const config = configPDA();
      const { agreement, escrow } = await createAgreement(
        "v2-riskctl-pay-ok",
        new BN(90_000_000),
        3,
        new BN(1)
      );
      // Installment 2 is due at start_time + 2*interval_seconds (2s here).
      // Matches the 5s margin used elsewhere in this suite for interval=1s
      // agreements — the local validator's clock advances slower than
      // wall-clock time, so a tight sleep flakes (see characterization.ts).
      await new Promise((r) => setTimeout(r, 5000));

      // Confirm unpaused (previous test restores it, but assert explicitly).
      const before = await program.account.protocolConfig.fetch(config);
      assert.isFalse(before.paused);

      // The validator clock can lag wall-clock time under load, so a fixed
      // sleep alone flakes with PaymentNotDue. Retry only on that specific
      // error; any other failure (e.g. ProtocolPaused) still fails the test.
      let paid = false;
      for (let attempt = 0; attempt < 6 && !paid; attempt++) {
        try {
          await payInstallment(agreement, escrow);
          paid = true;
        } catch (err: any) {
          if (!String(err.message).includes("PaymentNotDue")) throw err;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      assert.isTrue(paid, "pay_installment never became due");

      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.equal(acct.paidInstallments, 2);
    });

    // ── TVL cap enforcement (DEVELOPMENT_PLAN.md v2.1 item 5) ────────────────
    // current_tvl/tvl_cap were previously tracked in the account but never
    // enforced or updated. create_agreement, pay_installment,
    // merchant_withdraw, and cancel_agreement now call
    // apply_tvl_increase/apply_tvl_decrease (protocol_config.rs) on every
    // path that moves money in or out of escrow. Assertions compare deltas
    // rather than absolute values since current_tvl is a running total
    // shared with every other test in this file that touches create_agreement
    // once the config PDA is initialized.

    it("increases current_tvl by the escrowed amount on create_agreement and pay_installment", async () => {
      const config = configPDA();
      const before = await program.account.protocolConfig.fetch(config);

      const { agreement, escrow } = await createAgreement(
        "v2-tvl-track",
        new BN(60_000_000),
        2,
        new BN(1)
      );
      const afterCreate = await program.account.protocolConfig.fetch(config);
      assert.equal(
        afterCreate.currentTvl.sub(before.currentTvl).toString(),
        "30000000",
        "current_tvl must grow by the first installment"
      );

      await new Promise((r) => setTimeout(r, 5000));
      await payInstallment(agreement, escrow);

      const afterPay = await program.account.protocolConfig.fetch(config);
      assert.equal(
        afterPay.currentTvl.sub(before.currentTvl).toString(),
        "60000000",
        "current_tvl must grow by the second installment too"
      );
    });

    it("rejects create_agreement that would breach the protocol-wide TVL cap", async () => {
      const config = configPDA();
      const { currentTvl } = await program.account.protocolConfig.fetch(config);
      // Cap set just above current usage — a $50 agreement cannot fit.
      const tightCap = currentTvl.add(new BN(5_000_000));

      await program.methods
        .updateRiskLimits(new BN(0), tightCap) // max_agreement_deposit unlimited
        .accounts({ config, authority: govAuthority.publicKey })
        .signers([govAuthority])
        .rpc();

      try {
        await createAgreement("v2-tvl-cap-create", new BN(50_000_000), 2, new BN(1));
        assert.fail("Expected TvlCapExceeded");
      } catch (err: any) {
        assert.include(err.message, "TvlCapExceeded");
      } finally {
        await program.methods
          .updateRiskLimits(new BN(0), new BN(0)) // restore unlimited
          .accounts({ config, authority: govAuthority.publicKey })
          .signers([govAuthority])
          .rpc();
      }
    });

    it("rejects pay_installment that would breach the protocol-wide TVL cap", async () => {
      const config = configPDA();

      // Create with caps permissive, then tighten the cap to exactly current
      // usage so the next installment has zero headroom.
      const { agreement, escrow } = await createAgreement(
        "v2-tvl-cap-pay",
        new BN(20_000_000),
        2,
        new BN(1)
      );
      const { currentTvl } = await program.account.protocolConfig.fetch(config);

      await program.methods
        .updateRiskLimits(new BN(0), currentTvl) // no headroom left
        .accounts({ config, authority: govAuthority.publicKey })
        .signers([govAuthority])
        .rpc();

      await new Promise((r) => setTimeout(r, 5000));

      try {
        await payInstallment(agreement, escrow);
        assert.fail("Expected TvlCapExceeded");
      } catch (err: any) {
        assert.include(err.message, "TvlCapExceeded");
      } finally {
        await program.methods
          .updateRiskLimits(new BN(0), new BN(0)) // restore unlimited
          .accounts({ config, authority: govAuthority.publicKey })
          .signers([govAuthority])
          .rpc();
      }

      // Still on installment 1 — the rejected call had no effect.
      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.equal(acct.paidInstallments, 1);
    });

    it("decreases current_tvl when merchant_withdraw pulls escrow out", async () => {
      const config = configPDA();

      const { agreement, escrow } = await createAgreement(
        "v2-tvl-withdraw",
        new BN(40_000_000),
        2,
        new BN(1)
      );
      await new Promise((r) => setTimeout(r, 5000));
      await payInstallment(agreement, escrow);

      const before = await program.account.protocolConfig.fetch(config);

      await program.methods
        .merchantWithdraw()
        .accounts({
          agreement,
          merchant: merchant.publicKey,
          escrowUsdc: escrow,
          merchantUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([merchant])
        .rpc();

      const after = await program.account.protocolConfig.fetch(config);
      assert.equal(
        before.currentTvl.sub(after.currentTvl).toString(),
        "40000000",
        "current_tvl must shrink by the full total_price withdrawn"
      );
    });

    it("decreases current_tvl when cancel_agreement drains escrow", async () => {
      const config = configPDA();

      const { agreement, escrow } = await createAgreement(
        "v2-tvl-cancel",
        new BN(100_000_000),
        4,
        new BN(1)
      );
      const beforeConfig = await program.account.protocolConfig.fetch(config);
      const escrowBefore = (await getAccount(provider.connection, escrow)).amount;

      await program.methods
        .cancelAgreement()
        .accounts({
          agreement,
          buyer: buyer.publicKey,
          buyerUsdc,
          escrowUsdc: escrow,
          merchantUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();

      const afterConfig = await program.account.protocolConfig.fetch(config);
      assert.equal(
        beforeConfig.currentTvl.sub(afterConfig.currentTvl).toString(),
        escrowBefore.toString(),
        "current_tvl must shrink by the entire escrowed balance on cancellation"
      );
    });
  });

  // ── v2.1: KaminoConfig — landing pad for real Kamino Lend CPI ──────────────
  // (DEVELOPMENT_PLAN.md v2.1 items 1-3; see
  // docs/design/KAMINO_CPI_INTEGRATION.md for the full design). No
  // instruction reads this account yet — these tests cover only the
  // governance surface (init, authority-gated update, permissive-by-default
  // safety) that the real CPI call will consume in a future session.

  describe("kamino config (v2.1 groundwork)", () => {
    const govAuthority = Keypair.generate();
    kaminoConfigAuthority = govAuthority;
    const attacker = Keypair.generate();

    const configPDA = (): PublicKey =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("kamino_config")],
        program.programId
      )[0];

    before(async () => {
      const latest = await provider.connection.getLatestBlockhash();
      const sigs = await Promise.all([
        provider.connection.requestAirdrop(govAuthority.publicKey, 2 * LAMPORTS_PER_SOL),
        provider.connection.requestAirdrop(attacker.publicKey, 2 * LAMPORTS_PER_SOL),
      ]);
      await Promise.all(
        sigs.map((sig) =>
          provider.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed")
        )
      );
    });

    it("rejects init_kamino_config from anyone but the program upgrade authority", async () => {
      try {
        await program.methods
          .initKaminoConfig()
          .accounts({
            config: configPDA(),
            authority: attacker.publicKey,
            upgradeAuthority: attacker.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Expected Unauthorized");
      } catch (err: any) {
        assert.include(err.message, "Unauthorized");
      }
      const info = await provider.connection.getAccountInfo(configPDA());
      assert.isNull(info, "a front-runner must not be able to create the singleton");
    });

    it("initializes the KaminoConfig PDA disabled, with zeroed accounts", async () => {
      const config = configPDA();
      await program.methods
        .initKaminoConfig()
        .accounts({
          config,
          authority: govAuthority.publicKey,
          upgradeAuthority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([govAuthority])
        .rpc();

      const acct = await program.account.kaminoConfig.fetch(config);
      assert.equal(acct.authority.toBase58(), govAuthority.publicKey.toBase58());
      assert.isFalse(acct.enabled);
      assert.equal(acct.kaminoProgram.toBase58(), PublicKey.default.toBase58());
      assert.equal(acct.reserve.toBase58(), PublicKey.default.toBase58());
    });

    it("rejects set_kamino_config from a non-authority wallet", async () => {
      const config = configPDA();
      const dummy = Keypair.generate().publicKey;
      try {
        await program.methods
          .setKaminoConfig(true, dummy, dummy, dummy, dummy, dummy, dummy)
          .accounts({ config, authority: attacker.publicKey })
          .signers([attacker])
          .rpc();
        assert.fail("Expected Unauthorized");
      } catch (err: any) {
        assert.include(err.message, "Unauthorized");
      }
    });

    it("lets the governance authority set the reserve/market accounts and enable switch", async () => {
      const config = configPDA();
      const kaminoProgram = Keypair.generate().publicKey;
      const lendingMarket = Keypair.generate().publicKey;
      const lendingMarketAuthority = Keypair.generate().publicKey;
      const reserve = Keypair.generate().publicKey;
      const reserveLiquiditySupply = Keypair.generate().publicKey;
      const reserveCollateralMint = Keypair.generate().publicKey;

      await program.methods
        .setKaminoConfig(
          true,
          kaminoProgram,
          lendingMarket,
          lendingMarketAuthority,
          reserve,
          reserveLiquiditySupply,
          reserveCollateralMint
        )
        .accounts({ config, authority: govAuthority.publicKey })
        .signers([govAuthority])
        .rpc();

      const acct = await program.account.kaminoConfig.fetch(config);
      assert.isTrue(acct.enabled);
      assert.equal(acct.kaminoProgram.toBase58(), kaminoProgram.toBase58());
      assert.equal(acct.lendingMarket.toBase58(), lendingMarket.toBase58());
      assert.equal(acct.reserve.toBase58(), reserve.toBase58());
      assert.equal(
        acct.reserveLiquiditySupply.toBase58(),
        reserveLiquiditySupply.toBase58()
      );
      assert.equal(
        acct.reserveCollateralMint.toBase58(),
        reserveCollateralMint.toBase58()
      );

      // Disable again so a future test run (or another suite) never finds
      // this PDA enabled — no instruction reads it yet, but staying
      // conservative costs nothing.
      await program.methods
        .setKaminoConfig(
          false,
          kaminoProgram,
          lendingMarket,
          lendingMarketAuthority,
          reserve,
          reserveLiquiditySupply,
          reserveCollateralMint
        )
        .accounts({ config, authority: govAuthority.publicKey })
        .signers([govAuthority])
        .rpc();
    });

    it("does not affect create_agreement — no instruction reads KaminoConfig yet", async () => {
      // Sanity check on the "safe landing pad" claim: an agreement created
      // after KaminoConfig exists (in whatever enabled state the prior test
      // left it in) still gets simulated yield via the raw-USDC escrow path,
      // exactly like every other agreement in this suite.
      const { agreement } = await createAgreement(
        "v2-kamino-config-noop",
        new BN(40_000_000),
        4,
        new BN(1)
      );
      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.equal(acct.yieldSource, 0, "yield_source must still be Simulated");
    });
  });

  // ── Kamino CPI proof-of-concept (v2.1 items 1-3, "next" per 2026-07-14) ──
  // Proves the manual-CPI + fallback-on-failure mechanics in kamino_cpi.rs
  // / kamino_probe.rs against a local mock Kamino program. Not wired into
  // create_agreement/pay_installment/merchant_withdraw yet — see
  // kamino_probe.rs module doc for why. This is a standalone probe: it
  // moves an agreement's already-escrowed USDC into a mock reserve and
  // back, and proves a CPI failure degrades to a no-op instead of
  // aborting the transaction.
  describe("kamino CPI probe (v2.1 items 1-3)", () => {
    const mockKamino = anchor.workspace.MockKaminoLend as Program<any>;
    const reserveAuthority = Keypair.generate();

    let liquidityMint: PublicKey;
    let collateralMint: PublicKey;
    let reservePDA: PublicKey;
    let reserveLiquiditySupply: PublicKey;
    let approvedLendingMarket: PublicKey;
    let approvedLendingMarketAuthority: PublicKey;

    const dummyPubkey = () => Keypair.generate().publicKey;

    const probeConfigPDA = (): PublicKey =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("kamino_config")],
        program.programId
      )[0];

    const escrowCollateralPDA = (agreement: PublicKey): PublicKey =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("kamino_collateral"), agreement.toBuffer()],
        program.programId
      )[0];

    // Shared account bundle for kaminoProbeDeposit/Redeem calls — every
    // field here must match the governance-approved KaminoConfig exactly,
    // enforced by require_matches_kamino_config in the handler.
    const approvedAccounts = () => ({
      config: probeConfigPDA(),
      kaminoProgram: mockKamino.programId,
      kaminoLendingMarket: approvedLendingMarket,
      kaminoLendingMarketAuthority: approvedLendingMarketAuthority,
      kaminoReserve: reservePDA,
      kaminoReserveLiquiditySupply: reserveLiquiditySupply,
      kaminoReserveCollateralMint: collateralMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

    before(async () => {
      const sig = await provider.connection.requestAirdrop(
        reserveAuthority.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      const latest = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");

      // Reuse the shared USDC mint as the mock reserve's liquidity mint —
      // it's just a devnet-style 6-decimal SPL mint, same as production USDC.
      liquidityMint = usdcMint;

      [reservePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("reserve"), liquidityMint.toBuffer()],
        mockKamino.programId
      );

      // Collateral mint's authority must be the reserve PDA — that's who
      // signs mint_to/burn inside the mock program's deposit/redeem
      // handlers via invoke_signed.
      collateralMint = await createMint(
        provider.connection,
        buyer,
        reservePDA,
        null,
        6
      );

      reserveLiquiditySupply = await createAccount(
        provider.connection,
        buyer,
        liquidityMint,
        reservePDA,
        Keypair.generate() // owner (reservePDA) is off-curve — can't use an ATA
      );

      await mockKamino.methods
        .initializeReserve(false)
        .accounts({
          reserve: reservePDA,
          authority: reserveAuthority.publicKey,
          liquidityMint,
          collateralMint,
          reserveLiquiditySupply,
          systemProgram: SystemProgram.programId,
        })
        .signers([reserveAuthority])
        .rpc();

      // Reconfigure the program-wide KaminoConfig singleton (already
      // initialized by the "kamino config (v2.1 groundwork)" describe
      // block above) to point at this block's mock reserve and enable it —
      // kamino_probe_deposit/redeem now require every target account to
      // match it exactly (DEVELOPMENT_PLAN.md v2.1 gating).
      approvedLendingMarket = dummyPubkey();
      approvedLendingMarketAuthority = dummyPubkey();

      const config = probeConfigPDA();
      await program.methods
        .setKaminoConfig(
          true,
          mockKamino.programId,
          approvedLendingMarket,
          approvedLendingMarketAuthority,
          reservePDA,
          reserveLiquiditySupply,
          collateralMint
        )
        .accounts({ config, authority: kaminoConfigAuthority.publicKey })
        .signers([kaminoConfigAuthority])
        .rpc();
    });

    it("rejects kamino_probe_deposit when KaminoConfig is disabled", async () => {
      const config = probeConfigPDA();
      await program.methods
        .setKaminoConfig(
          false,
          mockKamino.programId,
          approvedLendingMarket,
          approvedLendingMarketAuthority,
          reservePDA,
          reserveLiquiditySupply,
          collateralMint
        )
        .accounts({ config, authority: kaminoConfigAuthority.publicKey })
        .signers([kaminoConfigAuthority])
        .rpc();

      const { agreement, escrow } = await createAgreement(
        "v2-kamino-probe-disabled",
        new BN(20_000_000),
        3,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);
      const escrowBefore = await getAccount(provider.connection, escrow);

      try {
        await program.methods
          .kaminoProbeDeposit(new BN(Number(escrowBefore.amount)))
          .accounts({
            agreement,
            payer: buyer.publicKey,
            escrowUsdc: escrow,
            ...approvedAccounts(),
            escrowKaminoCollateral: escrowCollateral,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Expected KaminoConfigDisabled");
      } catch (err: any) {
        assert.include(err.message, "KaminoConfigDisabled");
      }

      // Re-enable for the rest of this describe block's tests.
      await program.methods
        .setKaminoConfig(
          true,
          mockKamino.programId,
          approvedLendingMarket,
          approvedLendingMarketAuthority,
          reservePDA,
          reserveLiquiditySupply,
          collateralMint
        )
        .accounts({ config, authority: kaminoConfigAuthority.publicKey })
        .signers([kaminoConfigAuthority])
        .rpc();
    });

    it("rejects kamino_probe_deposit when a target account does not match KaminoConfig", async () => {
      const { agreement, escrow } = await createAgreement(
        "v2-kamino-probe-mismatch",
        new BN(20_000_000),
        3,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);
      const escrowBefore = await getAccount(provider.connection, escrow);

      try {
        await program.methods
          .kaminoProbeDeposit(new BN(Number(escrowBefore.amount)))
          .accounts({
            agreement,
            payer: buyer.publicKey,
            escrowUsdc: escrow,
            ...approvedAccounts(),
            // Wrong lending market — must not match config.lendingMarket.
            kaminoLendingMarket: dummyPubkey(),
            escrowKaminoCollateral: escrowCollateral,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Expected KaminoAccountMismatch");
      } catch (err: any) {
        assert.include(err.message, "KaminoAccountMismatch");
      }
    });

    it("deposits escrowed USDC into the mock Kamino reserve, mints escrow kTokens, and flips yield_source", async () => {
      const { agreement, escrow } = await createAgreement(
        "v2-kamino-probe-deposit",
        new BN(60_000_000),
        3,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);
      const escrowBefore = await getAccount(provider.connection, escrow);
      const depositAmount = new BN(Number(escrowBefore.amount)); // full first-installment balance

      await program.methods
        .kaminoProbeDeposit(depositAmount)
        .accounts({
          agreement,
          payer: buyer.publicKey,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      const escrowAfter = await getAccount(provider.connection, escrow);
      assert.equal(escrowAfter.amount.toString(), "0", "escrow USDC moved into the reserve");

      const collateralAcct = await getAccount(provider.connection, escrowCollateral);
      assert.equal(
        collateralAcct.amount.toString(),
        depositAmount.toString(),
        "escrow must hold 1:1 kTokens for the deposited amount"
      );

      const agreementAcct = await program.account.bnplAgreement.fetch(agreement);
      assert.equal(
        agreementAcct.yieldSource,
        1,
        "yield_source must flip to KaminoLend on a successful deposit"
      );
    });

    it("redeems escrow kTokens back into USDC and flips yield_source back to Simulated", async () => {
      const agreement = agreementPDA("v2-kamino-probe-deposit");
      const escrow = escrowPDA(agreement);
      const escrowCollateral = escrowCollateralPDA(agreement);

      const collateralBefore = await getAccount(provider.connection, escrowCollateral);
      const redeemAmount = new BN(Number(collateralBefore.amount));

      await program.methods
        .kaminoProbeRedeem(redeemAmount)
        .accounts({
          agreement,
          payer: buyer.publicKey,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
        })
        .signers([buyer])
        .rpc();

      const escrowAfter = await getAccount(provider.connection, escrow);
      assert.equal(
        escrowAfter.amount.toString(),
        redeemAmount.toString(),
        "USDC must return to escrow 1:1"
      );

      const collateralAfter = await getAccount(provider.connection, escrowCollateral);
      assert.equal(collateralAfter.amount.toString(), "0", "kTokens burned on redemption");

      const agreementAcct = await program.account.bnplAgreement.fetch(agreement);
      assert.equal(
        agreementAcct.yieldSource,
        0,
        "yield_source must flip back to Simulated once redeemed to raw USDC"
      );
    });

    it("falls back cleanly (no state change, no tx failure) when the CPI target rejects the deposit", async () => {
      // Force a deposit failure the same way the mock program documents:
      // pause the reserve. try_kamino_deposit must return Err, the handler
      // must catch it and emit a Fallback event, and the instruction must
      // still succeed — "never block a purchase on a DeFi dependency."
      await mockKamino.methods
        .setPaused(true)
        .accounts({ reserve: reservePDA, authority: reserveAuthority.publicKey })
        .signers([reserveAuthority])
        .rpc();

      const { agreement, escrow } = await createAgreement(
        "v2-kamino-probe-fallback",
        new BN(30_000_000),
        3,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);
      const escrowBefore = await getAccount(provider.connection, escrow);

      // Must not throw — the CPI failure is caught internally.
      await program.methods
        .kaminoProbeDeposit(new BN(Number(escrowBefore.amount)))
        .accounts({
          agreement,
          payer: buyer.publicKey,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      const escrowAfter = await getAccount(provider.connection, escrow);
      assert.equal(
        escrowAfter.amount.toString(),
        escrowBefore.amount.toString(),
        "escrow USDC must be untouched on CPI failure"
      );

      const collateralAcct = await getAccount(provider.connection, escrowCollateral);
      assert.equal(collateralAcct.amount.toString(), "0", "no kTokens minted on CPI failure");

      // Restore for hygiene, in case other tests run after this in future.
      await mockKamino.methods
        .setPaused(false)
        .accounts({ reserve: reservePDA, authority: reserveAuthority.publicKey })
        .signers([reserveAuthority])
        .rpc();
    });

    it("is a permissionless crank: a third party who is not the agreement's buyer can deposit and redeem", async () => {
      // DEVELOPMENT_PLAN.md v2.1 item 3, option (b) from kamino_cpi.rs's doc:
      // "move yield deposits into a separate crank instruction/transaction,
      // so a Kamino failure can never fail a purchase transaction." That
      // pattern only works if the crank can actually be submitted by someone
      // other than the buyer (a keeper bot). Prove it here with a random
      // keypair that never signs anywhere else in this agreement's life.
      const keeper = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(keeper.publicKey, LAMPORTS_PER_SOL),
        "confirmed"
      );

      const { agreement, escrow } = await createAgreement(
        "v2-kamino-probe-permissionless",
        new BN(40_000_000),
        4,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);
      const escrowBefore = await getAccount(provider.connection, escrow);
      const depositAmount = new BN(Number(escrowBefore.amount));

      // Deposit, signed only by `keeper` — not the buyer.
      await program.methods
        .kaminoProbeDeposit(depositAmount)
        .accounts({
          agreement,
          payer: keeper.publicKey,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([keeper])
        .rpc();

      const collateralAfterDeposit = await getAccount(provider.connection, escrowCollateral);
      assert.equal(
        collateralAfterDeposit.amount.toString(),
        depositAmount.toString(),
        "a non-buyer keeper can crank the deposit"
      );

      // Redeem, again signed only by `keeper`.
      await program.methods
        .kaminoProbeRedeem(depositAmount)
        .accounts({
          agreement,
          payer: keeper.publicKey,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
        })
        .signers([keeper])
        .rpc();

      const escrowAfterRedeem = await getAccount(provider.connection, escrow);
      assert.equal(
        escrowAfterRedeem.amount.toString(),
        depositAmount.toString(),
        "a non-buyer keeper can crank the redeem"
      );
    });

    it("allows redeeming Kamino collateral after Completed, so merchant_withdraw can recover the full total_price", async () => {
      // Reproduces the exact gap fixed 2026-09-11 (see kamino_probe.rs
      // module doc, "REDEEM ALLOWED POST-COMPLETION"): pay_installment moves
      // Active -> Completed with zero Kamino awareness, so an agreement
      // whose first installment was cranked into Kamino while Active
      // reaches Completed with its value split between escrow_usdc (raw)
      // and escrow_kamino_collateral (kTokens). merchant_withdraw only
      // reads escrow_usdc, so it must fail until this crank reconciles the
      // balance back — even though the agreement is fully paid off.
      const { agreement, escrow } = await createAgreement(
        "v2-kamino-redeem-post-completion",
        new BN(40_000_000),
        2,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);

      // Deposit the first installment into Kamino while still Active.
      const firstInstallment = await getAccount(provider.connection, escrow);
      await program.methods
        .kaminoProbeDeposit(new BN(Number(firstInstallment.amount)))
        .accounts({
          agreement,
          payer: buyer.publicKey,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      // Pay the final installment — this completes the agreement.
      await new Promise((r) => setTimeout(r, 5000));
      await payInstallment(agreement, escrow);

      const completed = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(completed.state, { completed: {} });

      // escrow_usdc only holds the second installment; the first is still
      // parked in Kamino collateral. merchant_withdraw must fail here.
      try {
        await program.methods
          .merchantWithdraw()
          .accounts({
            agreement,
            merchant: merchant.publicKey,
            escrowUsdc: escrow,
            merchantUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([merchant])
          .rpc();
        assert.fail("Expected NothingToWithdraw before redeeming Kamino collateral");
      } catch (err: any) {
        assert.include(err.message, "NothingToWithdraw");
      }

      // Redeem the parked collateral now that the agreement is Completed —
      // before the 2026-09-11 fix this reverted with AgreementNotActive.
      const collateralBefore = await getAccount(provider.connection, escrowCollateral);
      await program.methods
        .kaminoProbeRedeem(new BN(Number(collateralBefore.amount)))
        .accounts({
          agreement,
          payer: buyer.publicKey,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
        })
        .signers([buyer])
        .rpc();

      // Now merchant_withdraw succeeds for the full total_price.
      const merchantBefore = await getAccount(provider.connection, merchantUsdc);
      await program.methods
        .merchantWithdraw()
        .accounts({
          agreement,
          merchant: merchant.publicKey,
          escrowUsdc: escrow,
          merchantUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([merchant])
        .rpc();
      const merchantAfter = await getAccount(provider.connection, merchantUsdc);
      assert.equal(
        (merchantAfter.amount - merchantBefore.amount).toString(),
        "40000000",
        "merchant must recover the full total_price once Kamino collateral is reconciled"
      );
    });

    it("rejects kamino_probe_redeem once an agreement is Cancelled", async () => {
      // Cancelled/Defaulted both drain escrow_usdc and zero
      // escrow_deposited in the same transaction that changes state — see
      // the inline comment on the redeem handler's state check. Prove the
      // Cancelled half here; Defaulted requires a real 7-day grace-period
      // wait and is covered by the state-check logic, not a live test.
      const { agreement, escrow } = await createAgreement(
        "v2-kamino-redeem-cancelled",
        new BN(20_000_000),
        3,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);
      const escrowBefore = await getAccount(provider.connection, escrow);

      await program.methods
        .kaminoProbeDeposit(new BN(Number(escrowBefore.amount)))
        .accounts({
          agreement,
          payer: buyer.publicKey,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      await program.methods
        .cancelAgreement()
        .accounts({
          agreement,
          buyer: buyer.publicKey,
          buyerUsdc,
          escrowUsdc: escrow,
          merchantUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();

      const cancelled = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(cancelled.state, { cancelled: {} });

      try {
        await program.methods
          .kaminoProbeRedeem(new BN(Number(escrowBefore.amount)))
          .accounts({
            agreement,
            payer: buyer.publicKey,
            escrowUsdc: escrow,
            ...approvedAccounts(),
            escrowKaminoCollateral: escrowCollateral,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Expected AgreementNotRedeemable");
      } catch (err: any) {
        assert.include(err.message, "AgreementNotRedeemable");
      }
    });

    it("merchant_withdraw_reconciled redeems Kamino collateral and pays the merchant in a single transaction", async () => {
      // Same setup as "allows redeeming Kamino collateral after Completed"
      // above, but proves the single-transaction path: no separate
      // kaminoProbeRedeem call before merchantWithdraw.
      const { agreement, escrow } = await createAgreement(
        "v2-merchant-withdraw-reconciled",
        new BN(40_000_000),
        2,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);

      const firstInstallment = await getAccount(provider.connection, escrow);
      await program.methods
        .kaminoProbeDeposit(new BN(Number(firstInstallment.amount)))
        .accounts({
          agreement,
          payer: buyer.publicKey,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      await new Promise((r) => setTimeout(r, 5000));
      await payInstallment(agreement, escrow);

      const completed = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(completed.state, { completed: {} });

      // escrow_usdc alone (the second installment only) can't cover
      // total_price — the reconcile branch must fire inline.
      const escrowBeforeWithdraw = await getAccount(provider.connection, escrow);
      assert.isBelow(Number(escrowBeforeWithdraw.amount), 40_000_000);

      const merchantBefore = await getAccount(provider.connection, merchantUsdc);
      await program.methods
        .merchantWithdrawReconciled()
        .accounts({
          agreement,
          escrowUsdc: escrow,
          merchantUsdc,
          payer: buyer.publicKey,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      const merchantAfter = await getAccount(provider.connection, merchantUsdc);
      assert.equal(
        (merchantAfter.amount - merchantBefore.amount).toString(),
        "40000000",
        "merchant must receive the full total_price in one transaction, no separate crank"
      );

      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.isTrue(acct.merchantWithdrawn);

      // Second call must fail — same double-withdraw protection as
      // merchant_withdraw.
      try {
        await program.methods
          .merchantWithdrawReconciled()
          .accounts({
            agreement,
            escrowUsdc: escrow,
            merchantUsdc,
            payer: buyer.publicKey,
            ...approvedAccounts(),
            escrowKaminoCollateral: escrowCollateral,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Expected AlreadyWithdrawn");
      } catch (err: any) {
        assert.include(err.message, "AlreadyWithdrawn");
      }
    });

    it("merchant_withdraw_reconciled degrades to plain merchant_withdraw when Kamino was never used", async () => {
      // No kaminoProbeDeposit call at all — escrow_kamino_collateral does
      // not exist yet (init_if_needed creates it with a zero balance), so
      // the reconcile branch must be skipped entirely and escrow_usdc alone
      // must already cover total_price, exactly like merchant_withdraw.
      const { agreement, escrow } = await createAgreement(
        "v2-mwr-no-kamino",
        new BN(30_000_000),
        3,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);

      for (let i = 0; i < 2; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        await payInstallment(agreement, escrow);
      }

      const completed = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(completed.state, { completed: {} });

      const merchantBefore = await getAccount(provider.connection, merchantUsdc);
      await program.methods
        .merchantWithdrawReconciled()
        .accounts({
          agreement,
          escrowUsdc: escrow,
          merchantUsdc,
          payer: buyer.publicKey,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      const merchantAfter = await getAccount(provider.connection, merchantUsdc);
      assert.equal(
        (merchantAfter.amount - merchantBefore.amount).toString(),
        "30000000",
        "must pay full total_price even though Kamino collateral was never touched"
      );

      const collateralAcct = await getAccount(provider.connection, escrowCollateral);
      assert.equal(collateralAcct.amount.toString(), "0");
    });

    // pay_installment_kamino (v2.1 inline deposit)
    const payKamino = (agreement: PublicKey, escrow: PublicKey, overrides: any = {}) =>
      program.methods
        .payInstallmentKamino()
        .accounts({
          agreement,
          buyer: buyer.publicKey,
          buyerUsdc,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateralPDA(agreement),
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
          ...overrides,
        })
        .signers([buyer])
        .rpc();

    it("pay_installment_kamino pays the installment and deposits it into Kamino in one transaction", async () => {
      const { agreement, escrow } = await createAgreement(
        "v2-pay-kamino-inline",
        new BN(40_000_000),
        2,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);
      const before = await getAccount(provider.connection, escrow);

      await new Promise((r) => setTimeout(r, 5000));
      await payKamino(agreement, escrow);

      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.equal(acct.paidInstallments, 2);
      assert.deepEqual(acct.state, { completed: {} });
      assert.equal(acct.yieldSource, 1, "yield_source flips to KaminoLend");
      assert.equal(acct.escrowDeposited.toString(), "40000000");

      const after = await getAccount(provider.connection, escrow);
      assert.equal(after.amount.toString(), before.amount.toString(), "new installment left escrow_usdc");
      const collateral = await getAccount(provider.connection, escrowCollateral);
      assert.equal(collateral.amount.toString(), "20000000", "installment held as kTokens");

      // Reconciled exit recovers the full price with no crank.
      const merchantBefore = await getAccount(provider.connection, merchantUsdc);
      await program.methods
        .merchantWithdrawReconciled()
        .accounts({
          agreement,
          escrowUsdc: escrow,
          merchantUsdc,
          payer: buyer.publicKey,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();
      const merchantAfter = await getAccount(provider.connection, merchantUsdc);
      assert.equal((merchantAfter.amount - merchantBefore.amount).toString(), "40000000");
    });

    it("pay_installment_kamino falls back to raw USDC when the reserve is paused", async () => {
      const { agreement, escrow } = await createAgreement(
        "v2-pay-kamino-fallback",
        new BN(40_000_000),
        2,
        new BN(1)
      );
      await mockKamino.methods
        .setPaused(true)
        .accounts({ reserve: reservePDA, authority: reserveAuthority.publicKey })
        .signers([reserveAuthority])
        .rpc();
      try {
        await new Promise((r) => setTimeout(r, 5000));
        await payKamino(agreement, escrow);
      } finally {
        await mockKamino.methods
          .setPaused(false)
          .accounts({ reserve: reservePDA, authority: reserveAuthority.publicKey })
          .signers([reserveAuthority])
          .rpc();
      }
      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.equal(acct.paidInstallments, 2, "purchase flow must not be blocked");
      assert.equal(acct.yieldSource, 0, "still Simulated");
      const escrowAcct = await getAccount(provider.connection, escrow);
      assert.equal(escrowAcct.amount.toString(), "40000000", "held as raw USDC");
      const collateral = await getAccount(provider.connection, escrowCollateralPDA(agreement));
      assert.equal(collateral.amount.toString(), "0");
    });

    it("pay_installment_kamino rejects Kamino accounts that do not match KaminoConfig", async () => {
      const { agreement, escrow } = await createAgreement(
        "v2-pay-kamino-mismatch",
        new BN(40_000_000),
        2,
        new BN(1)
      );
      await new Promise((r) => setTimeout(r, 5000));
      try {
        await payKamino(agreement, escrow, { kaminoLendingMarket: dummyPubkey() });
        assert.fail("Expected KaminoAccountMismatch");
      } catch (err: any) {
        assert.include(err.message, "KaminoAccountMismatch");
      }
      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.equal(acct.paidInstallments, 1, "failed tx must not advance the schedule");
    });

    // create_agreement_kamino (v2.1 inline deposit of the first installment)
    const createKamino = (productId: string, overrides: any = {}, total = new BN(40_000_000)) => {
      const agreement = agreementPDA(productId);
      const escrow = escrowPDA(agreement);
      return program.methods
        .createAgreementKamino(total, 2, new BN(1), productId, MERCHANT_NAME)
        .accounts({
          agreement,
          buyer: buyer.publicKey,
          merchant: merchant.publicKey,
          usdcMint,
          buyerUsdc,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateralPDA(agreement),
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
          ...overrides,
        })
        .signers([buyer])
        .rpc()
        .then(() => ({ agreement, escrow }));
    };

    it("create_agreement_kamino creates the agreement and deposits the first installment into Kamino", async () => {
      const buyerBefore = await getAccount(provider.connection, buyerUsdc);
      const { agreement, escrow } = await createKamino("v2-create-kamino-inline");

      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.equal(acct.paidInstallments, 1);
      assert.deepEqual(acct.state, { active: {} });
      assert.equal(acct.installmentAmount.toString(), "20000000");
      assert.equal(acct.escrowDeposited.toString(), "20000000");
      assert.equal(acct.yieldSource, 1, "yield_source is KaminoLend from the first USDC");

      const escrowAcct = await getAccount(provider.connection, escrow);
      assert.equal(escrowAcct.amount.toString(), "0", "first installment left escrow_usdc");
      const collateral = await getAccount(provider.connection, escrowCollateralPDA(agreement));
      assert.equal(collateral.amount.toString(), "20000000", "held as kTokens");
      const buyerAfter = await getAccount(provider.connection, buyerUsdc);
      assert.equal((buyerBefore.amount - buyerAfter.amount).toString(), "20000000");

      // Reconciled cancel recovers the money with no crank.
      const buyerPre = await getAccount(provider.connection, buyerUsdc);
      await program.methods
        .cancelAgreementReconciled()
        .accounts({
          agreement,
          escrowUsdc: escrow,
          buyerUsdc,
          merchantUsdc,
          buyer: buyer.publicKey,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateralPDA(agreement),
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();
      const buyerPost = await getAccount(provider.connection, buyerUsdc);
      const merchantPost = await getAccount(provider.connection, merchantUsdc);
      assert.isTrue(buyerPost.amount > buyerPre.amount, "buyer refunded from redeemed collateral");
      const collateralAfter = await getAccount(provider.connection, escrowCollateralPDA(agreement));
      assert.equal(collateralAfter.amount.toString(), "0");
      assert.isTrue(merchantPost.amount >= 0n);
    });

    it("create_agreement_kamino falls back to raw USDC when the reserve is paused", async () => {
      await mockKamino.methods
        .setPaused(true)
        .accounts({ reserve: reservePDA, authority: reserveAuthority.publicKey })
        .signers([reserveAuthority])
        .rpc();
      let created: { agreement: PublicKey; escrow: PublicKey };
      try {
        created = await createKamino("v2-create-kamino-fallback");
      } finally {
        await mockKamino.methods
          .setPaused(false)
          .accounts({ reserve: reservePDA, authority: reserveAuthority.publicKey })
          .signers([reserveAuthority])
          .rpc();
      }
      const acct = await program.account.bnplAgreement.fetch(created.agreement);
      assert.equal(acct.paidInstallments, 1, "purchase flow must not be blocked");
      assert.equal(acct.yieldSource, 0, "still Simulated");
      const escrowAcct = await getAccount(provider.connection, created.escrow);
      assert.equal(escrowAcct.amount.toString(), "20000000", "held as raw USDC");
      const collateral = await getAccount(provider.connection, escrowCollateralPDA(created.agreement));
      assert.equal(collateral.amount.toString(), "0");
    });

    it("create_agreement_kamino rejects Kamino accounts that do not match KaminoConfig and creates nothing", async () => {
      try {
        await createKamino("v2-create-kamino-mismatch", { kaminoLendingMarket: dummyPubkey() });
        assert.fail("Expected KaminoAccountMismatch");
      } catch (err: any) {
        assert.include(err.message, "KaminoAccountMismatch");
      }
      const info = await provider.connection.getAccountInfo(agreementPDA("v2-create-kamino-mismatch"));
      assert.isNull(info, "failed tx must not leave an agreement behind");
    });

    it("create_agreement_kamino enforces the same argument validation as create_agreement", async () => {
      try {
        await createKamino("v2-create-kamino-zero", {}, new BN(0));
        assert.fail("Expected InvalidAmount");
      } catch (err: any) {
        assert.include(err.message, "InvalidAmount");
      }
    });

    // ── Risk controls on the Kamino variants (DEVELOPMENT_PLAN.md v2.1 item 5)
    const riskConfigPDA = () =>
      PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], program.programId)[0];
    const setRiskPaused = (paused: boolean) =>
      program.methods
        .setProtocolPaused(paused)
        .accounts({ config: riskConfigPDA(), authority: protocolGovAuthority.publicKey })
        .signers([protocolGovAuthority])
        .rpc();
    const setRiskLimits = (maxDeposit: BN, tvlCap: BN) =>
      program.methods
        .updateRiskLimits(maxDeposit, tvlCap)
        .accounts({ config: riskConfigPDA(), authority: protocolGovAuthority.publicKey })
        .signers([protocolGovAuthority])
        .rpc();

    it("create_agreement_kamino is blocked by the protocol pause flag and creates nothing", async () => {
      await setRiskPaused(true);
      try {
        await createKamino("v2-create-kamino-paused");
        assert.fail("Expected ProtocolPaused");
      } catch (err: any) {
        assert.include(err.message, "ProtocolPaused");
      } finally {
        await setRiskPaused(false);
      }
      const info = await provider.connection.getAccountInfo(agreementPDA("v2-create-kamino-paused"));
      assert.isNull(info);
    });

    it("create_agreement_kamino enforces the per-agreement cap and the TVL cap", async () => {
      try {
        await setRiskLimits(new BN(10_000_000), new BN(0));
        try {
          await createKamino("v2-create-kamino-cap");
          assert.fail("Expected DepositCapExceeded");
        } catch (err: any) {
          assert.include(err.message, "DepositCapExceeded");
        }

        const { currentTvl } = await program.account.protocolConfig.fetch(riskConfigPDA());
        await setRiskLimits(new BN(0), currentTvl.add(new BN(10_000_000)));
        try {
          await createKamino("v2-create-kamino-tvl");
          assert.fail("Expected TvlCapExceeded");
        } catch (err: any) {
          assert.include(err.message, "TvlCapExceeded");
        }
      } finally {
        await setRiskLimits(new BN(0), new BN(0));
      }
      assert.isNull(await provider.connection.getAccountInfo(agreementPDA("v2-create-kamino-cap")));
      assert.isNull(await provider.connection.getAccountInfo(agreementPDA("v2-create-kamino-tvl")));
    });

    it("pay_installment_kamino is blocked by the protocol pause flag", async () => {
      const { agreement, escrow } = await createAgreement(
        "v2-pay-kamino-paused",
        new BN(40_000_000),
        2,
        new BN(1)
      );
      await setRiskPaused(true);
      try {
        await new Promise((r) => setTimeout(r, 5000));
        await payKamino(agreement, escrow);
        assert.fail("Expected ProtocolPaused");
      } catch (err: any) {
        assert.include(err.message, "ProtocolPaused");
      } finally {
        await setRiskPaused(false);
      }
      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.equal(acct.paidInstallments, 1, "paused tx must not advance the schedule");
    });

    it("keeps current_tvl exact across a Kamino create and a reconciled cancel", async () => {
      const before = await program.account.protocolConfig.fetch(riskConfigPDA());
      const { agreement, escrow } = await createKamino("v2-create-kamino-tvl-track");
      const mid = await program.account.protocolConfig.fetch(riskConfigPDA());
      assert.equal(
        mid.currentTvl.sub(before.currentTvl).toString(),
        "20000000",
        "first installment counted once even though it landed in Kamino"
      );

      await program.methods
        .cancelAgreementReconciled()
        .accounts({
          agreement,
          escrowUsdc: escrow,
          buyerUsdc,
          merchantUsdc,
          buyer: buyer.publicKey,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateralPDA(agreement),
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();
      const after = await program.account.protocolConfig.fetch(riskConfigPDA());
      assert.equal(
        after.currentTvl.toString(),
        before.currentTvl.toString(),
        "reconciled cancel must release exactly what the Kamino create added"
      );
    });

    it("cancel_agreement_reconciled redeems Kamino collateral and splits the fee/refund in a single transaction", async () => {
      // Same shape as the merchant_withdraw_reconciled proof above: an
      // Active agreement whose first installment was cranked into Kamino.
      // cancel_agreement (frozen-adjacent, untouched here) only reads
      // escrow_usdc directly, so it would under-count the true escrow value
      // if called against this state — cancel_agreement_reconciled must
      // redeem the full collateral balance first, then split fee/refund
      // against the complete amount, in one transaction.
      const { agreement, escrow } = await createAgreement(
        "v2-cancel-reconciled",
        new BN(50_000_000),
        5,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);

      const firstInstallment = await getAccount(provider.connection, escrow);
      await program.methods
        .kaminoProbeDeposit(new BN(Number(firstInstallment.amount)))
        .accounts({
          agreement,
          payer: buyer.publicKey,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      const escrowAfterDeposit = await getAccount(provider.connection, escrow);
      assert.equal(
        escrowAfterDeposit.amount.toString(),
        "0",
        "escrow_usdc must be fully drained into Kamino before cancellation"
      );

      const buyerBefore = await getAccount(provider.connection, buyerUsdc);
      const merchantBefore = await getAccount(provider.connection, merchantUsdc);

      await program.methods
        .cancelAgreementReconciled()
        .accounts({
          agreement,
          buyer: buyer.publicKey,
          buyerUsdc,
          escrowUsdc: escrow,
          merchantUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      // Full first-installment amount (10_000_000, since 50M / 5) was the
      // only money that ever entered escrow before cancellation — 10% fee
      // to the merchant, 90% refunded to the buyer.
      const escrowedAmount = Number(firstInstallment.amount);
      const expectedFee = Math.floor((escrowedAmount * 1_000) / 10_000);
      const expectedRefund = escrowedAmount - expectedFee;

      const buyerAfter = await getAccount(provider.connection, buyerUsdc);
      const merchantAfter = await getAccount(provider.connection, merchantUsdc);
      assert.equal(
        (buyerAfter.amount - buyerBefore.amount).toString(),
        expectedRefund.toString(),
        "buyer must be refunded 90% of the fully-reconciled escrow balance"
      );
      assert.equal(
        (merchantAfter.amount - merchantBefore.amount).toString(),
        expectedFee.toString(),
        "merchant must receive the 10% cancellation fee from the fully-reconciled balance"
      );

      const cancelled = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(cancelled.state, { cancelled: {} });
      assert.equal(cancelled.escrowDeposited.toString(), "0");

      const collateralAfter = await getAccount(provider.connection, escrowCollateral);
      assert.equal(
        collateralAfter.amount.toString(),
        "0",
        "no Kamino collateral must be left behind once cancelled"
      );
    });

    it("cancel_agreement_reconciled degrades to plain cancel_agreement when Kamino was never used", async () => {
      const { agreement, escrow } = await createAgreement(
        "v2-car-no-kamino",
        new BN(30_000_000),
        3,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);

      const escrowBefore = await getAccount(provider.connection, escrow);
      const buyerBefore = await getAccount(provider.connection, buyerUsdc);
      const merchantBefore = await getAccount(provider.connection, merchantUsdc);

      await program.methods
        .cancelAgreementReconciled()
        .accounts({
          agreement,
          buyer: buyer.publicKey,
          buyerUsdc,
          escrowUsdc: escrow,
          merchantUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      const escrowedAmount = Number(escrowBefore.amount);
      const expectedFee = Math.floor((escrowedAmount * 1_000) / 10_000);
      const expectedRefund = escrowedAmount - expectedFee;

      const buyerAfter = await getAccount(provider.connection, buyerUsdc);
      const merchantAfter = await getAccount(provider.connection, merchantUsdc);
      assert.equal((buyerAfter.amount - buyerBefore.amount).toString(), expectedRefund.toString());
      assert.equal(
        (merchantAfter.amount - merchantBefore.amount).toString(),
        expectedFee.toString()
      );

      const cancelled = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(cancelled.state, { cancelled: {} });

      const collateralAcct = await getAccount(provider.connection, escrowCollateral);
      assert.equal(collateralAcct.amount.toString(), "0");
    });

    it("rejects cancel_agreement_reconciled when the fee destination is not the merchant's", async () => {
      const { agreement, escrow } = await createAgreement(
        "v2-car-fee-route",
        new BN(30_000_000),
        3,
        new BN(60)
      );

      const buyerOwnedUsdc = await createAccount(
        provider.connection,
        buyer,
        usdcMint,
        buyer.publicKey,
        Keypair.generate()
      );

      try {
        await program.methods
          .cancelAgreementReconciled()
          .accounts({
            agreement,
            buyer: buyer.publicKey,
            buyerUsdc,
            escrowUsdc: escrow,
            merchantUsdc: buyerOwnedUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
            ...approvedAccounts(),
            escrowKaminoCollateral: escrowCollateralPDA(agreement),
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Expected ConstraintTokenOwner");
      } catch (err: any) {
        assert.include(err.message, "ConstraintTokenOwner");
      }

      const feeAcct = await getAccount(provider.connection, buyerOwnedUsdc);
      assert.equal(feeAcct.amount.toString(), "0", "Fee must not reach a buyer-owned account");
      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(acct.state, { active: {} });
    });

    it("trigger_default_reconciled rejects before grace period expires, even with Kamino collateral present", async () => {
      // Mirrors characterization.ts's "rejects trigger_default before grace
      // period expires" — GRACE_PERIOD_SECONDS is a fixed 7-day wall-clock
      // window with no test-only fast-forward available against
      // solana-test-validator, so the real-default success path is untested
      // here for the same reason it's untested for plain trigger_default.
      // What IS new and worth proving: the Kamino-aware account wiring is
      // correct, and — critically — the grace-period guard runs BEFORE any
      // Kamino redeem is attempted, so an early call can never strand a
      // wasted CPI or mutate collateral state. Deposit into Kamino first,
      // then confirm the reconciled variant still rejects on the grace
      // check alone, with the collateral balance completely untouched.
      const { agreement, escrow } = await createAgreement(
        "v2-tdr-early-with-kamino",
        new BN(30_000_000),
        3,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);

      const firstInstallment = await getAccount(provider.connection, escrow);
      await program.methods
        .kaminoProbeDeposit(new BN(Number(firstInstallment.amount)))
        .accounts({
          agreement,
          payer: buyer.publicKey,
          escrowUsdc: escrow,
          ...approvedAccounts(),
          escrowKaminoCollateral: escrowCollateral,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      const collateralBefore = await getAccount(provider.connection, escrowCollateral);
      assert.ok(Number(collateralBefore.amount) > 0, "precondition: Kamino holds real collateral");

      try {
        await program.methods
          .triggerDefaultReconciled()
          .accounts({
            agreement,
            caller: buyer.publicKey,
            escrowUsdc: escrow,
            merchantUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
            ...approvedAccounts(),
            escrowKaminoCollateral: escrowCollateral,
            payer: buyer.publicKey,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Expected GracePeriodNotExpired error");
      } catch (err: any) {
        assert.include(err.message, "GracePeriodNotExpired", "Wrong error type");
      }

      const collateralAfter = await getAccount(provider.connection, escrowCollateral);
      assert.equal(
        collateralAfter.amount.toString(),
        collateralBefore.amount.toString(),
        "grace-period guard must run before any Kamino redeem is attempted"
      );

      const agreementAcct = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(
        agreementAcct.state,
        { active: {} },
        "agreement must remain Active when the grace check rejects"
      );
    });

    it("trigger_default_reconciled degrades to plain trigger_default gating when Kamino was never used", async () => {
      // No prior kaminoProbeDeposit — escrow_kamino_collateral does not
      // exist yet. init_if_needed would create it, but the grace-period
      // guard rejects first and the whole transaction (including that
      // account creation) reverts atomically, so the account never
      // persists. The only thing this proves — same as the "with Kamino
      // collateral present" case above — is that the reconciled variant's
      // gating logic matches plain trigger_default's even when every
      // Kamino account in the struct is wired up.
      const { agreement, escrow } = await createAgreement(
        "v2-tdr-no-kamino",
        new BN(30_000_000),
        3,
        new BN(1)
      );
      const escrowCollateral = escrowCollateralPDA(agreement);

      try {
        await program.methods
          .triggerDefaultReconciled()
          .accounts({
            agreement,
            caller: buyer.publicKey,
            escrowUsdc: escrow,
            merchantUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
            ...approvedAccounts(),
            escrowKaminoCollateral: escrowCollateral,
            payer: buyer.publicKey,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Expected GracePeriodNotExpired error");
      } catch (err: any) {
        assert.include(err.message, "GracePeriodNotExpired", "Wrong error type");
      }

      const agreementAcct = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(
        agreementAcct.state,
        { active: {} },
        "agreement must remain Active when the grace check rejects"
      );
    });
  });

  // ── Two-chain parity (feat/base-parity) ─────────────────────────────────────
  // Runs last on purpose: it pins the accepted USDC mint, a program-wide setting, and
  // v2-features.ts is the last suite alphabetically. Base equivalents live in
  // evm/test/base and docs/CHAIN_PARITY.md.
  describe("two-chain parity (feat/base-parity)", () => {
    const extGov = Keypair.generate();
    const borrower = buyer; // reuse the funded buyer as the credit line owner
    const lender = Keypair.generate();
    const keeper = Keypair.generate();
    const agentKey = Keypair.generate();
    const outsider = Keypair.generate();
    let lenderUsdc: PublicKey;
    let keeperUsdc: PublicKey;
    let outsiderUsdc: PublicKey;
    let otherMint: PublicKey;
    let otherMintBuyerUsdc: PublicKey;

    const pda = (...seeds: Buffer[]) =>
      PublicKey.findProgramAddressSync(seeds, program.programId)[0];
    const extPDA = () => pda(Buffer.from("protocol_config_ext"));
    const configPDA = () => pda(Buffer.from("protocol_config"));
    const creditPoolPDA = () => pda(Buffer.from("credit_pool"));
    const creditVaultPDA = () => pda(Buffer.from("credit_vault"));
    const creditLinePDA = (o: PublicKey) => pda(Buffer.from("credit_line"), o.toBuffer());
    const lenderPDA = (o: PublicKey) => pda(Buffer.from("lender"), o.toBuffer());
    const mandatePDA = (o: PublicKey, a: PublicKey) =>
      pda(Buffer.from("agent_mandate"), o.toBuffer(), a.toBuffer());
    const chargeRefPDA = (m: PublicKey, ref: Buffer) =>
      pda(Buffer.from("charge_ref"), m.toBuffer(), ref);

    async function expectErr(fn: () => Promise<unknown>, code: string) {
      try {
        await fn();
      } catch (err: any) {
        const text = `${err?.error?.errorCode?.code ?? ""} ${err?.logs?.join("\n") ?? ""} ${err}`;
        assert.include(text, code);
        return;
      }
      assert.fail(`expected ${code}`);
    }

    const setPaused = (paused: boolean) =>
      program.methods
        .setProtocolPaused(paused)
        .accounts({ config: configPDA(), authority: protocolGovAuthority.publicKey })
        .signers([protocolGovAuthority])
        .rpc();

    const draw = (amount: BN, payeeUsdc = merchantUsdc) =>
      program.methods
        .drawCredit(amount)
        .accounts({
          ext: extPDA(),
          creditPool: creditPoolPDA(),
          creditVault: creditVaultPDA(),
          creditLine: creditLinePDA(borrower.publicKey),
          owner: borrower.publicKey,
          payeeUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([borrower])
        .rpc();

    const repay = (amount: BN) =>
      program.methods
        .repayCredit(amount)
        .accounts({
          ext: extPDA(),
          creditPool: creditPoolPDA(),
          creditVault: creditVaultPDA(),
          creditLine: creditLinePDA(borrower.publicKey),
          payer: borrower.publicKey,
          payerUsdc: buyerUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([borrower])
        .rpc();

    const deposit = (amount: BN) =>
      program.methods
        .depositCollateral(amount)
        .accounts({
          ext: extPDA(),
          creditPool: creditPoolPDA(),
          creditVault: creditVaultPDA(),
          owner: borrower.publicKey,
          creditLine: creditLinePDA(borrower.publicKey),
          payer: borrower.publicKey,
          payerUsdc: buyerUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([borrower])
        .rpc();

    const setCredit = (enabled: boolean, rate = 800) =>
      program.methods
        .setCreditParams(enabled, rate)
        .accounts({ ext: extPDA(), authority: extGov.publicKey })
        .signers([extGov])
        .rpc();

    before(async () => {
      const latest = await provider.connection.getLatestBlockhash();
      const sigs = await Promise.all(
        [extGov, lender, keeper, agentKey, outsider].map((k) =>
          provider.connection.requestAirdrop(k.publicKey, 3 * LAMPORTS_PER_SOL)
        )
      );
      await Promise.all(
        sigs.map((sig) => provider.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed"))
      );
      lenderUsdc = await createAccount(provider.connection, lender, usdcMint, lender.publicKey);
      keeperUsdc = await createAccount(provider.connection, keeper, usdcMint, keeper.publicKey);
      outsiderUsdc = await createAccount(provider.connection, outsider, usdcMint, outsider.publicKey);
      await mintTo(provider.connection, buyer, usdcMint, lenderUsdc, buyer, 10_000_000_000);
      await mintTo(provider.connection, buyer, usdcMint, buyerUsdc, buyer, 5_000_000_000);
      otherMint = await createMint(provider.connection, buyer, buyer.publicKey, null, 6);
      otherMintBuyerUsdc = await createAccount(provider.connection, buyer, otherMint, buyer.publicKey);
      await mintTo(provider.connection, buyer, otherMint, otherMintBuyerUsdc, buyer, 1_000_000_000);

      // Earlier describes may leave caps or the pause flag set; start from a clean config.
      const cfg = await program.account.protocolConfig.fetch(configPDA());
      if (cfg.paused) await setPaused(false);
      await program.methods
        .updateRiskLimits(new BN(0), new BN(0))
        .accounts({ config: configPDA(), authority: protocolGovAuthority.publicKey })
        .signers([protocolGovAuthority])
        .rpc();
    });

    it("gates init_protocol_config_ext on the program upgrade authority", async () => {
      await expectErr(
        () =>
          program.methods
            .initProtocolConfigExt()
            .accounts({
              ext: extPDA(),
              authority: outsider.publicKey,
              upgradeAuthority: outsider.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([outsider])
            .rpc(),
        "Unauthorized"
      );
      await program.methods
        .initProtocolConfigExt()
        .accounts({
          ext: extPDA(),
          authority: extGov.publicKey,
          upgradeAuthority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([extGov])
        .rpc();
      const ext = await program.account.protocolConfigExt.fetch(extPDA());
      assert.isFalse(ext.creditEnabled);
      assert.equal(ext.creditRateBps, 800);
      assert.equal(ext.acceptedMint.toBase58(), PublicKey.default.toBase58());
    });

    it("blocks trigger_default while paused, and records the unpause for a fresh grace window (audit C-5)", async () => {
      const { agreement, escrow } = await createAgreement("parity-pause", new BN(20_000_000), 2, new BN(1));
      await setPaused(true);
      await expectErr(
        () =>
          program.methods
            .triggerDefault()
            .accounts({ agreement, caller: buyer.publicKey, escrowUsdc: escrow, merchantUsdc, tokenProgram: TOKEN_PROGRAM_ID })
            .rpc(),
        "ProtocolPaused"
      );
      const before = Math.floor(Date.now() / 1000) - 120;
      await setPaused(false);
      const ext = await program.account.protocolConfigExt.fetch(extPDA());
      assert.isAbove(ext.lastUnpausedAt.toNumber(), before, "unpause time recorded");
      await expectErr(
        () =>
          program.methods
            .triggerDefault()
            .accounts({ agreement, caller: buyer.publicKey, escrowUsdc: escrow, merchantUsdc, tokenProgram: TOKEN_PROGRAM_ID })
            .rpc(),
        "GracePeriodNotExpired"
      );
      const a = await program.account.bnplAgreement.fetch(agreement);
      assert.deepEqual(a.state, { active: {} });
    });

    it("pins the accepted USDC mint; other mints are rejected everywhere (audit C-4)", async () => {
      await expectErr(
        () =>
          program.methods
            .setAcceptedMint(usdcMint)
            .accounts({ ext: extPDA(), authority: outsider.publicKey })
            .signers([outsider])
            .rpc(),
        "Unauthorized"
      );
      await program.methods
        .setAcceptedMint(usdcMint)
        .accounts({ ext: extPDA(), authority: extGov.publicKey })
        .signers([extGov])
        .rpc();

      const productId = "parity-fake-mint";
      const agreement = agreementPDA(productId);
      await expectErr(
        () =>
          program.methods
            .createAgreement(new BN(20_000_000), 2, new BN(1), productId, MERCHANT_NAME)
            .accounts({
              agreement,
              buyer: buyer.publicKey,
              merchant: merchant.publicKey,
              usdcMint: otherMint,
              buyerUsdc: otherMintBuyerUsdc,
              escrowUsdc: escrowPDA(agreement),
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
              rent: SYSVAR_RENT_PUBKEY,
            })
            .signers([buyer])
            .rpc(),
        "MintNotAccepted"
      );
      await createAgreement("parity-real-mint", new BN(20_000_000), 2, new BN(1));
    });

    it("claim_yield_paid pays only from the yield reserve, in the reserve's mint", async () => {
      const { agreement, escrow } = await createAgreement("parity-claim", new BN(20_000_000), 2, new BN(1));
      const claim = () =>
        program.methods
          .claimYieldPaid()
          .accounts({ agreement, buyer: buyer.publicKey, buyerUsdc, tokenProgram: TOKEN_PROGRAM_ID })
          .signers([buyer])
          .rpc();
      await expectErr(claim, "AgreementNotComplete");
      await new Promise((r) => setTimeout(r, 2500));
      await payInstallment(agreement, escrow);
      // The stake pool (and its reserve) was created by the frozen v1 suite in another mint, so
      // the payout is refused instead of paying a token the agreement was never priced in.
      await expectErr(claim, "MintNotAccepted");
    });

    it("init_yield_reserve cannot replace an existing reserve", async () => {
      // The reserve already exists here (init_stake_pool created it), so Anchor's `init` refuses
      // before the mint constraint runs. The mint check (address = stake_pool.usdc_mint) only
      // matters on a pre-upgrade pool, which localnet cannot reproduce; it is covered by review.
      const stakePool = pda(Buffer.from("stake_pool"));
      const reserve = pda(Buffer.from("yield_reserve"));
      const pool = await program.account.stakePool.fetch(stakePool);
      const before = await getAccount(provider.connection, reserve);
      for (const mint of [pool.usdcMint, otherMint]) {
        await expectErr(
          () =>
            program.methods
              .initYieldReserve()
              .accounts({
                stakePool,
                yieldReserve: reserve,
                usdcMint: mint,
                payer: outsider.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: SYSVAR_RENT_PUBKEY,
              })
              .signers([outsider])
              .rpc(),
          "already in use"
        );
      }
      const after = await getAccount(provider.connection, reserve);
      assert.equal(after.mint.toBase58(), before.mint.toBase58());
      assert.equal(after.owner.toBase58(), stakePool.toBase58());
    });

    it("keeps credit off until governance enables it, and caps the rate", async () => {
      await expectErr(() => setCredit(true, 3_001), "RateTooHigh");
      await program.methods
        .initCreditPool()
        .accounts({
          ext: extPDA(),
          authority: extGov.publicKey,
          usdcMint,
          creditPool: creditPoolPDA(),
          creditVault: creditVaultPDA(),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([extGov])
        .rpc();
      await expectErr(() => deposit(new BN(1_000_000_000)), "CreditDisabled");
      await setCredit(true);
    });

    it("lends from the pool up to 80% LTV, straight to the payee", async () => {
      await program.methods
        .supplyLiquidity(new BN(5_000_000_000))
        .accounts({
          creditPool: creditPoolPDA(),
          creditVault: creditVaultPDA(),
          lenderPosition: lenderPDA(lender.publicKey),
          supplier: lender.publicKey,
          supplierUsdc: lenderUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([lender])
        .rpc();
      await deposit(new BN(1_000_000_000)); // $1,000 collateral
      await expectErr(() => draw(new BN(800_000_001)), "LtvExceeded");
      const m0 = (await getAccount(provider.connection, merchantUsdc)).amount;
      await draw(new BN(700_000_000));
      const m1 = (await getAccount(provider.connection, merchantUsdc)).amount;
      assert.equal((m1 - m0).toString(), "700000000");
      const line = await program.account.creditLine.fetch(creditLinePDA(borrower.publicKey));
      assert.equal(line.principal.toString(), "700000000");
      assert.equal(line.collateral.toString(), "1000000000");
    });

    it("refuses to liquidate a healthy line and to withdraw collateral past 80% LTV", async () => {
      await expectErr(
        () =>
          program.methods
            .liquidateCredit()
            .accounts({
              ext: extPDA(),
              creditPool: creditPoolPDA(),
              creditVault: creditVaultPDA(),
              creditLine: creditLinePDA(borrower.publicKey),
              liquidator: keeper.publicKey,
              liquidatorUsdc: keeperUsdc,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([keeper])
            .rpc(),
        "NotLiquidatable"
      );
      await expectErr(
        () =>
          program.methods
            .withdrawCollateral(new BN(200_000_000))
            .accounts({
              ext: extPDA(),
              creditPool: creditPoolPDA(),
              creditVault: creditVaultPDA(),
              creditLine: creditLinePDA(borrower.publicKey),
              owner: borrower.publicKey,
              ownerUsdc: buyerUsdc,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([borrower])
            .rpc(),
        "LtvExceeded"
      );
    });

    it("lets the lender withdraw only what is not lent out", async () => {
      await expectErr(
        () =>
          program.methods
            .withdrawLiquidity(new BN(5_000_000_000))
            .accounts({
              creditPool: creditPoolPDA(),
              creditVault: creditVaultPDA(),
              lenderPosition: lenderPDA(lender.publicKey),
              supplier: lender.publicKey,
              supplierUsdc: lenderUsdc,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([lender])
            .rpc(),
        "InsufficientLiquidity"
      );
    });

    it("repays interest first then principal; same-day repayment earns no trust", async () => {
      await repay(new BN(100_000_000));
      const line = await program.account.creditLine.fetch(creditLinePDA(borrower.publicKey));
      assert.isBelow(line.principal.toNumber(), 700_000_000);
      assert.isAbove(line.principal.toNumber(), 600_000_000 - 1);
      assert.equal(line.trustScore.toNumber(), 0, "debt younger than a day earns no points");
      assert.equal(line.totalRepaid.toString(), "100000000");
    });

    describe("agent_charge: an agent pays over the owner's credit line", () => {
      const mandate = () => mandatePDA(borrower.publicKey, agentKey.publicKey);
      const charge = (amount: BN, ref: Buffer, opts: { payee?: Keypair; payeeUsdc?: PublicKey; cosign?: boolean } = {}) => {
        const payee = opts.payee ?? merchant;
        const builder = program.methods
          .agentCharge(amount, Array.from(ref))
          .accounts({
            mandate: mandate(),
            agent: agentKey.publicKey,
            owner: borrower.publicKey,
            chargeRef: chargeRefPDA(mandate(), ref),
            payee: payee.publicKey,
            payeeUsdc: opts.payeeUsdc ?? merchantUsdc,
            ext: extPDA(),
            creditPool: creditPoolPDA(),
            creditVault: creditVaultPDA(),
            creditLine: creditLinePDA(borrower.publicKey),
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          });
        if (opts.cosign) {
          return builder.instruction().then(async (ix: any) => {
            ix.keys.find((k: any) => k.pubkey.equals(borrower.publicKey))!.isSigner = true;
            const tx = new anchor.web3.Transaction().add(ix);
            return anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [agentKey, borrower]);
          });
        }
        return builder.signers([agentKey]).rpc();
      };
      const ref = (s: string) => require("crypto").createHash("sha256").update(s).digest() as Buffer;

      before(async () => {
        await program.methods
          .createAgentMandate({
            perPurchaseCap: new BN(100_000_000),
            periodCap: new BN(200_000_000),
            periodSeconds: new BN(86_400),
            maxPurchasesPerPeriod: 5,
            approvalThreshold: new BN(60_000_000),
            expiresAt: new BN(0),
            delegatedAllowance: new BN(1),
            allowedMerchants: [merchant.publicKey],
            validFrom: new BN(0),
            windowStart: 0,
            windowEnd: 0,
            minIntervalSeconds: new BN(86_400),
            maxInstallments: 4,
          })
          .accounts({
            mandate: mandate(),
            owner: borrower.publicKey,
            agent: agentKey.publicKey,
            ownerUsdc: buyerUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([borrower])
          .rpc();
      });

      it("draws on the line and pays the allowlisted payee; the agent never holds funds", async () => {
        const m0 = (await getAccount(provider.connection, merchantUsdc)).amount;
        const before = await program.account.creditLine.fetch(creditLinePDA(borrower.publicKey));
        await charge(new BN(50_000_000), ref("x402-challenge-1"));
        const m1 = (await getAccount(provider.connection, merchantUsdc)).amount;
        assert.equal((m1 - m0).toString(), "50000000");
        const after = await program.account.creditLine.fetch(creditLinePDA(borrower.publicKey));
        assert.equal(after.principal.sub(before.principal).toString(), "50000000");
        const r = await program.account.chargeRef.fetch(chargeRefPDA(mandate(), ref("x402-challenge-1")));
        assert.equal(r.amount.toString(), "50000000");
      });

      it("never pays the same payment ref twice", async () => {
        await expectErr(() => charge(new BN(10_000_000), ref("x402-challenge-1")), "already in use");
      });

      it("rejects payees that are not on the allowlist", async () => {
        await expectErr(
          () => charge(new BN(10_000_000), ref("x402-outsider"), { payee: outsider, payeeUsdc: outsiderUsdc }),
          "MerchantNotApproved"
        );
      });

      it("requires the owner's co-signature above the approval threshold", async () => {
        await expectErr(() => charge(new BN(80_000_000), ref("x402-big")), "OwnerApprovalRequired");
        await charge(new BN(80_000_000), ref("x402-big-cosigned"), { cosign: true });
      });

      it("stops at the period cap and when credit is switched off", async () => {
        await expectErr(
          () => charge(new BN(100_000_000), ref("x402-over-period"), { cosign: true }),
          "AgentPeriodCapExceeded"
        );
        await setCredit(false);
        await expectErr(() => charge(new BN(10_000_000), ref("x402-disabled")), "CreditDisabled");
        await repay(new BN(10_000_000)); // exits still work with the flag off
      });

      it("is dead after one revoke", async () => {
        await setCredit(true);
        await program.methods
          .revokeAgentMandate()
          .accounts({ mandate: mandate(), owner: borrower.publicKey, ownerUsdc: buyerUsdc, tokenProgram: TOKEN_PROGRAM_ID })
          .signers([borrower])
          .rpc();
        await expectErr(() => charge(new BN(10_000_000), ref("x402-after-revoke")), "MandateRevoked");
      });
    });
  });
});
