const assert = require('assert');
const { setup, deploy, warp, expectRevert, findEvent, E, IMPL, bal } = require('./helpers');

const DAY = 86400n;

describe(`Bnpl [${IMPL}]`, function () {
  this.timeout(120000);
  let s, owner, seller, buyer, other, bnpl;

  beforeEach(async () => {
    s = await setup();
    [owner, seller, buyer, other] = s.signers;
    bnpl = await deploy('Bnpl', [], owner);
  });

  async function createDefault(over = {}) {
    const p = Object.assign({ total: E('10'), count: 5n, interval: 30n * DAY, collateral: E('2'), grace: 7n * DAY }, over);
    const tx = await bnpl.createAgreement(seller.address, buyer.address, p.total, p.count, p.interval, p.collateral, p.grace);
    const rc = await tx.wait();
    const ev = findEvent(rc, bnpl, 'AgreementCreated');
    return { id: ev.agreementId, p, ev };
  }

  it('creates agreement with correct fields and event', async () => {
    const { id, ev } = await createDefault();
    assert.equal(ev.totalPrice, E('10'));
    assert.equal(ev.installmentAmount, E('2'));
    const a = await bnpl.getAgreement(id);
    assert.equal(a.seller, seller.address);
    assert.equal(a.buyer, buyer.address);
    assert.equal(a.installmentCount, 5n);
    assert.equal(a.state, 0n); // Active
  });

  it('only owner can create agreements', async () => {
    await expectRevert(bnpl.connect(other).createAgreement(seller.address, buyer.address, E('1'), 1n, DAY, E('1'), DAY));
  });

  it('rejects zero-value parameters', async () => {
    await expectRevert(bnpl.createAgreement(seller.address, buyer.address, 0n, 1n, DAY, E('1'), DAY), 'Total price');
    await expectRevert(bnpl.createAgreement(seller.address, buyer.address, E('1'), 0n, DAY, E('1'), DAY), 'Installment count');
  });

  it('collateral: only buyer, exact amount', async () => {
    const { id } = await createDefault();
    await expectRevert(bnpl.connect(other).depositCollateral(id, { value: E('2') }));
    await expectRevert(bnpl.connect(buyer).depositCollateral(id, { value: E('1') }));
    await (await bnpl.connect(buyer).depositCollateral(id, { value: E('2') })).wait();
    assert.equal(await bnpl.collateralDeposited(id), E('2'));
  });

  it('happy path: all installments, completion, withdrawals', async () => {
    const { id } = await createDefault();
    await (await bnpl.connect(buyer).depositCollateral(id, { value: E('2') })).wait();
    for (let n = 1n; n <= 5n; n++) {
      await warp(30n * DAY);
      await (await bnpl.connect(buyer).payInstallment(id, n, { value: E('2') })).wait();
    }
    const a = await bnpl.getAgreement(id);
    assert.equal(a.state, 1n); // Completed
    const sb0 = await bal(seller.address);
    await (await bnpl.connect(seller).withdrawFunds(id)).wait();
    const sb1 = await bal(seller.address);
    assert.ok(sb1 - sb0 > E('9.9'));
    const bb0 = await bal(buyer.address);
    await (await bnpl.connect(buyer).withdrawCollateral(id)).wait();
    const bb1 = await bal(buyer.address);
    assert.ok(bb1 - bb0 > E('1.9'));
  });

  it('enforces exact installment amount and sequence', async () => {
    const { id } = await createDefault();
    await expectRevert(bnpl.connect(buyer).payInstallment(id, 1n, { value: E('1') }));
    await expectRevert(bnpl.connect(buyer).payInstallment(id, 2n, { value: E('2') })); // out of order (or not due)
    await expectRevert(bnpl.connect(other).payInstallment(id, 1n, { value: E('2') }));
  });

  it('early payoff with zero discount completes agreement', async () => {
    const { id } = await createDefault();
    await (await bnpl.connect(buyer).payInstallment(id, 1n, { value: E('2') })).wait();
    await (await bnpl.connect(buyer).earlyPayoff(id, 0n, { value: E('8') })).wait();
    const a = await bnpl.getAgreement(id);
    assert.equal(a.state, 1n);
  });

  it('default: seller claims collateral + paid installments after grace', async () => {
    const { id } = await createDefault();
    await (await bnpl.connect(buyer).depositCollateral(id, { value: E('2') })).wait();
    await (await bnpl.connect(buyer).payInstallment(id, 1n, { value: E('2') })).wait();
    await expectRevert(bnpl.connect(seller).triggerDefault(id)); // grace not expired
    await warp(30n * DAY + 7n * DAY + 60n * DAY);
    const sb0 = await bal(seller.address);
    await (await bnpl.connect(seller).triggerDefault(id)).wait();
    const sb1 = await bal(seller.address);
    assert.ok(sb1 - sb0 > E('3.9')); // 2 collateral + 2 paid
    assert.equal((await bnpl.getAgreement(id)).state, 2n); // Defaulted
    await expectRevert(bnpl.connect(other).triggerDefault(id));
  });

  it('withdrawals blocked while active', async () => {
    const { id } = await createDefault();
    await expectRevert(bnpl.connect(seller).withdrawFunds(id));
    await expectRevert(bnpl.connect(buyer).withdrawCollateral(id));
  });

  if (IMPL === 'legacy') {
    it('[quirk V1-BUG-1] buyer sets own discount and pays nothing', async () => {
      const { id } = await createDefault();
      await (await bnpl.connect(buyer).earlyPayoff(id, E('10'), { value: 0n })).wait();
      assert.equal((await bnpl.getAgreement(id)).state, 1n); // completed for free
    });
    it('[quirk V1-QUIRK-1] installment 1 due immediately, installment 2 not before interval', async () => {
      const { id } = await createDefault();
      await (await bnpl.connect(buyer).payInstallment(id, 1n, { value: E('2') })).wait();
      await expectRevert(bnpl.connect(buyer).payInstallment(id, 2n, { value: E('2') }), 'PaymentNotDue');
    });
  }

  if (IMPL === 'v2') {
    it('[v2] unapproved discount reverts, seller-approved discount honored', async () => {
      const { id } = await createDefault();
      await expectRevert(bnpl.connect(buyer).earlyPayoff(id, E('10'), { value: 0n }));
      await (await bnpl.connect(seller).approveDiscount(id, E('1'))).wait();
      await (await bnpl.connect(buyer).earlyPayoff(id, E('1'), { value: E('9') })).wait();
      assert.equal((await bnpl.getAgreement(id)).state, 1n);
    });
    it('[v2] prepayment allowed before due date', async () => {
      const { id } = await createDefault();
      await (await bnpl.connect(buyer).payInstallment(id, 1n, { value: E('2') })).wait();
      await (await bnpl.connect(buyer).payInstallment(id, 2n, { value: E('2') })).wait(); // early, allowed
      assert.equal((await bnpl.getAgreement(id)).paidInstallments, 2n);
    });
  }
});
