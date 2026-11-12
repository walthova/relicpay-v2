const assert = require('assert');
const {
  setup, deploy, warp, expectRevert, expectCustomError, findEvent, latestTimestamp, IMPL,
} = require('./helpers');

// v2-only: ADR-011 risk 1. L2 sequencer uptime check in ChainlinkPriceAdapter.
(IMPL === 'v2' ? describe : describe.skip)(`ChainlinkPriceAdapter sequencer check [${IMPL}]`, function () {
  this.timeout(120000);

  const ETH = '0x0000000000000000000000000000000000000000';
  const BTC = '0x0000000000000000000000000000000000000001';
  const E8 = 10n ** 8n;
  const GRACE = 3600;

  let s, owner, other, oracle, adapter, ethFeed, seq;

  beforeEach(async () => {
    s = await setup();
    [owner, other] = s.signers;
    oracle = await deploy('PriceOracle', [], owner);
    adapter = await deploy('ChainlinkPriceAdapter', [oracle.target], owner);
    await (await oracle.authorizeOracle(adapter.target)).wait();
    // long feed age so only the sequencer check can be what refuses
    ethFeed = await deploy('MockAggregatorV3', [8, 'ETH / USD', 2345n * E8], owner);
    await (await adapter.setFeed(ETH, ethFeed.target, 7 * 24 * 3600, 95)).wait();
    // Chainlink sequencer feed: 0 decimals, answer 0 = up, startedAt = last status change
    seq = await deploy('MockAggregatorV3', [0, 'L2 Sequencer Uptime', 0], owner);
  });

  async function enable() {
    await (await adapter.setSequencerUptimeFeed(seq.target, GRACE)).wait();
  }

  it('is disabled by default: L1 and existing deployments behave exactly as before', async () => {
    assert.equal(await adapter.sequencerUptimeFeed(), '0x0000000000000000000000000000000000000000');
    assert.equal(await adapter.sequencerGracePeriod(), 0n);
    const [ok, reason] = await adapter.sequencerStatus();
    assert.equal(ok, true);
    assert.equal(reason, '');
    await (await adapter.pushPrice(ETH)).wait();
    assert.equal(await oracle.getPrice(ETH), 2345n * E8);
  });

  it('refuses inside the grace period after startup, then allows once it has passed', async () => {
    await enable();
    // the mock stamps startedAt = deploy time, so the sequencer just "restarted"
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'SequencerGracePeriodNotOver');
    await expectCustomError(adapter.readFeed.staticCall(ETH), 'SequencerGracePeriodNotOver');
    let [ok, reason] = await adapter.sequencerStatus();
    assert.equal(ok, false);
    assert.equal(reason, 'SequencerGracePeriod');

    await warp(GRACE - 60);
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'SequencerGracePeriodNotOver');

    await warp(120);
    [ok, reason] = await adapter.sequencerStatus();
    assert.equal(ok, true);
    await (await adapter.pushPrice(ETH)).wait();
    assert.equal(await oracle.getPrice(ETH), 2345n * E8);
  });

  it('refuses while the sequencer is down, even with a fresh looking feed', async () => {
    await enable();
    await warp(GRACE + 10);
    await (await seq.setAnswer(1)).wait(); // down
    await (await ethFeed.setAnswer(2400n * E8)).wait(); // feed looks perfectly fresh

    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'SequencerDown');
    const [ok, , , reason] = await adapter.peekFeed(ETH);
    assert.equal(ok, false);
    assert.equal(reason, 'SequencerDown');
  });

  it('after a restart the grace period runs from the restart, not from the outage', async () => {
    await enable();
    await warp(GRACE + 10);
    await (await seq.setAnswer(1)).wait();
    await warp(5 * 3600); // long outage
    await (await seq.setAnswer(0)).wait(); // back up now
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'SequencerGracePeriodNotOver');
    await warp(GRACE + 1);
    await (await adapter.pushPrice(ETH)).wait();
  });

  it('tolerant paths skip with a reason, strict batch reverts', async () => {
        await enable();

    await expectCustomError(adapter.pushPrices.staticCall([ETH], false), 'SequencerGracePeriodNotOver');
    const rc = await (await adapter.pushPrices([ETH], true)).wait();
    const skipped = findEvent(rc, adapter, 'PushSkipped');
    assert.equal(skipped.asset, ETH);
    assert.equal(skipped.reason, 'SequencerGracePeriod');
    const rc2 = await (await adapter.pushAll()).wait();
    assert.equal(findEvent(rc2, adapter, 'PushSkipped').reason, 'SequencerGracePeriod');
    assert.equal(await oracle.getPrice(ETH), 2000n * E8);
  });

  it('fails closed on an uninitialised round and on a sequencer feed that reverts', async () => {
    await enable();
    await warp(GRACE + 10);
    const now = BigInt(await latestTimestamp());

    await (await seq.setRound(3, 0, 0, now, 3)).wait(); // startedAt == 0
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'SequencerRoundInvalid');

    await (await seq.setRound(4, 0, now - BigInt(2 * GRACE), now, 4)).wait();
    await (await adapter.pushPrice(ETH)).wait();

    await (await seq.setReverting(true)).wait();
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'SequencerCheckFailed');
    const [ok, reason] = await adapter.sequencerStatus();
    assert.equal(ok, false);
    assert.equal(reason, 'SequencerCheckFailed');
  });

  it('a startedAt in the future counts as inside the grace period, not an underflow', async () => {
    await enable();
    const now = BigInt(await latestTimestamp());
    await (await seq.setRound(3, 0, now + 10000n, now, 3)).wait();
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'SequencerGracePeriodNotOver');
  });

  it('configuration is owner only, bounded, validated, and emits', async () => {
    await expectRevert(adapter.connect(other).setSequencerUptimeFeed(seq.target, GRACE), 'OwnableUnauthorizedAccount');
    await expectCustomError(adapter.setSequencerUptimeFeed.staticCall(seq.target, 30), 'InvalidGracePeriod');
    await expectCustomError(adapter.setSequencerUptimeFeed.staticCall(seq.target, 2 * 24 * 3600), 'InvalidGracePeriod');
    // an EOA is not an aggregator
    await expectRevert(adapter.setSequencerUptimeFeed(other.address, GRACE));

    const rc = await (await adapter.setSequencerUptimeFeed(seq.target, GRACE)).wait();
    const ev = findEvent(rc, adapter, 'SequencerFeedSet');
    assert.equal(ev.feed, seq.target);
    assert.equal(ev.gracePeriod, BigInt(GRACE));
    assert.equal(await adapter.sequencerUptimeFeed(), seq.target);
    assert.equal(await adapter.sequencerGracePeriod(), BigInt(GRACE));
  });

  it('address(0) disables the check again and clears the grace period', async () => {
    await enable();
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'SequencerGracePeriodNotOver');
    const rc = await (await adapter.setSequencerUptimeFeed('0x0000000000000000000000000000000000000000', 0)).wait();
    assert.equal(findEvent(rc, adapter, 'SequencerFeedSet').gracePeriod, 0n);
    assert.equal(await adapter.sequencerGracePeriod(), 0n);
    await (await adapter.pushPrice(ETH)).wait();
  });

  it('the sequencer check does not affect per-feed staleness', async () => {
    await enable();
    await warp(GRACE + 10);
    const shortFeed = await deploy('MockAggregatorV3', [8, 'ETH / USD', 2345n * E8], owner);
    await (await adapter.setFeed(ETH, shortFeed.target, 100, 95)).wait();
    await (await seq.setRound(9, 0, BigInt(await latestTimestamp()) - BigInt(10 * GRACE), BigInt(await latestTimestamp()), 9)).wait();
    await warp(200);
    await expectCustomError(adapter.pushPrice.staticCall(ETH), 'FeedStale');
  });
});
