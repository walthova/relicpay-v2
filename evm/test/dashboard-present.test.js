// Tests for the dashboard render model (dashboard/lib/present.js, tokens.js, client.js).
//
// v2 only, same reasoning as test/dashboard.test.js: the dashboard is a v2 artifact and legacy/ is
// the frozen spec, so the legacy run stays at exactly 51.
//
// The chain-backed half feeds real reader output through the presenter rather than hand-built
// fixtures. A fixture written by hand is written from the same misunderstanding as the code, so it
// agrees with it; the whole point of this layer is that a BigInt the reader added yesterday must
// fail here today, and only live output can catch that.

const assert = require('assert');
const { createPublicClient, custom } = require('viem');

const { setup, deploy, warp, findEvent, E, IMPL, ethers } = require('./helpers');
const {
  PresenterError,
  agreementTone,
  assertSerializable,
  humanDuration,
  presentAgreement,
  presentAmount,
  presentBps,
  presentBuyerDashboard,
  presentDuration,
  presentProtocolInfo,
  presentSellerDashboard,
  presentTime,
  sumByCurrency,
} = require('../dashboard/lib/present');
const {
  NATIVE,
  TokenError,
  createTokenRegistry,
  tokenMetaFrom,
  unknownToken,
} = require('../dashboard/lib/tokens');
const { createRelicPayReader } = require('../dashboard/lib/reader');
const { chainFor, createServerClient, loadDashboard, ClientError } = require('../dashboard/lib/client');

const DAY = 86400n;
const USDC = { symbol: 'USDC', name: 'USD Coin', decimals: 6 };

