// Tests for the extension quote layer (extension/lib/offer.js), part a of the browser extension
// revival. ADR-003 is the spec this suite checks.
//
// v2 only, same reasoning as the dashboard suites: the extension is a v2 artifact and legacy/ is the
// frozen spec, so the legacy run stays at exactly 51.
//
// Two parts:
//
// 1. Pure. The price parser, the conversion and the schedule, with no chain. The parser gets the
//    most cases because it is the layer that reads a hostile page, and every case it gets wrong
//    turns into a confident wrong number on a money surface.
//
// 2. Against a live chain. Every quote is checked against what the contract then does with the same
//    inputs: an accepted quote must produce an agreement whose schedule matches the quote, a refused
//    quote must be refused by the chain too, and a softened refusal must be one the chain accepts.
//    A quote that disagrees with createAgreementWithRWA in either direction is the bug this layer
//    exists to not have.

const assert = require('assert');
const { createPublicClient, custom } = require('viem');

const { setup, deploy, findEvent, IMPL, ethers, warp } = require('./helpers');
const { createRelicPayReader } = require('../dashboard/lib/reader');
const {
  OfferError,
  REFUSAL,
  parseMoney,
  toMinorUnits,
  convertToCredit,
  quoteInstallments,
  assessCollateral,
  mayCreditGrow,
  createOfferQuoter,
  decimalsFrom,
} = require('../extension/lib/offer');

const DAY = 86400n;
const E18 = 10n ** 18n;
const ZERO = '0x0000000000000000000000000000000000000000';

