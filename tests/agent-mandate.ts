// ─── AGENT BNPL: AGENT MANDATE TESTS ──────────────────────────────────────────
// An owner lets an AI agent buy now, pay later on their behalf inside limits
// the owner sets: per-purchase cap, period cap, purchase count, approved
// merchants, owner co-sign above a threshold, and one-tap revoke. USDC stays
// in the owner's wallet behind a bounded SPL delegation to the mandate PDA.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

const USDC = (n: number) => new BN(n * 1_000_000);

describe("agent BNPL: agent mandates", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Relicpay as Program<any>;

  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const stranger = Keypair.generate();
  const merchant = Keypair.generate();
  const otherMerchant = Keypair.generate();

  let usdcMint: PublicKey;
  let ownerUsdc: PublicKey;

  const mandatePDA = (o: PublicKey, a: PublicKey): PublicKey =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("agent_mandate"), o.toBuffer(), a.toBuffer()],
      program.programId
    )[0];
  const mandate = () => mandatePDA(owner.publicKey, agent.publicKey);

  const agreementPDA = (productId: string): PublicKey =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("agreement"), owner.publicKey.toBuffer(), Buffer.from(productId)],
      program.programId
    )[0];

  const escrowPDA = (agreement: PublicKey): PublicKey =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), agreement.toBuffer()],
      program.programId
    )[0];

  const limits = (overrides: Record<string, unknown> = {}) => ({
    perPurchaseCap: USDC(100),
    periodCap: USDC(250),
    periodSeconds: new BN(24 * 60 * 60),
    maxPurchasesPerPeriod: 3,
    approvalThreshold: USDC(60),
    expiresAt: new BN(0),
    delegatedAllowance: USDC(500),
    allowedMerchants: [merchant.publicKey],
    ...overrides,
  });

  /** Agent purchase. `cosign` adds the owner as a signer (above threshold). */
  async function agentBuy(
    productId: string,
    totalPrice: BN,
    opts: { cosign?: boolean; merchantKey?: PublicKey; signer?: Keypair } = {}
  ) {
    const signer = opts.signer ?? agent;
    const agreement = agreementPDA(productId);
    const ix = await program.methods
      // 1-second interval so the repayment test can reach a due date quickly.
      .agentCreateAgreement(totalPrice, 2, new BN(1), productId, "IBG Collection")
      .accounts({
        mandate: mandate(),
        agent: signer.publicKey,
        owner: owner.publicKey,
        agreement,
        merchant: opts.merchantKey ?? merchant.publicKey,
        usdcMint,
        ownerUsdc,
        escrowUsdc: escrowPDA(agreement),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();
    const signers = [signer];
    if (opts.cosign) {
      ix.keys.find((k) => k.pubkey.equals(owner.publicKey))!.isSigner = true;
      signers.push(owner);
    }
    // The agent pays fees itself; the provider wallet is not part of this tx.
    await sendAndConfirmTransaction(provider.connection, new Transaction().add(ix), signers, {
      ...provider.opts,
    });
    return agreement;
  }

  async function expectError(fn: () => Promise<unknown>, code?: string) {
    try {
      await fn();
    } catch (err: any) {
      if (code) {
        const text = `${err?.error?.errorCode?.code ?? ""} ${err?.logs?.join("\n") ?? ""} ${err}`;
        assert.include(text, code);
      }
      return;
    }
    assert.fail(`expected ${code ?? "an error"}`);
  }

  before(async () => {
    const latest = await provider.connection.getLatestBlockhash();
    const sigs = await Promise.all(
      [owner, agent, stranger].map((kp) =>
        provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL)
      )
    );
    await Promise.all(
      sigs.map((sig) =>
        provider.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed")
      )
    );

    usdcMint = await createMint(provider.connection, owner, owner.publicKey, null, 6);
    ownerUsdc = await createAccount(provider.connection, owner, usdcMint, owner.publicKey);
    await mintTo(provider.connection, owner, usdcMint, ownerUsdc, owner, 1_000_000_000);
  });

  it("rejects invalid mandate limits", async () => {
    await expectError(
      () =>
        program.methods
          .createAgentMandate(limits({ periodCap: USDC(50) })) // below per-purchase cap
          .accounts({
            mandate: mandate(),
            owner: owner.publicKey,
            agent: agent.publicKey,
            ownerUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner])
          .rpc(),
      "InvalidMandate"
    );
  });

  it("creates a mandate and delegates a bounded allowance to its PDA", async () => {
    await program.methods
      .createAgentMandate(limits())
      .accounts({
        mandate: mandate(),
        owner: owner.publicKey,
        agent: agent.publicKey,
        ownerUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const m: any = await program.account.agentMandate.fetch(mandate());
    assert.ok(m.owner.equals(owner.publicKey));
    assert.ok(m.agent.equals(agent.publicKey));
    assert.equal(m.perPurchaseCap.toString(), USDC(100).toString());
    assert.equal(m.revoked, false);
    assert.equal(m.allowedMerchants.length, 1);

    const acct = await getAccount(provider.connection, ownerUsdc);
    assert.ok(acct.delegate!.equals(mandate()));
    assert.equal(acct.delegatedAmount.toString(), USDC(500).toString());
  });

  it("lets the agent buy within limits; the agreement belongs to the owner", async () => {
    const before = await getAccount(provider.connection, ownerUsdc);
    const agreement = await agentBuy("agent-buy-1", USDC(50));

    const a: any = await program.account.bnplAgreement.fetch(agreement);
    assert.ok(a.buyer.equals(owner.publicKey));
    assert.ok(a.merchant.equals(merchant.publicKey));
    assert.equal(a.paidInstallments, 1);

    const escrow = await getAccount(provider.connection, escrowPDA(agreement));
    assert.equal(escrow.amount.toString(), USDC(25).toString());
    const after = await getAccount(provider.connection, ownerUsdc);
    assert.equal((before.amount - after.amount).toString(), USDC(25).toString());

    const m: any = await program.account.agentMandate.fetch(mandate());
    assert.equal(m.periodSpent.toString(), USDC(50).toString());
    assert.equal(m.periodPurchases, 1);
    assert.equal(m.totalPurchases, 1);
  });

  it("lets the owner repay an agent-opened agreement with the normal flow", async () => {
    const agreement = agreementPDA("agent-buy-1");
    await new Promise((r) => setTimeout(r, 3000)); // installment 2 due at start + 2s
    await program.methods
      .payInstallment()
      .accounts({
        agreement,
        buyer: owner.publicKey,
        buyerUsdc: ownerUsdc,
        escrowUsdc: escrowPDA(agreement),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();
    const a: any = await program.account.bnplAgreement.fetch(agreement);
    assert.equal(a.paidInstallments, 2);
  });

  it("rejects a purchase above the per-purchase cap", async () => {
    await expectError(() => agentBuy("too-big", USDC(150)), "AgentPurchaseCapExceeded");
  });

  it("rejects a merchant that is not on the approved list", async () => {
    await expectError(
      () => agentBuy("wrong-shop", USDC(10), { merchantKey: otherMerchant.publicKey }),
      "MerchantNotApproved"
    );
  });

  it("requires the owner to co-sign above the approval threshold", async () => {
    await expectError(() => agentBuy("big-1", USDC(80)), "OwnerApprovalRequired");
    await agentBuy("big-1", USDC(80), { cosign: true });
    const m: any = await program.account.agentMandate.fetch(mandate());
    assert.equal(m.periodSpent.toString(), USDC(130).toString());
  });

  it("enforces the period spending cap and the purchase count", async () => {
    await agentBuy("big-2", USDC(100), { cosign: true }); // 230 of 250, purchase 3 of 3
    await expectError(() => agentBuy("over-period", USDC(30)), "AgentPeriodCapExceeded");
    await expectError(() => agentBuy("over-count", USDC(10)), "AgentPurchaseLimitReached");
  });

  it("rejects any key other than the mandate's agent", async () => {
    await expectError(() => agentBuy("stranger", USDC(10), { signer: stranger }));
  });

  it("refuses to close a mandate that has not been revoked", async () => {
    await expectError(
      () =>
        program.methods
          .closeAgentMandate()
          .accounts({ mandate: mandate(), owner: owner.publicKey })
          .signers([owner])
          .rpc(),
      "MandateNotRevoked"
    );
  });

  it("revokes in one tap: allowance pulled back, agent blocked, mandate closable", async () => {
    await program.methods
      .revokeAgentMandate()
      .accounts({
        mandate: mandate(),
        owner: owner.publicKey,
        ownerUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const acct = await getAccount(provider.connection, ownerUsdc);
    assert.isNull(acct.delegate);
    assert.equal(acct.delegatedAmount.toString(), "0");

    await expectError(() => agentBuy("after-revoke", USDC(10)), "MandateRevoked");
    await expectError(
      () =>
        program.methods
          .updateAgentMandate(limits())
          .accounts({
            mandate: mandate(),
            owner: owner.publicKey,
            ownerUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc(),
      "MandateRevoked"
    );

    await program.methods
      .closeAgentMandate()
      .accounts({ mandate: mandate(), owner: owner.publicKey })
      .signers([owner])
      .rpc();
    assert.isNull(await provider.connection.getAccountInfo(mandate()));
  });
});