if (IMPL === 'v2') {

describe('Dashboard presenter, pure [v2]', function () {
  it('formats an amount in its own currency, not always in 18 decimals', () => {
    const wei = presentAmount(1500000000000000000n, NATIVE);
    assert.strictEqual(wei.display, '1.5');
    assert.strictEqual(wei.symbol, 'ETH');

    // The same integer is 1.5 trillion USDC. An 18-decimal assumption renders it as 0.0000015.
    const usdc = presentAmount(1500000n, { ...USDC, address: '0xabc', native: false });
    assert.strictEqual(usdc.display, '1.5');
    assert.strictEqual(usdc.decimals, 6);
    assert.strictEqual(usdc.raw, '1500000');
  });

  it('renders an unknown currency as nothing rather than a plausible number', () => {
    const a = presentAmount(3000000n, unknownToken('0xdead'));
    assert.strictEqual(a.display, null, 'no decimals means no number, never a guess at 18');
    assert.strictEqual(a.symbol, null);
    assert.strictEqual(a.currency.known, false);
    assert.strictEqual(a.raw, '3000000', 'the exact integer survives so the UI can show it and say so');
  });

  it('tokenMetaFrom treats the zero address and null alike as native ETH', () => {
    assert.strictEqual(tokenMetaFrom({}, null), NATIVE);
    assert.strictEqual(tokenMetaFrom({}, '0x' + '00'.repeat(20)), NATIVE);
    assert.strictEqual(tokenMetaFrom({}, '0xDEAD').known, false);
  });

  it('a metadata lookup is case insensitive, since deployments files are not checksummed', () => {
    const tokens = { '0xaabb': { ...USDC, address: '0xAABB', native: false } };
    assert.strictEqual(tokenMetaFrom(tokens, '0xAABB').decimals, 6);
    assert.strictEqual(tokenMetaFrom(tokens, '0xaAbB').decimals, 6);
  });

  it('a seed without decimals is rejected at construction, not at render time', () => {
    assert.throws(
      () => createTokenRegistry({ seed: { '0xabc': { symbol: 'X' } } }),
      TokenError
    );
  });

  it('durations render one coarse unit with past and future wording', () => {
    assert.strictEqual(humanDuration(0n), 'now');
    assert.strictEqual(humanDuration(90n), '1 minute');
    assert.strictEqual(humanDuration(2n * DAY), '2 days');
    assert.strictEqual(humanDuration(-2n * DAY), '2 days');

    assert.strictEqual(presentDuration(2n * DAY).relative, 'in 2 days');
    assert.strictEqual(presentDuration(-2n * DAY).relative, '2 days ago');
    assert.strictEqual(presentDuration(-2n * DAY).isPast, true);
    assert.strictEqual(presentDuration(0n).relative, 'now');
  });

  it('a timestamp is measured against the pinned block, never against wall clock', () => {
    const t = presentTime(2000n, 1000n);
    assert.strictEqual(t.unix, '2000');
    assert.strictEqual(t.in.seconds, '1000');
    assert.strictEqual(presentTime(2000n).in, null, 'no pin, no relative claim');
  });

  it('basis points keep the exact integer alongside the rendered percent', () => {
    assert.strictEqual(presentBps(2500n).percent, '25.00%');
    assert.strictEqual(presentBps(2505n).percent, '25.05%');
    assert.strictEqual(presentBps(10000n).percent, '100.00%');
    assert.strictEqual(presentBps(2500n).bps, '2500');
  });

  it('sums group by currency instead of adding USDC to wei', () => {
    const tokens = { '0xaa': { ...USDC, address: '0xAA', native: false } };
    const sums = sumByCurrency(
      [
        { settlementToken: null, outstanding: 1000000000000000000n },
        { settlementToken: null, outstanding: 500000000000000000n },
        { settlementToken: '0xAA', outstanding: 3000000n },
      ],
      (a) => a.outstanding,
      tokens
    );
    assert.strictEqual(sums.length, 2, 'two currencies, two totals, never one meaningless sum');
    const eth = sums.find((s) => s.tokenAddress === null);
    const usd = sums.find((s) => s.tokenAddress === '0xAA');
    assert.strictEqual(eth.total.display, '1.5');
    assert.strictEqual(eth.count, 2);
    assert.strictEqual(usd.total.display, '3');
  });

  it('assertSerializable names the path of a value React cannot send', () => {
    assert.throws(
      () => assertSerializable({ a: { b: [{ c: 1n }] } }),
      (e) => e instanceof PresenterError && /\$\.a\.b\[0\]\.c is a BigInt/.test(e.message)
    );
    assert.throws(() => assertSerializable({ d: new Date() }), /is a Date/);
    assert.throws(() => assertSerializable({ m: new Map() }), /is a Map/);
    assert.throws(() => assertSerializable({ u: undefined }), /is undefined/);
    assert.throws(() => assertSerializable({ f: () => 1 }), /is a function/);
    assert.throws(() => assertSerializable({ e: new Error('x') }), /instance/);
    assert.doesNotThrow(() => assertSerializable({ a: 1, b: 'x', c: null, d: [true] }));
  });

  it('an amount that is not an integer is an error, not NaN on the page', () => {
    assert.throws(() => presentAmount(1.5, NATIVE), PresenterError);
    assert.throws(() => presentAmount('abc', NATIVE), PresenterError);
    assert.strictEqual(presentAmount('1500000000000000000', NATIVE).display, '1.5');
  });

  it('tone escalates from ready, to warn, to danger', () => {
    const base = {
      state: 'Active',
      defaultable: false,
      overdueCount: 0,
      paymentMethod: { requiresBuyerTransaction: true },
      settlement: null,
    };
    assert.strictEqual(agreementTone(base), 'ok');
    assert.strictEqual(agreementTone({ ...base, overdueCount: 1 }), 'warn');
    assert.strictEqual(agreementTone({ ...base, defaultable: true }), 'danger');
    assert.strictEqual(agreementTone({ ...base, state: 'Defaulted' }), 'danger');
    assert.strictEqual(agreementTone({ ...base, state: 'Completed' }), 'ok');
    assert.strictEqual(
      agreementTone({
        ...base,
        paymentMethod: { requiresBuyerTransaction: false },
        settlement: { ready: false },
      }),
      'warn',
      'a pool-funded agreement that cannot cover its next payment is a warning, not a clean row'
    );
  });

  it('rejects an unknown network instead of silently reading the wrong chain', () => {
    assert.throws(() => chainFor('mainnetish'), ClientError);
    assert.strictEqual(chainFor('sepolia').id, 11155111);
  });

  it('refuses to build a client with no endpoint, and never reads NEXT_PUBLIC_RPC_URL', () => {
    assert.throws(() => createServerClient({ env: {} }), ClientError);
    assert.throws(
      () => createServerClient({ env: { NEXT_PUBLIC_RPC_URL: 'https://example.invalid' } }),
      ClientError,
      'the NEXT_PUBLIC_ prefix inlines a value into the browser bundle; an endpoint must not be'
    );
    assert.doesNotThrow(() => createServerClient({ env: { RPC_URL: 'https://example.invalid' } }));
  });
});

describe('Dashboard presenter against a live chain [v2]', function () {
  this.timeout(180000);

  let s, owner, seller, buyer, rp, nft, usd6, publicClient, reader, transport;

  async function makeViemClient(provider) {
    const chainId = Number(await provider.send('eth_chainId', []));
    transport = custom({ request: ({ method, params }) => provider.send(method, params ?? []) });
    return createPublicClient({
      cacheTime: 0,
      pollingInterval: 0,
      chain: {
        id: chainId,
        name: 'ganache',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [] } },
      },
      transport,
    });
  }

  beforeEach(async () => {
    s = await setup();
    [owner, seller, buyer] = s.signers;
    rp = await deploy('RelicPay', [], owner);
    nft = await deploy('MockNFT', [], owner);
    usd6 = await deploy('MockStablecoin', ['USD Coin', 'USDC', 6], owner);
    await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
    publicClient = await makeViemClient(s.provider);
    reader = createRelicPayReader({
      publicClient,
      addresses: { relicPay: ethers.getAddress(await rp.getAddress()) },
    });
  });

  async function giveCredit(who, amount) {
    await (await rp.connect(who).depositETHCollateral(false, { value: amount })).wait();
  }

  async function createAgreement(total, method, over = {}) {
    const rc = await (await nft.connect(seller).mint(seller.address)).wait();
    const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
    await (await nft.connect(seller).approve(await rp.getAddress(), tokenId)).wait();
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

  async function useStablecoin() {
    const addr = ethers.getAddress(await usd6.getAddress());
    await (await rp.authorizeSettlementToken(addr, true)).wait();
    await (await rp.connect(seller).setSettlementPreference(addr)).wait();
    return addr;
  }

  async function tokensFor(dashboard) {
    return createTokenRegistry({ publicClient }).loadForDashboard(dashboard);
  }

  it('a collateral position carries its two ceilings, presented in its own currency', async () => {
    // Three figures rather than one, because the gaps between them are the whole explanation when
    // a withdrawal is refused: amount includes reinvested yield, principal is the part that can
    // ever leave, and withdrawable is what is left after the credit line's claim on it.
    await giveCredit(buyer, E('10'));
    await createAgreement(E('4'), 0); // Manual, draws on the line

    const dashboard = await reader.getBuyerDashboard(ethers.getAddress(buyer.address));
    const view = presentBuyerDashboard(dashboard, { tokens: await tokensFor(dashboard) });
    assertSerializable(view);

    const pos = view.collateral[0];
    assert.strictEqual(pos.principal.raw, E('10').toString());
    assert.ok(BigInt(pos.withdrawable.raw) < BigInt(pos.principal.raw), 'the agreement spoke for part of it');
    assert.strictEqual(pos.principal.symbol, 'ETH', 'a ceiling is presented in the position\'s own currency');
    assert.strictEqual(pos.isFloor, false, 'a position touched this block has no accrual pending');
  });

  it('does not mark the withdrawable ceiling as a floor once an accrual is pending (ADR-012)', async () => {
    // Before ADR-012 a pending accrual raised the credit line, so the view under-reported and a UI
    // had to print it as a floor. Credit is principal only now, so the figure is exact, while the
    // yield rate and the accrual itself are still reported truthfully.
    await giveCredit(buyer, E('10'));
    await warp(365n * DAY);
    const after = await reader.getBuyerDashboard(ethers.getAddress(buyer.address));
    assert.strictEqual(after.collateral[0].mayAccrue, false, 'accrual no longer moves the credit line');
    assert.strictEqual(after.collateral[0].yieldRateBps, 500n);

    const view = presentBuyerDashboard(after, { tokens: await tokensFor(after) });
    assertSerializable(view);
    assert.strictEqual(view.collateral[0].isFloor, false);
    assert.strictEqual(view.collateral[0].yieldRateBps, '500', 'a bps figure crosses as a string');
  });

  it('an agreement carries its settlement currency for its whole life, not just while Active', async () => {
    const addr = await useStablecoin();
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(3000000n, 0); // 3 USDC at 6 decimals

    let a = await reader.getAgreement(id);
    assert.strictEqual(a.settlementToken, addr);
    assert.strictEqual(a.settlement.tokenAddress, addr);

    // Pay it off. getSettlementTerms and getSettlementReadiness both return zeroes once the
    // agreement leaves Active, so before this field existed a completed stablecoin agreement came
    // back with no currency at all and every amount on it rendered as ETH.
    await (await usd6.mint(buyer.address, 3000000n)).wait();
    await (await usd6.connect(buyer).approve(await rp.getAddress(), 3000000n)).wait();
    for (let i = 1; i <= 3; i++) {
      await (await rp.connect(buyer).processPayment(id, i)).wait();
    }

    a = await reader.getAgreement(id);
    assert.strictEqual(a.state, 'Completed');
    assert.strictEqual(a.settlement, null, 'nothing is owed, so there is no next payment to describe');
    assert.strictEqual(a.settlementToken, addr, 'but the currency it was denominated in survives');
  });

  it('a stablecoin agreement renders in the token decimals, not in ETH', async () => {
    await useStablecoin();
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(3000000n, 0);
    const a = await reader.getAgreement(id);
    const tokens = await createTokenRegistry({ publicClient }).load([a.settlementToken]);

    const view = presentAgreement(a, { tokens });
    assert.strictEqual(view.currency.symbol, 'USDC');
    assert.strictEqual(view.currency.decimals, 6);
    assert.strictEqual(view.totalPrice.display, '3', '3 USDC, not 0.000000000003 ETH');
    assert.strictEqual(view.installmentAmount.display, '1');
    assert.strictEqual(view.schedule[0].amount.display, '1');
    assert.strictEqual(view.next.amount.display, '1');
  });

  it('the same agreement in ETH renders in ether, proving the denomination is per agreement', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), 0);
    const a = await reader.getAgreement(id);
    const view = presentAgreement(a, { tokens: {} });
    assert.strictEqual(a.settlementToken, null);
    assert.strictEqual(view.currency.native, true);
    assert.strictEqual(view.currency.symbol, 'ETH');
    assert.strictEqual(view.totalPrice.display, '3');
  });

  it('a currency with no metadata on chain presents as unknown rather than blanking the page', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), 0);
    const a = await reader.getAgreement(id);
    // An ERC721 has symbol() but no decimals(), which is exactly the shape of a non-compliant
    // token: enough metadata to look fine, not enough to format a number.
    const nftAddr = ethers.getAddress(await nft.getAddress());
    const tokens = await createTokenRegistry({ publicClient }).load([nftAddr]);
    assert.strictEqual(tokens[nftAddr.toLowerCase()].known, false);

    const view = presentAgreement({ ...a, settlementToken: nftAddr }, { tokens });
    assert.strictEqual(view.currency.known, false);
    assert.strictEqual(view.totalPrice.display, null);
    assert.strictEqual(view.totalPrice.raw, E('3').toString());
    assert.doesNotThrow(() => assertSerializable(view));
  });

  it('the token registry caches, so a render does not re-read immutable metadata', async () => {
    const addr = ethers.getAddress(await usd6.getAddress());
    const registry = createTokenRegistry({ publicClient });
    const first = await registry.get(addr);
    const second = await registry.get(addr);
    assert.strictEqual(first.decimals, 6);
    assert.strictEqual(first, second, 'same object, so it came from the cache and not the chain');
    assert.strictEqual(registry.cache.size, 1);
  });

  it('a whole buyer dashboard survives the server to client boundary', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), 0);
    await (await rp.connect(buyer).processPayment(id, 1, { value: E('1') })).wait();

    const d = await reader.getBuyerDashboard(ethers.getAddress(buyer.address));
    const view = presentBuyerDashboard(d, { tokens: await tokensFor(d) });

    assert.doesNotThrow(() => assertSerializable(view), 'no BigInt escapes the presenter');
    // The real proof: JSON is what React's serializer is approximating, so a round trip that comes
    // back deep-equal means nothing in here depended on a type JSON cannot carry.
    assert.deepStrictEqual(JSON.parse(JSON.stringify(view)), view);

    assert.strictEqual(view.role, 'buyer');
    assert.strictEqual(view.agreements.length, 1);
    assert.strictEqual(view.agreements[0].totalPaid.display, '1');
    assert.strictEqual(view.agreements[0].outstanding.display, '2');
    assert.strictEqual(view.agreements[0].progress.percent, '33%');
    assert.strictEqual(view.credit.utilization.percent.endsWith('%'), true);
  });

  it('summary buckets carry ids that resolve, since object identity does not survive serializing', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), 0);
    await warp(33n * DAY); // past the 30 day due date, still inside the 7 day grace

    const d = await reader.getBuyerDashboard(ethers.getAddress(buyer.address));
    const view = presentBuyerDashboard(d, { tokens: await tokensFor(d) });
    assert.deepStrictEqual(view.summary.overdue, [id]);
    assert.deepStrictEqual(view.summary.atRisk, []);
    const byId = new Map(view.agreements.map((a) => [a.id, a]));
    assert.ok(byId.has(view.summary.overdue[0]), 'every bucket id is an agreement on the page');
    assert.strictEqual(byId.get(id).tone, 'warn');
    assert.strictEqual(byId.get(id).schedule[0].isStale, true);
  });

  it('an overdue installment reads as overdue in the view, with grace expiry in plain words', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), 0);
    await warp(33n * DAY);
    const a = await reader.getAgreement(id);
    const view = presentAgreement(a, { tokens: {} });

    assert.strictEqual(view.next.isOverdue, true);
    assert.strictEqual(view.next.isDefaultable, false);
    assert.strictEqual(view.next.secondsUntilDue.isPast, true);
    assert.ok(/ ago$/.test(view.next.dueDate.in.relative));
    assert.ok(/^in /.test(view.next.graceExpiry.in.relative), 'grace has not run out yet');
    assert.strictEqual(view.schedule[0].storedStatus, 'Pending');
    assert.strictEqual(view.schedule[0].isOverdue, true);
  });

  it('a defaulted agreement still shows what is owed and in which currency', async () => {
    const addr = await useStablecoin();
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(3000000n, 0);
    await warp(40n * DAY);
    await (await rp.connect(seller).triggerDefault(id)).wait();

    const a = await reader.getAgreement(id);
    const tokens = await createTokenRegistry({ publicClient }).load([addr]);
    const view = presentAgreement(a, { tokens });

    assert.strictEqual(view.state, 'Defaulted');
    assert.strictEqual(view.tone, 'danger');
    assert.strictEqual(view.outstanding.display, '3', 'a default does not zero the debt');
    assert.strictEqual(view.outstanding.symbol, 'USDC');
    assert.ok(view.defaultedAt);
    assert.doesNotThrow(() => assertSerializable(view));
  });

  it('a settlement shortfall counts only the pools the method actually draws from', async () => {
    // The buyer has 10 ETH of collateral and 0.25 ETH in the auto-payment pool. An Auto agreement
    // settles from the pool and nothing else, so it is short 0.75 no matter how much collateral is
    // sitting there. Measuring against the larger of the two pools reported a shortfall of zero on
    // an agreement the contract was about to refuse to settle.
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), 1); // Auto
    await (await rp.connect(buyer).depositAutoPaymentFunds({ value: E('0.25') })).wait();

    const view = presentAgreement(await reader.getAgreement(id), { tokens: {} });
    assert.strictEqual(view.settlement.ready, false);
    assert.strictEqual(view.settlement.required.display, '1');
    assert.strictEqual(view.settlement.autoBalance.display, '0.25');
    assert.ok(
      BigInt(view.settlement.collateralAvailable.raw) > E('1'),
      'collateral is plentiful, and irrelevant to an Auto agreement'
    );
    assert.strictEqual(view.settlement.shortfall.display, '0.75');
    assert.strictEqual(view.tone, 'warn');
  });

  it('the same shortfall is zero once collateral is a source the method can use', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), 3); // AutoWithCollateral
    await (await rp.connect(buyer).depositAutoPaymentFunds({ value: E('0.25') })).wait();

    const view = presentAgreement(await reader.getAgreement(id), { tokens: {} });
    assert.strictEqual(view.settlement.ready, true, 'collateral alone covers the installment');
    assert.strictEqual(view.settlement.shortfall.isZero, true);
    assert.strictEqual(view.tone, 'ok');
  });

  it('a Manual agreement has no shortfall to report, since the money is in a wallet', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), 0); // Manual
    const view = presentAgreement(await reader.getAgreement(id), { tokens: {} });
    assert.strictEqual(view.settlement.shortfall, null, 'null, not a confident zero');
    assert.strictEqual(view.settlement.requiresApproval, false, 'ETH needs no allowance');
  });

  it('a funded pool reports no shortfall', async () => {
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(E('3'), 1);
    await (await rp.connect(buyer).depositAutoPaymentFunds({ value: E('2') })).wait();
    const view = presentAgreement(await reader.getAgreement(id), { tokens: {} });
    assert.strictEqual(view.settlement.ready, true);
    assert.strictEqual(view.settlement.shortfall.isZero, true);
    assert.strictEqual(view.tone, 'ok');
  });

  it('a seller still sees a stablecoin balance after the agreement that earned it completed', async () => {
    const addr = await useStablecoin();
    await giveCredit(buyer, E('10'));
    const id = await createAgreement(3000000n, 0);
    await (await usd6.mint(buyer.address, 3000000n)).wait();
    await (await usd6.connect(buyer).approve(await rp.getAddress(), 3000000n)).wait();
    for (let i = 1; i <= 3; i++) {
      await (await rp.connect(buyer).processPayment(id, i)).wait();
    }

    const d = await reader.getSellerDashboard(ethers.getAddress(seller.address));
    assert.strictEqual(d.summary.completed, 1);
    // Before the settlementTokensOf fix this list was built from Active agreements only, so a
    // seller whose stablecoin agreements had all completed saw an empty withdrawable list while
    // holding the proceeds.
    assert.deepStrictEqual(d.withdrawable.tokens, [addr]);

    const view = presentSellerDashboard(d, { tokens: await tokensFor(d) });
    const bal = view.balances.tokens.find((t) => t.tokenAddress === addr);
    assert.ok(bal, 'the currency is listed even though no agreement is open in it');
    assert.strictEqual(bal.balance.display, '3');
    assert.strictEqual(bal.balance.symbol, 'USDC');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(view)), view);
  });

  it('a seller holding two currencies gets two totals, never one added together', async () => {
    await giveCredit(buyer, E('10'));
    await createAgreement(E('3'), 0, { physicalId: 'IBG-ETH' });
    const addr = await useStablecoin();
    await createAgreement(3000000n, 0, { physicalId: 'IBG-USDC' });

    const d = await reader.getSellerDashboard(ethers.getAddress(seller.address));
    const view = presentSellerDashboard(d, { tokens: await tokensFor(d) });

    assert.strictEqual(view.summary.active, 2);
    const totals = view.summary.receivableByCurrency;
    assert.strictEqual(totals.length, 2);
    const eth = totals.find((t) => t.tokenAddress === null);
    const usd = totals.find((t) => t.tokenAddress === addr);
    assert.strictEqual(eth.total.display, '3');
    assert.strictEqual(eth.total.symbol, 'ETH');
    assert.strictEqual(usd.total.display, '3');
    assert.strictEqual(usd.total.symbol, 'USDC');
    assert.strictEqual(view.settlementPreference.symbol, 'USDC');
  });

  it('a seller taking ETH reports a native preference, not a zero address', async () => {
    await giveCredit(buyer, E('10'));
    await createAgreement(E('3'), 0);
    const d = await reader.getSellerDashboard(ethers.getAddress(seller.address));
    const view = presentSellerDashboard(d, { tokens: {} });
    assert.strictEqual(view.settlementPreference.tokenAddress, null);
    assert.strictEqual(view.settlementPreference.native, true);
    assert.strictEqual(view.settlementPreference.symbol, 'ETH');
  });

  it('protocol info presents governance params and renders ungoverned honestly', async () => {
    const view = presentProtocolInfo(await reader.getProtocolInfo());
    assert.strictEqual(view.isGoverned, false);
    assert.strictEqual(view.governor, null);
    assert.ok(view.params.creditLimitRatio.percent.endsWith('%'));
    assert.ok(/day|hour|week/.test(view.params.defaultGracePeriod.human));
    assert.doesNotThrow(() => assertSerializable(view));
  });

  it('loadDashboard wires client, reader, tokens and presenter into one serializable call', async () => {
    const addr = await useStablecoin();
    await giveCredit(buyer, E('10'));
    await createAgreement(3000000n, 0);

    const env = {
      NETWORK: 'local',
      RPC_URL: 'http://unused.invalid', // the transport below wins; this only proves the guard
      RELICPAY_ADDRESS: ethers.getAddress(await rp.getAddress()),
    };
    const view = await loadDashboard(ethers.getAddress(buyer.address), {
      role: 'buyer',
      network: 'local',
      transport,
      env,
    });

    assert.strictEqual(view.role, 'buyer');
    assert.strictEqual(view.network, 'local');
    assert.strictEqual(view.contract, env.RELICPAY_ADDRESS);
    assert.strictEqual(view.agreements.length, 1);
    assert.strictEqual(view.agreements[0].currency.symbol, 'USDC');
    assert.strictEqual(view.agreements[0].totalPrice.display, '3');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(view)), view);
    assert.ok(view.summary.outstandingByCurrency.some((t) => t.tokenAddress === addr));
  });

  it('loadDashboard rejects a role it cannot render', async () => {
    await assert.rejects(
      loadDashboard(ethers.getAddress(buyer.address), {
        role: 'admin',
        network: 'local',
        transport,
        env: { RELICPAY_ADDRESS: ethers.getAddress(await rp.getAddress()) },
      }),
      ClientError
    );
  });
});

}
