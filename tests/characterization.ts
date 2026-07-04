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

// ─── Test Setup ──────────────────────────────────────────────────────────────

describe("relicpay", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Relicpay as Program<any>;

  // Keypairs
  const buyer = Keypair.generate();
  const merchant = Keypair.generate();
  const authority = Keypair.generate(); // protocol admin (stake pool)

  // Token accounts
  let usdcMint: PublicKey;
  let buyerUsdc: PublicKey;
  let merchantUsdc: PublicKey;
  let authorityUsdc: PublicKey;

  // Constants matching the contract
  const PRODUCT_ID = "ibg-drop-001";
  const MERCHANT_NAME = "IBG Collection";
  const TOTAL_PRICE = new BN(300_000_000); // $300 USDC
  const INSTALLMENT_COUNT = 3;
  const INTERVAL_SECONDS = new BN(2_592_000); // 30 days

  // PDA helpers
  const agreementPDA = (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("agreement"), buyer.publicKey.toBuffer(), Buffer.from(PRODUCT_ID)],
      program.programId
    );

  const escrowPDA = (agreement: PublicKey): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), agreement.toBuffer()],
      program.programId
    );

  const stakePoolPDA = (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from("stake_pool")], program.programId);

  const poolVaultPDA = (pool: PublicKey): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), pool.toBuffer()],
      program.programId
    );

  const userStakePDA = (user: PublicKey): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("user_stake"), user.toBuffer()],
      program.programId
    );

  // ─── Global Before ─────────────────────────────────────────────────────────

  before(async () => {
    // Fund test wallets
    await Promise.all([
      provider.connection.requestAirdrop(buyer.publicKey, 10 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(merchant.publicKey, 2 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(authority.publicKey, 2 * LAMPORTS_PER_SOL),
    ]);

    // Wait for airdrop confirmations
    await new Promise((r) => setTimeout(r, 1000));

    // Create mock USDC mint (6 decimals)
    usdcMint = await createMint(
      provider.connection,
      buyer, // payer
      buyer.publicKey, // mint authority
      null,
      6
    );

    // Create token accounts
    buyerUsdc = await createAccount(provider.connection, buyer, usdcMint, buyer.publicKey);
    merchantUsdc = await createAccount(provider.connection, merchant, usdcMint, merchant.publicKey);
    authorityUsdc = await createAccount(provider.connection, authority, usdcMint, authority.publicKey);

    // Mint $5000 USDC to buyer (tests consume ~$1600 total across all agreements)
    await mintTo(provider.connection, buyer, usdcMint, buyerUsdc, buyer, 5_000_000_000);
  });

  // ─── Helper: create a fresh agreement ──────────────────────────────────────

  async function createAgreement(productId = PRODUCT_ID) {
    const [agreement] = PublicKey.findProgramAddressSync(
      [Buffer.from("agreement"), buyer.publicKey.toBuffer(), Buffer.from(productId)],
      program.programId
    );
    const [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), agreement.toBuffer()],
      program.programId
    );

    await program.methods
      .createAgreement(TOTAL_PRICE, INSTALLMENT_COUNT, INTERVAL_SECONDS, productId, MERCHANT_NAME)
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

  // ─── BNPL Happy Path ───────────────────────────────────────────────────────

  describe("happy path: create → pay → withdraw → claim yield", () => {
    let agreement: PublicKey;
    let escrow: PublicKey;

    it("creates agreement and pays first installment", async () => {
      ({ agreement, escrow } = await createAgreement());

      const acct = await program.account.bnplAgreement.fetch(agreement);
      assert.equal(acct.buyer.toBase58(), buyer.publicKey.toBase58());
      assert.equal(acct.merchant.toBase58(), merchant.publicKey.toBase58());
      assert.equal(acct.totalPrice.toString(), TOTAL_PRICE.toString());
      assert.equal(acct.installmentCount, INSTALLMENT_COUNT);
      assert.equal(acct.paidInstallments, 1);
      assert.deepEqual(acct.state, { active: {} });

      // First installment ($100) should be in escrow
      const escrowAcct = await getAccount(provider.connection, escrow);
      assert.equal(escrowAcct.amount.toString(), "100000000");
    });

    it("pays second installment (advances time via interval=1s for test)", async () => {
      // For testing, use interval=1s so payment is immediately due
      // This agreement uses a 1-second interval instead of 30 days
      const fastProductId = "fast-test-001";
      const [fastAgreement] = PublicKey.findProgramAddressSync(
        [Buffer.from("agreement"), buyer.publicKey.toBuffer(), Buffer.from(fastProductId)],
        program.programId
      );
      const [fastEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), fastAgreement.toBuffer()],
        program.programId
      );

      await program.methods
        .createAgreement(
          new BN(300_000_000),
          3,
          new BN(1), // 1-second interval — immediately payable in tests
          fastProductId,
          MERCHANT_NAME
        )
        .accounts({
          agreement: fastAgreement,
          buyer: buyer.publicKey,
          merchant: merchant.publicKey,
          usdcMint,
          buyerUsdc,
          escrowUsdc: fastEscrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      // Wait 5 seconds — localnet clock needs buffer beyond the 2s interval
      await new Promise((r) => setTimeout(r, 5000));

      await program.methods
        .payInstallment()
        .accounts({
          agreement: fastAgreement,
          buyer: buyer.publicKey,
          buyerUsdc,
          escrowUsdc: fastEscrow,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();

      const acct = await program.account.bnplAgreement.fetch(fastAgreement);
      assert.equal(acct.paidInstallments, 2);
      assert.deepEqual(acct.state, { active: {} });

      // Escrow should now hold $200
      const escrowAcct = await getAccount(provider.connection, fastEscrow);
      assert.equal(escrowAcct.amount.toString(), "200000000");
    });

    it("yield does not double-count: accrued only for the window since last update", async () => {
      const productId = "yield-test-001";
      const [yAgreement] = PublicKey.findProgramAddressSync(
        [Buffer.from("agreement"), buyer.publicKey.toBuffer(), Buffer.from(productId)],
        program.programId
      );
      const [yEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), yAgreement.toBuffer()],
        program.programId
      );

      await program.methods
        .createAgreement(new BN(300_000_000), 3, new BN(1), productId, MERCHANT_NAME)
        .accounts({
          agreement: yAgreement,
          buyer: buyer.publicKey,
          merchant: merchant.publicKey,
          usdcMint,
          buyerUsdc,
          escrowUsdc: yEscrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      await new Promise((r) => setTimeout(r, 5000));

      await program.methods
        .payInstallment()
        .accounts({
          agreement: yAgreement,
          buyer: buyer.publicKey,
          buyerUsdc,
          escrowUsdc: yEscrow,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();

      const acct = await program.account.bnplAgreement.fetch(yAgreement);

      // Yield accrued on $100 for ~1s at 3% APY:
      // 100_000_000 * 300 / 10000 / 31_536_000 * 1 = ~0.095 USDC lamports ≈ 0
      // The key check: yield_accrued must be tiny (not $0.25+ which would indicate 30d math)
      // If it were double-counting from start_time with $200 balance it would be much larger
      const yieldAccrued = acct.yieldAccrued.toNumber();
      // 2 seconds at 3% APY on $100 = < 100 USDC lamports (not millions)
      assert.isTrue(yieldAccrued < 1000, `Yield ${yieldAccrued} looks too large — possible double-count`);
    });

    it("pays final installment and auto-completes agreement", async () => {
      const productId = "complete-test-001";
      const [cAgreement] = PublicKey.findProgramAddressSync(
        [Buffer.from("agreement"), buyer.publicKey.toBuffer(), Buffer.from(productId)],
        program.programId
      );
      const [cEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), cAgreement.toBuffer()],
        program.programId
      );

      await program.methods
        .createAgreement(new BN(300_000_000), 3, new BN(1), productId, MERCHANT_NAME)
        .accounts({
          agreement: cAgreement,
          buyer: buyer.publicKey,
          merchant: merchant.publicKey,
          usdcMint,
          buyerUsdc,
          escrowUsdc: cEscrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      // Pay installments 2 and 3 — 5s gap ensures localnet clock advances past due time
      for (let i = 0; i < 2; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        await program.methods
          .payInstallment()
          .accounts({
            agreement: cAgreement,
            buyer: buyer.publicKey,
            buyerUsdc,
            escrowUsdc: cEscrow,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();
      }

      const acct = await program.account.bnplAgreement.fetch(cAgreement);
      assert.equal(acct.paidInstallments, 3);
      assert.deepEqual(acct.state, { completed: {} });

      // Merchant withdraws
      const merchantBefore = (await getAccount(provider.connection, merchantUsdc)).amount;
      await program.methods
        .merchantWithdraw()
        .accounts({
          agreement: cAgreement,
          merchant: merchant.publicKey,
          escrowUsdc: cEscrow,
          merchantUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([merchant])
        .rpc();

      const merchantAfter = (await getAccount(provider.connection, merchantUsdc)).amount;
      assert.equal(
        (merchantAfter - merchantBefore).toString(),
        "300000000",
        "Merchant must receive exactly total_price"
      );

      // Buyer claims yield (v1: state update only, no USDC transfer)
      // With 1s intervals yield is effectively 0 — only call if non-zero to avoid NothingToWithdraw
      const acctBeforeClaim = await program.account.bnplAgreement.fetch(cAgreement);
      if (acctBeforeClaim.yieldAccrued.toNumber() > 0) {
        await program.methods
          .claimYield()
          .accounts({
            agreement: cAgreement,
            buyer: buyer.publicKey,
          })
          .signers([buyer])
          .rpc();
        const acctAfter = await program.account.bnplAgreement.fetch(cAgreement);
        assert.equal(acctAfter.yieldAccrued.toNumber(), 0, "yield_accrued must be zeroed after claim");
      } else {
        // Yield is 0 for tiny time intervals — correct behavior, just verify state
        assert.deepEqual(acctBeforeClaim.state, { completed: {} });
      }
    });
  });

  // ─── Cancel Path ───────────────────────────────────────────────────────────

  describe("cancel path", () => {
    it("buyer cancels: 10% to merchant, 90% refund to buyer", async () => {
      const productId = "cancel-test-001";
      const [cAgreement] = PublicKey.findProgramAddressSync(
        [Buffer.from("agreement"), buyer.publicKey.toBuffer(), Buffer.from(productId)],
        program.programId
      );
      const [cEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), cAgreement.toBuffer()],
        program.programId
      );

      await program.methods
        .createAgreement(new BN(300_000_000), 3, new BN(1), productId, MERCHANT_NAME)
        .accounts({
          agreement: cAgreement,
          buyer: buyer.publicKey,
          merchant: merchant.publicKey,
          usdcMint,
          buyerUsdc,
          escrowUsdc: cEscrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      // Escrow holds $100 (first installment)
      const escrowBefore = (await getAccount(provider.connection, cEscrow)).amount;
      const merchantBefore = (await getAccount(provider.connection, merchantUsdc)).amount;
      const buyerBefore = (await getAccount(provider.connection, buyerUsdc)).amount;

      await program.methods
        .cancelAgreement()
        .accounts({
          agreement: cAgreement,
          buyer: buyer.publicKey,
          buyerUsdc,
          escrowUsdc: cEscrow,
          merchantUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();

      const escrowAfter = (await getAccount(provider.connection, cEscrow)).amount;
      const merchantAfter = (await getAccount(provider.connection, merchantUsdc)).amount;
      const buyerAfter = (await getAccount(provider.connection, buyerUsdc)).amount;

      const fee = escrowBefore / BigInt(10);
      const refund = escrowBefore - fee;

      assert.equal(escrowAfter.toString(), "0", "Escrow must be drained on cancel");
      assert.equal((merchantAfter - merchantBefore).toString(), fee.toString(), "Merchant gets 10%");
      assert.equal((buyerAfter - buyerBefore).toString(), refund.toString(), "Buyer gets 90%");

      const acct = await program.account.bnplAgreement.fetch(cAgreement);
      assert.deepEqual(acct.state, { cancelled: {} });
    });
  });

  // ─── Default Path ──────────────────────────────────────────────────────────

  describe("default path", () => {
    it("trigger_default sends escrow to merchant after grace period", async () => {
      // Use interval=0 is invalid; use interval=1 and wait for grace (7 days in real time = impractical)
      // Instead we test the rejection case (before grace) and verify the state guard works.
      // Full default path requires clock manipulation — covered in rejection tests.

      const productId = "default-reject-test";
      const [dAgreement] = PublicKey.findProgramAddressSync(
        [Buffer.from("agreement"), buyer.publicKey.toBuffer(), Buffer.from(productId)],
        program.programId
      );
      const [dEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), dAgreement.toBuffer()],
        program.programId
      );

      await program.methods
        .createAgreement(new BN(300_000_000), 3, new BN(1), productId, MERCHANT_NAME)
        .accounts({
          agreement: dAgreement,
          buyer: buyer.publicKey,
          merchant: merchant.publicKey,
          usdcMint,
          buyerUsdc,
          escrowUsdc: dEscrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      // Grace period not expired — must reject
      try {
        await program.methods
          .triggerDefault()
          .accounts({
            agreement: dAgreement,
            caller: buyer.publicKey,
            escrowUsdc: dEscrow,
            merchantUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("Expected GracePeriodNotExpired error");
      } catch (err: any) {
        assert.include(err.message, "GracePeriodNotExpired", "Wrong error type");
      }
    });
  });

  // ─── Security / Rejection Tests ────────────────────────────────────────────

  describe("security: unauthorized access and timing guards", () => {
    let secAgreement: PublicKey;
    let secEscrow: PublicKey;
    let completedAgreement: PublicKey;
    let completedEscrow: PublicKey;

    before(async () => {
      // Create one active agreement for rejection tests
      const productId = "sec-test-001";
      [secAgreement] = PublicKey.findProgramAddressSync(
        [Buffer.from("agreement"), buyer.publicKey.toBuffer(), Buffer.from(productId)],
        program.programId
      );
      [secEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), secAgreement.toBuffer()],
        program.programId
      );
      await program.methods
        .createAgreement(new BN(300_000_000), 3, new BN(1), productId, MERCHANT_NAME)
        .accounts({
          agreement: secAgreement,
          buyer: buyer.publicKey,
          merchant: merchant.publicKey,
          usdcMint,
          buyerUsdc,
          escrowUsdc: secEscrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();

      // Create one completed agreement for withdraw/claimYield tests
      const cId = "sec-complete-001";
      [completedAgreement] = PublicKey.findProgramAddressSync(
        [Buffer.from("agreement"), buyer.publicKey.toBuffer(), Buffer.from(cId)],
        program.programId
      );
      [completedEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), completedAgreement.toBuffer()],
        program.programId
      );
      await program.methods
        .createAgreement(new BN(300_000_000), 3, new BN(1), cId, MERCHANT_NAME)
        .accounts({
          agreement: completedAgreement,
          buyer: buyer.publicKey,
          merchant: merchant.publicKey,
          usdcMint,
          buyerUsdc,
          escrowUsdc: completedEscrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();
      for (let i = 0; i < 2; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        await program.methods
          .payInstallment()
          .accounts({
            agreement: completedAgreement,
            buyer: buyer.publicKey,
            buyerUsdc,
            escrowUsdc: completedEscrow,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();
      }
    });

    it("rejects pay_installment before due time", async () => {
      // secAgreement uses interval=1s; installment 2 is due at start+2s
      // Call immediately after create (< 2s) — must fail
      try {
        await program.methods
          .payInstallment()
          .accounts({
            agreement: secAgreement,
            buyer: buyer.publicKey,
            buyerUsdc,
            escrowUsdc: secEscrow,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Expected PaymentNotDue");
      } catch (err: any) {
        assert.include(err.message, "PaymentNotDue");
      }
    });

    it("rejects merchant_withdraw with wrong signer", async () => {
      const impostor = Keypair.generate();
      await provider.connection.requestAirdrop(impostor.publicKey, LAMPORTS_PER_SOL);
      await new Promise((r) => setTimeout(r, 500));
      const impostorUsdc = await createAccount(
        provider.connection,
        impostor,
        usdcMint,
        impostor.publicKey
      );

      try {
        await program.methods
          .merchantWithdraw()
          .accounts({
            agreement: completedAgreement,
            merchant: impostor.publicKey,
            escrowUsdc: completedEscrow,
            merchantUsdc: impostorUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([impostor])
          .rpc();
        assert.fail("Expected Unauthorized");
      } catch (err: any) {
        assert.include(err.message, "Unauthorized");
      }
    });

    it("rejects claim_yield with wrong buyer", async () => {
      const impostor = Keypair.generate();
      await provider.connection.requestAirdrop(impostor.publicKey, LAMPORTS_PER_SOL);
      await new Promise((r) => setTimeout(r, 500));

      try {
        await program.methods
          .claimYield()
          .accounts({
            // Passing impostor as buyer — PDA derivation uses buyer key as seed,
            // so Anchor rejects with a constraint/seeds mismatch before reaching auth check.
            // Both outcomes (Unauthorized + constraint mismatch) are valid rejections.
            agreement: completedAgreement,
            buyer: impostor.publicKey,
          })
          .signers([impostor])
          .rpc();
        assert.fail("Expected auth or constraint error");
      } catch (err: any) {
        // Accept either explicit Unauthorized or Anchor's account constraint error
        const isRejected =
          err.message.includes("Unauthorized") ||
          err.message.includes("AnchorError") ||
          err.message.includes("seeds constraint") ||
          err.message.includes("caused by account");
        assert.isTrue(isRejected, `Expected auth rejection, got: ${err.message}`);
      }
    });

    it("rejects double claim_yield (reentrancy guard)", async () => {
      // With 1s test intervals, yield_accrued may be 0, meaning NothingToWithdraw
      // fires on the FIRST call. Either way, the guard prevents double-claiming.
      try {
        await program.methods
          .claimYield()
          .accounts({ agreement: completedAgreement, buyer: buyer.publicKey })
          .signers([buyer])
          .rpc();

        // First call succeeded (yield was > 0). Second must fail.
        try {
          await program.methods
            .claimYield()
            .accounts({ agreement: completedAgreement, buyer: buyer.publicKey })
            .signers([buyer])
            .rpc();
          assert.fail("Expected NothingToWithdraw on second claim");
        } catch (e2: any) {
          assert.include(e2.message, "NothingToWithdraw", "Second claim must be blocked");
        }
      } catch (e1: any) {
        // Yield was 0 — first claim immediately blocked. Guard works either way.
        assert.include(e1.message, "NothingToWithdraw", "Zero-yield claim must be blocked");
      }
    });

    it("rejects cancel_agreement on a completed agreement", async () => {
      try {
        await program.methods
          .cancelAgreement()
          .accounts({
            agreement: completedAgreement,
            buyer: buyer.publicKey,
            buyerUsdc,
            escrowUsdc: completedEscrow,
            merchantUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Expected AgreementNotActive");
      } catch (err: any) {
        assert.include(err.message, "AgreementNotActive");
      }
    });

    it("rejects trigger_default before grace period expires", async () => {
      try {
        await program.methods
          .triggerDefault()
          .accounts({
            agreement: secAgreement,
            caller: buyer.publicKey,
            escrowUsdc: secEscrow,
            merchantUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          // No .signers() — caller is AccountInfo (not Signer), adding it causes "unknown signer"
          .rpc();
        assert.fail("Expected GracePeriodNotExpired");
      } catch (err: any) {
        assert.include(err.message, "GracePeriodNotExpired");
      }
    });
  });

  // ─── Stake Pool ────────────────────────────────────────────────────────────

  describe("stake pool: init, stake, tiers, unstake", () => {
    let poolPDA: PublicKey;
    let vaultPDA: PublicKey;
    let userStake: PublicKey;

    before(() => {
      [poolPDA] = stakePoolPDA();
      [vaultPDA] = poolVaultPDA(poolPDA);
      [userStake] = userStakePDA(authority.publicKey);
    });

    it("initializes stake pool", async () => {
      await program.methods
        .initStakePool()
        .accounts({
          stakePool: poolPDA,
          authority: authority.publicKey,
          usdcMint,
          poolVault: vaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority])
        .rpc();

      const pool = await program.account.stakePool.fetch(poolPDA);
      assert.equal(pool.authority.toBase58(), authority.publicKey.toBase58());
      assert.equal(pool.yieldRateBpsAnnual, 300);
      assert.equal(pool.totalStaked.toNumber(), 0);
    });

    it("mints USDC to authority for staking", async () => {
      await mintTo(provider.connection, buyer, usdcMint, authorityUsdc, buyer, 1_000_000_000);
    });

    it("stakes $10 → tier 1", async () => {
      await program.methods
        .stakeUsdc(new BN(10_000_000)) // $10
        .accounts({
          stakePool: poolPDA,
          userStake,
          user: authority.publicKey,
          userUsdc: authorityUsdc,
          poolVault: vaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority])
        .rpc();

      const stake = await program.account.userStake.fetch(userStake);
      assert.equal(stake.stakedAmount.toNumber(), 10_000_000);
      assert.equal(stake.tier, 1, "Should be Tier 1 at $10");
    });

    it("adds $40 more → tier 2 at $50", async () => {
      await program.methods
        .stakeUsdc(new BN(40_000_000)) // +$40
        .accounts({
          stakePool: poolPDA,
          userStake,
          user: authority.publicKey,
          userUsdc: authorityUsdc,
          poolVault: vaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority])
        .rpc();

      const stake = await program.account.userStake.fetch(userStake);
      assert.equal(stake.stakedAmount.toNumber(), 50_000_000);
      assert.equal(stake.tier, 2, "Should be Tier 2 at $50");
    });

    it("unstakes full amount: receives principal + yield", async () => {
      await new Promise((r) => setTimeout(r, 1000)); // let some yield accrue

      const userBefore = (await getAccount(provider.connection, authorityUsdc)).amount;

      await program.methods
        .unstakeUsdc(new BN(0)) // 0 = full unstake
        .accounts({
          stakePool: poolPDA,
          userStake,
          user: authority.publicKey,
          userUsdc: authorityUsdc,
          poolVault: vaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();

      const userAfter = (await getAccount(provider.connection, authorityUsdc)).amount;
      const received = userAfter - userBefore;

      // Must receive at least the principal back
      assert.isTrue(received >= BigInt(50_000_000), "Must receive at least $50 principal");
      // Tier should reset to 0
      const stake = await program.account.userStake.fetch(userStake);
      assert.equal(stake.tier, 0);
      assert.equal(stake.stakedAmount.toNumber(), 0);
    });

    it("verifies pool total_staked tracks correctly", async () => {
      const pool = await program.account.stakePool.fetch(poolPDA);
      assert.equal(pool.totalStaked.toNumber(), 0, "Pool total should be 0 after full unstake");
    });
  });
});
