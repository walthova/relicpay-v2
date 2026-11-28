import * as anchor from "@coral-xyz/anchor";
import { getAccount, createAccount, createMint, mintTo } from "@solana/spl-token";
import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_CLOCK_PUBKEY,
  SystemProgram, Transaction } from "@solana/web3.js";

const idl: anchor.Idl = require("../target/idl/relicpay.json");
const usdc = (n: number) => new anchor.BN(n * 1_000_000);
const programId = new PublicKey(idl.address);
const programData = PublicKey.findProgramAddressSync([programId.toBuffer()],
  new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0];
const pda = (seed: string, ...keys: Buffer[]) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...keys], programId)[0];
const stakePool = pda("stake_pool");
const poolVault = pda("pool_vault", stakePool.toBuffer());
const creditConfig = pda("credit_config");
const lendingPool = pda("lending_pool");
const lendingVault = pda("lending_vault", lendingPool.toBuffer());
const pool = { lendingPool, lendingVault };
const grace = 7 * 24 * 60 * 60;
const interval = 3600;

const wsReady = () => new Promise<boolean>((done) => {
  const socket = connect(30000, "127.0.0.1");
  socket.once("error", () => done(false));
  socket.once("connect", () => {
    socket.end();
    done(true);
  });
});

async function startValidator(root: string, payer: Keypair, fixtureDir?: string) {
  const connection = new Connection("http://127.0.0.1:29999", "confirmed");
  const validator = spawn("solana-test-validator", [
    "--ledger", fixtureDir ? `${fixtureDir}-ledger` : join(root, "ledger"),
    "--rpc-port", "29999", "--faucet-port", "29901", "--gossip-port", "29902",
    "--dynamic-port-range", "30100-30150",
    "--mint", payer.publicKey.toBase58(),
    "--upgradeable-program", programId.toBase58(),
    resolve(__dirname, "../target/deploy/relicpay.so"), payer.publicKey.toBase58(),
    ...(fixtureDir ? ["--account-dir", fixtureDir] : []),
    "--quiet",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  for (const stream of [validator.stdout, validator.stderr]) {
    stream.setEncoding("utf8").on("data", (chunk) => {
      diagnostics = (diagnostics + chunk).slice(-4000);
    });
  }
  let stopped = false;
  const closed = new Promise<void>((done) => validator.once("close", () => {
    stopped = true;
    done();
  }));
  validator.on("error", (error) => { diagnostics += error.message; });
  const stop = async () => {
    if (!stopped) {
      await delay(600);
      validator.kill("SIGTERM");
    }
    await closed;
  };
  try {
    const readyBy = Date.now() + 20_000;
    while (true) {
      const loaded = await connection.getMultipleAccountsInfo([payer.publicKey, programId])
        .catch(() => null);
      if (loaded?.[0] && loaded[1]?.executable && await connection.getSlot() > 1 && await wsReady()) break;
      if (stopped || Date.now() > readyBy) {
        throw new Error(`Credit validator did not start: ${diagnostics}`);
      }
      await delay(200);
    }
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    return { connection, provider, program: new anchor.Program<any>(idl, provider), stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function expectError(run: () => Promise<unknown>, code: string) {
  await rejects(run, (error: any) => {
    const detail = [error?.error?.errorCode?.code, error?.message, ...(error?.logs ?? [])].join("\n");
    assert.include(detail, code, detail);
    return true;
  });
}

describe("agent credit: upfront lending pool", () => {
  const payer = Keypair.generate();
  const agent = Keypair.generate();
  const merchant = Keypair.generate();
  let root: string;
  let local: Awaited<ReturnType<typeof startValidator>>;
  let usdcMint: PublicKey;
  let providerUsdc: PublicKey;
  let agentUsdc: PublicKey;
  let merchantUsdc: PublicKey;
  let borrower: Awaited<ReturnType<typeof createBorrower>>;

  const balance = async (address: PublicKey) => (await getAccount(local.connection, address)).amount;
  const unixTime = async () =>
    Number((await local.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY))!.data.readBigInt64LE(32));
  const fetchLine = () => local.program.account.creditLine.fetch(borrower.creditLine) as Promise<any>;
  const fetchPool = () => local.program.account.lendingPool.fetch(lendingPool) as Promise<any>;
  const fetchMandate = () => local.program.account.agentMandate.fetch(borrower.mandate) as Promise<any>;
  const fetchDraw = (product: string) =>
    local.program.account.creditDraw.fetch(borrower.drawAddress(product)) as Promise<any>;
  const drawAccounts = (product: string) => ({
    ...pool, creditConfig, stakePool,
    owner: borrower.owner.publicKey,
    userStake: borrower.userStake,
    creditLine: borrower.creditLine,
    mandate: borrower.mandate,
    creditDraw: borrower.drawAddress(product),
    agent: agent.publicKey, merchant: merchant.publicKey, merchantUsdc,
  });

  function limits(overrides: Record<string, unknown> = {}) {
    return {
      perPurchaseCap: usdc(500),
      periodCap: usdc(1200),
      periodSeconds: new anchor.BN(86400),
      maxPurchasesPerPeriod: 12,
      approvalThreshold: usdc(0),
      expiresAt: new anchor.BN(0),
      delegatedAllowance: usdc(50),
      allowedMerchants: [merchant.publicKey],
      ...overrides,
    };
  }

  const createMandate = (owner: Keypair, ownerUsdc: PublicKey, mandate: PublicKey) =>
    local.program.methods.createAgentMandate(limits()).accounts({
      mandate, owner: owner.publicKey, agent: agent.publicKey, ownerUsdc,
    }).signers([owner]).rpc();

  const authorizeCredit = (owner: Keypair, mandate: PublicKey) =>
    local.program.methods.authorizeAgentCredit().accountsPartial({
      owner: owner.publicKey, mandate,
    }).signers([owner]).rpc();

  async function createBorrower(authorize = true) {
    const owner = Keypair.generate();
    const ownerUsdc = await createAccount(local.connection, payer, usdcMint, owner.publicKey);
    await mintTo(local.connection, payer, usdcMint, ownerUsdc, payer, 1_000_000_000);
    await local.provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({
      fromPubkey: payer.publicKey, toPubkey: owner.publicKey, lamports: LAMPORTS_PER_SOL,
    })));
    const userStake = pda("user_stake", owner.publicKey.toBuffer());
    const creditLine = pda("credit_line", owner.publicKey.toBuffer());
    const mandate = pda("agent_mandate", owner.publicKey.toBuffer(), agent.publicKey.toBuffer());
    await local.program.methods.stakeUsdc(usdc(500)).accounts({
      stakePool, poolVault, userStake, user: owner.publicKey, userUsdc: ownerUsdc,
    }).signers([owner]).rpc();
    await createMandate(owner, ownerUsdc, mandate);
    if (authorize) await authorizeCredit(owner, mandate);
    return {
      owner, ownerUsdc, userStake, creditLine, mandate,
      drawAddress: (product: string) => pda("credit_draw", owner.publicKey.toBuffer(), Buffer.from(product)),
    };
  }

  async function updateLimits(overrides: Record<string, unknown>) {
    await local.program.methods.updateAgentMandate(limits(overrides)).accounts({
      mandate: borrower.mandate, owner: borrower.owner.publicKey,
      ownerUsdc: borrower.ownerUsdc,
    }).signers([borrower.owner]).rpc();
  }

  async function draw(
    product: string,
    amount: anchor.BN,
    options: { cosign?: boolean; signer?: Keypair; destination?: PublicKey; merchant?: PublicKey; interval?: anchor.BN } = {},
  ) {
    const signer = options.signer ?? agent;
    const ix = await local.program.methods
      .agentDrawCredit(amount, 2, options.interval ?? new anchor.BN(interval), product)
      .accountsPartial({
        ...drawAccounts(product), agent: signer.publicKey,
        merchantUsdc: options.destination ?? merchantUsdc,
        merchant: options.merchant ?? merchant.publicKey,
      }).instruction();
    if (options.cosign) ix.keys.find((k) => k.pubkey.equals(borrower.owner.publicKey))!.isSigner = true;
    return local.provider.sendAndConfirm(
      new Transaction().add(ix), options.cosign ? [signer, borrower.owner] : [signer],
    );
  }

  const repay = (product: string, amount: anchor.BN, signer = borrower.owner) =>
    local.program.methods.repayCreditDraw(amount).accountsPartial({
      ...pool, owner: signer.publicKey, ownerUsdc: borrower.ownerUsdc,
      creditLine: borrower.creditLine, creditDraw: borrower.drawAddress(product),
    }).signers([signer]).rpc();

  const closeDraw = (product: string, signer = borrower.owner) =>
    local.program.methods.closeCreditDraw().accountsPartial({
      owner: signer.publicKey, creditDraw: borrower.drawAddress(product),
    }).signers([signer]).rpc();

  const unstake = (amount: anchor.BN) =>
    local.program.methods.unstakeUsdc(amount).accounts({
      stakePool, poolVault, user: borrower.owner.publicKey,
      userStake: borrower.userStake, userUsdc: borrower.ownerUsdc,
    }).signers([borrower.owner]).rpc();

  const configure = (ltv: number, paused = false, signer = payer) =>
    local.program.methods.updateCreditConfig(ltv, paused).accountsPartial({
      creditConfig, authority: signer.publicKey,
    }).signers(signer === payer ? [] : [signer]).rpc();

  const freeze = (product: string) =>
    local.program.methods.freezeCreditDefault().accounts({
      creditDraw: borrower.drawAddress(product), creditLine: borrower.creditLine,
    }).rpc();
  const settle = (product: string) =>
    local.program.methods.settleCreditDefault().accounts({
      ...pool, creditDraw: borrower.drawAddress(product), creditLine: borrower.creditLine,
      stakePool, poolVault, userStake: borrower.userStake,
    }).rpc();

  async function ageDraws(products: string[]) {
    const drawProducts = new Map(products.map((product) => [borrower.drawAddress(product).toBase58(), product]));
    const keys = [usdcMint, agent.publicKey, borrower.owner.publicKey, borrower.ownerUsdc, merchantUsdc,
      stakePool, poolVault, creditConfig, lendingPool, lendingVault, borrower.userStake,
      borrower.creditLine, borrower.mandate, agentUsdc, providerUsdc, ...products.map(borrower.drawAddress)];
    const accounts = await local.connection.getMultipleAccountsInfo(keys);
    const fixtureDir = await mkdtemp(join(root, "aged-accounts-"));
    // Replay the real account data on a fresh validator, changing only draw start times.
    const agedStart = (await unixTime()) - grace - interval - 60;
    for (const [i, address] of keys.entries()) {
      const account = accounts[i]!;
      let data = account.data;
      const product = drawProducts.get(address.toBase58());
      if (product !== undefined) {
        const decoded = await fetchDraw(product);
        data = await local.program.coder.accounts.encode("creditDraw", {
          ...decoded, startTime: new anchor.BN(agedStart),
        });
        const padded = Buffer.alloc(account.data.length);
        data.copy(padded);
        data = padded;
      }
      await writeFile(join(fixtureDir, `${address}.json`), JSON.stringify({
        pubkey: address.toBase58(),
        account: { ...account, data: [data.toString("base64"), "base64"],
          owner: account.owner.toBase58(), rentEpoch: 0 },
      }));
    }
    await local.stop();
    local = await startValidator(root, payer, fixtureDir);
    return agedStart;
  }

  async function startFixtures() {
    root = await mkdtemp(join(tmpdir(), "relicpay-credit-"));
    local = await startValidator(root, payer);
    await local.provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({
      fromPubkey: payer.publicKey, toPubkey: agent.publicKey, lamports: LAMPORTS_PER_SOL,
    })));
    usdcMint = await createMint(local.connection, payer, payer.publicKey, null, 6);
    providerUsdc = await createAccount(local.connection, payer, usdcMint, payer.publicKey);
    agentUsdc = await createAccount(local.connection, payer, usdcMint, agent.publicKey);
    merchantUsdc = await createAccount(local.connection, payer, usdcMint, merchant.publicKey);
    await mintTo(local.connection, payer, usdcMint, providerUsdc, payer, 4_000_000_000);
    await mintTo(local.connection, payer, usdcMint, agentUsdc, payer, 10_000_000);
    await local.program.methods.initStakePool().accounts({
      stakePool, poolVault, usdcMint, authority: payer.publicKey,
    }).rpc();
  }

  async function stopFixtures() {
    try {
      if (local) await local.stop();
    } finally {
      if (root) await rm(root, { recursive: true, force: true });
    }
  }

  async function prepareBorrower() {
    borrower = await createBorrower();
  }

  const initConfig = (upgradeAuthority: Keypair, mint = usdcMint) =>
    local.program.methods.initCreditConfig().accounts({
      creditConfig, authority: payer.publicKey, upgradeAuthority: upgradeAuthority.publicKey, programData,
      stakePool, usdcMint: mint,
    }).signers(upgradeAuthority === payer ? [] : [upgradeAuthority]).rpc();
  const initPool = (mint: PublicKey, upgradeAuthority: Keypair) =>
    local.program.methods.initLendingPool().accountsPartial({
      ...pool, creditConfig, authority: payer.publicKey, upgradeAuthority: upgradeAuthority.publicKey, programData,
      usdcMint: mint,
    }).signers(upgradeAuthority === payer ? [] : [upgradeAuthority]).rpc();
  const fund = (amount: anchor.BN) => local.program.methods.fundLendingPool(amount).accounts({
    ...pool, provider: payer.publicKey, providerUsdc,
  }).rpc();

  describe("governance and funding", () => {
    before(startFixtures);
    after(stopFixtures);
    beforeEach(prepareBorrower);

    it("gates governance and mint, disables draws at zero LTV, and requires funded liquidity", async () => {
      await expectError(() => initConfig(agent), "Unauthorized");
      const otherMint = await createMint(local.connection, payer, payer.publicKey, null, 6);
      await expectError(() => initConfig(payer, otherMint), "CreditMintMismatch");
      await initConfig(payer);
      await expectError(() => initPool(usdcMint, agent), "Unauthorized");
      await expectError(() => initPool(otherMint, payer), "ConstraintHasOne");
      await initPool(usdcMint, payer);
      await expectError(() => configure(8000, false, agent), "ConstraintHasOne");
      await expectError(() => configure(8001), "LtvTooHigh");
      await expectError(() => draw("off", usdc(1)), "ExceedsCreditLimit");
      await configure(8000);
      await expectError(() => draw("empty-pool", usdc(1)), "InsufficientLendingLiquidity");
      assert.isNull(await local.connection.getAccountInfo(borrower.creditLine));
      assert.equal((await fetchMandate()).periodPurchases, 0);
      await expectError(() => fund(usdc(0)), "InvalidAmount");
      await fund(usdc(3000));
      assert.equal(await balance(lendingVault), 3_000_000_000n);
      assert.equal((await fetchPool()).totalLiquidity.toString(), "3000000000");
    });
  });

  describe("draw lifecycle", () => {
    before(async () => {
      await startFixtures();
      await initConfig(payer);
      await initPool(usdcMint, payer);
      await configure(8000);
      await fund(usdc(3000));
    });
    after(stopFixtures);
    beforeEach(prepareBorrower);

    it("requires a separate owner grant before the escrow mandate can incur debt", async () => {
      borrower = await createBorrower(false);
      const { owner, ownerUsdc, mandate, creditLine } = borrower;
      await expectError(() => authorizeCredit(agent, mandate), "ConstraintHasOne");
      await expectError(() => draw("not-authorized", usdc(1)), "CreditNotAuthorized");
      assert.isNull(await local.connection.getAccountInfo(creditLine));
      assert.equal((await fetchMandate()).periodPurchases, 0);
      await authorizeCredit(owner, mandate);
      await draw("authorized", usdc(1));
      await local.program.methods.revokeAgentMandate().accounts({
        mandate, owner: owner.publicKey, ownerUsdc,
      }).signers([owner]).rpc();
      await local.program.methods.closeAgentMandate().accounts({
        mandate, owner: owner.publicKey,
      }).signers([owner]).rpc();
      await createMandate(owner, ownerUsdc, mandate);
      await expectError(() => draw("recreated", usdc(1)), "CreditNotAuthorized");
    });

    it("lets only the owner close a settled draw, recover rent, and reuse its product ID", async () => {
      await draw("reusable", usdc(20));
      await expectError(() => closeDraw("reusable"), "InvalidCreditDrawState");
      await repay("reusable", usdc(20));
      await expectError(() => closeDraw("reusable", agent), "ConstraintHasOne");
      const owner = borrower.owner.publicKey;
      const creditDraw = borrower.drawAddress("reusable");
      const rent = (await local.connection.getAccountInfo(creditDraw))!.lamports;
      const before = await local.connection.getBalance(owner);
      await closeDraw("reusable");
      assert.equal(await local.connection.getBalance(owner), before + rent);
      assert.isNull(await local.connection.getAccountInfo(creditDraw));
      await draw("reusable", usdc(20));
      assert.property((await fetchDraw("reusable")).state, "active");
    });

    it("pays the merchant from the lending vault and enforces the exact available credit boundary", async () => {
      const before = await Promise.all([balance(merchantUsdc), balance(lendingVault),
        balance(borrower.ownerUsdc), balance(agentUsdc), balance(poolVault)]);
      await draw("purchase", usdc(180));
      assert.deepEqual(await Promise.all([balance(merchantUsdc), balance(lendingVault),
        balance(borrower.ownerUsdc), balance(agentUsdc), balance(poolVault)]),
      [before[0] + 180_000_000n, before[1] - 180_000_000n, before[2], before[3], before[4]]);
      assert.equal((await getAccount(local.connection, borrower.ownerUsdc)).delegatedAmount, 50_000_000n);
      assert.equal((await fetchDraw("purchase")).principal.toString(), "180000000");
      assert.equal((await fetchLine()).outstandingDebt.toString(), "180000000");
      await expectError(() => draw("over", usdc(220).addn(1)), "ExceedsCreditLimit");
      await draw("exact", usdc(220));
      await expectError(() => draw("past", new anchor.BN(1)), "ExceedsCreditLimit");
      assert.equal((await fetchLine()).outstandingDebt.toString(), "400000000");
      assert.equal((await fetchMandate()).periodSpent.toString(), "400000000");
    });

    it("enforces merchant, owner approval, spending, count, expiry, revocation, and signer checks", async () => {
      await updateLimits({ perPurchaseCap: usdc(100), periodCap: usdc(150),
        maxPurchasesPerPeriod: 2, approvalThreshold: usdc(60) });
      await expectError(() => draw("wrong-agent", usdc(1), { signer: payer }), "ConstraintSeeds");
      await expectError(() => draw("wrong-destination", usdc(1), { destination: agentUsdc }), "ConstraintTokenOwner");
      await expectError(() => draw("wrong-merchant", usdc(1), {
        merchant: agent.publicKey, destination: agentUsdc,
      }), "MerchantNotApproved");
      await expectError(() => draw("over-purchase", usdc(101)), "AgentPurchaseCapExceeded");
      await expectError(() => draw("above-approval", usdc(90)), "OwnerApprovalRequired");
      await draw("approved", usdc(90), { cosign: true });
      await expectError(() => draw("over-period", usdc(61), { cosign: true }), "AgentPeriodCapExceeded");
      await draw("second", usdc(10));
      await expectError(() => draw("over-count", usdc(1)), "AgentPurchaseLimitReached");
      const expires = (await unixTime()) + 3;
      await updateLimits({ expiresAt: new anchor.BN(expires) });
      for (let attempts = 0; attempts < 30; attempts++) {
        if ((await unixTime()) >= expires) break;
        await delay(250);
      }
      await expectError(() => draw("expired", usdc(1)), "MandateExpired");
      await local.program.methods.revokeAgentMandate().accounts({
        mandate: borrower.mandate, owner: borrower.owner.publicKey, ownerUsdc: borrower.ownerUsdc,
      }).signers([borrower.owner]).rpc();
      await expectError(() => draw("revoked", usdc(1)), "MandateRevoked");
      assert.equal((await fetchMandate()).totalPurchases.toString(), "2");
      await repay("second", usdc(10));
      assert.property((await fetchDraw("second")).state, "repaid");
    });

    it("repays only the selected draw, restores pool liquidity, and reopens credit while paused draws stay blocked", async () => {
      const startingLiquidity = await balance(lendingVault);
      await draw("repaid", usdc(180));
      await draw("other", usdc(220));
      await configure(8000, true);
      try {
        await expectError(() => draw("paused", usdc(1)), "CreditPaused");
        await expectError(() => repay("repaid", usdc(1), agent), "ConstraintSeeds");
        await expectError(() => repay("repaid", usdc(0)), "InvalidAmount");
        await expectError(() => repay("repaid", usdc(180).addn(1)), "RepaymentExceedsDebt");
        await repay("repaid", usdc(60));
        assert.equal((await fetchLine()).outstandingDebt.toString(), "340000000");
        assert.equal((await fetchDraw("repaid")).amountRepaid.toString(), "60000000");
        assert.equal(await balance(lendingVault), startingLiquidity - 340_000_000n);
      } finally {
        await configure(8000);
      }
      await expectError(() => draw("one-more", usdc(60).addn(1)), "ExceedsCreditLimit");
      await draw("restored", usdc(60));
      await repay("repaid", usdc(120));
      assert.property((await fetchDraw("repaid")).state, "repaid");
      assert.equal((await fetchLine()).drawsRepaid, 1);
      assert.equal((await fetchLine()).totalRepaid.toString(), "180000000");
      assert.equal((await fetchPool()).totalLiquidity.toString(), (await balance(lendingVault)).toString());
    });

    it("blocks full and excessive unstake with debt but permits the exact boundary and full release after repayment", async () => {
      await draw("secured", usdc(180));
      await expectError(() => unstake(usdc(0)), "CreditCollateralLocked");
      await expectError(() => unstake(usdc(275).addn(1)), "CreditCollateralLocked");
      await unstake(usdc(275));
      const stake = () => local.program.account.userStake.fetch(borrower.userStake) as Promise<any>;
      assert.equal((await stake()).stakedAmount.toString(), "225000000");
      await expectError(() => draw("post-unstake", new anchor.BN(1)), "ExceedsCreditLimit");
      await configure(7000);
      try {
        await expectError(() => unstake(new anchor.BN(1)), "CreditCollateralLocked");
      } finally {
        await configure(8000);
      }
      await repay("secured", usdc(180));
      await unstake(usdc(0));
      assert.equal((await stake()).stakedAmount.toString(), "0");
    });

    it("rejects an overflowing repayment schedule without creating debt or charging the mandate", async () => {
      await expectError(() => draw("overflow", usdc(100), {
        interval: new anchor.BN("9223372036854775807"),
      }), "MathOverflow");
      assert.isNull(await local.connection.getAccountInfo(borrower.creditLine));
      assert.isNull(await local.connection.getAccountInfo(borrower.drawAddress("overflow")));
      assert.equal((await fetchMandate()).periodPurchases, 0);
    });

    it("keeps the no-credit SPL delegate fallback and shares its mandate spending counters", async () => {
      borrower = await createBorrower(false);
      const product = "delegate";
      const owner = borrower.owner.publicKey;
      const agreement = pda("agreement", owner.toBuffer(), Buffer.from(product));
      const escrowUsdc = pda("escrow", agreement.toBuffer());
      const poolBefore = await balance(lendingVault);
      const merchantBefore = await balance(merchantUsdc);
      await updateLimits({ periodCap: usdc(40), perPurchaseCap: usdc(40) });
      await local.program.methods.agentCreateAgreement(usdc(30), 2, new anchor.BN(interval), product, "Merchant")
        .accounts({
          agreement, escrowUsdc, mandate: borrower.mandate, agent: agent.publicKey,
          merchant: merchant.publicKey, owner, ownerUsdc: borrower.ownerUsdc, usdcMint,
        }).signers([agent]).rpc();
      assert.equal(await balance(escrowUsdc), 15_000_000n);
      assert.equal((await getAccount(local.connection, borrower.ownerUsdc)).delegatedAmount, 35_000_000n);
      assert.equal(await balance(lendingVault), poolBefore);
      assert.equal(await balance(merchantUsdc), merchantBefore);
      assert.isNull(await local.connection.getAccountInfo(borrower.creditLine));
      await authorizeCredit(borrower.owner, borrower.mandate);
      await expectError(() => draw("combined-spending", usdc(11)), "AgentPeriodCapExceeded");
      await draw("combined-exact", usdc(10));
      assert.equal((await fetchMandate()).periodSpent.toString(), "40000000");
    });

    it("freezes overdue debt without CPI and permissionlessly seizes only that draw's unpaid collateral", async () => {
      await draw("late", usdc(100));
      await draw("current", usdc(80));
      await repay("late", usdc(10));
      await repay("current", usdc(40));
      await expectError(() => freeze("late"), "GracePeriodNotExpired");
      await expectError(() => settle("late"), "InvalidCreditDrawState");

      const late = borrower.drawAddress("late");
      const agedStart = await ageDraws(["late", "current"]);

      assert.equal((await fetchDraw("current")).startTime.toNumber(), agedStart);
      const stakeBefore = await balance(poolVault);
      const lendingBefore = await balance(lendingVault);
      const merchantBefore = await balance(merchantUsdc);
      await expectError(() => freeze("current"), "GracePeriodNotExpired");
      await freeze("late");
      assert.property((await fetchDraw("late")).state, "defaultPending");
      assert.isTrue((await fetchLine()).frozen);
      assert.equal((await fetchLine()).seizurePending.toString(), "90000000");
      assert.equal(await balance(poolVault), stakeBefore);
      assert.equal(await balance(lendingVault), lendingBefore);
      await expectError(() => freeze("late"), "InvalidCreditDrawState");
      await expectError(() => draw("frozen", usdc(1)), "CreditLineFrozen");
      await expectError(() => unstake(usdc(1)), "CreditLineFrozen");
      await expectError(() => repay("late", usdc(1)), "InvalidCreditDrawState");
      await expectError(() => closeDraw("late"), "InvalidCreditDrawState");

      await settle("late");
      const line = await fetchLine();
      const drawState = await fetchDraw("late");
      assert.property(drawState.state, "defaulted");
      assert.equal(drawState.amountRepaid.toString(), "10000000");
      assert.isFalse(line.frozen);
      assert.equal(line.seizurePending.toString(), "0");
      assert.equal(line.outstandingDebt.toString(), "40000000");
      assert.property((await fetchDraw("current")).state, "active");
      const stake = await local.program.account.userStake.fetch(borrower.userStake) as any;
      assert.equal(stake.stakedAmount.toString(), "410000000");
      assert.equal(await balance(poolVault), stakeBefore - 90_000_000n);
      assert.equal(await balance(lendingVault), lendingBefore + 90_000_000n);
      assert.equal(await balance(merchantUsdc), merchantBefore);
      assert.equal((await fetchPool()).badDebt.toString(), "0");
      await expectError(() => settle("late"), "InvalidCreditDrawState");
      await closeDraw("late");
      assert.isNull(await local.connection.getAccountInfo(late));
    });

    it("keeps the credit line frozen until both overdue draws are settled", async () => {
      await draw("first-late", usdc(70));
      await draw("second-late", usdc(30));
      await ageDraws(["first-late", "second-late"]);
      await freeze("first-late");
      await freeze("second-late");
      assert.equal((await fetchLine()).seizurePending.toString(), "100000000");

      await settle("first-late");
      const pending = await fetchLine();
      assert.isTrue(pending.frozen);
      assert.equal(pending.seizurePending.toString(), "30000000");
      assert.equal(pending.outstandingDebt.toString(), "30000000");
      assert.property((await fetchDraw("second-late")).state, "defaultPending");
      await expectError(() => draw("still-frozen", usdc(1)), "CreditLineFrozen");
      await expectError(() => unstake(usdc(1)), "CreditLineFrozen");

      await settle("second-late");
      const settled = await fetchLine();
      assert.isFalse(settled.frozen);
      assert.equal(settled.seizurePending.toString(), "0");
      assert.equal(settled.outstandingDebt.toString(), "0");
      await draw("unfrozen", usdc(1));
    });
  });
});
