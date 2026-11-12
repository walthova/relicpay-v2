// Tests for the dashboard write layer (dashboard/lib/writes.js).
//
// v2 only, same reasoning as the other dashboard tests: the dashboard is a v2 artifact and legacy/
// is the frozen spec, so the legacy run stays at exactly 51.
//
// The suite is in three parts, and the middle one is the point.
//
// 1. Plan shape. Pure assertions on the request objects, with no chain: the ABI, the args, and
//    above all `value`, since attaching ETH to a pool-funded payment destroys it (ADR-002).
//
// 2. Plans, executed. Every planned request is sent to ganache through ethers and the chain state
//    is read back. A plan that builds a valid-looking request for a call that reverts is a plan
//    that fails in the user's wallet, so nothing here trusts the shape of a request as evidence
//    that it works.
//
// 3. Rejections, executed anyway. Each preflight rejection is sent to the chain regardless, and
//    the chain must refuse it. This is the half that keeps the preflight honest: a rule that blocks
//    a transaction the contract would have accepted is a dashboard that will not let someone pay a
//    bill they can afford, and it fails silently as a permanently greyed-out button.
//
// The requests are viem-shaped because the browser hands them to wagmi. `send` below adapts one to
// ethers so the same object the app will submit is the object this suite submits, rather than a
// re-derivation of it that can drift.

const assert = require('assert');
const { createPublicClient, custom } = require('viem');

const { setup, deploy, findEvent, E, IMPL, ethers, warp } = require('./helpers');
const { createRelicPayReader } = require('../dashboard/lib/reader');
const { loadDashboard } = require('../dashboard/lib/client');
const {
  ACTIONS,
  ACTION_NAMES,
  SCOPES,
  WriteError,
  agreementScope,
  availableActions,
  currencyOf,
  isPlanStale,
  isScopePending,
  nextInstallmentOf,
  pendingScopes,
  planAction,
  resolveAfter,
} = require('../dashboard/lib/writes');

const DAY = 86400n;
const ZERO = '0x0000000000000000000000000000000000000000';

// Payment method enum, mirroring contracts/RelicPay.sol.
const MANUAL = 0;
const AUTO = 1;
const COLLATERAL = 2;

