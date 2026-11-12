// Tests for the dashboard control surface (dashboard/lib/panels.js) and the app that renders it.
//
// v2 only, same reasoning as the other dashboard tests: the dashboard is a v2 artifact and legacy/
// is the frozen spec, so the legacy run stays at exactly 51.
//
// Part c2 of the roadmap item wires the write layer into React, and the suite cannot render React.
// That constraint is the whole design: everything a component decides was pushed into panels.js as
// a value, so what is left in JSX is markup, and what is left to check about the JSX is import
// rules. The two halves below are exactly that split.
//
// 1. The control surface. Which controls exist for a viewer, which are disabled, and the sentence
//    saying why. Run with no chain for the rules that are pure, then against ganache on a real
//    dashboard, because the interesting disabled states (nothing to withdraw, grace period still
//    running, pool too small) are all derived from chain state and a hand-built fixture can assert
//    them into existence.
//
// 2. The app's structure. The part c2 additions have to obey part b2's rules, and they widen one of
//    them: a client component may now import writes/panels/abis, because encoding a transaction
//    needs the ABI, while client/reader/tokens/present stay server-only. That widening is written
//    down as an assertion here rather than left as an absence.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPublicClient, custom } = require('viem');

const { setup, deploy, findEvent, E, IMPL, ethers, warp } = require('./helpers');
const { createRelicPayReader } = require('../dashboard/lib/reader');
const { loadDashboard } = require('../dashboard/lib/client');
const { SCOPES, agreementScope, autoBalanceOf, sellerBalanceOf, planAction } = require('../dashboard/lib/writes');
const {
  DISABLED_PRECEDENCE,
  SELF_SCOPED,
  agreementPanel,
  controlSurface,
  describeSteps,
  livePath,
  panelById,
  pendingSetOf,
  reloadAfter,
} = require('../dashboard/lib/panels');

const APP = path.join(__dirname, '..', 'dashboard', 'app');
const DAY = 86400n;

const MANUAL = 0;
const AUTO = 1;
const COLLATERAL = 2;

