const assert = require('assert');
const {
  setup, deploy, warp, expectRevert, expectCustomError, findEvent, latestTimestamp, IMPL, ethers,
} = require('./helpers');

// v2-only: the adapter is a new v2 contract. legacy/ is the frozen spec and has no counterpart.
(IMPL === 'v2' ? describe : describe.skip)(`ChainlinkPriceAdapter [${IMPL}]`, function () {
  this.timeout(120000);

  const ETH = '0x0000000000000000000000000000000000000000';
  const BTC = '0x0000000000000000000000000000000000000001';
  const USDC = '0x0000000000000000000000000000000000000002';
  const UNLISTED = '0x00000000000000000000000000000000000000AA';
  const E8 = 10n ** 8n;

  let s, owner, other, third, oracle, adapter, ethFeed;

  beforeEach(async () => {
    s = await setup();
    [owner, other, third] = s.signers;
    oracle = await deploy('PriceOracle', [], owner);
    adapter = await deploy('ChainlinkPriceAdapter', [oracle.target], owner);
    // The adapter writes through updatePrice like any other oracle, so adopting it is exactly
    // one authorizeOracle call. Nothing else about PriceOracle changes.
    await (await oracle.authorizeOracle(adapter.target)).wait();
    // 8 decimals is what almost every Chainlink USD feed reports, so it is the default here.
    ethFeed = await deploy('MockAggregatorV3', [8, 'ETH / USD', 2345n * E8], owner);
    await (await adapter.setFeed(ETH, ethFeed.target, 3600, 95)).wait();
  });

  it('a push moves the Chainlink answer into PriceOracle, with the oracle ABI untouched', async () => {
    // the seeded placeholder is still what the oracle reports before any push
    assert.equal(await oracle.getPrice(ETH), 2000n * E8);

    const rc = await (await adapter.pushPrice(ETH)).wait();

    // the consumer-facing read is unchanged: same function, same scale, Chainlink's number
    assert.equal(await oracle.getPrice(ETH), 2345n * E8);
    const [price, confidence] = await oracle.getPriceWithConfidence(ETH);
    assert.equal(price, 2345n * E8);
    assert.equal(confidence, 95n);

    const pushed = findEvent(rc, adapter, 'PricePushed');
    assert.equal(pushed.asset, ETH);
    assert.equal(pushed.price, 2345n * E8);
    assert.equal(pushed.roundId, 1n);
    // the log carries the aggregator's own updatedAt, not the block time of the push
    assert.equal(pushed.feedUpdatedAt, (await ethFeed.updatedAt()));
  });

  it('a new Chainlink round is reflected on the next push, and only on the next push', async () => {
    await (await adapter.pushPrice(ETH)).wait();
    await (await ethFeed.setAnswer(2600n * E8)).wait();

    // the oracle still holds the previously pushed value: nothing reads the feed on its own
    assert.equal(await oracle.getPrice(ETH), 2345n * E8);
    const [ok, peeked] = await adapter.peekFeed(ETH);
    assert.ok(ok);
    assert.equal(peeked, 2600n * E8);

    await (await adapter.pushPrice(ETH)).wait();
    assert.equal(await oracle.getPrice(ETH), 2600n * E8);
  });

  it('anyone may push: the adapter can only relay what the aggregator already said', async () => {
    assert.equal(await oracle.isOracleAuthorized(other.address), false);
    await (await adapter.connect(other).pushPrice(ETH)).wait();
    assert.equal(await oracle.getPrice(ETH), 2345n * E8);
  });

  it('rescales feeds that do not report 8 decimals', async () => {
    const btcFeed = await deploy('MockAggregatorV3', [18, 'BTC / USD', 61000n * 10n ** 18n], owner);
    const usdcFeed = await deploy('MockAggregatorV3', [6, 'USDC / USD', 999900n], owner); // $0.9999
    await (await adapter.setFeed(BTC, btcFeed.target, 3600, 95)).wait();
    await (await adapter.setFeed(USDC, usdcFeed.target, 3600, 99)).wait();

    await (await adapter.pushPrices([BTC, USDC], false)).wait();

    assert.equal(await oracle.getPrice(BTC), 61000n * E8);
    assert.equal(await oracle.getPrice(USDC), 99990000n);
    assert.equal((await adapter.getFeed(BTC)).feedDecimals, 18n);
    assert.equal((await adapter.getFeed(USDC)).feedDecimals, 6n);
  });

  it('refuses an answer that rescales to zero instead of letting the sink reject it blind', async () => {
    // 18 decimals down to 8 floors, so a sub-1e10 answer would arrive at the sink as 0 and come
    // back as a bare "Invalid price" from a contract that has no idea a feed is involved
    const dustFeed = await deploy('MockAggregatorV3', [18, 'DUST / USD', 1n], owner);
    await (await adapter.setFeed(BTC, dustFeed.target, 3600, 95)).wait();

    await expectCustomError(adapter.readFeed.staticCall(BTC), 'FeedAnswerInvalid');
    await expectCustomError(adapter.pushPrice.staticCall(BTC), 'FeedAnswerInvalid');
    const [ok, , , reason] = await adapter.peekFeed(BTC);
    assert.equal(ok, false);
    assert.equal(reason, 'FeedAnswerInvalid');
  });

  // ---- the reason the adapter has its own staleness window ------------------------------------

  it('a frozen feed is refused by the adapter while the oracle window is still open', async () => {
    const shortFeed = await deploy('MockAggregatorV3', [8, 'ETH / USD', 2345n * E8], owner);
    // 100s on the feed against the oracle's 300s default for ETH, so there is a window where the
    // oracle would happily accept a push of an answer the feed itself has stopped updating
    await (await adapter.setFeed(ETH, shortFeed.target, 100, 95)).wait();
    await (await adapter.pushPrice(ETH)).wait();

    await warp(200);

    // the oracle's own copy is 200s old and still fresh by its 300s window
    assert.equal(await oracle.getPrice(ETH), 2345n * E8);
    // but the adapter refuses to refresh it from a feed that has not moved in 200s, which is what
    // lets the oracle's window actually expire instead of being reset forever with a dead number
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'FeedStale');

    await warp(200);
    await expectRevert(oracle.getPrice(ETH), 'StalePrice');
  });

  it('refuses an unanswered round, a carried-over answer, and a non-positive answer', async () => {
    const now = await latestTimestamp();

    // round started, never answered
    await (await ethFeed.setRound(5, 2345n * E8, now, 0, 5)).wait();
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'FeedRoundIncomplete');

    // answer carried over from an earlier round: the feed has stopped advancing
    await (await ethFeed.setRound(9, 2345n * E8, now, now, 7)).wait();
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'FeedRoundIncomplete');

    // zero and negative answers, which a real aggregator can report during an outage
    await (await ethFeed.setRound(10, 0, now, now, 10)).wait();
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'FeedAnswerInvalid');
    await (await ethFeed.setRound(11, -1n * E8, now, now, 11)).wait();
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'FeedAnswerInvalid');

    // nothing was written to the sink through any of it
    assert.equal(await oracle.getPrice(ETH), 2000n * E8);
  });

  it('survives an aggregator that reverts outright', async () => {
    await (await ethFeed.setReverting(true)).wait();

    const [ok, price, , reason] = await adapter.peekFeed(ETH);
    assert.equal(ok, false);
    assert.equal(price, 0n);
    assert.equal(reason, 'AggregatorCallFailed');
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'AggregatorCallFailed');

    // and a sweep steps over it rather than being taken down by it
    await (await adapter.pushAll()).wait();
    assert.equal(await oracle.getPrice(ETH), 2000n * E8);
  });

  // ---- batching -------------------------------------------------------------------------------

  it('pushPrices is all or nothing unless the caller asks to skip', async () => {
    const btcFeed = await deploy('MockAggregatorV3', [8, 'BTC / USD', 61000n * E8], owner);
    await (await adapter.setFeed(BTC, btcFeed.target, 3600, 95)).wait();
    await (await btcFeed.setReverting(true)).wait();

    // strict: one bad feed takes the whole batch down, and the healthy one is not written either
    await expectCustomError(adapter.pushPrices.staticCall([ETH, BTC], false), 'AggregatorCallFailed');
    assert.equal(await oracle.getPrice(ETH), 2000n * E8);

    // tolerant: the healthy one lands, the bad one is logged
    const rc = await (await adapter.pushPrices([ETH, BTC], true)).wait();
    assert.equal(await oracle.getPrice(ETH), 2345n * E8);
    const skipped = findEvent(rc, adapter, 'PushSkipped');
    assert.equal(skipped.asset, BTC);
    assert.equal(skipped.reason, 'AggregatorCallFailed');
    assert.equal(await adapter.pushPrices.staticCall([ETH, BTC], true), 1n);
  });

  it('pushAll sweeps every registered feed and refuses an empty registry', async () => {
    const btcFeed = await deploy('MockAggregatorV3', [8, 'BTC / USD', 61000n * E8], owner);
    await (await adapter.setFeed(BTC, btcFeed.target, 3600, 95)).wait();

    assert.equal(await adapter.pushAll.staticCall(), 2n);
    await (await adapter.pushAll()).wait();
    assert.equal(await oracle.getPrice(ETH), 2345n * E8);
    assert.equal(await oracle.getPrice(BTC), 61000n * E8);

    const bare = await deploy('ChainlinkPriceAdapter', [oracle.target], owner);
    await expectCustomError(bare.pushAll.staticCall(), 'NoAssets');
    await expectCustomError(adapter.pushPrices.staticCall([], true), 'NoAssets');
  });

  // ---- registration ---------------------------------------------------------------------------

  it('validates feed registration and keeps it owner only', async () => {
    await expectRevert(
      adapter.connect(other).setFeed(BTC, ethFeed.target, 3600, 95),
      'OwnableUnauthorizedAccount'
    );
    await expectCustomError(
      adapter.setFeed.staticCall(BTC, ethers.ZeroAddress, 3600, 95),
      'InvalidAggregator'
    );
    await expectCustomError(adapter.setFeed.staticCall(BTC, ethFeed.target, 0, 95), 'InvalidFeedAge');
    await expectCustomError(
      adapter.setFeed.staticCall(BTC, ethFeed.target, 8 * 24 * 3600, 95),
      'InvalidFeedAge'
    );
    await expectCustomError(adapter.setFeed.staticCall(BTC, ethFeed.target, 3600, 101), 'InvalidConfidence');
    // the sink would reject this at push time, hours later, in a stranger's transaction
    await expectCustomError(
      adapter.setFeed.staticCall(UNLISTED, ethFeed.target, 3600, 95),
      'AssetNotSupportedBySink'
    );
    // an address that is not an aggregator fails the decimals() read rather than registering
    await expectRevert(adapter.setFeed(BTC, other.address, 3600, 95));
    assert.equal(await adapter.hasFeed(BTC), false);
    // and the constructor refuses a zero sink, so there is no adapter that pushes into nothing
    await expectRevert(deploy('ChainlinkPriceAdapter', [ethers.ZeroAddress], owner));
  });

  it('repointing an asset replaces its feed in place without duplicating the registry', async () => {
    assert.deepEqual(await adapter.getRegisteredAssets(), [ETH]);

    const replacement = await deploy('MockAggregatorV3', [8, 'ETH / USD v2', 3100n * E8], owner);
    await (await adapter.setFeed(ETH, replacement.target, 600, 90)).wait();

    assert.deepEqual(await adapter.getRegisteredAssets(), [ETH]);
    const feed = await adapter.getFeed(ETH);
    assert.equal(feed.aggregator, replacement.target);
    assert.equal(feed.maxFeedAge, 600n);
    assert.equal(feed.confidence, 90n);

    await (await adapter.pushPrice(ETH)).wait();
    assert.equal(await oracle.getPrice(ETH), 3100n * E8);
  });

  it('removeFeed unregisters the asset and leaves the already pushed price to age out', async () => {
    const btcFeed = await deploy('MockAggregatorV3', [8, 'BTC / USD', 61000n * E8], owner);
    await (await adapter.setFeed(BTC, btcFeed.target, 3600, 95)).wait();
    await (await adapter.pushAll()).wait();

    await expectRevert(adapter.connect(other).removeFeed(ETH), 'OwnableUnauthorizedAccount');
    await (await adapter.removeFeed(ETH)).wait();

    assert.equal(await adapter.hasFeed(ETH), false);
    assert.deepEqual(await adapter.getRegisteredAssets(), [BTC]);
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'FeedNotSet');
    await expectCustomError(adapter.removeFeed.staticCall(ETH), 'FeedNotSet');

    // the last pushed price is still there: removing a feed is not a price revocation, it just
    // stops the refresh, and the oracle's own staleness window does the rest
    assert.equal(await oracle.getPrice(ETH), 2345n * E8);
    await warp(400);
    await expectRevert(oracle.getPrice(ETH), 'StalePrice');
  });

  it('a deauthorized adapter cannot write, and the oracle is the one saying no', async () => {
    await (await oracle.deauthorizeOracle(adapter.target)).wait();

    // the feed itself is still perfectly healthy, so the refusal is purely the sink's
    const [ok] = await adapter.peekFeed(ETH);
    assert.ok(ok);
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'Unauthorized oracle');
    assert.equal(await oracle.getPrice(ETH), 2000n * E8);

    // re-adopting is one call back the other way
    await (await oracle.authorizeOracle(adapter.target)).wait();
    await (await adapter.pushPrice(ETH)).wait();
    assert.equal(await oracle.getPrice(ETH), 2345n * E8);
  });

  it('peekFeed and readFeed agree on a healthy feed', async () => {
    const [ok, peekPrice, peekUpdatedAt, reason] = await adapter.peekFeed(ETH);
    const [readPrice, readUpdatedAt, roundId] = await adapter.readFeed(ETH);
    assert.ok(ok);
    assert.equal(reason, '');
    assert.equal(peekPrice, readPrice);
    assert.equal(peekUpdatedAt, readUpdatedAt);
    assert.equal(roundId, 1n);
    assert.equal(await adapter.priceOracle(), oracle.target);
    assert.equal(await adapter.ORACLE_DECIMALS(), 8n);
  });
});