if (IMPL === 'v2') {

describe('Extension quote layer, pure [v2]', function () {
  describe('parseMoney', () => {
    const ok = (text, amount, currency) => {
      const r = parseMoney(text);
      assert.strictEqual(r.ok, true, `${JSON.stringify(text)} should parse, got ${r.code}`);
      assert.strictEqual(r.amount, amount, JSON.stringify(text));
      if (currency) assert.strictEqual(r.currency, currency);
    };
    const no = (text, code) => {
      const r = parseMoney(text);
      assert.strictEqual(r.ok, false, `${JSON.stringify(text)} should refuse`);
      assert.strictEqual(r.code, code, JSON.stringify(text));
    };

    it('reads plain, grouped and trailing-marker prices into minor units', () => {
      ok('$49', 4900n, 'USD');
      ok('$49.99', 4999n, 'USD');
      ok('$1,299.00', 129900n, 'USD');
      ok('$1,299', 129900n, 'USD');
      ok('45,99 €', 4599n, 'EUR');
      ok('1.299,00 €', 129900n, 'EUR');
      ok('1 299,00 €', 129900n, 'EUR');
      ok('USD 250', 25000n, 'USD');
      ok('£7.5', 750n, 'GBP');
    });

    it('reads an ungrouped price to the end rather than stopping at three digits', () => {
      // The regression from the first draft: the grouped alternative matched "123" and quoted
      // $123.00 for a $12,345.67 relic.
      ok('$12345.67', 1234567n);
      ok('$2500', 250000n);
    });

    it('ignores unmarked numbers: review counts, percentages, stock levels', () => {
      ok('Save 20%, now $49', 4900n);
      ok('Rated 4.5 by 120 people. $80. 12 in stock', 8000n);
    });

    it('does not treat an ASCII space as a thousands separator', () => {
      ok('$5 100 reviews', 500n);
    });

    it('treats the same price printed twice as one price', () => {
      const r = parseMoney('$49.99 ... $49.99');
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.amount, 4999n);
      assert.strictEqual(r.matches, 2);
    });

    it('refuses two different prices instead of picking one', () => {
      no('$45 - $89', 'AMBIGUOUS_PRICE');
      no('Was $120 now $90', 'AMBIGUOUS_PRICE');
      // The trailing-marker case: the second "$" must not be swallowed as the first price's suffix.
      no('$45 $89', 'AMBIGUOUS_PRICE');
      no('$45$89', 'AMBIGUOUS_PRICE');
      no('$49 or 45 €', 'AMBIGUOUS_PRICE');
    });

    it('refuses empty, unpriced and malformed text', () => {
      no('', 'NO_PRICE');
      no(undefined, 'NO_PRICE');
      no('Contact for price', 'NO_PRICE');
      no('$1,2345', 'NO_PRICE');
    });

    it('returns BigInt, never a float', () => {
      assert.strictEqual(typeof parseMoney('$0.30').amount, 'bigint');
      assert.strictEqual(parseMoney('$0.10').amount + parseMoney('$0.20').amount, 30n);
    });
  });

  describe('toMinorUnits', () => {
    it('refuses more fractional digits than the currency has', () => {
      assert.strictEqual(toMinorUnits('1.5', 0), null);
      assert.strictEqual(toMinorUnits('1.50', 2), 150n);
      assert.strictEqual(toMinorUnits('12.3456', 2), null);
    });
  });

  describe('convertToCredit', () => {
    it('requires a rate and has no fallback', () => {
      assert.strictEqual(convertToCredit({ amount: 100n, decimals: 2, rate: undefined }), null);
    });

    it('converts at the declared rate', () => {
      // $2,000.00 at 0.0005 ETH per dollar is exactly 1 ETH.
      const rate = 5n * 10n ** 14n; // 0.0005 with 18 decimals
      assert.strictEqual(convertToCredit({ amount: 200000n, decimals: 2, rate }), E18);
    });

    it('rounds up so the obligation is never quoted low', () => {
      // 1 cent at 1 credit unit per dollar, with no credit decimals, is 0.01 of a unit: must be 1.
      const r = convertToCredit({ amount: 1n, decimals: 2, rate: 1n, rateDecimals: 0, creditDecimals: 0 });
      assert.strictEqual(r, 1n);
    });

    it('rejects a non-BigInt or non-positive rate as a programmer error', () => {
      assert.throws(() => convertToCredit({ amount: 1n, decimals: 2, rate: 1 }), OfferError);
      assert.throws(() => convertToCredit({ amount: 1n, decimals: 2, rate: 0n }), OfferError);
      assert.throws(() => convertToCredit({ amount: 1, decimals: 2, rate: 1n }), OfferError);
    });
  });

  describe('quoteInstallments', () => {
    it('puts the remainder on the final installment, like _createPaymentSchedule', () => {
      const q = quoteInstallments({ totalPrice: 1000n, installmentCount: 3, dueIntervalSeconds: 10n });
      assert.strictEqual(q.ok, true);
      assert.strictEqual(q.installmentAmount, 333n);
      assert.strictEqual(q.finalAmount, 334n);
      assert.strictEqual(q.hasRemainder, true);
      assert.strictEqual(q.schedule.reduce((a, s) => a + s.amount, 0n), 1000n);
      assert.deepStrictEqual(q.schedule.map((s) => s.dueDate), [10n, 20n, 30n]);
    });

    it('reports no remainder on an even split', () => {
      const q = quoteInstallments({ totalPrice: 900n, installmentCount: 3, dueIntervalSeconds: 1n });
      assert.strictEqual(q.hasRemainder, false);
    });

    it('mirrors each of the contract arithmetic gates as a distinct code', () => {
      const base = { totalPrice: 10n, installmentCount: 2, dueIntervalSeconds: 1n };
      assert.strictEqual(quoteInstallments({ ...base, totalPrice: 0n }).code, 'ZERO_PRICE');
      assert.strictEqual(quoteInstallments({ ...base, installmentCount: 0 }).code, 'INSTALLMENT_COUNT_INVALID');
      assert.strictEqual(quoteInstallments({ ...base, dueIntervalSeconds: 0n }).code, 'DUE_INTERVAL_INVALID');
      assert.strictEqual(quoteInstallments({ ...base, installmentCount: 11 }).code, 'INSTALLMENT_ROUNDS_TO_ZERO');
      assert.strictEqual(quoteInstallments({ ...base, installmentCount: 2n ** 32n }).code, 'VALUE_TOO_LARGE');
    });
  });

  describe('assessCollateral and mayCreditGrow', () => {
    const TOKEN = '0x' + '11'.repeat(20);

    it('is sound when every position is 18 decimals', () => {
      const r = assessCollateral([{ token: null, amount: 5n, stakingRewards: 1n }]);
      assert.strictEqual(r.sound, true);
      assert.strictEqual(r.conservativeValue, 6n);
    });

    it('separates a 6-decimal position from the conservative sum', () => {
      const r = assessCollateral(
        [{ token: null, amount: E18 }, { token: TOKEN, amount: 1000n * 10n ** 6n }],
        { decimalsOf: decimalsFrom({ [TOKEN.toUpperCase().replace('0X', '0x')]: 6 }) }
      );
      assert.strictEqual(r.sound, false);
      assert.strictEqual(r.conservativeValue, E18);
      assert.strictEqual(r.unsoundValue, 1000n * 10n ** 6n);
      assert.strictEqual(r.offending[0].decimals, 6);
    });

    it('counts a token of unknown decimals as unsound rather than guessing 18', () => {
      const r = assessCollateral([{ token: TOKEN, amount: 1n }], { decimalsOf: decimalsFrom({}) });
      assert.strictEqual(r.sound, false);
      assert.strictEqual(r.hasUnknownDecimals, true);
    });

    it('only flags growth when a full day has passed, per _updateYield', () => {
      const p = { autoReinvest: true, yieldRateBps: 500n, amount: 1n, lastUpdateTime: 1000n };
      assert.strictEqual(mayCreditGrow([p], { timestamp: 1000n + DAY - 1n }), false);
      assert.strictEqual(mayCreditGrow([p], { timestamp: 1000n + DAY }), true);
      assert.strictEqual(mayCreditGrow([{ ...p, yieldRateBps: 0n }], { timestamp: 10n * DAY }), false);
      assert.strictEqual(mayCreditGrow([{ ...p, autoReinvest: false }], { timestamp: 10n * DAY }), false);
    });
  });

  describe('REFUSAL catalogue', () => {
    it('gives every code a sentence', () => {
      for (const [code, text] of Object.entries(REFUSAL)) {
        assert.ok(typeof text === 'string' && text.length > 10, code);
        assert.ok(!text.includes('\u2014'), `${code} uses an em dash`);
      }
    });
  });

  describe('module boundary', () => {
    it('does not touch chrome.*, React or dashboard/app', () => {
      const src = require('fs').readFileSync(require.resolve('../extension/lib/offer'), 'utf8');
      const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      assert.ok(!/\bchrome\./.test(code), 'offer.js must stay chrome-free');
      assert.ok(!/require\(['"]react/.test(code));
      assert.ok(!/dashboard\/app/.test(code));
    });

    it('returns no request-shaped object, because the buyer cannot send one (ADR-003)', () => {
      const src = require('fs').readFileSync(require.resolve('../extension/lib/offer'), 'utf8');
      assert.ok(!/functionName:\s*['"]createAgreementWithRWA/.test(src));
    });
  });
});

describe('Extension quote layer against a live chain [v2]', function () {
  this.timeout(180000);

  let s, owner, seller, buyer, rp, rpAddr, nft, publicClient, reader, quoter;

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

  async function refusedByChain(fn) {
    try {
      const receipt = await (await fn()).wait();
      return receipt.status === 0;
    } catch (e) {
      return /revert|VM Exception|status|estimate/i.test(String(e && e.message));
    }
  }

  beforeEach(async () => {
    s = await setup();
    [owner, seller, buyer] = s.signers;
    rp = await deploy('RelicPay', [], owner);
    rpAddr = ethers.getAddress(await rp.getAddress());
    nft = await deploy('MockNFT', [], owner);
    await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
    publicClient = await makeViemClient(s.provider);
    reader = createRelicPayReader({ publicClient, addresses: { relicPay: rpAddr } });
    quoter = createOfferQuoter({ publicClient, addresses: { relicPay: rpAddr }, reader });
  });

  async function mintToSeller() {
    const rc = await (await nft.connect(seller).mint(seller.address)).wait();
    const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
    await (await nft.connect(seller).approve(rpAddr, tokenId)).wait();
    return tokenId;
  }

  function listingFor(tokenId, over = {}) {
    return {
      priceText: '$1,600.00',
      nftContract: nft.target,
      tokenId,
      seller: seller.address,
      physicalId: 'IBG-OPTIC-001',
      ...over,
    };
  }

  // $2,000 buys 1 ETH, so $1,600 is 0.8 ETH, exactly 1 ETH of collateral's 80% credit limit.
  const USD_RATE = { currency: 'USD', rate: 5n * 10n ** 14n, rateDecimals: 18 };

  function create(q, tokenId, from = owner) {
    return rp.connect(from).createAgreementWithRWA(
      seller.address,
      buyer.address,
      q.totalPrice,
      q.installmentCount,
      q.dueIntervalSeconds,
      q.gracePeriodSeconds,
      0,
      {
        physicalId: 'IBG-OPTIC-001',
        nftContract: q.listing.nftContract,
        tokenId,
        metadataURI: 'ipfs://relic/1',
        ownershipTransferred: false,
        currentOwner: seller.address,
      }
    );
  }

  it('quotes a covered listing, and the agreement the chain creates matches the quote', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    const tokenId = await mintToSeller();
    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(tokenId),
      terms: { installmentCount: 3, dueIntervalSeconds: 30n * DAY, gracePeriodSeconds: 7n * DAY },
      rate: USD_RATE,
    });
    assert.strictEqual(q.ok, true, q.reason);
    assert.strictEqual(q.unconfirmed, false);
    assert.strictEqual(q.totalPrice, (8n * E18) / 10n);
    assert.deepStrictEqual(q.warnings, []);

    const rc = await (await create(q, tokenId)).wait();
    const id = findEvent(rc, rp, 'AgreementCreated').agreementId;
    const a = await reader.getAgreement(id);
    assert.strictEqual(a.totalPrice, q.totalPrice);
    assert.deepStrictEqual(a.schedule.map((x) => x.amount), q.schedule.map((x) => x.amount));
  });

  it('carries the remainder on the final installment exactly as the chain does', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    const tokenId = await mintToSeller();
    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(tokenId, { priceText: '1000 wei', price: 1000n }),
      terms: { installmentCount: 3, dueIntervalSeconds: DAY },
      rate: { creditDenominated: true },
    });
    assert.strictEqual(q.ok, true, q.reason);
    assert.strictEqual(q.hasRemainder, true);
    const rc = await (await create(q, tokenId)).wait();
    const a = await reader.getAgreement(findEvent(rc, rp, 'AgreementCreated').agreementId);
    assert.deepStrictEqual(a.schedule.map((x) => x.amount), [333n, 333n, 334n]);
  });

  it('refuses a listing over the line with no accrual pending, and so does the chain', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    const tokenId = await mintToSeller();
    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(tokenId, { priceText: '$1,700.00' }),
      terms: { installmentCount: 3, dueIntervalSeconds: 30n * DAY },
      rate: USD_RATE,
    });
    assert.strictEqual(q.ok, false);
    assert.strictEqual(q.code, 'INSUFFICIENT_CREDIT');
    assert.ok(q.shortfall > 0n);
    const totalPrice = (17n * E18) / 20n;
    assert.ok(await refusedByChain(() =>
      create({ totalPrice, installmentCount: 3, dueIntervalSeconds: 30n * DAY, gracePeriodSeconds: 0n,
        listing: { nftContract: nft.target } }, tokenId)));
  });

  it('does not soften a shortfall on account of pending yield, and the chain agrees (ADR-012)', async () => {
    // ADR-002/003 softened a refusal a pending accrual could close. ADR-012 makes the credit line
    // principal-only, so accrual closes nothing: a quote over the line is a refusal, and the chain
    // refuses the same terms even after a long wait.
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    await warp(60n * DAY);
    await (await nft.connect(seller).mint(seller.address)).wait(); // mine a block past the warp
    const tokenId = await mintToSeller();
    const price = (8n * E18) / 10n + 10n ** 15n; // just over the 0.8 ETH line
    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(tokenId, { price }),
      terms: { installmentCount: 3, dueIntervalSeconds: 30n * DAY },
      rate: { creditDenominated: true },
    });
    assert.strictEqual(q.ok, false);
    assert.strictEqual(q.code, 'INSUFFICIENT_CREDIT');
    assert.ok(q.shortfall > 0n);
    assert.ok(await refusedByChain(() =>
      create({ totalPrice: price, installmentCount: 3, dueIntervalSeconds: 30n * DAY, gracePeriodSeconds: 0n,
        listing: { nftContract: nft.target } }, tokenId)));
  });

  it('refuses a collection the protocol has not authorized, and so does the chain', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    const other = await deploy('MockNFT', [], owner);
    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(0n, { nftContract: other.target }),
      terms: { installmentCount: 3, dueIntervalSeconds: DAY },
      rate: USD_RATE,
    });
    assert.strictEqual(q.code, 'NFT_NOT_AUTHORIZED');
    assert.ok(await refusedByChain(() =>
      create({ totalPrice: 10n ** 17n, installmentCount: 3, dueIntervalSeconds: DAY, gracePeriodSeconds: 0n,
        listing: { nftContract: other.target } }, 0n)));
  });

  it('refuses listing problems before reading anything about the buyer', async () => {
    const terms = { installmentCount: 3, dueIntervalSeconds: DAY };
    const q1 = await quoter.quote({ buyer: buyer.address, listing: listingFor(0n, { nftContract: ZERO }), terms, rate: USD_RATE });
    assert.strictEqual(q1.code, 'NO_LISTING_ASSET');
    const q2 = await quoter.quote({ buyer: buyer.address, listing: listingFor(0n, { seller: undefined }), terms, rate: USD_RATE });
    assert.strictEqual(q2.code, 'NO_SELLER');
    const q3 = await quoter.quote({ buyer: buyer.address, listing: listingFor(0n, { priceText: '$45 - $89' }), terms, rate: USD_RATE });
    assert.strictEqual(q3.code, 'AMBIGUOUS_PRICE');
    assert.strictEqual(q3.reason, REFUSAL.AMBIGUOUS_PRICE);
  });

  it('refuses a fiat price with no rate, and a rate for the wrong currency', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    const terms = { installmentCount: 3, dueIntervalSeconds: DAY };
    const noRate = await quoter.quote({ buyer: buyer.address, listing: listingFor(0n), terms });
    assert.strictEqual(noRate.code, 'NO_RATE');
    const rateNoCurrency = await quoter.quote({
      buyer: buyer.address, listing: listingFor(0n), terms, rate: { rate: USD_RATE.rate },
    });
    assert.strictEqual(rateNoCurrency.code, 'NO_RATE');
    const euro = await quoter.quote({
      buyer: buyer.address, listing: listingFor(0n, { priceText: '1.600,00 €' }), terms, rate: USD_RATE,
    });
    assert.strictEqual(euro.code, 'RATE_CURRENCY_MISMATCH');
  });

  it('ignores a page that declares itself credit-denominated', async () => {
    // A listing is a claim from the page. Whether conversion is skipped is operator config.
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(0n, { isCreditDenominated: true }),
      terms: { installmentCount: 3, dueIntervalSeconds: DAY },
    });
    assert.strictEqual(q.code, 'NO_RATE');
  });

  it('refuses a buyer with no collateral at all', async () => {
    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(0n),
      terms: { installmentCount: 3, dueIntervalSeconds: DAY },
      rate: USD_RATE,
    });
    assert.strictEqual(q.code, 'NO_CREDIT_LINE');
  });

  it('warns, and still quotes, when collateral spans assets of different decimals (finding 3)', async () => {
    const usdc = await deploy('MockStablecoin', ['USD Coin', 'USDC', 6], owner);
    await (await rp.authorizeToken(usdc.target, true)).wait();
    // minCollateralAmount is 1e18 raw, so the smallest USDC deposit the contract accepts is a
    // trillion dollars. That is finding 3 again, from the other side.
    await (await usdc.mint(buyer.address, E18)).wait();
    await (await usdc.connect(buyer).approve(rpAddr, E18)).wait();
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    await (await rp.connect(buyer).depositERC20Collateral(usdc.target, E18)).wait();

    const q6 = createOfferQuoter({
      publicClient, addresses: { relicPay: rpAddr }, reader,
      tokenDecimals: { [usdc.target]: 6 },
    });
    const tokenId = await mintToSeller();
    const q = await q6.quote({
      buyer: buyer.address,
      listing: listingFor(tokenId),
      terms: { installmentCount: 3, dueIntervalSeconds: 30n * DAY },
      rate: USD_RATE,
    });
    assert.strictEqual(q.ok, true, q.reason);
    const w = q.warnings.find((x) => x.code === 'COLLATERAL_UNITS_UNSOUND');
    assert.ok(w, 'mixed-decimal collateral must be surfaced');
    assert.strictEqual(w.contractValue, 2n * E18, 'the contract adds 1 ETH and 1e18 raw USDC units');
    assert.strictEqual(w.conservativeValue, E18);
    assert.strictEqual(w.offending[0].decimals, 6);
  });

  it('a listing cannot vouch for a token decimals to hide the warning', async () => {
    const usdc = await deploy('MockStablecoin', ['USD Coin', 'USDC', 6], owner);
    await (await rp.authorizeToken(usdc.target, true)).wait();
    await (await usdc.mint(buyer.address, E18)).wait();
    await (await usdc.connect(buyer).approve(rpAddr, E18)).wait();
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    await (await rp.connect(buyer).depositERC20Collateral(usdc.target, E18)).wait();
    const tokenId = await mintToSeller();
    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(tokenId, { tokenDecimals: { [usdc.target.toLowerCase()]: 18 } }),
      terms: { installmentCount: 3, dueIntervalSeconds: 30n * DAY },
      rate: USD_RATE,
    });
    assert.strictEqual(q.ok, true, q.reason);
    const w = q.warnings.find((x) => x.code === 'COLLATERAL_UNITS_UNSOUND');
    assert.ok(w, 'decimals from the page must not be trusted');
    assert.strictEqual(w.offending[0].decimals, null, 'unknown, not the page-supplied 18');
  });

  it('refuses past maxAgreementDuration, since the contract now enforces it', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    const tokenId = await mintToSeller();
    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(tokenId),
      terms: { installmentCount: 20, dueIntervalSeconds: 30n * DAY },
      rate: USD_RATE,
    });
    assert.strictEqual(q.ok, false);
    assert.strictEqual(q.code, 'EXCEEDS_MAX_DURATION');
    assert.strictEqual(q.maxDuration, 365n * DAY, 'read from governanceParams, not the fallback');
    assert.strictEqual(q.totalDuration, 600n * DAY);
  });

  it('pins every read to one block', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    const tokenId = await mintToSeller();
    const at = await quoter.pinnedBlock();
    // A deposit after the pin must not show up in a quote pinned before it.
    await (await rp.connect(buyer).depositETHCollateral(true, { value: E18 })).wait();
    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(tokenId),
      terms: { installmentCount: 3, dueIntervalSeconds: DAY },
      rate: USD_RATE,
      at,
    });
    assert.strictEqual(q.ok, true, q.reason);
    assert.strictEqual(q.credit.creditLimit, (8n * E18) / 10n);
    assert.strictEqual(q.at.blockNumber, at.blockNumber);
  });

  it('throws on programmer errors rather than refusing', async () => {
    assert.throws(() => createOfferQuoter({ addresses: { relicPay: rpAddr }, reader }), OfferError);
    await assert.rejects(quoter.quote({ listing: listingFor(0n), terms: { installmentCount: 1 } }), OfferError);
    await assert.rejects(
      quoter.quote({ buyer: buyer.address, listing: listingFor(0n, { price: 5 }), terms: { installmentCount: 1 } }),
      OfferError
    );
  });
});

}
