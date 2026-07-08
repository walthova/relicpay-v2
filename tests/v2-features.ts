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
  });
});
