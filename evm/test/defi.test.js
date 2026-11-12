const assert = require('assert');
const { setup, deploy, warp, expectRevert, expectCustomError, E, IMPL, bal, ethers } = require('./helpers');

const YEAR = 365n * 86400n;
const LIDO = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';

describe(`DeFiIntegration [${IMPL}]`, function () {
  this.timeout(120000);
  let s, owner, user, gov, defi;

  beforeEach(async () => {
    s = await setup();
    [owner, user, gov] = s.signers;
    defi = await deploy('DeFiIntegration', [], owner);
  });

  it('stakes with Lido and records position', async () => {
    await (await defi.connect(user).stakeWithLido({ value: E('1') })).wait();
    const ps = await defi.getUserYieldPositions(user.address);
    assert.equal(ps.length, 1);
    assert.equal(ps[0].amount, E('1'));
    assert.equal(ps[0].apy, 500n);
  });

  it('position value accrues linear APY yield', async () => {
    await (await defi.connect(user).stakeWithLido({ value: E('1') })).wait();
    await warp(YEAR);
    const v = await defi.getPositionValue(user.address, 0);
    assert.ok(v >= E('1.049') && v <= E('1.051'), `got ${v}`);
  });

  it('closes position, pays principal + yield, tracks earned', async () => {
    await (await defi.connect(user).stakeWithLido({ value: E('1') })).wait();
    await (await owner.sendTransaction({ to: await defi.getAddress(), value: E('1') })).wait(); // fund yield
    await warp(YEAR);
    const b0 = await bal(user.address);
    await (await defi.connect(user).closeYieldPosition(0)).wait();
    const b1 = await bal(user.address);
    assert.ok(b1 - b0 > E('1.04'));
    assert.ok(await defi.getTotalYieldEarned(user.address) > 0n);
    await expectRevert(defi.connect(user).closeYieldPosition(0), 'already closed');
  });

  it('projected yield math', async () => {
    const y = await defi.calculateProjectedYield(E('100'), LIDO, YEAR);
    assert.equal(y, E('5'));
  });

  it('protocol admin: authorize/deauthorize/update APY, owner only', async () => {
    await expectRevert(defi.connect(user).deauthorizeProtocol(LIDO));
    await (await defi.deauthorizeProtocol(LIDO)).wait();
    await expectRevert(defi.connect(user).stakeWithLido({ value: E('1') }), 'not authorized');
    await (await defi.authorizeProtocol(LIDO, 700n)).wait();
    await (await defi.updateProtocolAPY(LIDO, 800n)).wait();
    assert.equal(await defi.protocolAPYs(LIDO), 800n);
  });

  it('aave and compound flows record positions', async () => {
    await (await defi.connect(user).supplyToAave({ value: E('2') })).wait();
    await (await defi.connect(user).supplyToCompound({ value: E('3') })).wait();
    const ps = await defi.getUserYieldPositions(user.address);
    assert.equal(ps.length, 2);
    assert.equal(ps[0].apy, 300n);
    assert.equal(ps[1].apy, 250n);
  });

  if (IMPL === 'v2') {
    it('[v2] oversized apy reverts instead of silently truncating', async () => {
      // apy is packed into YieldPosition as uint32 (gas optimization pass); anything
      // above uint32 max must revert with ValueTooLarge rather than wrap around.
      const tooLarge = 2n ** 32n; // one past uint32 max
      await expectRevert(defi.authorizeProtocol(user.address, tooLarge), 'ValueTooLarge');
      await (await defi.authorizeProtocol(user.address, 700n)).wait();
      await expectRevert(defi.updateProtocolAPY(user.address, tooLarge), 'ValueTooLarge');
      // the max representable value still works and round-trips through a real position
      await (await defi.updateProtocolAPY(user.address, 2n ** 32n - 1n)).wait();
      assert.equal(await defi.protocolAPYs(user.address), 2n ** 32n - 1n);
    });

    // ---- governor role (part b2), tested independently of the governance contract ----
    // `gov` is a plain EOA standing in for RelicPayGovernance: the target side of the wiring is
    // just an address with a role, and nothing here should depend on who holds it.

    it('[v2] the governor can move protocol parameters, and only once appointed', async () => {
      const proto = user.address;
      assert.equal(await defi.governor(), ethers.ZeroAddress);
      await expectCustomError(
        defi.connect(gov).setProtocolAuthorized.staticCall(proto, true, 700n),
        'UnauthorizedGovernance'
      );

      await (await defi.setGovernor(gov.address)).wait();
      assert.ok(await defi.hasGovernanceRights(gov.address));

      await (await defi.connect(gov).setProtocolAuthorized(proto, true, 700n)).wait();
      assert.ok(await defi.authorizedProtocols(proto));
      assert.equal(await defi.protocolAPYs(proto), 700n);

      await (await defi.connect(gov).updateProtocolAPY(proto, 450n)).wait();
      assert.equal(await defi.protocolAPYs(proto), 450n);

      // deauthorize clears both the flag and the rate, same as the legacy owner-only path
      await (await defi.connect(gov).setProtocolAuthorized(proto, false, 0n)).wait();
      assert.equal(await defi.authorizedProtocols(proto), false);
      assert.equal(await defi.protocolAPYs(proto), 0n);

      await (await defi.setGovernor(ethers.ZeroAddress)).wait();
      await expectCustomError(
        defi.connect(gov).updateProtocolAPY.staticCall(proto, 450n),
        'UnauthorizedGovernance'
      );
    });

    it('[v2] setProtocolAuthorized rejects a non-zero apy on the deauthorize path', async () => {
      const proto = user.address;
      await (await defi.authorizeProtocol(proto, 700n)).wait();

      // the apy is unread when authorized is false, so accepting it would let two proposals that
      // hash differently have identical effects, with a number in the committed actions that
      // looks like it meant something
      await expectCustomError(
        defi.setProtocolAuthorized.staticCall(proto, false, 700n),
        'InvalidProtocolUpdate'
      );
      await expectCustomError(
        defi.setProtocolAuthorized.staticCall(proto, false, 1n),
        'InvalidProtocolUpdate'
      );
      assert.ok(await defi.authorizedProtocols(proto)); // nothing landed

      await (await defi.setProtocolAuthorized(proto, false, 0n)).wait();
      assert.equal(await defi.authorizedProtocols(proto), false);

      // the bound on apy still applies on the authorize path through the new entry point
      await expectRevert(defi.setProtocolAuthorized(proto, true, 2n ** 32n), 'ValueTooLarge');
      assert.equal(await defi.authorizedProtocols(proto), false);
    });

    it('[v2] onlyGovernance widened the owner surface without narrowing it', async () => {
      const proto = user.address;
      await (await defi.setGovernor(gov.address)).wait();

      // the owner keeps everything, including the functions that moved to onlyGovernance
      await (await defi.setProtocolAuthorized(proto, true, 700n)).wait();
      await (await defi.updateProtocolAPY(proto, 450n)).wait();
      assert.equal(await defi.protocolAPYs(proto), 450n);

      // the legacy pair is untouched and still owner-only
      await (await defi.deauthorizeProtocol(proto)).wait();
      assert.equal(await defi.authorizedProtocols(proto), false);
      await expectRevert(defi.connect(gov).authorizeProtocol(proto, 700n), 'OwnableUnauthorizedAccount');
      await expectRevert(defi.connect(gov).deauthorizeProtocol(proto), 'OwnableUnauthorizedAccount');

      // emergencyWithdraw moves funds rather than setting a parameter, so a 2 day timelock in
      // front of it would be a downgrade in exactly the case it exists for
      await expectRevert(defi.connect(gov).emergencyWithdraw(), 'OwnableUnauthorizedAccount');
      await expectRevert(defi.connect(gov).setGovernor(gov.address), 'OwnableUnauthorizedAccount');
    });
  }
});
