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

    it("initializes the ProtocolConfig PDA with permissive defaults", async () => {
      const config = configPDA();
      await program.methods
        .initProtocolConfig()
        .accounts({
          config,
          authority: govAuthority.publicKey,
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

      await payInstallment(agreement, escrow);

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

    it("initializes the KaminoConfig PDA disabled, with zeroed accounts", async () => {
      const config = configPDA();
      await program.methods
        .initKaminoConfig()
        .accounts({
          config,
          authority: govAuthority.publicKey,
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
  });
});