if (IMPL === 'v2') {

describe('Dashboard write layer, plan shape [v2]', function () {
  const RP = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
  const WHO = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
  const TOKEN = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

  // A view thin enough to read at a glance, in the presenter's shape. Amounts are {raw} because
  // that is what crosses the server/client boundary; the planner accepts the reader's bare BigInt
  // too, which part 2 exercises against real reader output.
  function view(over = {}) {
    return {
      role: 'buyer',
      address: WHO,
      contract: RP,
      at: { blockNumber: '100', timestamp: '1750000000' },
      autoPayment: { enabled: false, ethBalance: { raw: '1000' }, tokenBalances: {} },
      agreements: [],
      ...over,
    };
  }

  function agreement(over = {}) {
    return {
      id: '0x' + 'ab'.repeat(32),
      seller: RP,
      buyer: WHO,
      state: 'Active',
      installmentCount: 3,
      progress: { paid: 0, total: 3 },
      paymentMethod: { label: 'Manual' },
      currency: { address: null, native: true },
      schedule: [{ amount: { raw: '500' } }, { amount: { raw: '500' } }, { amount: { raw: '500' } }],
      settlement: { ready: true },
      defaultable: false,
      ...over,
    };
  }

  it('every catalogued action has a planner and a role', () => {
    for (const name of ACTION_NAMES) {
      const meta = ACTIONS[name];
      assert.ok(meta.role === 'buyer' || meta.role === 'seller', `${name} needs a role`);
      assert.ok(meta.scopes.length > 0, `${name} must declare what it can move`);
      assert.ok(meta.summary, `${name} needs a summary, the UI renders it`);
    }
  });

  it('an unknown action throws rather than returning a rejection', () => {
    // A typo in a component is a programmer error, not something a user can reach, so it must not
    // arrive as a polite disabled button.
    assert.throws(() => planAction('payInstallmnt', {}, { relicPay: RP, view: view() }), WriteError);
  });

  it('an ETH collateral deposit carries the amount as value', () => {
    const p = planAction('depositEthCollateral', { amount: '1000' }, { relicPay: RP, view: view() });
    assert.strictEqual(p.ok, true);
    assert.strictEqual(p.steps.length, 1);
    assert.strictEqual(p.steps[0].request.functionName, 'depositETHCollateral');
    assert.deepStrictEqual(p.steps[0].request.args, [false]);
    assert.strictEqual(p.steps[0].request.value, 1000n);
  });

  it('flags that it could not check the collateral minimum when no protocol params were supplied', () => {
    const p = planAction('depositEthCollateral', { amount: '1' }, { relicPay: RP, view: view() });
    assert.ok(p.notes.includes('minimum-collateral-unchecked'),
      'skipped is not the same as passed, and the UI should be able to tell');
  });

  it('rejects a deposit below the protocol minimum when it does know it', () => {
    const p = planAction(
      'depositEthCollateral',
      { amount: '1' },
      { relicPay: RP, view: view(), protocol: { params: { minCollateralAmount: 1000n } } }
    );
    assert.strictEqual(p.ok, false);
    assert.strictEqual(p.code, 'BELOW_MINIMUM');
  });

  it('prepends an approve step for a token deposit and targets the token, not the protocol', () => {
    const p = planAction(
      'depositTokenCollateral',
      { token: TOKEN, amount: '500', allowance: 0n },
      { relicPay: RP, view: view() }
    );
    assert.strictEqual(p.steps.length, 2);
    assert.strictEqual(p.steps[0].kind, 'approve');
    assert.strictEqual(p.steps[0].request.address, TOKEN, 'an approve goes to the token contract');
    assert.deepStrictEqual(p.steps[0].request.args, [RP, 500n]);
    assert.strictEqual(p.steps[1].request.address, RP);
  });

  it('omits the approve step when the allowance already covers it', () => {
    const p = planAction(
      'depositTokenCollateral',
      { token: TOKEN, amount: '500', allowance: 500n },
      { relicPay: RP, view: view() }
    );
    assert.strictEqual(p.steps.length, 1);
    assert.strictEqual(p.steps[0].request.functionName, 'depositERC20Collateral');
  });

  // --- collateral withdrawal: telling three reverts apart ---------------------
  //
  // `withdrawCollateral` can fail three ways and the contract names each one separately. The whole
  // value of planning this action rather than just encoding it is that the three arrive as three
  // different sentences, because they are three different problems: ask for less, that part is not
  // yours, and pay your agreement down. One generic "withdrawal failed" throws all of that away,
  // and worse, points a buyer at the wrong fix for two cases out of three.

  function position(over = {}) {
    return {
      id: '0x' + 'cd'.repeat(32),
      collateralType: 'ETH',
      tokenAddress: null,
      amount: { raw: '1000' },
      principal: { raw: '1000' },
      withdrawable: { raw: '1000' },
      isFloor: false,
      ...over,
    };
  }

  it('a collateral withdrawal names the position and attaches no value', () => {
    const pos = position();
    const p = planAction(
      'withdrawCollateral',
      { positionId: pos.id, amount: '400' },
      { relicPay: RP, view: view({ collateral: [pos] }) }
    );
    assert.strictEqual(p.ok, true);
    assert.strictEqual(p.steps.length, 1);
    assert.strictEqual(p.steps[0].request.functionName, 'withdrawCollateral');
    assert.deepStrictEqual(p.steps[0].request.args, [pos.id, 400n]);
    assert.strictEqual(p.steps[0].request.value, 0n, 'a withdrawal pays nothing in');
  });

  it('a withdrawal declares that it moves the credit line, not only the collateral', () => {
    // The credit limit is a ratio of collateral value, so every withdrawal moves it. A plan that
    // claimed COLLATERAL alone would leave the credit panel live over a figure about to change.
    const pos = position();
    const p = planAction(
      'withdrawCollateral',
      { positionId: pos.id, amount: '400' },
      { relicPay: RP, view: view({ collateral: [pos] }) }
    );
    assert.ok(p.scopes.includes(SCOPES.COLLATERAL));
    assert.ok(p.scopes.includes(SCOPES.CREDIT));
  });

  it('refuses a withdrawal of zero with a sentence rather than a bare require', () => {
    const pos = position();
    const p = planAction(
      'withdrawCollateral',
      { positionId: pos.id, amount: '0' },
      { relicPay: RP, view: view({ collateral: [pos] }) }
    );
    assert.strictEqual(p.ok, false);
    assert.strictEqual(p.code, 'ZERO_AMOUNT');
  });

  it('throws on a positionId that is not a bytes32, rather than encoding one', () => {
    // A caller error, like every other malformed argument in this module: a component passing a
    // truncated id is a bug, not a state a user reaches.
    assert.throws(
      () => planAction('withdrawCollateral', { positionId: '0xdeadbeef', amount: '1' },
        { relicPay: RP, view: view({ collateral: [position()] }) }),
      WriteError
    );
  });

  it('refuses a position that is not on this dashboard', () => {
    const p = planAction(
      'withdrawCollateral',
      { positionId: '0x' + 'ef'.repeat(32), amount: '1' },
      { relicPay: RP, view: view({ collateral: [position()] }) }
    );
    assert.strictEqual(p.ok, false);
    assert.strictEqual(p.code, 'POSITION_NOT_FOUND');
  });

  it('distinguishes a shortfall from unwithdrawable yield from encumbered principal', () => {
    // The three, side by side, on one position whose numbers differ in exactly the way the
    // contract's three gates read them: 1000 held, of which 800 is principal, of which 300 is free
    // of the credit line's claim.
    const pos = position({
      amount: { raw: '1000' },
      principal: { raw: '800' },
      withdrawable: { raw: '300' },
    });
    const at = { relicPay: RP, view: view({ collateral: [pos] }) };
    const plans = {
      tooMuch: planAction('withdrawCollateral', { positionId: pos.id, amount: '1001' }, at),
      yield: planAction('withdrawCollateral', { positionId: pos.id, amount: '900' }, at),
      credit: planAction('withdrawCollateral', { positionId: pos.id, amount: '500' }, at),
      fine: planAction('withdrawCollateral', { positionId: pos.id, amount: '300' }, at),
    };

    assert.strictEqual(plans.tooMuch.code, 'INSUFFICIENT_COLLATERAL');
    assert.strictEqual(plans.yield.code, 'EXCEEDS_WITHDRAWABLE_PRINCIPAL');
    assert.strictEqual(plans.credit.code, 'COLLATERAL_BACKS_OPEN_CREDIT');
    assert.strictEqual(plans.fine.ok, true, 'the ceiling itself is withdrawable');

    // And each reason says what to do about it, which is the only reason they are separate.
    assert.match(plans.yield.reason, /accrued yield/i);
    assert.match(plans.credit.reason, /pay the agreement down/i);
    assert.notStrictEqual(plans.yield.reason, plans.credit.reason);
  });

  it('checks the gates in the contract\'s own order, so the predicted error is the real one', () => {
    // Principal is bounded by amount, so a request over amount is over principal too and both
    // gates are closed. The contract checks amount first, so the code has to be the amount one.
    const pos = position({
      amount: { raw: '1000' },
      principal: { raw: '500' },
      withdrawable: { raw: '500' },
    });
    const p = planAction(
      'withdrawCollateral',
      { positionId: pos.id, amount: '2000' },
      { relicPay: RP, view: view({ collateral: [pos] }) }
    );
    assert.strictEqual(p.code, 'INSUFFICIENT_COLLATERAL');
  });

  it('will not refuse on the credit ceiling when pending yield is about to raise it', () => {
    // The rule this module holds itself to, applied to the one gate that can come untrue.
    // getWithdrawableCollateral is a view and does not settle yield; withdrawCollateral settles it
    // on the way in, which raises the collateral value and with it the credit headroom. So on a
    // position with an accrual waiting, the reported ceiling is a floor, and rejecting above it
    // would be the preflight refusing a withdrawal the chain may well accept. Offered with the
    // risk stated instead.
    const pos = position({
      amount: { raw: '1000' },
      principal: { raw: '1000' },
      withdrawable: { raw: '300' },
      isFloor: true,
    });
    const p = planAction(
      'withdrawCollateral',
      { positionId: pos.id, amount: '500' },
      { relicPay: RP, view: view({ collateral: [pos] }) }
    );
    assert.strictEqual(p.ok, true, 'a floor is not a refusal');
    assert.ok(p.notes.includes('above-reported-withdrawable'));
    assert.ok(p.notes.includes('withdrawable-is-a-floor'));
  });

  it('still refuses on principal even when yield is pending, because principal never rises', () => {
    // The converse of the test above, and the reason the softening is scoped to one gate rather
    // than applied to the whole planner. An accrual raises amount and the credit line; it does not
    // raise principal, so that gate stays exact on a yielding position.
    const pos = position({
      amount: { raw: '1200' },
      principal: { raw: '1000' },
      withdrawable: { raw: '1000' },
      isFloor: true,
    });
    const p = planAction(
      'withdrawCollateral',
      { positionId: pos.id, amount: '1100' },
      { relicPay: RP, view: view({ collateral: [pos] }) }
    );
    assert.strictEqual(p.code, 'EXCEEDS_WITHDRAWABLE_PRINCIPAL');
  });

  it('says so when the view carries no withdrawable ceiling at all', () => {
    const pos = position({ withdrawable: null });
    const p = planAction(
      'withdrawCollateral',
      { positionId: pos.id, amount: '900' },
      { relicPay: RP, view: view({ collateral: [pos] }) }
    );
    assert.strictEqual(p.ok, true);
    assert.ok(p.notes.includes('withdrawable-unknown'), 'skipped is not the same as passed');
  });

  it('reads a reader-shaped position as readily as a presented one', () => {
    // The planner is fed reader output by the suite and presented output by the app; a withdrawal
    // planned from one shape and not the other is the bug part c2 found in the balance lookups.
    const pos = { id: '0x' + 'cd'.repeat(32), amount: 1000n, principal: 800n, withdrawable: 300n, mayAccrue: false };
    const at = { relicPay: RP, view: view({ collateral: [pos] }) };
    assert.strictEqual(planAction('withdrawCollateral', { positionId: pos.id, amount: '300' }, at).ok, true);
    assert.strictEqual(
      planAction('withdrawCollateral', { positionId: pos.id, amount: '400' }, at).code,
      'COLLATERAL_BACKS_OPEN_CREDIT'
    );
    assert.strictEqual(
      planAction('withdrawCollateral', { positionId: pos.id, amount: '900' }, at).code,
      'EXCEEDS_WITHDRAWABLE_PRINCIPAL'
    );
  });

  it('an ETH Manual payment sends exactly the installment amount, not more', () => {
    // _settleManual requires msg.value == amount. An overpayment reverts, so "at least" is wrong.
    const p = planAction(
      'payInstallment',
      { agreementId: agreement().id },
      { relicPay: RP, view: view({ agreements: [agreement()] }) }
    );
    assert.strictEqual(p.ok, true);
    assert.strictEqual(p.steps[0].request.value, 500n);
  });

  it('a token Manual payment sends zero value and approves first', () => {
    const a = agreement({ currency: { address: TOKEN }, settlement: { ready: true } });
    const p = planAction(
      'payInstallment',
      { agreementId: a.id, allowance: 0n },
      { relicPay: RP, view: view({ agreements: [a] }) }
    );
    assert.strictEqual(p.steps.length, 2);
    assert.strictEqual(p.steps[0].kind, 'approve');
    assert.strictEqual(p.steps[1].request.value, 0n,
      '_settleManual reverts with UnexpectedETHPayment if a token agreement is sent ETH');
  });

  // The one that matters most in this file.
  it('never attaches value to a pool-funded payment, whatever the currency', () => {
    for (const label of ['Auto', 'Collateral', 'AutoWithCollateral']) {
      for (const currency of [{ address: null, native: true }, { address: TOKEN }]) {
        const a = agreement({ paymentMethod: { label }, currency });
        const p = planAction(
          'payInstallment',
          { agreementId: a.id },
          { relicPay: RP, view: view({ agreements: [a] }) }
        );
        assert.strictEqual(p.ok, true, `${label} should plan`);
        const callStep = p.steps[p.steps.length - 1];
        assert.strictEqual(
          callStep.request.value,
          0n,
          `${label} never reads msg.value, so ETH attached here is credited to nobody and cannot be recovered`
        );
      }
    }
  });

  it('refuses an out-of-sequence installment and names the one that is due', () => {
    const a = agreement({ progress: { paid: 1, total: 3 } });
    const p = planAction(
      'payInstallment',
      { agreementId: a.id, installmentNumber: 3 },
      { relicPay: RP, view: view({ agreements: [a] }) }
    );
    assert.strictEqual(p.ok, false);
    assert.strictEqual(p.code, 'OUT_OF_SEQUENCE');
    assert.strictEqual(p.expected, '2');
  });

  it('allows a third party to pay a Manual installment but says so', () => {
    const a = agreement();
    const p = planAction(
      'payInstallment',
      { agreementId: a.id },
      { relicPay: RP, view: view({ agreements: [a] }), from: TOKEN }
    );
    assert.strictEqual(p.ok, true, 'the contract permits it, so the write layer must not invent a rule');
    assert.ok(p.notes.includes('payerIsNotBuyer'));
  });

  it('a payment claims the agreement scope as well as the funding scopes', () => {
    const a = agreement();
    const p = planAction('payInstallment', { agreementId: a.id }, { relicPay: RP, view: view({ agreements: [a] }) });
    assert.ok(p.scopes.includes(agreementScope(a.id)));
    assert.ok(p.scopes.includes(SCOPES.CREDIT));
    assert.ok(p.scopes.includes(SCOPES.RELIC), 'the final installment transfers the relic');
  });

  it('rejects a pool-funded payment the reader already says is not covered', () => {
    const a = agreement({ paymentMethod: { label: 'Auto' }, settlement: { ready: false } });
    const p = planAction('payInstallment', { agreementId: a.id }, { relicPay: RP, view: view({ agreements: [a] }) });
    assert.strictEqual(p.ok, false);
    assert.strictEqual(p.code, 'NOT_READY');
  });

  it('rejects a pool withdrawal larger than the pool', () => {
    const p = planAction('withdrawAutoPayment', { amount: '5000' }, { relicPay: RP, view: view() });
    assert.strictEqual(p.ok, false);
    assert.strictEqual(p.code, 'INSUFFICIENT_POOL_BALANCE');
    assert.strictEqual(p.available, '1000');
  });

  it('refuses a non-integer amount as a caller error rather than a rejection', () => {
    for (const bad of ['', '1.5', 'abc', null, undefined, {}]) {
      assert.throws(
        () => planAction('depositEthCollateral', { amount: bad }, { relicPay: RP, view: view() }),
        WriteError,
        `${String(bad)} should throw`
      );
    }
  });

  it('availableActions marks amount-taking actions as needing input instead of planning zero', () => {
    const list = availableActions(view(), { role: 'buyer' });
    const deposit = list.find((a) => a.action === 'depositEthCollateral');
    assert.strictEqual(deposit.needsInput, true);
    assert.strictEqual(deposit.ok, undefined, 'a deposit of nothing is not a rejected deposit');
  });

  it('availableActions filters by role', () => {
    const buyer = availableActions(view(), { role: 'buyer' }).map((a) => a.action);
    const seller = availableActions(view(), { role: 'seller' }).map((a) => a.action);
    assert.ok(buyer.includes('payInstallment'));
    assert.ok(!buyer.includes('triggerDefault'));
    assert.ok(seller.includes('triggerDefault'));
    assert.ok(!seller.includes('payInstallment'));
  });

  it('a plan remembers its block and goes stale when the view moves', () => {
    const p = planAction('depositEthCollateral', { amount: '1000' }, { relicPay: RP, view: view() });
    assert.strictEqual(p.plannedAt.blockNumber, '100');
    assert.strictEqual(isPlanStale(p, view()), false);
    assert.strictEqual(isPlanStale(p, view({ at: { blockNumber: '101', timestamp: '1750000012' } })), true);
  });

  it('pending is per scope, so an unrelated region stays usable', () => {
    const p = planAction('fundAutoPayment', { amount: '10' }, { relicPay: RP, view: view() });
    assert.strictEqual(isScopePending([p], SCOPES.AUTO_PAYMENT), true);
    assert.strictEqual(isScopePending([p], SCOPES.SELLER_BALANCES), false);
    assert.strictEqual(pendingScopes([p]).size, 1);
  });

  it('resolveAfter re-pins at the receipt block and reloads only on success', () => {
    const p = planAction('fundAutoPayment', { amount: '10' }, { relicPay: RP, view: view() });
    const ok = resolveAfter(p, { blockNumber: 104n, status: 'success' });
    assert.strictEqual(ok.reload, true);
    assert.strictEqual(ok.blockNumber, '104');

    const failed = resolveAfter(p, { blockNumber: 104n, status: 'reverted' });
    assert.strictEqual(failed.reload, false, 'nothing changed, so the pin stays where it was');
    assert.strictEqual(failed.status, 'reverted');
  });

  it('a plan is JSON-safe, since it crosses the same boundary the view model does', () => {
    const p = planAction('depositEthCollateral', { amount: '1000' }, { relicPay: RP, view: view() });
    // The request itself holds BigInt on purpose, because viem wants BigInt. Everything the server
    // sends to the client is the metadata, and that has to survive JSON.
    const { steps, ...meta } = p;
    assert.doesNotThrow(() => JSON.stringify(meta));
    assert.strictEqual(typeof p.plannedAt.blockNumber, 'string');
  });

  it('reads the settlement currency from a field that survives a completed agreement', () => {
    // settlement.tokenAddress is null on anything not Active, so a planner reading it would treat a
    // completed USDC agreement as an ETH one. Both view shapes must resolve the currency.
    const completedPresented = agreement({ state: 'Completed', currency: { address: TOKEN }, settlement: null });
    assert.strictEqual(currencyOf(completedPresented), TOKEN);
    const completedRaw = { state: 'Completed', settlementToken: TOKEN, settlement: null };
    assert.strictEqual(currencyOf(completedRaw), TOKEN);
    assert.strictEqual(currencyOf({ settlementToken: null }), null, 'null means native ETH');
  });

  it('derives the next installment from paid count, which every agreement shape has', () => {
    assert.strictEqual(nextInstallmentOf({ progress: { paid: 2 } }), 3n);
    assert.strictEqual(nextInstallmentOf({ paidInstallments: 0 }), 1n);
  });
});

describe('Dashboard write layer against a live chain [v2]', function () {
  this.timeout(180000);

  let s, owner, seller, buyer, other, rp, rpAddr, registry, nft, usd, publicClient, reader;

  async function makeViemClient(provider) {
    const chainId = Number(await provider.send('eth_chainId', []));
    return createPublicClient({
      // cacheTime 0 for the same reason dashboard.test.js needs it: these tests warp the clock and
      // read immediately, and a cached block number pins every read to before the warp.
      cacheTime: 0,
      pollingInterval: 0,
      chain: {
        id: chainId,
        name: 'ganache',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [] } },
      },
      transport: custom({ request: ({ method, params }) => provider.send(method, params ?? []) }),
    });
  }

  /**
   * Submit a viem-shaped request through ethers.
   *
   * The adaptation is the whole reason this is trustworthy: the object being sent is the object
   * writes.js built, including its `value`, so a planner that forgets to attach ETH or attaches it
   * where it must not fails here rather than in a wallet.
   */
  async function send(request, signer) {
    const c = new ethers.Contract(request.address, request.abi, signer);
    const overrides = request.value === undefined || request.value === 0n ? {} : { value: request.value };
    const tx = await c[request.functionName](...request.args, overrides);
    return tx.wait();
  }

  async function execute(plan, signer) {
    assert.strictEqual(plan.ok, true, `plan was rejected: ${plan.reason || ''}`);
    let last;
    for (const step of plan.steps) last = await send(step.request, signer);
    return last;
  }

  /**
   * Send a call the preflight refused, and require the chain to refuse it too.
   *
   * This is the request a dashboard with no preflight would have submitted, built by calling the
   * contract directly with the arguments the user asked for. estimateGas is stubbed out in
   * helpers.js, so a failing transaction comes back as a mined receipt with status 0 rather than
   * throwing; both are accepted here.
   */
  async function refusedByChain(fn) {
    try {
      const receipt = await (await fn()).wait();
      return receipt.status === 0;
    } catch (e) {
      return /revert|VM Exception|status|estimate/i.test(String(e && e.message));
    }
  }

  /**
   * The protocol's ETH balance, over the raw RPC with an explicit tag.
   *
   * Not `provider.getBalance`. ethers caches the latest block for its polling interval, exactly as
   * helpers.js documents for block timestamps, and the same cache applies to balances: a
   * before/after pair taken around one transaction can both resolve against the same cached block
   * and report a delta of zero. That is not a flaky test, it is a test that passes while asserting
   * a number the chain never produced, which is how the stranded-ETH assertion below first went
   * green with the wrong figure in it.
   */
  async function contractEth() {
    return BigInt(await s.provider.send('eth_getBalance', [rpAddr, 'latest']));
  }

  beforeEach(async () => {
    s = await setup();
    [owner, seller, buyer, other] = s.signers;
    rp = await deploy('RelicPay', [], owner);
    rpAddr = ethers.getAddress(await rp.getAddress());
    registry = await deploy('RelicRegistry', [], owner);
    nft = await deploy('MockNFT', [], owner);
    usd = await deploy('MockERC20', [], owner);
    await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
    await (await rp.authorizeNFT(await registry.getAddress(), true)).wait();
    publicClient = await makeViemClient(s.provider);
    reader = createRelicPayReader({ publicClient, addresses: { relicPay: rpAddr } });
  });

  async function giveCredit(who, amount) {
    await (await rp.connect(who).depositETHCollateral(false, { value: amount })).wait();
  }

  async function mintToSeller() {
    const rc = await (await nft.connect(seller).mint(seller.address)).wait();
    const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
    await (await nft.connect(seller).approve(await rp.getAddress(), tokenId)).wait();
    return tokenId;
  }

  async function createAgreement(total, method, over = {}) {
    const tokenId = await mintToSeller();
    const p = Object.assign({ count: 3n, interval: 30n * DAY, grace: 7n * DAY }, over);
    const tx = await rp.createAgreementWithRWA(
      seller.address,
      buyer.address,
      total,
      p.count,
      p.interval,
      p.grace,
      method,
      {
        physicalId: over.physicalId || 'IBG-OPTIC-001',
        nftContract: nft.target,
        tokenId,
        metadataURI: 'ipfs://relic/1',
        ownershipTransferred: false,
        currentOwner: seller.address,
      }
    );
    return findEvent(await tx.wait(), rp, 'AgreementCreated').agreementId;
  }

  function buyerView() {
    return reader.getBuyerDashboard(ethers.getAddress(buyer.address));
  }

  function sellerView() {
    return reader.getSellerDashboard(ethers.getAddress(seller.address));
  }

  function ctxFor(view) {
    return { relicPay: rpAddr, view };
  }

  // --- part 2: plans, executed ------------------------------------------------

  it('a planned ETH collateral deposit actually posts collateral', async () => {
    const before = await buyerView();
    assert.strictEqual(before.collateral.length, 0);

    const p = planAction('depositEthCollateral', { amount: E('2') }, ctxFor(before));
    await execute(p, buyer);

    const after = await buyerView();
    assert.strictEqual(after.collateral.length, 1);
    assert.strictEqual(after.collateral[0].amount, E('2'));
    assert.ok(after.credit.creditLimit > 0n, 'posting collateral opens a credit line');
  });

  it('the stakeForYield flag reaches the chain', async () => {
    const p = planAction('depositEthCollateral', { amount: E('2'), stakeForYield: true }, ctxFor(await buyerView()));
    await execute(p, buyer);
    const after = await buyerView();
    assert.strictEqual(after.collateral[0].collateralType, 'StakedETH');
    assert.strictEqual(after.collateral[0].isStaked, true);
  });

  it('a planned token collateral deposit approves and deposits in one plan', async () => {
    const usdAddr = ethers.getAddress(await usd.getAddress());
    await (await rp.connect(owner).authorizeToken(usdAddr, true)).wait();
    await (await usd.mint(buyer.address, E('100'))).wait();

    const p = planAction(
      'depositTokenCollateral',
      { token: usdAddr, amount: E('50'), allowance: 0n },
      ctxFor(await buyerView())
    );
    assert.strictEqual(p.steps.length, 2, 'no allowance, so the plan has to include the approve');
    await execute(p, buyer);

    const after = await buyerView();
    const pos = after.collateral.find((c) => c.collateralType === 'ERC20');
    assert.ok(pos, 'the ERC20 position exists');
    assert.strictEqual(pos.amount, E('50'));
  });

  it('a planned ETH Manual payment settles the installment', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);
    const view = await buyerView();

    const p = planAction('payInstallment', { agreementId: id }, ctxFor(view));
    assert.strictEqual(p.steps[0].request.value, E('1'));
    await execute(p, buyer);

    const after = await buyerView();
    const a = after.agreements.find((x) => x.id === id);
    assert.strictEqual(a.paidInstallments, 1);
    assert.strictEqual(a.totalPaid, E('1'));
  });

  it('a planned Collateral payment settles without any ETH attached', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), COLLATERAL);
    const view = await buyerView();

    const p = planAction('payInstallment', { agreementId: id }, ctxFor(view));
    assert.strictEqual(p.steps[0].request.value, 0n);
    await execute(p, buyer);

    const after = await buyerView();
    const a = after.agreements.find((x) => x.id === id);
    assert.strictEqual(a.paidInstallments, 1, 'the draw came from collateral, not from the wallet');
    assert.ok(after.totalCollateral < E('10'), 'and collateral went down');
  });

  it('a planned Auto payment draws the pool the plan just funded', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), AUTO);

    const fund = planAction('fundAutoPayment', { amount: E('2') }, ctxFor(await buyerView()));
    await execute(fund, buyer);

    const view = await buyerView();
    assert.strictEqual(view.autoPayment.ethBalance, E('2'));

    const pay = planAction('payInstallment', { agreementId: id }, ctxFor(view));
    assert.strictEqual(pay.steps[0].request.value, 0n);
    await execute(pay, buyer);

    const after = await buyerView();
    assert.strictEqual(after.autoPayment.ethBalance, E('1'), 'one installment came out of the pool');
    assert.strictEqual(after.agreements.find((x) => x.id === id).paidInstallments, 1);
  });

  it('a planned pool withdrawal returns the funds', async () => {
    await execute(planAction('fundAutoPayment', { amount: E('3') }, ctxFor(await buyerView())), buyer);
    const view = await buyerView();
    await execute(planAction('withdrawAutoPayment', { amount: E('1') }, ctxFor(view)), buyer);
    const after = await buyerView();
    assert.strictEqual(after.autoPayment.ethBalance, E('2'));
  });

  it('setAutoPayment flips the preference the buyer view reads back', async () => {
    const view = await buyerView();
    assert.strictEqual(view.autoPayment.enabled, false);
    await execute(planAction('setAutoPayment', { enabled: true }, ctxFor(view)), buyer);
    assert.strictEqual((await buyerView()).autoPayment.enabled, true);
  });

  it('a planned seller withdrawal moves the settled balance out', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);
    await execute(planAction('payInstallment', { agreementId: id }, ctxFor(await buyerView())), buyer);

    const view = await sellerView();
    assert.strictEqual(view.balances.eth, E('1'));

    const p = planAction('withdrawSellerBalance', {}, { relicPay: rpAddr, view, from: ethers.getAddress(seller.address) });
    await execute(p, seller);
    assert.strictEqual((await sellerView()).balances.eth, 0n);
  });

  it('a planned triggerDefault defaults the agreement and seizes collateral', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);
    await warp(40n * DAY); // past the first due date plus its 7 day grace

    const view = await sellerView();
    const a = view.agreements.find((x) => x.id === id);
    assert.strictEqual(a.defaultable, true, 'the fixture has to actually be defaultable');

    const p = planAction('triggerDefault', { agreementId: id }, { relicPay: rpAddr, view, from: ethers.getAddress(seller.address) });
    await execute(p, seller);

    const after = await sellerView();
    assert.strictEqual(after.agreements.find((x) => x.id === id).state, 'Defaulted');
  });

  it('a planned processOverduePayments advances the stored schedule status', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), COLLATERAL);
    await warp(40n * DAY);

    const view = await sellerView();
    const before = view.agreements.find((x) => x.id === id);
    assert.ok(before.schedule.some((x) => x.isOverdue && x.storedStatus === 'Pending'),
      'derived overdue with a stale stored status is the state this action exists for');

    const p = planAction('processOverduePayments', { agreementId: id }, { relicPay: rpAddr, view, from: ethers.getAddress(seller.address) });
    await execute(p, seller);

    const after = (await sellerView()).agreements.find((x) => x.id === id);
    assert.ok(after.paidInstallments > before.paidInstallments, 'the sweep settled from collateral');
  });

  it('setSettlementPreference moves the seller default and leaves open agreements alone', async () => {
    const usdAddr = ethers.getAddress(await usd.getAddress());
    await (await rp.connect(owner).authorizeSettlementToken(usdAddr, true)).wait();
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL); // created while the preference is still ETH

    const view = await sellerView();
    const p = planAction('setSettlementPreference', { token: usdAddr }, { relicPay: rpAddr, view, from: ethers.getAddress(seller.address) });
    await execute(p, seller);

    const after = await sellerView();
    assert.strictEqual(after.settlementPreference.toLowerCase(), usdAddr.toLowerCase());
    assert.strictEqual(
      after.agreements.find((x) => x.id === id).settlementToken,
      null,
      'the currency is snapshotted at creation, so the open agreement still settles in ETH'
    );
  });

  it('plans built from the presented view model work as well as ones built from reader output', async () => {
    // The app plans against present.js output on the client; the suite mostly plans against reader
    // output. If the two shapes diverged, the app would build wrong requests and nothing here would
    // notice, so plan the same payment both ways and require identical requests.
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);

    const raw = await buyerView();
    const presented = await loadDashboard(ethers.getAddress(buyer.address), {
      role: 'buyer',
      network: 'local',
      transport: custom({ request: ({ method, params }) => s.provider.send(method, params ?? []) }),
      env: { RPC_URL: 'http://unused.invalid', RELICPAY_ADDRESS: rpAddr },
    });

    const fromRaw = planAction('payInstallment', { agreementId: id }, ctxFor(raw));
    const fromView = planAction('payInstallment', { agreementId: id }, { relicPay: rpAddr, view: presented });

    assert.deepStrictEqual(fromView.steps[0].request.args, fromRaw.steps[0].request.args);
    assert.strictEqual(fromView.steps[0].request.value, fromRaw.steps[0].request.value);
    await execute(fromView, buyer);
    assert.strictEqual((await buyerView()).agreements.find((x) => x.id === id).paidInstallments, 1);
  });

  // --- the reload contract ----------------------------------------------------

  it('reloading at the receipt block shows the payment; the block before it does not', async () => {
    // This is ADR-002's central claim made testable. Refetching at "latest" on send would race the
    // miner and render a block from before the transaction, which to the buyer is indistinguishable
    // from a payment that never happened.
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);

    const view = await buyerView();
    const p = planAction('payInstallment', { agreementId: id }, ctxFor(view));
    const receipt = await execute(p, buyer);

    const resolution = resolveAfter(p, { blockNumber: receipt.blockNumber, status: receipt.status });
    assert.strictEqual(resolution.reload, true);

    const at = BigInt(resolution.blockNumber);
    const reloaded = await reader.getBuyerDashboard(ethers.getAddress(buyer.address), { blockNumber: at });
    assert.strictEqual(reloaded.agreements.find((x) => x.id === id).paidInstallments, 1);

    const earlier = await reader.getBuyerDashboard(ethers.getAddress(buyer.address), { blockNumber: at - 1n });
    assert.strictEqual(
      earlier.agreements.find((x) => x.id === id).paidInstallments,
      0,
      'one block earlier the payment is genuinely not there, which is what a race would render'
    );
  });

  it('a plan built before a payment is stale against the view after it', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);

    const view = await buyerView();
    const p = planAction('payInstallment', { agreementId: id }, ctxFor(view));
    await execute(p, buyer);

    assert.strictEqual(isPlanStale(p, await buyerView()), true,
      'the same plan clicked twice would pay installment 1 again and revert');
  });

  // --- part 3: rejections, executed anyway ------------------------------------

  it('NOT_THE_SELLER: a non-seller default is refused, and reverts if sent anyway', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);
    await warp(40n * DAY);

    const view = await reader.getSellerDashboard(ethers.getAddress(seller.address));
    const rejected = planAction('triggerDefault', { agreementId: id }, { relicPay: rpAddr, view, from: ethers.getAddress(buyer.address) });
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.code, 'NOT_THE_SELLER');

    assert.ok(await refusedByChain(() => rp.connect(buyer).triggerDefault(id)),
      'the chain refuses it too, so the preflight is not inventing a rule');
  });

  it('GRACE_PERIOD_ACTIVE: an early default is refused, and reverts if sent anyway', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);

    const view = await sellerView();
    const rejected = planAction('triggerDefault', { agreementId: id }, { relicPay: rpAddr, view, from: ethers.getAddress(seller.address) });
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.code, 'GRACE_PERIOD_ACTIVE');

    assert.ok(await refusedByChain(() => rp.connect(seller).triggerDefault(id)));
  });

  it('GRACE_PERIOD_ACTIVE clears on its own once time passes, with no transaction in between', async () => {
    // The one rejection that flips to allowed without anybody sending anything, which is why the
    // preflight has to be described as advisory and pinned rather than as a guarantee.
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);
    const sellerAddr = ethers.getAddress(seller.address);

    const before = planAction('triggerDefault', { agreementId: id }, { relicPay: rpAddr, view: await sellerView(), from: sellerAddr });
    assert.strictEqual(before.ok, false);

    await warp(40n * DAY);

    const after = planAction('triggerDefault', { agreementId: id }, { relicPay: rpAddr, view: await sellerView(), from: sellerAddr });
    assert.strictEqual(after.ok, true);
  });

  it('OUT_OF_SEQUENCE: skipping an installment is refused, and reverts if sent anyway', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);

    const view = await buyerView();
    const rejected = planAction('payInstallment', { agreementId: id, installmentNumber: 2 }, ctxFor(view));
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.code, 'OUT_OF_SEQUENCE');

    assert.ok(await refusedByChain(() => rp.connect(buyer).processPayment(id, 2, { value: E('1') })));
  });

  it('AGREEMENT_NOT_ACTIVE: paying a completed agreement is refused, and reverts if sent anyway', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL, { count: 1n });
    await execute(planAction('payInstallment', { agreementId: id }, ctxFor(await buyerView())), buyer);

    const view = await buyerView();
    assert.strictEqual(view.agreements.find((x) => x.id === id).state, 'Completed');
    const rejected = planAction('payInstallment', { agreementId: id }, ctxFor(view));
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.code, 'AGREEMENT_NOT_ACTIVE');

    assert.ok(await refusedByChain(() => rp.connect(buyer).processPayment(id, 1, { value: E('3') })));
  });

  it('NOTHING_TO_WITHDRAW: an empty seller balance is refused, and reverts if sent anyway', async () => {
    const view = await sellerView();
    assert.strictEqual(view.balances.eth, 0n);
    const rejected = planAction('withdrawSellerBalance', {}, { relicPay: rpAddr, view, from: ethers.getAddress(seller.address) });
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.code, 'NOTHING_TO_WITHDRAW');

    assert.ok(await refusedByChain(() => rp.connect(seller).withdrawSellerBalance()));
  });

  it('INSUFFICIENT_POOL_BALANCE: overdrawing the pool is refused, and reverts if sent anyway', async () => {
    await execute(planAction('fundAutoPayment', { amount: E('1') }, ctxFor(await buyerView())), buyer);
    const view = await buyerView();
    const rejected = planAction('withdrawAutoPayment', { amount: E('5') }, ctxFor(view));
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.code, 'INSUFFICIENT_POOL_BALANCE');

    assert.ok(await refusedByChain(() => rp.connect(buyer).withdrawAutoPaymentFunds(E('5'))));
  });

  it('NOT_READY: an underfunded Auto payment is refused, and reverts if sent anyway', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), AUTO); // pool never funded

    const view = await buyerView();
    const rejected = planAction('payInstallment', { agreementId: id }, ctxFor(view));
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.code, 'NOT_READY');

    assert.ok(await refusedByChain(() => rp.connect(buyer).processPayment(id, 1)));
  });

  // --- collateral withdrawal, against the chain -------------------------------

  it('a planned withdrawal returns unencumbered collateral and lowers the credit line', async () => {
    await execute(planAction('depositEthCollateral', { amount: E('4') }, ctxFor(await buyerView())), buyer);

    const before = await buyerView();
    const pos = before.collateral[0];
    assert.strictEqual(pos.amount, E('4'));
    assert.strictEqual(pos.principal, E('4'), 'a fresh deposit is all principal');
    assert.strictEqual(pos.withdrawable, E('4'), 'nothing is borrowed against it yet');
    const limitBefore = before.credit.creditLimit;

    const p = planAction('withdrawCollateral', { positionId: pos.id, amount: E('1.5') }, ctxFor(before));
    await execute(p, buyer);

    const after = await buyerView();
    assert.strictEqual(after.collateral[0].amount, E('2.5'));
    assert.strictEqual(after.collateral[0].principal, E('2.5'));
    assert.ok(after.credit.creditLimit < limitBefore, 'withdrawing lowers the line it backed');
  });

  it('the whole reported ceiling is withdrawable, which is what makes it worth showing', async () => {
    // The ceiling is only useful if a buyer can type it in and have it work. An off-by-one here
    // would be a "max" button that fails, which is worse than no max button.
    await execute(planAction('depositEthCollateral', { amount: E('3') }, ctxFor(await buyerView())), buyer);
    await giveCredit(buyer, E('7')); // second deposit into the same position
    const view = await buyerView();
    const pos = view.collateral[0];

    const p = planAction('withdrawCollateral', { positionId: pos.id, amount: pos.withdrawable }, ctxFor(view));
    const receipt = await execute(p, buyer);
    assert.strictEqual(receipt.status, 1);
    assert.strictEqual((await buyerView()).collateral[0].withdrawable, 0n);
  });

  it('INSUFFICIENT_COLLATERAL: over the position balance is refused, and reverts if sent anyway', async () => {
    await execute(planAction('depositEthCollateral', { amount: E('2') }, ctxFor(await buyerView())), buyer);
    const view = await buyerView();
    const pos = view.collateral[0];

    const rejected = planAction('withdrawCollateral', { positionId: pos.id, amount: E('3') }, ctxFor(view));
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.code, 'INSUFFICIENT_COLLATERAL');

    assert.ok(await refusedByChain(() => rp.connect(buyer).withdrawCollateral(pos.id, E('3'))));
  });

  it('EXCEEDS_WITHDRAWABLE_PRINCIPAL: reinvested yield is refused, and reverts if sent anyway', async () => {
    // The gate that exists because position.amount is not principal. A year of 5% APY reinvested
    // leaves the position holding more than was ever deposited, and that surplus is simulated: it
    // is backed by other users' deposits and cannot be paid out. A dashboard reading only `amount`
    // would offer it as withdrawable, which is the exact promise the contract refuses to keep.
    await execute(planAction('depositEthCollateral', { amount: E('10') }, ctxFor(await buyerView())), buyer);
    await warp(365n * DAY);
    await execute(planAction('depositEthCollateral', { amount: E('1') }, ctxFor(await buyerView())), buyer);

    const view = await buyerView();
    const pos = view.collateral[0];
    assert.ok(pos.amount > pos.principal, 'expected the year of reinvested yield to show as drift');
    assert.strictEqual(pos.principal, E('11'));
    assert.strictEqual(pos.withdrawable, E('11'), 'the ceiling is principal, not the inflated balance');

    const rejected = planAction('withdrawCollateral', { positionId: pos.id, amount: pos.amount }, ctxFor(view));
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.code, 'EXCEEDS_WITHDRAWABLE_PRINCIPAL');

    assert.ok(await refusedByChain(() => rp.connect(buyer).withdrawCollateral(pos.id, pos.amount)));
  });

  it('COLLATERAL_BACKS_OPEN_CREDIT: the V1-BUG-2 case is refused, and reverts if sent anyway', async () => {
    // v1's EnhancedBnpl.withdrawCollateral checked nothing, so a buyer could open an agreement
    // against collateral and then walk the collateral out from under it. The contract's fix is a
    // revert; this is the dashboard saying which revert it is, and what fixes it.
    await execute(planAction('depositEthCollateral', { amount: E('5') }, ctxFor(await buyerView())), buyer);
    await createAgreement(E('3'), MANUAL);

    const view = await buyerView();
    const pos = view.collateral[0];
    assert.ok(view.credit.usedCredit > 0n, 'the agreement drew on the line');
    assert.ok(pos.withdrawable < pos.principal, 'part of the principal is now spoken for');
    assert.strictEqual(pos.mayAccrue, false, 'a position touched this block has no accrual pending');

    const rejected = planAction('withdrawCollateral', { positionId: pos.id, amount: pos.principal }, ctxFor(view));
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.code, 'COLLATERAL_BACKS_OPEN_CREDIT');
    assert.match(rejected.reason, /pay the agreement down/i);

    assert.ok(await refusedByChain(() => rp.connect(buyer).withdrawCollateral(pos.id, pos.principal)));

    // And the distinction earns its keep: the spare below the ceiling still comes out, which is the
    // whole reason the contract asks "would this leave it uncovered" rather than "is any credit
    // outstanding".
    const p = planAction('withdrawCollateral', { positionId: pos.id, amount: pos.withdrawable }, ctxFor(view));
    assert.strictEqual(p.ok, true);
    assert.strictEqual((await execute(p, buyer)).status, 1);
  });

  it('the reported ceiling stays exact once yield is pending (ADR-012)', async () => {
    // Before ADR-012 a pending accrual raised the credit line on the way into withdrawCollateral,
    // so getWithdrawableCollateral was a floor and the planner let amounts above it through. The
    // credit line now counts principal only, so accrual cannot raise it: the figure is exact, and an
    // amount above it is refused by the chain. The planner must refuse it too, not wave it through.
    await execute(planAction('depositEthCollateral', { amount: E('10') }, ctxFor(await buyerView())), buyer);
    await createAgreement(E('3'), MANUAL);
    await warp(365n * DAY);

    const view = await buyerView();
    const pos = view.collateral[0];
    assert.strictEqual(pos.mayAccrue, false, 'accrual no longer moves the credit line, so it is not a caveat');

    const over = pos.withdrawable + E('0.1');
    const p = planAction('withdrawCollateral', { positionId: pos.id, amount: over }, ctxFor(view));
    assert.strictEqual(p.ok, false);
    assert.strictEqual(p.code, 'COLLATERAL_BACKS_OPEN_CREDIT');
    assert.ok(await refusedByChain(() => rp.connect(buyer).withdrawCollateral(pos.id, over)),
      'the chain refuses it too, which is what makes the rejection right');

    // And the ceiling itself goes through.
    const exact = planAction('withdrawCollateral', { positionId: pos.id, amount: pos.withdrawable }, ctxFor(view));
    assert.strictEqual(exact.ok, true);
    assert.strictEqual((await execute(exact, buyer)).status, 1);
  });

  it('refusedByChain reports false for a call that succeeds', async () => {
    // Guards the guard. Every rejection test in this section asserts refusedByChain returns true,
    // so a helper that returned true unconditionally would make all of them pass while proving
    // nothing at all.
    assert.strictEqual(
      await refusedByChain(() => rp.connect(buyer).depositETHCollateral(false, { value: E('2') })),
      false
    );
  });

  it('a rejection the contract would have accepted is the failure mode this suite exists to catch', async () => {
    // The positive control for part 3. Fund the pool so the same agreement that was NOT_READY above
    // becomes payable, and require the preflight to let it through. Without this test, a preflight
    // that rejected everything would pass every other assertion in this section.
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), AUTO);
    await execute(planAction('fundAutoPayment', { amount: E('2') }, ctxFor(await buyerView())), buyer);

    const p = planAction('payInstallment', { agreementId: id }, ctxFor(await buyerView()));
    assert.strictEqual(p.ok, true, 'the pool now covers it, so the preflight must not block it');
    const receipt = await execute(p, buyer);
    assert.strictEqual(receipt.status, 1);
  });

  // --- the contract fact that makes `value` load-bearing ----------------------

  it('ETH attached to a Collateral payment is accepted by the chain and credited to nobody', async () => {
    // Proof for the rule the planner enforces, and the reason `value` is computed rather than
    // defaulted. This is the transaction a UI that attaches the installment amount to every Pay
    // button would send, and it does not revert: the ETH lands in the contract, the buyer's
    // collateral is still drawn for the full installment on top of it, and no function on RelicPay
    // can retrieve the difference.
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), COLLATERAL);

    const collateralBefore = (await buyerView()).totalCollateral;
    const sellerCreditBefore = await rp.getSellerBalance(seller.address);
    const contractBefore = await contractEth();

    const receipt = await (await rp.connect(buyer).processPayment(id, 1, { value: E('1') })).wait();
    assert.strictEqual(receipt.status, 1, 'it does not revert, which is exactly the problem');

    const after = await buyerView();
    assert.strictEqual(after.agreements.find((x) => x.id === id).paidInstallments, 1);
    assert.strictEqual(
      collateralBefore - after.totalCollateral,
      E('1'),
      'the collateral draw took the whole installment, as if no ETH had been sent'
    );
    assert.strictEqual(
      (await rp.getSellerBalance(seller.address)) - sellerCreditBefore,
      E('1'),
      'and the seller is credited once, from the collateral, not twice'
    );

    // The buyer paid 1 ETH out of pocket and 1 ETH out of collateral for a 1 ETH installment. The
    // contract is holding the extra with nothing pointing at it.
    assert.strictEqual(
      (await contractEth()) - contractBefore,
      E('1'),
      'the attached ETH is still sitting in the contract, owed to no one'
    );

    // And the planner never builds that transaction.
    const planned = planAction('payInstallment', { agreementId: id }, ctxFor(await buyerView()));
    assert.strictEqual(planned.ok, true);
    assert.strictEqual(planned.steps[planned.steps.length - 1].request.value, 0n);
  });
});

}