const ALICE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const BOB = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const RP = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const TOKEN = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function sourceFiles() {
  return walk(APP).filter((f) => /\.(jsx?|mjs)$/.test(f));
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function isClientComponent(text) {
  return /^\s*(['"])use client\1/m.test(text.split('\n').slice(0, 5).join('\n'));
}

/** A minimal presented buyer view, for the rules that do not need a chain. */
function buyerFixture(over = {}) {
  return {
    role: 'buyer',
    address: ALICE,
    contract: RP,
    at: { blockNumber: '100', timestamp: '1700000000' },
    credit: {},
    collateral: [],
    autoPayment: { enabled: false, ethBalance: { raw: '1000' }, tokenBalances: [] },
    agreements: [],
    summary: {},
    ...over,
  };
}

function sellerFixture(over = {}) {
  return {
    role: 'seller',
    address: ALICE,
    contract: RP,
    at: { blockNumber: '100', timestamp: '1700000000' },
    balances: { eth: { raw: '0' }, tokens: [] },
    settlementPreference: {},
    agreements: [],
    summary: {},
    ...over,
  };
}

function control(surface, id) {
  const c = surface.byId[id];
  assert.ok(c, `no control ${id} on this surface; have ${Object.keys(surface.byId).join(', ')}`);
  return c;
}

if (IMPL === 'v2') {

describe('Dashboard control surface [v2]', function () {
  it('gives a buyer collateral and auto-payment panels, and a seller balance and preference ones', () => {
    const buyer = controlSurface(buyerFixture(), { from: ALICE });
    assert.deepStrictEqual(buyer.panels.map((p) => p.id), ['collateral', 'autoPayment']);

    const seller = controlSurface(sellerFixture(), { from: ALICE });
    assert.deepStrictEqual(seller.panels.map((p) => p.id), ['balances', 'preference']);
  });

  it('refuses every control when no wallet is connected, and says so', () => {
    const surface = controlSurface(buyerFixture({ collateral: [positionFixture()] }), { from: null });
    assert.strictEqual(surface.connected, false);
    for (const c of Object.values(surface.byId)) {
      assert.strictEqual(c.disabled, true, `${c.id} should be disabled with no wallet`);
      assert.strictEqual(c.code, 'NOT_CONNECTED');
      assert.match(c.reason, /connect a wallet/i);
    }
  });

  // --- the rule part c2 adds -------------------------------------------------

  it('refuses msg.sender-scoped actions to a viewer who is not the subject of the page', () => {
    // The point of this test is that these calls would *succeed*, not revert. Every one of them
    // reads msg.sender and takes no account argument, so on someone else's dashboard the button is
    // live, correctly encoded, and silently operates on the connected wallet's own account. The
    // reload then re-renders the subject's unchanged figures, which reads as a no-op.
    // Carries a collateral position so the per-position withdraw controls are in the loop too. On
    // someone else's page that one is not a silent success but a guaranteed revert: the id on
    // screen is keccak(subject, asset, tag) and the call keys into collateralPositions[msg.sender],
    // so the lookup lands on an empty position of the viewer's. Same refusal, different reason.
    const surface = controlSurface(
      buyerFixture({ address: ALICE, collateral: [positionFixture()] }),
      { from: BOB }
    );
    assert.strictEqual(surface.viewingSelf, false);
    assert.ok(
      Object.keys(surface.byId).some((id) => id.startsWith('collateral.withdraw.')),
      'the withdraw controls have to be in this loop for it to cover them'
    );

    for (const c of Object.values(surface.byId)) {
      assert.strictEqual(c.disabled, true, `${c.id} is live on someone else's dashboard`);
      assert.strictEqual(c.code, 'NOT_YOUR_ACCOUNT');
      assert.match(c.reason, /connected wallet, not on the address this page is showing/);
    }
  });

  it('still offers the permissionless agreement actions to a viewer who is not the subject', () => {
    // The converse, and it matters as much: ADR-002 decided that paying someone else's installment
    // is allowed with a note rather than refused, because refusing invents a rule the protocol does
    // not have. Those actions name their agreement by id, so the page and the transaction agree
    // about the subject and there is nothing to protect anyone from.
    assert.ok(!SELF_SCOPED.has('payInstallment'));
    assert.ok(!SELF_SCOPED.has('processOverduePayments'));
    assert.ok(!SELF_SCOPED.has('triggerDefault'));
    // withdrawCollateral also names a position by id and is still self-scoped, which is the
    // exception that proves the rule above is about the subject and not about the argument list:
    // the id keys into collateralPositions[msg.sender], so on a stranger's page the id belongs to
    // one account and the lookup to another.
    assert.ok(SELF_SCOPED.has('withdrawCollateral'));
    assert.strictEqual(SELF_SCOPED.size, 8);
  });

  // --- one withdraw control per collateral position ---------------------------

  function positionFixture(over = {}) {
    return {
      id: '0x' + 'cd'.repeat(32),
      collateralType: 'ETH',
      tokenAddress: null,
      amount: { raw: '1000' },
      principal: { raw: '1000' },
      withdrawable: { raw: '600' },
      isFloor: false,
      ...over,
    };
  }

  it('offers a withdraw control per position, not one control with a picker', () => {
    const a = positionFixture({ id: '0x' + 'aa'.repeat(32) });
    const b = positionFixture({ id: '0x' + 'bb'.repeat(32), withdrawable: { raw: '25' } });
    const surface = controlSurface(buyerFixture({ collateral: [a, b] }), { from: ALICE });

    const panel = panelById(surface, 'collateral');
    const withdraws = panel.controls.filter((c) => c.action === 'withdrawCollateral');
    assert.strictEqual(withdraws.length, 2);
    assert.deepStrictEqual(withdraws.map((c) => c.positionId), [a.id, b.id]);
    // The ceiling is per position, so a picker would put the number the user needs one selection
    // away from the field they type it into.
    assert.deepStrictEqual(withdraws.map((c) => c.withdrawable), ['600', '25']);
  });

  it('gives each position its own form state, so one amount does not fill in the others', () => {
    // Every one of these controls carries the same action name, so form state keyed by action
    // would make them one field. The control the user was not looking at is the one whose plan
    // would then be wrong, which is a withdrawal of the wrong size from the wrong position.
    const a = positionFixture({ id: '0x' + 'aa'.repeat(32) });
    const b = positionFixture({ id: '0x' + 'bb'.repeat(32) });
    const surface = controlSurface(buyerFixture({ collateral: [a, b] }), {
      from: ALICE,
      inputs: { [`withdrawCollateral:${a.id}`]: { amount: '100' } },
    });

    const first = control(surface, `collateral.withdraw.${a.id}`);
    const second = control(surface, `collateral.withdraw.${b.id}`);
    assert.notStrictEqual(first.inputKey, second.inputKey);
    assert.strictEqual(first.disabled, false, 'the position with an amount typed is ready');
    assert.deepStrictEqual(first.plan.steps[0].request.args, [a.id, 100n]);
    assert.strictEqual(second.code, 'NEEDS_INPUT', 'the other position is still an empty field');
  });

  it('says whether the ceiling it shows is exact or a floor', () => {
    // The roadmap item's own caveat. getWithdrawableCollateral does not settle pending yield, so on
    // a position with an accrual waiting it under-reports, and calling it a maximum in the help
    // text would be a promise the contract does not make.
    const exact = positionFixture({ id: '0x' + 'aa'.repeat(32), isFloor: false });
    const floor = positionFixture({ id: '0x' + 'bb'.repeat(32), isFloor: true });
    const surface = controlSurface(buyerFixture({ collateral: [exact, floor] }), { from: ALICE });

    const exactHelp = control(surface, `collateral.withdraw.${exact.id}`).fields[0].help;
    const floorHelp = control(surface, `collateral.withdraw.${floor.id}`).fields[0].help;
    assert.match(exactHelp, /up to 600/i);
    assert.match(floorHelp, /at least 600/i);
    assert.match(floorHelp, /floor and not an exact maximum/i);
    assert.strictEqual(control(surface, `collateral.withdraw.${floor.id}`).maxIsFloor, true);
  });

  it('renders each of the three withdrawal refusals as its own sentence', () => {
    // The point of planning this action rather than just encoding it. Three reverts, three fixes,
    // three sentences: ask for less, that part is not yours, pay the agreement down.
    const pos = positionFixture({
      amount: { raw: '1000' },
      principal: { raw: '800' },
      withdrawable: { raw: '300' },
    });
    const at = (amount) =>
      control(
        controlSurface(buyerFixture({ collateral: [pos] }), {
          from: ALICE,
          inputs: { [`withdrawCollateral:${pos.id}`]: { amount } },
        }),
        `collateral.withdraw.${pos.id}`
      );

    const tooMuch = at('1001');
    const notYours = at('900');
    const encumbered = at('500');
    assert.strictEqual(tooMuch.code, 'INSUFFICIENT_COLLATERAL');
    assert.strictEqual(notYours.code, 'EXCEEDS_WITHDRAWABLE_PRINCIPAL');
    assert.strictEqual(encumbered.code, 'COLLATERAL_BACKS_OPEN_CREDIT');
    assert.strictEqual(new Set([tooMuch.reason, notYours.reason, encumbered.reason]).size, 3);
  });

  // --- pending is a scope, not a spinner -------------------------------------

  it('a pending scope disables its own controls and leaves the rest of the page alive', () => {
    const surface = controlSurface(buyerFixture(), {
      from: ALICE,
      pending: [SCOPES.AUTO_PAYMENT],
      inputs: { depositEthCollateral: { amount: '5000' } },
    });

    const toggle = control(surface, 'autoPayment.toggle');
    assert.strictEqual(toggle.pending, true);
    assert.strictEqual(toggle.disabled, true);
    assert.strictEqual(toggle.code, 'PENDING');

    const deposit = control(surface, 'collateral.depositEth');
    assert.strictEqual(deposit.pending, false, 'a pending pool must not take the collateral form down');
    assert.strictEqual(deposit.disabled, false);
    assert.ok(deposit.plan && deposit.plan.ok);
  });

  it('accepts in-flight plans as well as scope names, so the runner need not spell scopes itself', () => {
    const plan = planAction('setAutoPayment', { enabled: true }, { relicPay: RP, view: buyerFixture(), from: ALICE });
    const fromPlans = pendingSetOf([plan]);
    assert.ok(fromPlans.has(SCOPES.AUTO_PAYMENT));

    const surface = controlSurface(buyerFixture(), { from: ALICE, pending: [plan] });
    assert.strictEqual(control(surface, 'autoPayment.toggle').code, 'PENDING');
  });

  it('a pending payment on one agreement leaves the other agreement usable', () => {
    const view = buyerFixture({
      agreements: [
        { id: '0xaa', state: 'Active', buyer: ALICE, seller: BOB, installmentCount: 3, paidInstallments: 0,
          paymentMethod: { label: 'Manual' }, schedule: [{ amount: { raw: '100' } }], settlementToken: null },
        { id: '0xbb', state: 'Active', buyer: ALICE, seller: BOB, installmentCount: 3, paidInstallments: 0,
          paymentMethod: { label: 'Manual' }, schedule: [{ amount: { raw: '100' } }], settlementToken: null },
      ],
    });

    const surface = controlSurface(view, { from: ALICE, pending: [agreementScope('0xaa')] });
    assert.strictEqual(control(surface, 'agreement.0xaa.pay').disabled, true);
    assert.strictEqual(control(surface, 'agreement.0xaa.pay').code, 'PENDING');
    assert.strictEqual(control(surface, 'agreement.0xbb.pay').disabled, false);
  });

  // --- which reason gets shown ----------------------------------------------

  it('shows the reason that will not clear on its own when several apply at once', () => {
    // Three reasons are true here: the viewer is not the subject, a write is in flight, and the
    // amount field is empty. Telling someone to wait for a transaction, when the button will still
    // be dead afterwards, sends them to watch a spinner for a problem the spinner cannot fix.
    const surface = controlSurface(buyerFixture({ address: ALICE }), {
      from: BOB,
      pending: [SCOPES.COLLATERAL, SCOPES.CREDIT],
      inputs: {},
    });
    const c = control(surface, 'collateral.depositEth');
    assert.strictEqual(c.code, 'NOT_YOUR_ACCOUNT');
    assert.strictEqual(
      DISABLED_PRECEDENCE.indexOf('NOT_YOUR_ACCOUNT') < DISABLED_PRECEDENCE.indexOf('PENDING'),
      true
    );
  });

  it('pending outranks a rejection, because a rejection is computed from figures in flight', () => {
    const view = buyerFixture({ autoPayment: { enabled: false, ethBalance: { raw: '10' }, tokenBalances: [] } });
    const surface = controlSurface(view, {
      from: ALICE,
      pending: [SCOPES.AUTO_PAYMENT],
      inputs: { withdrawAutoPayment: { amount: '999999' } }, // would reject on the pool balance
    });
    assert.strictEqual(control(surface, 'autoPayment.withdraw').code, 'PENDING');
  });

  it('an untouched form is NEEDS_INPUT, not a zero-amount rejection', () => {
    // writes.js says "Enter an amount to deposit" for a typed 0, which is right for a typed 0 and
    // wrong for a field nobody has visited: it paints a rejection on an empty form on first render.
    const empty = controlSurface(buyerFixture(), { from: ALICE, inputs: {} });
    const c = control(empty, 'collateral.depositEth');
    assert.strictEqual(c.code, 'NEEDS_INPUT');
    assert.match(c.reason, /enter amount first/i);

    const zero = controlSurface(buyerFixture(), { from: ALICE, inputs: { depositEthCollateral: { amount: '0' } } });
    assert.strictEqual(control(zero, 'collateral.depositEth').code, 'ZERO_AMOUNT');
  });

  it('passes a planner rejection through as its own sentence, unrewritten', () => {
    const view = buyerFixture({ autoPayment: { enabled: false, ethBalance: { raw: '10' }, tokenBalances: [] } });
    const surface = controlSurface(view, { from: ALICE, inputs: { withdrawAutoPayment: { amount: '50' } } });
    const c = control(surface, 'autoPayment.withdraw');
    assert.strictEqual(c.code, 'INSUFFICIENT_POOL_BALANCE');
    assert.strictEqual(c.reason, 'The pool holds 10 base units and this would withdraw 50.');
  });

  it('turns a planner throw into a disabled control rather than an exception', () => {
    // Half of what a planner throws on arrives from a form: a malformed address, a non-integer
    // amount. Those must not reach an error boundary and blank the page.
    const surface = controlSurface(buyerFixture(), {
      from: ALICE,
      inputs: { depositTokenCollateral: { token: 'not-an-address', amount: '5' } },
    });
    const c = control(surface, 'collateral.depositToken');
    assert.strictEqual(c.disabled, true);
    assert.strictEqual(c.code, 'INVALID_INPUT');
    assert.match(c.reason, /must be an address/);
  });

  it('labels the auto-payment toggle by what it will do, not by what is true now', () => {
    const off = controlSurface(buyerFixture(), { from: ALICE });
    assert.strictEqual(control(off, 'autoPayment.toggle').label, 'Turn on auto-payment');
    assert.strictEqual(control(off, 'autoPayment.toggle').plan.steps[0].request.args[0], true);

    const on = controlSurface(
      buyerFixture({ autoPayment: { enabled: true, ethBalance: { raw: '0' }, tokenBalances: [] } }),
      { from: ALICE }
    );
    assert.strictEqual(control(on, 'autoPayment.toggle').label, 'Turn off auto-payment');
    assert.strictEqual(control(on, 'autoPayment.toggle').plan.steps[0].request.args[0], false);
  });

  it('offers the currencies the view actually holds, plus ETH', () => {
    const view = buyerFixture({
      autoPayment: {
        enabled: false,
        ethBalance: { raw: '1' },
        tokenBalances: [{ tokenAddress: TOKEN, balance: { raw: '5', symbol: 'UNI', currency: { known: true } } }],
      },
    });
    const surface = controlSurface(view, { from: ALICE });
    const field = control(surface, 'autoPayment.fund').fields.find((f) => f.name === 'token');
    assert.deepStrictEqual(field.options, [
      { value: null, label: 'ETH' },
      { value: TOKEN, label: 'UNI' },
    ]);
  });

  // --- the two-step render ---------------------------------------------------

  it('describes an approve-then-call plan as two steps, with the approval aimed at the token', () => {
    // A UI that renders one address for the whole plan shows an approval pointed at RelicPay, which
    // is not what the wallet is about to ask the user to sign.
    const surface = controlSurface(buyerFixture(), {
      from: ALICE,
      inputs: { depositTokenCollateral: { token: TOKEN, amount: '500' } },
    });
    const c = control(surface, 'collateral.depositToken');
    assert.strictEqual(c.steps.length, 2);
    assert.deepStrictEqual(c.steps.map((s) => [s.index, s.of, s.kind]), [[1, 2, 'approve'], [2, 2, 'call']]);
    assert.strictEqual(c.steps[0].target.toLowerCase(), TOKEN.toLowerCase());
    assert.notStrictEqual(c.steps[0].target.toLowerCase(), RP.toLowerCase());
    assert.strictEqual(c.steps[1].target.toLowerCase(), RP.toLowerCase());
  });

  it('renders step metadata without BigInt, since it crosses into React props', () => {
    const surface = controlSurface(buyerFixture(), {
      from: ALICE,
      inputs: { depositEthCollateral: { amount: '5000' } },
    });
    const steps = control(surface, 'collateral.depositEth').steps;
    assert.strictEqual(steps[0].value, '5000');
    assert.doesNotThrow(() => JSON.stringify(steps));
  });

  it('describeSteps is empty for a rejected plan, so a disabled control renders no step list', () => {
    assert.deepStrictEqual(describeSteps({ ok: false, code: 'X' }), []);
    assert.deepStrictEqual(describeSteps(null), []);
  });

  // --- the reload contract ---------------------------------------------------

  it('reloads to the receipt block on the same role and address', () => {
    const plan = planAction('setAutoPayment', { enabled: true }, { relicPay: RP, view: buyerFixture(), from: ALICE });
    const next = reloadAfter(plan, { blockNumber: 4321, status: 'success' }, { role: 'buyer', address: ALICE });
    assert.strictEqual(next.reload, true);
    assert.strictEqual(next.blockNumber, '4321');
    assert.strictEqual(next.path, `/buyer?address=${ALICE}&at=4321`);
    assert.deepStrictEqual(next.scopes, [SCOPES.AUTO_PAYMENT]);
  });

  it('does not reload on a reverted receipt', () => {
    const plan = planAction('setAutoPayment', { enabled: true }, { relicPay: RP, view: buyerFixture(), from: ALICE });
    const next = reloadAfter(plan, { blockNumber: 9, status: 0 }, { role: 'buyer', address: ALICE });
    assert.strictEqual(next.reload, false);
    assert.strictEqual(next.path, null);
    assert.strictEqual(next.status, 'reverted');
  });

  it('offers a way back to the latest block, which the pinned reload makes necessary', () => {
    // Without this the reload is a one-way door: the URL after a payment names a fixed block, the
    // page never advances again, and that URL is the one someone bookmarks or sends to their seller.
    assert.strictEqual(livePath({ role: 'buyer', address: ALICE }), `/buyer?address=${ALICE}`);
    assert.ok(!livePath({ role: 'seller', address: ALICE }).includes('at='));
  });
});

describe('Dashboard control surface against a live chain [v2]', function () {
  this.timeout(180000);

  let s, owner, seller, buyer, rp, rpAddr, registry, nft, usd, publicClient, reader;

  async function makeViemClient(provider) {
    const chainId = Number(await provider.send('eth_chainId', []));
    return createPublicClient({
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

  async function send(request, signer) {
    const c = new ethers.Contract(request.address, request.abi, signer);
    const overrides = request.value === undefined || request.value === 0n ? {} : { value: request.value };
    const tx = await c[request.functionName](...request.args, overrides);
    return tx.wait();
  }

  /** Run a control's plan exactly as the runner will: every step, in order. */
  async function runControl(c, signer) {
    assert.strictEqual(c.disabled, false, `control ${c.id} was disabled: ${c.reason || ''}`);
    let last;
    for (const step of c.plan.steps) last = await send(step.request, signer);
    return last;
  }

  beforeEach(async () => {
    s = await setup();
    [owner, seller, buyer] = s.signers;
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

  function presentedView(who, role) {
    return loadDashboard(ethers.getAddress(who.address), {
      role,
      network: 'local',
      transport: custom({ request: ({ method, params }) => s.provider.send(method, params ?? []) }),
      env: { RPC_URL: 'http://unused.invalid', RELICPAY_ADDRESS: rpAddr },
    });
  }

  async function giveCredit(who, amount) {
    await (await rp.connect(who).depositETHCollateral(false, { value: amount })).wait();
  }

  async function createAgreement(total, method, over = {}) {
    const rc = await (await nft.connect(seller).mint(seller.address)).wait();
    const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
    await (await nft.connect(seller).approve(rpAddr, tokenId)).wait();
    const p = Object.assign({ count: 3n, interval: 30n * DAY, grace: 7n * DAY }, over);
    const tx = await rp.createAgreementWithRWA(
      seller.address, buyer.address, total, p.count, p.interval, p.grace, method,
      {
        physicalId: 'IBG-OPTIC-001',
        nftContract: nft.target,
        tokenId,
        metadataURI: 'ipfs://relic/1',
        ownershipTransferred: false,
        currentOwner: seller.address,
      }
    );
    return findEvent(await tx.wait(), rp, 'AgreementCreated').agreementId;
  }

  // The app builds its surface from the presented view, so every test here does too. That is the
  // shape part c2 found the balance-lookup bug in.

  it('a control planned from a presented view sends a transaction the chain accepts', async () => {
    const view = await presentedView(buyer, 'buyer');
    const surface = controlSurface(view, {
      from: ethers.getAddress(buyer.address),
      inputs: { depositEthCollateral: { amount: E('2').toString(), stakeForYield: false } },
    });

    await runControl(control(surface, 'collateral.depositEth'), buyer);

    const after = await presentedView(buyer, 'buyer');
    assert.strictEqual(after.collateral.length, 1);
    assert.strictEqual(after.collateral[0].amount.raw, E('2').toString());
  });

  it('reads a token pool balance out of the presented view, which the planner could not before', async () => {
    // The regression this test exists for: present.js renders these balances as an array of
    // {tokenAddress, balance} while the reader returns an object keyed by address, and writes.js
    // only handled the keyed form. An array's keys are '0','1', so the lookup missed, the balance
    // came back null, and null is the documented "not supplied" case that skips the check. Every
    // token balance preflight was live in this suite and absent in the browser, which is the only
    // place it is for.
    const usdAddr = ethers.getAddress(await usd.getAddress());
    await (await rp.connect(owner).authorizeSettlementToken(usdAddr, true)).wait();
    await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
    await (await usd.mint(buyer.address, E('100'))).wait();
    await (await usd.connect(buyer).approve(rpAddr, E('100'))).wait();
    await (await rp.connect(buyer).depositAutoPaymentTokens(usdAddr, E('10'))).wait();
    // The reader discovers which tokens to ask about from the settlement currency on the buyer's
    // agreements, so a pool balance in a token they have no agreement in is invisible to both
    // shapes. One USD-settled agreement is what puts this token on the dashboard at all.
    await giveCredit(buyer, E('10'));
    await createAgreement(E('3'), MANUAL);

    const raw = await reader.getBuyerDashboard(ethers.getAddress(buyer.address));
    const presented = await presentedView(buyer, 'buyer');

    assert.strictEqual(autoBalanceOf(raw, usdAddr), E('10'), 'reader shape');
    assert.strictEqual(autoBalanceOf(presented, usdAddr), E('10'), 'presented shape');

    const surface = controlSurface(presented, {
      from: ethers.getAddress(buyer.address),
      inputs: { withdrawAutoPayment: { token: usdAddr, amount: E('50').toString() } },
    });
    const c = control(surface, 'autoPayment.withdraw');
    assert.strictEqual(c.code, 'INSUFFICIENT_POOL_BALANCE', 'the preflight has to fire on the app’s view shape');

    // And the converse: the chain agrees that the refused withdrawal really would have failed.
    let refused = false;
    try {
      const receipt = await (await rp.connect(buyer).withdrawAutoPaymentTokens(usdAddr, E('50'))).wait();
      refused = receipt.status === 0;
    } catch (e) {
      refused = /revert|VM Exception|status|estimate/i.test(String(e && e.message));
    }
    assert.strictEqual(refused, true, 'a rejection has to name a condition that really does revert');
  });

  it('reads a seller token balance out of the presented view too', async () => {
    const usdAddr = ethers.getAddress(await usd.getAddress());
    await (await rp.connect(owner).authorizeSettlementToken(usdAddr, true)).wait();
    await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
    await (await usd.mint(buyer.address, E('100'))).wait();
    await (await usd.connect(buyer).approve(rpAddr, E('100'))).wait();
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);
    await (await rp.connect(buyer).processPayment(id, 1)).wait();

    const presented = await presentedView(seller, 'seller');
    assert.ok(sellerBalanceOf(presented, usdAddr) > 0n, 'the presented seller balance must be readable');

    const surface = controlSurface(presented, {
      from: ethers.getAddress(seller.address),
      inputs: { withdrawSellerBalance: { token: usdAddr } },
    });
    await runControl(control(surface, 'balances.withdraw'), seller);
    assert.ok((await usd.balanceOf(seller.address)) > 0n, 'the proceeds reached the seller');
  });

  it('disables the seller withdrawal with the contract’s own reason when there is nothing to take', async () => {
    const view = await presentedView(seller, 'seller');
    const surface = controlSurface(view, { from: ethers.getAddress(seller.address) });
    const c = control(surface, 'balances.withdraw');
    assert.strictEqual(c.disabled, true);
    assert.strictEqual(c.code, 'NOTHING_TO_WITHDRAW');

    // withdrawSellerBalance requires a strictly positive balance, so this is the seller's most
    // common click on a page showing them zero. Confirm the chain really would refuse it.
    let refused = false;
    try {
      const receipt = await (await rp.connect(seller).withdrawSellerBalance()).wait();
      refused = receipt.status === 0;
    } catch (e) {
      refused = /revert|VM Exception|status|estimate/i.test(String(e && e.message));
    }
    assert.strictEqual(refused, true);
  });

  it('offers the buyer a pay button per agreement and defaults it to the next installment', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);

    const view = await presentedView(buyer, 'buyer');
    const surface = controlSurface(view, { from: ethers.getAddress(buyer.address) });
    const panel = agreementPanel(surface, id);
    assert.ok(panel, 'each agreement gets its own panel');
    assert.deepStrictEqual(panel.scopes, [agreementScope(id)]);

    const pay = panel.controls[0];
    assert.strictEqual(pay.label, 'Pay installment 1');
    assert.strictEqual(pay.disabled, false);
    await runControl(pay, buyer);

    const after = await presentedView(buyer, 'buyer');
    assert.strictEqual(after.agreements.find((a) => a.id === id).paidInstallments, 1);

    const next = controlSurface(after, { from: ethers.getAddress(buyer.address) });
    assert.strictEqual(agreementPanel(next, id).controls[0].label, 'Pay installment 2');
  });

  it('disables the seller default button until the grace period has actually expired', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);

    const before = await presentedView(seller, 'seller');
    const early = agreementPanel(controlSurface(before, { from: ethers.getAddress(seller.address) }), id)
      .controls.find((c) => c.action === 'triggerDefault');
    assert.strictEqual(early.disabled, true);
    assert.strictEqual(early.code, 'GRACE_PERIOD_ACTIVE');

    await warp(40n * DAY);

    const after = await presentedView(seller, 'seller');
    const late = agreementPanel(controlSurface(after, { from: ethers.getAddress(seller.address) }), id)
      .controls.find((c) => c.action === 'triggerDefault');
    // The one rejection on this dashboard that clears with no transaction at all, purely because
    // time passed. A surface that cached its verdict would leave this button dead forever.
    assert.strictEqual(late.disabled, false, 'the same control must come back enabled after the warp');
    await runControl(late, seller);

    const defaulted = await presentedView(seller, 'seller');
    assert.strictEqual(defaulted.agreements.find((a) => a.id === id).state, 'Defaulted');
  });

  it('refuses the default button to a buyer looking at the same agreement', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);
    await warp(40n * DAY);

    const sellerSurface = controlSurface(await presentedView(seller, 'seller'), {
      from: ethers.getAddress(buyer.address), // the buyer, viewing the seller's dashboard
    });
    const c = agreementPanel(sellerSurface, id).controls.find((x) => x.action === 'triggerDefault');
    assert.strictEqual(c.disabled, true);
    assert.strictEqual(c.code, 'NOT_THE_SELLER');
  });

  it('carries the pool-funded note so the UI can say no funds are attached', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), COLLATERAL);

    const view = await presentedView(buyer, 'buyer');
    const surface = controlSurface(view, { from: ethers.getAddress(buyer.address) });
    const pay = agreementPanel(surface, id).controls[0];
    assert.ok(pay.notes.includes('pool-funded'));
    // One step, which Actions.jsx renders as a bare button rather than a numbered list; the list
    // exists to warn that a click will produce two wallet prompts, and here it produces one.
    assert.strictEqual(pay.steps.length, 1);
    assert.strictEqual(pay.steps[0].value, '0');
    assert.strictEqual(pay.plan.steps[0].request.value, 0n, 'ETH attached here would be destroyed');
  });

  it('notes that the payer is not the buyer rather than refusing the payment', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);

    const view = await presentedView(buyer, 'buyer');
    const surface = controlSurface(view, { from: ethers.getAddress(owner.address) });
    const pay = agreementPanel(surface, id).controls[0];
    assert.strictEqual(pay.disabled, false, 'the protocol allows this, so the dashboard must not invent a rule');
    assert.ok(pay.notes.includes('payerIsNotBuyer'));
  });

  it('the reload path renders the transaction it was pinned to', async () => {
    // ADR-002's postcondition, end to end through the surface: run a control, take the receipt,
    // ask reloadAfter where to go, and load that block. The effect has to be there.
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), MANUAL);

    const view = await presentedView(buyer, 'buyer');
    const surface = controlSurface(view, { from: ethers.getAddress(buyer.address) });
    const pay = agreementPanel(surface, id).controls[0];
    const receipt = await runControl(pay, buyer);

    const next = reloadAfter(pay.plan, { blockNumber: receipt.blockNumber, status: 'success' }, {
      role: 'buyer',
      address: ethers.getAddress(buyer.address),
    });
    assert.strictEqual(next.path, `/buyer?address=${ethers.getAddress(buyer.address)}&at=${receipt.blockNumber}`);

    const at = await loadDashboard(ethers.getAddress(buyer.address), {
      role: 'buyer',
      network: 'local',
      blockNumber: BigInt(next.blockNumber),
      transport: custom({ request: ({ method, params }) => s.provider.send(method, params ?? []) }),
      env: { RPC_URL: 'http://unused.invalid', RELICPAY_ADDRESS: rpAddr },
    });
    assert.strictEqual(at.agreements.find((a) => a.id === id).paidInstallments, 1);

    const before = await loadDashboard(ethers.getAddress(buyer.address), {
      role: 'buyer',
      network: 'local',
      blockNumber: BigInt(next.blockNumber) - 1n,
      transport: custom({ request: ({ method, params }) => s.provider.send(method, params ?? []) }),
      env: { RPC_URL: 'http://unused.invalid', RELICPAY_ADDRESS: rpAddr },
    });
    assert.strictEqual(before.agreements.find((a) => a.id === id).paidInstallments, 0,
      'one block earlier the payment genuinely is not there, which is why refetching on send is wrong');
  });
});

