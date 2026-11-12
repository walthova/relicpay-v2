const assert = require('assert');
const { setup, deploy, warp, expectRevert, findEvent, E, IMPL, bal } = require('./helpers');

const DAY = 86400n;

describe(`EnhancedBnpl [${IMPL}]`, function () {
  this.timeout(120000);
  let s, owner, seller, buyer, bnpl, usd;

  beforeEach(async () => {
    s = await setup();
    [owner, seller, buyer] = s.signers;
    bnpl = await deploy('EnhancedBnpl', [], owner);
    usd = await deploy('MockERC20', [], owner);
  });

  async function createWithCredit(total, method, over = {}) {
    const p = Object.assign({ count: 3n, interval: 30n * DAY, grace: 7n * DAY }, over);
    const tx = await bnpl.createAgreementWithCredit(seller.address, buyer.address, total, p.count, p.interval, p.grace, method);
    const rc = await tx.wait();
    return findEvent(rc, bnpl, 'AgreementCreated').agreementId;
  }

  it('ETH collateral opens 80% credit line', async () => {
    await (await bnpl.connect(buyer).depositETHCollateral({ value: E('10') })).wait();
    const cl = await bnpl.getCreditLine(buyer.address);
    assert.equal(cl.collateralValue, E('10'));
    assert.equal(cl.creditLimit, E('8'));
    assert.equal(cl.availableCredit, E('8'));
  });

  it('ERC20 collateral adds to credit line', async () => {
    await (await usd.mint(buyer.address, E('100'))).wait();
    await (await usd.connect(buyer).approve(await bnpl.getAddress(), E('100'))).wait();
    await (await bnpl.connect(buyer).depositERC20Collateral(await usd.getAddress(), E('100'))).wait();
    const cl = await bnpl.getCreditLine(buyer.address);
    assert.equal(cl.creditLimit, E('80'));
    assert.equal((await bnpl.getUserCollateralPositionIds(buyer.address)).length, 1);
  });

  it('agreement requires available credit and reserves it', async () => {
    await expectRevert(bnpl.createAgreementWithCredit(seller.address, buyer.address, E('5'), 5n, DAY, DAY, 0), 'InsufficientCredit');
    await (await bnpl.connect(buyer).depositETHCollateral({ value: E('10') })).wait();
    await createWithCredit(E('6'), 0);
    const cl = await bnpl.getCreditLine(buyer.address);
    assert.equal(cl.usedCredit, E('6'));
    assert.equal(cl.availableCredit, E('2'));
  });

  it('manual payments credit seller balance; completion releases credit', async () => {
    await (await bnpl.connect(buyer).depositETHCollateral({ value: E('10') })).wait();
    const id = await createWithCredit(E('6'), 0);
    for (let n = 1n; n <= 3n; n++) {
      await warp(30n * DAY);
      await (await bnpl.connect(buyer).payInstallment(id, n, { value: E('2') })).wait();
    }
    assert.equal((await bnpl.getAgreement(id)).state, 1n);
    assert.equal(await bnpl.getSellerBalance(seller.address), E('6'));
    const cl = await bnpl.getCreditLine(buyer.address);
    assert.equal(cl.usedCredit, 0n);
    const b0 = await bal(seller.address);
    await (await bnpl.connect(seller).withdrawSellerBalance()).wait();
    assert.ok(await bal(seller.address) - b0 > E('5.9'));
  });

  it('collateral payment method pulls from positions', async () => {
    await (await bnpl.connect(buyer).depositETHCollateral({ value: E('10') })).wait();
    const id = await createWithCredit(E('6'), 2); // Collateral method
    await warp(30n * DAY);
    await (await bnpl.connect(buyer).payInstallment(id, 1n)).wait();
    assert.equal(await bnpl.getSellerBalance(seller.address), E('2'));
    assert.ok((await bnpl.getTotalCollateralValue(buyer.address)) < E('10'));
  });

  it('yield accrues and auto-reinvests after a day', async () => {
    await (await bnpl.connect(buyer).depositETHCollateral({ value: E('10') })).wait();
    await warp(365n * DAY);
    await (await bnpl.connect(buyer).depositETHCollateral({ value: E('1') })).wait(); // triggers update
    const v = await bnpl.getTotalCollateralValue(buyer.address);
    assert.ok(v > E('11.4') && v < E('11.6'), `got ${v}`); // ~5% APY on 10
  });

  if (IMPL === 'legacy') {
    it('[quirk V1-BUG-2] collateral backing open credit can be withdrawn', async () => {
      await (await bnpl.connect(buyer).depositETHCollateral({ value: E('10') })).wait();
      await createWithCredit(E('6'), 0);
      const ids = await bnpl.getUserCollateralPositionIds(buyer.address);
      await (await bnpl.connect(buyer).withdrawCollateral(ids[0], E('10'))).wait(); // drains backing
      const cl = await bnpl.getCreditLine(buyer.address);
      assert.equal(cl.collateralValue, 0n);
      assert.equal(cl.usedCredit, E('6')); // credit still outstanding, unbacked
    });
  }

  if (IMPL === 'v2') {
    it('[v2] withdrawal below required credit backing reverts', async () => {
      await (await bnpl.connect(buyer).depositETHCollateral({ value: E('10') })).wait();
      await createWithCredit(E('6'), 0);
      const ids = await bnpl.getUserCollateralPositionIds(buyer.address);
      await expectRevert(bnpl.connect(buyer).withdrawCollateral(ids[0], E('10')));
      await (await bnpl.connect(buyer).withdrawCollateral(ids[0], E('2'))).wait(); // keeps 8 >= 6/0.8=7.5
      const cl = await bnpl.getCreditLine(buyer.address);
      assert.equal(cl.collateralValue, E('8'));
    });

    it('[v2] oversized packed fields revert instead of silently truncating', async () => {
      // installmentCount, dueIntervalSeconds and gracePeriodSeconds are packed into
      // uint32 storage slots (gas optimization pass); anything above uint32 max must
      // revert with ValueTooLarge rather than wrap around.
      await (await bnpl.connect(buyer).depositETHCollateral({ value: E('10') })).wait();
      const tooBig = 2n ** 32n; // one past uint32 max
      await expectRevert(
        bnpl.createAgreementWithCredit(seller.address, buyer.address, E('1'), tooBig, 30n * DAY, 7n * DAY, 0),
        'ValueTooLarge'
      );
      await expectRevert(
        bnpl.createAgreementWithCredit(seller.address, buyer.address, E('1'), 1n, tooBig, 7n * DAY, 0),
        'ValueTooLarge'
      );
      await expectRevert(
        bnpl.createAgreementWithCredit(seller.address, buyer.address, E('1'), 1n, 30n * DAY, tooBig, 0),
        'ValueTooLarge'
      );
    });

    it('[v2] credit utilization is capped at MAX_CREDIT_UTILIZATION', async () => {
      // This contract reports utilization as a percent, not basis points. Paying from collateral
      // shrinks the credit limit while usedCredit stays outstanding until completion, so the raw
      // ratio runs past 100.
      assert.equal(await bnpl.MAX_CREDIT_UTILIZATION(), 100n);
      await (await bnpl.connect(buyer).depositETHCollateral({ value: E('10') })).wait();
      const id = await createWithCredit(E('6'), 2); // Collateral payment method

      // 6 used against an 8 limit. No time has passed yet so no yield has reinvested, which
      // makes this one exact; the later steps are bounded instead, since the 30 day warps
      // reinvest yield back into the collateral position.
      let cl = await bnpl.getCreditLine(buyer.address);
      assert.equal(cl.creditUtilization, 75n);

      // Installment 1: collateral 10 -> ~8, limit 8 -> ~6.4, still 6 used. Roughly 93%,
      // high but genuinely under the cap, so it must still be reported as a real ratio.
      await warp(30n * DAY);
      await (await bnpl.connect(buyer).payInstallment(id, 1n)).wait();
      cl = await bnpl.getCreditLine(buyer.address);
      assert.ok(cl.usedCredit <= cl.creditLimit, 'expected installment 1 to stay within the limit');
      assert.ok(cl.creditUtilization > 90n && cl.creditUtilization < 100n, `got ${cl.creditUtilization}`);

      // Installment 2: collateral ~8 -> ~6, limit ~6.4 -> ~4.8, still 6 used. Raw ratio ~124.
      await warp(30n * DAY);
      await (await bnpl.connect(buyer).payInstallment(id, 2n)).wait();
      cl = await bnpl.getCreditLine(buyer.address);
      assert.ok(cl.usedCredit > cl.creditLimit, 'expected a genuinely over-limit credit line');
      assert.equal(cl.creditUtilization, 100n);

      // Completion releases the credit and utilization returns to zero.
      await warp(30n * DAY);
      await (await bnpl.connect(buyer).payInstallment(id, 3n)).wait();
      cl = await bnpl.getCreditLine(buyer.address);
      assert.equal(cl.usedCredit, 0n);
      assert.equal(cl.creditUtilization, 0n);
    });

    // The push into userCollateralPositionIds was guarded on `position.amount == 0`, which reads as
    // "new position" but means "empty position", and an emptied position is still in the array. So
    // withdrawing a position to zero and then redepositing pushed it a second time, and every
    // consumer that walks the array counted the same storage twice: 10 ETH of collateral reading as
    // 20, and a credit limit to match. Found while adding RelicPay's withdrawal path, which has the
    // identical bug; fixed in both contracts.
    it('[v2] a position emptied and refunded is listed once, not twice', async () => {
      const ethPositionId = require('./helpers').ethers.solidityPackedKeccak256(
        ['address', 'address', 'string'],
        [buyer.address, require('./helpers').ethers.ZeroAddress, 'eth']
      );

      await (await bnpl.connect(buyer).depositETHCollateral({ value: E('10') })).wait();
      await (await bnpl.connect(buyer).withdrawCollateral(ethPositionId, E('10'))).wait();
      assert.equal((await bnpl.getCollateralPosition(buyer.address, ethPositionId)).amount, 0n);

      await (await bnpl.connect(buyer).depositETHCollateral({ value: E('10') })).wait();

      assert.equal((await bnpl.getUserCollateralPositionIds(buyer.address)).length, 1);
      assert.equal(await bnpl.getTotalCollateralValue(buyer.address), E('10'));
      assert.equal((await bnpl.getCreditLine(buyer.address)).creditLimit, E('8'));
      assert.equal(await bal(await bnpl.getAddress()), E('10'));
    });
  }
});
