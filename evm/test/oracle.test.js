const assert = require('assert');
const { setup, deploy, warp, expectRevert, expectCustomError, IMPL, ethers } = require('./helpers');

describe(`PriceOracle [${IMPL}]`, function () {
  this.timeout(120000);
  let s, owner, other, third, oracle;
  const ETH = '0x0000000000000000000000000000000000000000';
  const BTC = '0x0000000000000000000000000000000000000001';
  const USDC = '0x0000000000000000000000000000000000000002';

  beforeEach(async () => {
    s = await setup();
    [owner, other, third] = s.signers;
    oracle = await deploy('PriceOracle', [], owner);
  });

  it('seeds ETH/BTC/USDC/USDT prices', async () => {
    assert.equal(await oracle.getPrice(ETH), 2000n * 10n ** 8n);
    assert.equal(await oracle.getPrice(BTC), 30000n * 10n ** 8n);
    assert.equal(await oracle.getPrice(USDC), 10n ** 8n);
    assert.equal((await oracle.getSupportedAssets()).length, 4);
  });

  it('reverts on stale price', async () => {
    await warp(400);
    await expectRevert(oracle.getPrice(ETH), 'StalePrice');
  });

  it('authorized oracle updates price; unauthorized cannot', async () => {
    await expectRevert(oracle.connect(other).updatePrice(ETH, 2500n * 10n ** 8n, 90n), 'Unauthorized');
    await (await oracle.updatePrice(ETH, 2500n * 10n ** 8n, 90n)).wait();
    assert.equal(await oracle.getPrice(ETH), 2500n * 10n ** 8n);
    const [p, c] = await oracle.getPriceWithConfidence(ETH);
    assert.equal(p, 2500n * 10n ** 8n);
    assert.equal(c, 90n);
  });

  it('validates confidence and price', async () => {
    await expectRevert(oracle.updatePrice(ETH, 0n, 90n), 'Invalid price');
    await expectRevert(oracle.updatePrice(ETH, 1n, 101n), 'Invalid confidence');
  });

  it('batch update enforces array lengths', async () => {
    await expectRevert(oracle.batchUpdatePrices([ETH], [1n, 2n], [90n]), 'length mismatch');
    await (await oracle.batchUpdatePrices([ETH, BTC], [3000n * 10n ** 8n, 60000n * 10n ** 8n], [95n, 95n])).wait();
    assert.equal(await oracle.getPrice(BTC), 60000n * 10n ** 8n);
  });

  it('computes USD value with decimals', async () => {
    const v = await oracle.getUSDValue(ETH, 2n * 10n ** 18n);
    assert.equal(v, 4000n * 10n ** 8n);
  });

  it('add/remove assets, authorize oracles (owner only)', async () => {
    const A = '0x00000000000000000000000000000000000000AA';
    await expectRevert(oracle.connect(other).addAsset(A, 'TEST', 18, 300));
    await (await oracle.addAsset(A, 'TEST', 18, 300)).wait();
    assert.ok(await oracle.isAssetSupported(A));
    await (await oracle.removeAsset(A)).wait();
    assert.ok(!(await oracle.isAssetSupported(A)));
    await (await oracle.authorizeOracle(other.address)).wait();
    await (await oracle.connect(other).updatePrice(ETH, 999n * 10n ** 8n, 50n)).wait();
    await (await oracle.deauthorizeOracle(other.address)).wait();
    await expectRevert(oracle.connect(other).updatePrice(ETH, 1n, 50n), 'Unauthorized');
  });

  if (IMPL === 'v2') {
    // ---- governor role (part b2), tested independently of the governance contract ----
    // `other` stands in for RelicPayGovernance here on purpose: the target side of the wiring is
    // just an address with a role, and proving that against an EOA shows the target is not
    // depending on anything about the governance contract.

    it('[v2] the governor can move oracle parameters, and only once appointed', async () => {
      assert.equal(await oracle.governor(), ethers.ZeroAddress);
      assert.equal(await oracle.hasGovernanceRights(other.address), false);
      await expectCustomError(
        oracle.connect(other).setOracleAuthorized.staticCall(third.address, true),
        'UnauthorizedGovernance'
      );
      await expectCustomError(
        oracle.connect(other).updateMaxPriceAge.staticCall(ETH, 900),
        'UnauthorizedGovernance'
      );

      await (await oracle.setGovernor(other.address)).wait();
      assert.ok(await oracle.hasGovernanceRights(other.address));

      await (await oracle.connect(other).setOracleAuthorized(third.address, true)).wait();
      assert.ok(await oracle.isOracleAuthorized(third.address));
      await (await oracle.connect(other).updateMaxPriceAge(ETH, 900)).wait();
      assert.equal((await oracle.getAssetInfo(ETH)).maxPriceAge, 900n);

      // the widened window is real: a price this old would have been stale at the 300s default
      await (await oracle.connect(third).updatePrice(ETH, 2500n * 10n ** 8n, 90n)).wait();
      await warp(400);
      assert.equal(await oracle.getPrice(ETH), 2500n * 10n ** 8n);

      // revocation is one transaction and takes effect immediately
      await (await oracle.setGovernor(ethers.ZeroAddress)).wait();
      assert.equal(await oracle.hasGovernanceRights(other.address), false);
      await expectCustomError(
        oracle.connect(other).setOracleAuthorized.staticCall(third.address, false),
        'UnauthorizedGovernance'
      );
    });

    it('[v2] onlyGovernance widened the owner surface without narrowing it', async () => {
      await (await oracle.setGovernor(other.address)).wait();

      // the owner keeps every governable function it had before the role existed
      await (await oracle.setOracleAuthorized(third.address, true)).wait();
      assert.ok(await oracle.isOracleAuthorized(third.address));
      await (await oracle.updateMaxPriceAge(ETH, 900)).wait();
      assert.equal((await oracle.getAssetInfo(ETH)).maxPriceAge, 900n);

      // the legacy single-purpose pair is untouched: same names, same effect, still owner-only
      await (await oracle.deauthorizeOracle(third.address)).wait();
      assert.equal(await oracle.isOracleAuthorized(third.address), false);
      await expectRevert(oracle.connect(other).authorizeOracle(third.address), 'OwnableUnauthorizedAccount');
      await expectRevert(oracle.connect(other).deauthorizeOracle(third.address), 'OwnableUnauthorizedAccount');

      // listing an asset commits the protocol to valuing collateral it may have no real feed for,
      // which is a risk decision rather than a parameter, so it stays owner-only
      const A = '0x00000000000000000000000000000000000000AA';
      await expectRevert(oracle.connect(other).addAsset(A, 'TEST', 18, 300), 'OwnableUnauthorizedAccount');
      await expectRevert(oracle.connect(other).removeAsset(ETH), 'OwnableUnauthorizedAccount');
      // and setGovernor itself is owner-only, so a governor cannot extend or re-point its own role
      await expectRevert(oracle.connect(other).setGovernor(other.address), 'OwnableUnauthorizedAccount');
    });

    it('[v2] setOracleAuthorized and the legacy pair write the same state and events', async () => {
      const rc1 = await (await oracle.setOracleAuthorized(third.address, true)).wait();
      const rc2 = await (await oracle.authorizeOracle(other.address)).wait();
      // one shared write path, so the two entry points cannot drift apart
      assert.equal(rc1.logs[0].topics[0], rc2.logs[0].topics[0]); // both OracleAuthorized
      assert.ok(await oracle.isOracleAuthorized(third.address));
      assert.ok(await oracle.isOracleAuthorized(other.address));

      const rc3 = await (await oracle.setOracleAuthorized(third.address, false)).wait();
      const rc4 = await (await oracle.deauthorizeOracle(other.address)).wait();
      assert.equal(rc3.logs[0].topics[0], rc4.logs[0].topics[0]); // both OracleDeauthorized
      assert.notEqual(rc3.logs[0].topics[0], rc1.logs[0].topics[0]); // and not the same event
      assert.equal(await oracle.isOracleAuthorized(third.address), false);
      assert.equal(await oracle.isOracleAuthorized(other.address), false);
    });
  }
});