describe('Dashboard app write wiring [v2]', function () {
  // Structural, for the reason in this file's header: the suite cannot render React, so what is
  // checkable about the JSX is which modules it may import and where the islands are mounted.
  it('ships the write island, its runner and the pending registry', () => {
    for (const rel of [
      'app/write/Actions.jsx',
      'app/write/PendingScopes.jsx',
      'app/write/useActionRunner.js',
    ]) {
      assert.ok(fs.existsSync(path.join(APP, rel)), `dashboard/app/${rel} is missing`);
    }
  });

  it('keeps the reader off the client while allowing the write layer onto it', () => {
    // The one import rule part c2 widens, and it is widened deliberately rather than by accident:
    // encoding a transaction needs its ABI, and the wallet sends it, so writes/panels/abis belong
    // in the browser. client/reader/tokens/present still do not: those carry RPC_URL and the
    // eth_getLogs scan, which is what ADR-001 keeps on the server.
    let clientsImportingWrites = 0;
    for (const file of sourceFiles()) {
      const text = read(file);
      if (!isClientComponent(text)) continue;
      const rel = path.relative(APP, file);
      const readsChain = /(?:from|require\()\s*['"][^'"]*lib\/(client|reader|tokens|present)/.test(text);
      assert.ok(!readsChain, `${rel} is a client component reading chain state`);
      const importsServerOnly = /(?:^|\s)(?:import|require\()\s*\(?['"]server-only['"]/.test(text);
      assert.ok(!importsServerOnly, `${rel} is a client component importing server-only`);
      if (/from ['"][^'"]*lib\/(writes|panels)/.test(text)) clientsImportingWrites += 1;
    }
    assert.ok(clientsImportingWrites >= 1, 'the write island has to import the write layer somewhere');
  });

  it('puts no protocol rule in the components', () => {
    // Everything a control decides lives in panels.js, where it is tested. A component naming a
    // contract function, a payment method or an action code is a rule nothing checks.
    for (const rel of ['app/write/Actions.jsx', 'app/write/useActionRunner.js', 'app/write/PendingScopes.jsx']) {
      const text = read(path.join(APP, rel));
      const body = text
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      for (const forbidden of ['processPayment', 'depositETHCollateral', 'triggerDefault', 'withdrawSellerBalance']) {
        assert.ok(!body.includes(forbidden), `${rel} names the contract function ${forbidden}`);
      }
    }
  });

  it('mounts the pending registry above the whole tree, since a scope is page-wide', () => {
    const layout = read(path.join(APP, 'app', 'layout.jsx'));
    assert.match(layout, /PendingProvider/, 'the layout has to mount the pending registry');
    const providers = layout.indexOf('<Providers>');
    const pending = layout.indexOf('<PendingProvider>');
    assert.ok(providers >= 0 && pending > providers, 'wagmi has to wrap the pending registry, not the reverse');
  });

  it('sends every write through the runner, so nothing bypasses the pending registry', () => {
    for (const file of sourceFiles()) {
      const rel = path.relative(APP, file);
      if (rel === path.join('app', 'write', 'useActionRunner.js')) continue;
      const text = read(file);
      assert.ok(
        !/useWriteContract|useSendTransaction/.test(text),
        `${rel} sends transactions outside useActionRunner`
      );
    }
  });

  it('offers a way back to latest wherever the route is pinned', () => {
    // Otherwise the reload-at-receipt-block is a one-way door. See the note in Shell.jsx.
    const shell = read(path.join(APP, 'app', 'ui', 'Shell.jsx'));
    assert.match(shell, /livePath/);
    assert.match(shell, /parsed\.block/);
  });

  it('every relative import into ../lib still resolves', () => {
    let checked = 0;
    for (const file of sourceFiles()) {
      const text = read(file);
      for (const m of text.matchAll(/from ['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const target = path.resolve(path.dirname(file), m[1]);
        if (!/\/dashboard\/lib\//.test(target)) continue;
        assert.ok(fs.existsSync(target), `${path.relative(APP, file)} imports missing ${m[1]}`);
        checked += 1;
      }
    }
    assert.ok(checked >= 6, `expected the app to import the data layer, found ${checked} imports`);
  });
});

}
