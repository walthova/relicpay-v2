const assert = require('assert');
const { setup, deploy, warp, expectRevert, expectCustomError, findEvent, E, IMPL, bal, ethers } = require('./helpers');

const DAY = 86400n;

describe(`RelicPay [${IMPL}]`, function () {
  this.timeout(120000);
  let s, owner, seller, buyer, rp, nft, usd;

  beforeEach(async () => {
    s = await setup();
    [owner, seller, buyer] = s.signers;
    rp = await deploy('RelicPay', [], owner);
    nft = await deploy('MockNFT', [], owner);
    usd = await deploy('MockERC20', [], owner);
    await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
  });

  async function mintRelicToSeller() {
    const tx = await nft.connect(seller).mint(seller.address);
    const rc = await tx.wait();
    const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
    await (await nft.connect(seller).approve(await rp.getAddress(), tokenId)).wait();
    return tokenId;
  }

  function rwa(tokenId) {
    return {
      physicalId: 'IBG-OPTIC-001',
      nftContract: nft.target,
      tokenId,
      metadataURI: 'ipfs://relic/1',
      ownershipTransferred: false,
      currentOwner: seller.address,
    };
  }

  async function createRWA(total, method, tokenId, over = {}) {
    const p = Object.assign({ count: 3n, interval: 30n * DAY, grace: 7n * DAY }, over);
    const tx = await rp.createAgreementWithRWA(seller.address, buyer.address, total, p.count, p.interval, p.grace, method, rwa(tokenId));
    return findEvent(await tx.wait(), rp, 'AgreementCreated').agreementId;
  }

  it('constructor sets governance defaults', async () => {
    const g = await rp.getGovernanceParams();
    assert.equal(g.creditLimitRatio, 8000n);
    assert.equal(g.defaultGracePeriod, 7n * DAY);
    assert.equal(g.minCollateralAmount, E('1'));
  });

  it('enforces minimum collateral', async () => {
    await expectRevert(rp.connect(buyer).depositETHCollateral(false, { value: E('0.5') }), 'Insufficient collateral');
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('5') })).wait();
    const cl = await rp.getCreditLine(buyer.address);
    assert.equal(cl.creditLimit, E('4'));
  });

  it('staked ETH collateral: legacy credits the simulated bonus, v2 does not (ADR-012)', async () => {
    await (await rp.connect(buyer).depositETHCollateral(true, { value: E('10') })).wait();
    const v = await rp.getTotalCollateralValue(buyer.address);
    if (IMPL === 'v2') {
      assert.equal(v, E('10')); // the +0.5% simulated bonus is recorded but backed by nothing
      const id = ethers.solidityPackedKeccak256(['address', 'address', 'string'], [buyer.address, ethers.ZeroAddress, 'staked']);
      assert.equal((await rp.getCollateralPosition(buyer.address, id)).stakingRewards, E('0.05'));
    } else {
      assert.equal(v, E('10.05')); // legacy: +0.5% simulated
    }
  });

  it('ERC20 collateral requires authorization', async () => {
    await (await usd.mint(buyer.address, E('10'))).wait();
    await (await usd.connect(buyer).approve(await rp.getAddress(), E('10'))).wait();
    await expectRevert(rp.connect(buyer).depositERC20Collateral(await usd.getAddress(), E('10')), 'not authorized');
    await (await rp.authorizeToken(await usd.getAddress(), true)).wait();
    await (await rp.connect(buyer).depositERC20Collateral(await usd.getAddress(), E('10'))).wait();
  });

  it('RWA agreement: creation, schedule, credit reservation', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    const tokenId = await mintRelicToSeller();
    await expectRevert(rp.createAgreementWithRWA(seller.address, buyer.address, E('20'), 3n, DAY, DAY, 0, rwa(tokenId)), 'InsufficientCredit');
    const id = await createRWA(E('6'), 0, tokenId);
    const sched = await rp.getPaymentSchedule(id);
    assert.equal(sched.length, 3);
    assert.equal(sched[0].amount, E('2'));
    const cl = await rp.getCreditLine(buyer.address);
    assert.equal(cl.usedCredit, E('6'));
    assert.equal((await rp.getAgreement(id)).state, 0n);
  });

  it('unauthorized NFT contract rejected', async () => {
    const badNft = await deploy('MockNFT', [], owner);
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    const bad = { physicalId: 'x', nftContract: badNft.target, tokenId: 1n, metadataURI: '', ownershipTransferred: false, currentOwner: seller.address };
    await expectRevert(rp.createAgreementWithRWA(seller.address, buyer.address, E('1'), 1n, DAY, DAY, 0, bad), 'not authorized');
  });

  it('manual payments complete agreement and transfer the relic NFT', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    const tokenId = await mintRelicToSeller();
    const id = await createRWA(E('6'), 0, tokenId);
    for (let n = 1n; n <= 3n; n++) {
      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, n, { value: E('2') })).wait();
    }
    assert.equal((await rp.getAgreement(id)).state, 1n);
    assert.equal(await nft.ownerOf(tokenId), buyer.address);
    assert.equal(await rp.getSellerBalance(seller.address), E('6'));
    const b0 = await bal(seller.address);
    await (await rp.connect(seller).withdrawSellerBalance()).wait();
    assert.ok(await bal(seller.address) - b0 > E('5.9'));
  });

  it('auto payment uses deposited balance', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    const tokenId = await mintRelicToSeller();
    const id = await createRWA(E('6'), 1, tokenId); // Auto
    await (await rp.connect(buyer).depositAutoPaymentFunds({ value: E('4') })).wait();
    await warp(30n * DAY);
    await (await rp.connect(buyer).processPayment(id, 1n)).wait();
    assert.equal(await rp.autoPaymentBalance(buyer.address), E('2'));
    assert.equal(await rp.getSellerBalance(seller.address), E('2'));
    await warp(30n * DAY);
    await warp(30n * DAY);
    await (await rp.connect(buyer).processPayment(id, 2n)).wait();
    await expectRevert(rp.connect(buyer).processPayment(id, 3n), 'InsufficientAutoPaymentBalance');
  });

  it('auto-with-collateral falls back to collateral', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    const tokenId = await mintRelicToSeller();
    const id = await createRWA(E('6'), 3, tokenId); // AutoWithCollateral
    await warp(30n * DAY);
    await (await rp.connect(buyer).processPayment(id, 1n)).wait(); // no auto balance -> collateral
    assert.equal(await rp.getSellerBalance(seller.address), E('2'));
    assert.ok(await rp.getTotalCollateralValue(buyer.address) < E('10'));
  });

  it('keeper: processOverduePayments settles from collateral and completes', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    const tokenId = await mintRelicToSeller();
    const id = await createRWA(E('6'), 0, tokenId);
    await warp(3n * 30n * DAY + 7n * DAY + DAY); // all overdue past grace
    await (await rp.processOverduePayments(id)).wait();
    assert.equal((await rp.getAgreement(id)).state, 1n);
    assert.equal(await nft.ownerOf(tokenId), buyer.address);
    assert.equal(await rp.getSellerBalance(seller.address), E('6'));
  });

  it('auto payment funds deposit/withdraw', async () => {
    await (await rp.connect(buyer).depositAutoPaymentFunds({ value: E('3') })).wait();
    await (await rp.connect(buyer).withdrawAutoPaymentFunds(E('1'))).wait();
    assert.equal(await rp.autoPaymentBalance(buyer.address), E('2'));
    await expectRevert(rp.connect(buyer).withdrawAutoPaymentFunds(E('5')), 'Insufficient balance');
    await (await rp.connect(buyer).setAutoPayment(true)).wait();
    assert.ok(await rp.autoPaymentEnabled(buyer.address));
  });

  it('owner governance setters', async () => {
    await (await rp.updateGovernanceParams(8500n, 5n * DAY, E('2'))).wait();
    const g = await rp.getGovernanceParams();
    assert.equal(g.creditLimitRatio, 8500n);
    await (await rp.setYieldRate('0x0000000000000000000000000000000000000000', 600n)).wait();
    await expectRevert(rp.connect(buyer).updateGovernanceParams(1n, 1n, 1n));
  });

  if (IMPL === 'v2') {
    it('[v2] the governor role sits beside the owner and never displaces it', async () => {
      // seller stands in for the governance contract here: the role is a plain address, and the
      // target does not care what is at the other end of it
      const governance = seller;
      assert.equal(await rp.governor(), ethers.ZeroAddress);
      assert.equal(await rp.hasGovernanceRights(owner.address), true);
      assert.equal(await rp.hasGovernanceRights(governance.address), false);

      // nobody is the governor yet, so a non-owner is refused
      await expectCustomError(
        rp.connect(governance).setCreditLimitRatio.staticCall(8500n),
        'UnauthorizedGovernance'
      );

      // only the owner appoints
      await expectRevert(rp.connect(buyer).setGovernor(governance.address), 'OwnableUnauthorizedAccount');
      const rc = await (await rp.setGovernor(governance.address)).wait();
      const ev = findEvent(rc, rp, 'GovernorUpdated');
      assert.equal(ev.previousGovernor, ethers.ZeroAddress);
      assert.equal(ev.newGovernor, governance.address);

      // the governor can move the governed parameters
      await (await rp.connect(governance).setCreditLimitRatio(8500n)).wait();
      await (await rp.connect(governance).setDefaultGracePeriod(5n * DAY)).wait();
      await (await rp.connect(governance).setMinCollateralAmount(E('2'))).wait();
      let g = await rp.getGovernanceParams();
      assert.equal(g.creditLimitRatio, 8500n);
      assert.equal(g.defaultGracePeriod, 5n * DAY);
      assert.equal(g.minCollateralAmount, E('2'));
      // each setter touched only its own field, so the three compose without clobbering
      assert.equal(g.maxAgreementDuration, 365n * DAY);

      // the owner did not lose anything by appointing one
      await (await rp.updateGovernanceParams(7000n, 3n * DAY, E('1'))).wait();
      assert.equal((await rp.getGovernanceParams()).creditLimitRatio, 7000n);
      await (await rp.connect(governance).authorizeToken(await usd.getAddress(), true)).wait();
      assert.ok(await rp.authorizedTokens(await usd.getAddress()));

      // and a third party is still nobody
      await expectCustomError(
        rp.connect(buyer).setCreditLimitRatio.staticCall(1n),
        'UnauthorizedGovernance'
      );

      // authorizeSettlementToken is deliberately outside the governed set
      await expectRevert(
        rp.connect(governance).authorizeSettlementToken(await usd.getAddress(), true),
        'OwnableUnauthorizedAccount'
      );

      // revocation is one transaction
      await (await rp.setGovernor(ethers.ZeroAddress)).wait();
      assert.equal(await rp.hasGovernanceRights(governance.address), false);
      await expectCustomError(
        rp.connect(governance).setCreditLimitRatio.staticCall(1n),
        'UnauthorizedGovernance'
      );
      assert.equal((await rp.getGovernanceParams()).creditLimitRatio, 7000n);
    });
  }

  if (IMPL === 'legacy') {
    it('[quirk V1-QUIRK-2] cannot pay before due date', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId);
      await expectRevert(rp.connect(buyer).processPayment(id, 1n, { value: E('2') }), 'PaymentNotDue');
    });
  }

  if (IMPL === 'v2') {
    it('[v2] early payment allowed', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId);
      await (await rp.connect(buyer).processPayment(id, 1n, { value: E('2') })).wait();
      assert.equal((await rp.getAgreement(id)).paidInstallments, 1n);
    });
    it('[v2] remainder lands on final installment', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('7') + 1n, 0, tokenId, { count: 3n });
      const sched = await rp.getPaymentSchedule(id);
      const sum = sched.reduce((a, x) => a + x.amount, 0n);
      assert.equal(sum, E('7') + 1n);
    });

    it('[v2] oversized packed fields revert instead of silently truncating', async () => {
      // installmentCount, dueIntervalSeconds and gracePeriodSeconds are packed into
      // uint32 storage slots (gas optimization pass); anything above uint32 max must
      // revert with ValueTooLarge rather than wrap around.
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const tooBig = 2n ** 32n; // one past uint32 max
      await expectRevert(
        rp.createAgreementWithRWA(seller.address, buyer.address, E('1'), tooBig, 30n * DAY, 7n * DAY, 0, rwa(tokenId)),
        'ValueTooLarge'
      );
      await expectRevert(
        rp.createAgreementWithRWA(seller.address, buyer.address, E('1'), 1n, tooBig, 7n * DAY, 0, rwa(tokenId)),
        'ValueTooLarge'
      );
      await expectRevert(
        rp.createAgreementWithRWA(seller.address, buyer.address, E('1'), 1n, 30n * DAY, tooBig, 0, rwa(tokenId)),
        'ValueTooLarge'
      );
    });

    it('[v2] credit utilization is capped at MAX_CREDIT_UTILIZATION', async () => {
      // creditUtilization is packed into uint16, which is only safe because it is clamped.
      // Paying from collateral shrinks the credit limit while usedCredit stays outstanding
      // until completion, so the raw ratio runs past 100%.
      assert.equal(await rp.MAX_CREDIT_UTILIZATION(), 10000n);
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 2, tokenId); // Collateral payment method

      // 6 used against an 8 limit. No time has passed yet so no yield has reinvested, which
      // makes this one exact; the later steps are bounded instead, since the 30 day warps
      // reinvest yield back into the collateral position.
      let cl = await rp.getCreditLine(buyer.address);
      assert.equal(cl.creditUtilization, 7500n);

      // Installment 1: collateral 10 -> ~8, limit 8 -> ~6.4, still 6 used. Roughly 9350 bps,
      // high but genuinely under the cap, so it must still be reported as a real ratio.
      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 1n)).wait();
      cl = await rp.getCreditLine(buyer.address);
      assert.ok(cl.usedCredit <= cl.creditLimit, 'expected installment 1 to stay within the limit');
      assert.ok(cl.creditUtilization > 9000n && cl.creditUtilization < 10000n, `got ${cl.creditUtilization}`);

      // Installment 2: collateral ~8 -> ~6, limit ~6.4 -> ~4.8, still 6 used. Raw ratio ~12400 bps.
      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 2n)).wait();
      cl = await rp.getCreditLine(buyer.address);
      assert.ok(cl.usedCredit > cl.creditLimit, 'expected a genuinely over-limit credit line');
      assert.equal(cl.creditUtilization, 10000n); // clamped at the cap, never above it

      // Completion releases the credit and utilization returns to zero.
      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 3n)).wait();
      cl = await rp.getCreditLine(buyer.address);
      assert.equal(cl.usedCredit, 0n);
      assert.equal(cl.creditUtilization, 0n);
    });

    // ---- Explicit Defaulted state (closes V1-QUIRK-3) ----
    // In v1 a RelicPay agreement had no path out of Active: a buyer who stopped paying left the
    // seller with reserved credit, an untransferred relic and no on-chain record of the failure.

    const ACTIVE = 0n, COMPLETED = 1n, DEFAULTED = 2n;
    const PAID = 1n, PS_DEFAULTED = 3n;

    it('[v2] seller triggers default after grace: seizes collateral, releases credit, keeps the relic', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId); // Manual, 3 x 2 ETH, 30d interval, 7d grace

      // Buyer pays the first installment, then walks away.
      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 1n, { value: E('2') })).wait();

      // Past installment 2's due date plus its grace period.
      await warp(30n * DAY + 7n * DAY + DAY);
      const rc = await (await rp.connect(seller).triggerDefault(id)).wait();

      const ev = findEvent(rc, rp, 'AgreementDefaulted');
      assert.equal(ev.missedInstallment, 2n);
      assert.equal(ev.outstanding, E('4')); // 6 total less the 2 already paid
      assert.equal(ev.collateralSeized, E('4')); // fully collateralised, so the seizure covers it

      const ag = await rp.getAgreement(id);
      assert.equal(ag.state, DEFAULTED);
      assert.ok((await rp.defaultedAt(id)) > 0n);
      assert.equal(await rp.getCollateralSeized(id), E('4'));

      // Seller holds 2 from the paid installment plus 4 seized, as a pull-payment balance.
      assert.equal(await rp.getSellerBalance(seller.address), E('6'));

      // Unpaid installments are marked, the paid one is untouched.
      const sched = await rp.getPaymentSchedule(id);
      assert.equal(sched[0].status, PAID);
      assert.equal(sched[1].status, PS_DEFAULTED);
      assert.equal(sched[2].status, PS_DEFAULTED);

      // The relic never moves: ownership transfer only happens on completion.
      assert.equal(await nft.ownerOf(tokenId), seller.address);
      assert.equal(ag.rwaAsset.ownershipTransferred, false);

      // The buyer's line is freed rather than stranded at 6 used forever.
      const cl = await rp.getCreditLine(buyer.address);
      assert.equal(cl.usedCredit, 0n);
      assert.equal(cl.creditUtilization, 0n);

      // Collateral shrank by exactly the seizure. Yield reinvested over 67 days is not credit-bearing (ADR-012).
      const left = await rp.getTotalCollateralValue(buyer.address);
      assert.equal(left, E('6'));

      // And the seller can actually take the money out.
      const before = await bal(seller.address);
      await (await rp.connect(seller).withdrawSellerBalance()).wait();
      assert.ok((await bal(seller.address)) > before);
    });

    it('[v2] triggerDefault is seller-only and refuses before the grace period expires', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId);

      await expectCustomError(rp.connect(seller).triggerDefault.staticCall(ethers.ZeroHash), 'AgreementNotFound');

      // Due date has not even arrived yet.
      await expectCustomError(rp.connect(seller).triggerDefault.staticCall(id), 'GracePeriodNotExpired');

      // Overdue, but still inside the 7 day grace window.
      await warp(30n * DAY + DAY);
      await expectCustomError(rp.connect(seller).triggerDefault.staticCall(id), 'GracePeriodNotExpired');
      await expectRevert(rp.connect(seller).triggerDefault(id));

      // Grace has now expired, but only the seller may call it. Not the buyer, not the owner.
      await warp(7n * DAY);
      await expectCustomError(rp.connect(buyer).triggerDefault.staticCall(id), 'UnauthorizedCaller');
      await expectCustomError(rp.connect(owner).triggerDefault.staticCall(id), 'UnauthorizedCaller');
      await expectRevert(rp.connect(buyer).triggerDefault(id));

      // None of the failed attempts moved the agreement off Active.
      assert.equal((await rp.getAgreement(id)).state, ACTIVE);
      assert.equal(await rp.getSellerBalance(seller.address), 0n);

      await (await rp.connect(seller).triggerDefault(id)).wait();
      assert.equal((await rp.getAgreement(id)).state, DEFAULTED);
    });

    it('[v2] Defaulted is terminal: no payments, no keeper sweep, no second default', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId);
      await warp(30n * DAY + 7n * DAY + DAY);
      await (await rp.connect(seller).triggerDefault(id)).wait();

      const seizedAfterDefault = await rp.getSellerBalance(seller.address);

      await expectCustomError(rp.connect(buyer).processPayment.staticCall(id, 1n, { value: E('2') }), 'AgreementNotActive');
      await expectCustomError(rp.processOverduePayments.staticCall(id), 'Agreement not active');
      await expectCustomError(rp.connect(seller).triggerDefault.staticCall(id), 'AgreementAlreadyDefaulted');

      // The same calls as real transactions, to prove nothing lands on chain either.
      await expectRevert(rp.connect(buyer).processPayment(id, 1n, { value: E('2') }));
      await expectRevert(rp.processOverduePayments(id));
      await expectRevert(rp.connect(seller).triggerDefault(id));

      // No double seizure from the repeat attempts.
      assert.equal(await rp.getSellerBalance(seller.address), seizedAfterDefault);
      assert.equal(await rp.getCollateralSeized(id), seizedAfterDefault);
    });

    it('[v2] a completed agreement cannot be defaulted', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId);
      for (const n of [1n, 2n, 3n]) {
        await warp(30n * DAY);
        await (await rp.connect(buyer).processPayment(id, n, { value: E('2') })).wait();
      }
      assert.equal((await rp.getAgreement(id)).state, COMPLETED);
      await warp(365n * DAY);
      await expectCustomError(rp.connect(seller).triggerDefault.staticCall(id), 'AgreementAlreadyCompleted');
      await expectRevert(rp.connect(seller).triggerDefault(id));
      assert.equal(await nft.ownerOf(tokenId), buyer.address);
    });

    it('[v2] an under-collateralised default seizes what is left instead of reverting', async () => {
      // Push the credit limit ratio above 100% so the agreement can be worth more than the
      // collateral backing it. Otherwise the 80% ratio guarantees the seizure always clears.
      await (await rp.updateGovernanceParams(12000n, 7n * DAY, E('1'))).wait();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      assert.equal((await rp.getCreditLine(buyer.address)).creditLimit, E('12'));

      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('11'), 0, tokenId, { count: 2n });

      await warp(30n * DAY + 7n * DAY + DAY);
      const rc = await (await rp.connect(seller).triggerDefault(id)).wait();
      const ev = findEvent(rc, rp, 'AgreementDefaulted');

      assert.equal(ev.outstanding, E('11')); // buyer paid nothing
      // ADR-010: seizure is capped at recorded principal (10 deposited). The ~37 days of simulated
      // 5% APY is backed by no ETH, so it is never paid to the seller.
      assert.equal(ev.collateralSeized, E('10'));
      assert.equal(await rp.getSellerBalance(seller.address), E('10'));

      // Principal is drained; only the unbacked yield remains on the position. The credit
      // reservation is still released in full.
      assert.equal(await rp.collateralPrincipal(buyer.address, (await rp.getUserCollateralPositionIds(buyer.address))[0]), 0n);
      // ADR-012: the leftover yield is not credit-bearing, so the buyer's collateral value is zero.
      const left = await rp.getTotalCollateralValue(buyer.address);
      assert.equal(left, 0n);
      const cl = await rp.getCreditLine(buyer.address);
      assert.equal(cl.usedCredit, 0n);
      assert.equal((await rp.getAgreement(id)).state, DEFAULTED);
    });

    it('[v2] getDefaultStatus reports the grace deadline without simulating the call', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId);
      const startTime = (await rp.getAgreement(id)).startTime;

      let st = await rp.getDefaultStatus(id);
      assert.equal(st.defaultable, false);
      assert.equal(st.nextInstallment, 1n);
      assert.equal(st.graceExpiry, startTime + 30n * DAY + 7n * DAY);
      assert.equal(st.outstanding, E('6'));

      // Paying installment 1 rolls the deadline forward to installment 2 and cuts the balance.
      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 1n, { value: E('2') })).wait();
      st = await rp.getDefaultStatus(id);
      assert.equal(st.nextInstallment, 2n);
      assert.equal(st.graceExpiry, startTime + 60n * DAY + 7n * DAY);
      assert.equal(st.outstanding, E('4'));
      assert.equal(st.defaultable, false);

      await warp(30n * DAY + 7n * DAY + DAY);
      st = await rp.getDefaultStatus(id);
      assert.equal(st.defaultable, true);

      // Terminal states report nothing actionable.
      await (await rp.connect(seller).triggerDefault(id)).wait();
      st = await rp.getDefaultStatus(id);
      assert.equal(st.defaultable, false);
      assert.equal(st.nextInstallment, 0n);
      assert.equal(st.outstanding, 0n);

      await expectCustomError(rp.getDefaultStatus(ethers.ZeroHash), 'AgreementNotFound');
    });

    // --- Stablecoin settlement for sellers (Phase 2, part a) ---

    // Give the buyer a stablecoin balance and an allowance to RelicPay, and authorize the token
    // as a settlement currency. Deliberately does NOT call authorizeToken: settlement and
    // collateral are separate registries and this proves it.
    async function enableStable(allowance = E('100')) {
      const addr = await usd.getAddress();
      await (await rp.authorizeSettlementToken(addr, true)).wait();
      await (await usd.mint(buyer.address, E('100'))).wait();
      await (await usd.connect(buyer).approve(await rp.getAddress(), allowance)).wait();
      return addr;
    }

    it('[v2] seller opts into stablecoin settlement and is paid in the token, not ETH', async () => {
      const usdAddr = await enableStable();
      await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
      assert.equal(await rp.sellerSettlementToken(seller.address), usdAddr);

      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId); // Manual

      assert.equal(await rp.getSettlementToken(id), usdAddr);
      const terms = await rp.getSettlementTerms(id);
      assert.equal(terms.token, usdAddr);
      assert.equal(terms.nextInstallment, 1n);
      assert.equal(terms.amount, E('2'));
      assert.equal(terms.requiresApproval, true);

      const rpAddr = await rp.getAddress();
      for (let n = 1n; n <= 3n; n++) {
        await warp(30n * DAY);
        await (await rp.connect(buyer).processPayment(id, n)).wait();
      }

      // Seller is credited in the stablecoin and holds no ETH balance at all.
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('6'));
      assert.equal(await rp.getSellerBalance(seller.address), 0n);
      assert.equal(await usd.balanceOf(rpAddr), E('6'));
      assert.equal(await usd.balanceOf(buyer.address), E('94'));

      // Agreement still completes and the relic still moves.
      assert.equal((await rp.getAgreement(id)).state, 1n);
      assert.equal(await nft.ownerOf(tokenId), buyer.address);

      // Pull payment out, same as the ETH path.
      await (await rp.connect(seller).withdrawSellerTokenBalance(usdAddr)).wait();
      assert.equal(await usd.balanceOf(seller.address), E('6'));
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), 0n);
      assert.equal(await usd.balanceOf(rpAddr), 0n);
    });

    it('[v2] a stablecoin agreement refuses attached ETH instead of trapping it', async () => {
      const usdAddr = await enableStable();
      await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId);

      await warp(30n * DAY);
      await expectCustomError(
        rp.connect(buyer).processPayment.staticCall(id, 1n, { value: E('2') }),
        'UnexpectedETHPayment'
      );
      // and the ETH path's own guard still applies to ETH-settled agreements
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), 0n);
    });

    it('[v2] settlement currency is snapshotted, so the seller cannot switch it mid-agreement', async () => {
      const usdAddr = await enableStable();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('20') })).wait();

      // Agreement 1 opens while the seller still wants ETH.
      const t1 = await mintRelicToSeller();
      const ethId = await createRWA(E('6'), 0, t1);
      assert.equal(await rp.getSettlementToken(ethId), ethers.ZeroAddress);

      // Seller flips to the stablecoin. Agreement 1 must not move with them.
      await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
      assert.equal(await rp.getSettlementToken(ethId), ethers.ZeroAddress);

      const t2 = await mintRelicToSeller();
      const usdId = await createRWA(E('6'), 0, t2);
      assert.equal(await rp.getSettlementToken(usdId), usdAddr);

      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(ethId, 1n, { value: E('2') })).wait();
      await (await rp.connect(buyer).processPayment(usdId, 1n)).wait();
      assert.equal(await rp.getSellerBalance(seller.address), E('2'));
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('2'));

      // Reverting to ETH also only affects agreements opened afterwards.
      await (await rp.connect(seller).setSettlementPreference(ethers.ZeroAddress)).wait();
      assert.equal(await rp.getSettlementToken(usdId), usdAddr);
      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(usdId, 2n)).wait();
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('4'));
    });

    it('[v2] only authorized settlement tokens can be chosen, and the registry is owner-gated', async () => {
      const usdAddr = await usd.getAddress();

      // Not authorized yet.
      await expectCustomError(
        rp.connect(seller).setSettlementPreference.staticCall(usdAddr),
        'InvalidSettlementToken'
      );
      // Collateral authorization is a different registry and does not grant settlement.
      await (await rp.authorizeToken(usdAddr, true)).wait();
      await expectCustomError(
        rp.connect(seller).setSettlementPreference.staticCall(usdAddr),
        'InvalidSettlementToken'
      );

      await expectRevert(rp.connect(seller).authorizeSettlementToken(usdAddr, true), 'OwnableUnauthorizedAccount');
      await expectCustomError(
        rp.authorizeSettlementToken.staticCall(ethers.ZeroAddress, true),
        'InvalidSettlementToken'
      );

      await (await rp.authorizeSettlementToken(usdAddr, true)).wait();
      await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
      assert.equal(await rp.settlementTokens(usdAddr), true);

      // De-authorizing blocks new agreements against that currency.
      await (await rp.authorizeSettlementToken(usdAddr, false)).wait();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      await expectCustomError(
        rp.createAgreementWithRWA.staticCall(
          seller.address, buyer.address, E('6'), 3n, 30n * DAY, 7n * DAY, 0, rwa(tokenId)
        ),
        'InvalidSettlementToken'
      );
    });

    it('[v2] de-authorizing a settlement token does not strand agreements already open', async () => {
      const usdAddr = await enableStable();
      await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId);

      await (await rp.authorizeSettlementToken(usdAddr, false)).wait();

      // Existing agreement keeps settling and the seller keeps their withdrawal path.
      for (let n = 1n; n <= 3n; n++) {
        await warp(30n * DAY);
        await (await rp.connect(buyer).processPayment(id, n)).wait();
      }
      assert.equal((await rp.getAgreement(id)).state, 1n);
      await (await rp.connect(seller).withdrawSellerTokenBalance(usdAddr)).wait();
      assert.equal(await usd.balanceOf(seller.address), E('6'));
    });

    it('[v2] every payment method now opens against a stablecoin-settled seller', async () => {
      // Part a rejected Auto, Collateral and AutoWithCollateral with UnsupportedSettlementMethod
      // because they had no settlement-currency path. Part b gave them one, so creation succeeds
      // for all four and each records the same snapshot.
      const usdAddr = await enableStable();
      await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('40') })).wait();

      for (const method of [0, 1, 2, 3]) {
        const tokenId = await mintRelicToSeller();
        const id = await createRWA(E('6'), method, tokenId);
        assert.equal(await rp.getSettlementToken(id), usdAddr);
        assert.equal((await rp.getAgreement(id)).paymentMethod, BigInt(method));
        // Only Manual asks the payer for an allowance at payment time; the others draw pools the
        // contract already holds.
        assert.equal((await rp.getSettlementTerms(id)).requiresApproval, method === 0);
      }
    });

    it('[v2] a stablecoin payment with no allowance reverts and leaves the schedule untouched', async () => {
      const usdAddr = await enableStable(0n); // minted, but no approval
      await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId);

      await warp(30n * DAY);
      await expectRevert(rp.connect(buyer).processPayment(id, 1n), 'revert');
      const sched = await rp.getPaymentSchedule(id);
      assert.equal(sched[0].status, 0n); // still Pending
      assert.equal((await rp.getAgreement(id)).paidInstallments, 0n);
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), 0n);

      // Approving unblocks it.
      await (await usd.connect(buyer).approve(await rp.getAddress(), E('100'))).wait();
      await (await rp.connect(buyer).processPayment(id, 1n)).wait();
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('2'));
    });

    it('[v2] a third party can settle a stablecoin installment on the buyer behalf', async () => {
      const usdAddr = await enableStable();
      const payer = s.signers[4];
      await (await usd.mint(payer.address, E('10'))).wait();
      await (await usd.connect(payer).approve(await rp.getAddress(), E('10'))).wait();

      await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId);

      await warp(30n * DAY);
      await (await rp.connect(payer).processPayment(id, 1n)).wait();
      // Tokens came from the payer, not the buyer.
      assert.equal(await usd.balanceOf(payer.address), E('8'));
      assert.equal(await usd.balanceOf(buyer.address), E('100'));
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('2'));
    });

    it('[v2] getSettlementTerms describes the ETH path and goes quiet on terminal states', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 0, tokenId);

      let terms = await rp.getSettlementTerms(id);
      assert.equal(terms.token, ethers.ZeroAddress);
      assert.equal(terms.amount, E('2'));
      assert.equal(terms.requiresApproval, false);

      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 1n, { value: E('2') })).wait();
      terms = await rp.getSettlementTerms(id);
      assert.equal(terms.nextInstallment, 2n);

      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 2n, { value: E('2') })).wait();
      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 3n, { value: E('2') })).wait();
      terms = await rp.getSettlementTerms(id);
      assert.equal(terms.nextInstallment, 0n);
      assert.equal(terms.amount, 0n);

      await expectCustomError(rp.getSettlementTerms(ethers.ZeroHash), 'AgreementNotFound');
      await expectCustomError(rp.getSettlementToken(ethers.ZeroHash), 'AgreementNotFound');
    });

    // --- Stablecoin settlement, part b: auto pools, collateral draws, default seizure ---

    // enableStable plus collateral authorization, so the buyer can also post the stablecoin as
    // collateral. Still two separate registries; this helper just opts into both.
    async function enableStableCollateral(mintAmount = E('100')) {
      const addr = await usd.getAddress();
      await (await rp.authorizeSettlementToken(addr, true)).wait();
      await (await rp.authorizeToken(addr, true)).wait();
      await (await usd.mint(buyer.address, mintAmount)).wait();
      await (await usd.connect(buyer).approve(await rp.getAddress(), mintAmount)).wait();
      await (await rp.connect(seller).setSettlementPreference(addr)).wait();
      return addr;
    }

    it('[v2] Auto payments on a stablecoin agreement draw the token pool, not the ETH one', async () => {
      const usdAddr = await enableStable();
      await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 1, tokenId); // Auto

      // A funded ETH pool is not a substitute: this agreement settles in the token.
      await (await rp.connect(buyer).depositAutoPaymentFunds({ value: E('10') })).wait();
      await warp(30n * DAY);
      await expectCustomError(
        rp.connect(buyer).processPayment.staticCall(id, 1n),
        'InsufficientAutoPaymentBalance'
      );

      await (await rp.connect(buyer).depositAutoPaymentTokens(usdAddr, E('4'))).wait();
      assert.equal(await rp.autoPaymentTokenBalance(buyer.address, usdAddr), E('4'));
      assert.equal(await rp.getAutoPaymentBalance(buyer.address, usdAddr), E('4'));
      assert.equal(await rp.getAutoPaymentBalance(buyer.address, ethers.ZeroAddress), E('10'));

      const rc = await (await rp.connect(buyer).processPayment(id, 1n)).wait();
      assert.equal(findEvent(rc, rp, 'PaymentProcessed').autoProcessed, true);
      assert.equal(await rp.autoPaymentTokenBalance(buyer.address, usdAddr), E('2'));
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('2'));

      // The ETH pool and the seller's ETH balance are both untouched throughout.
      assert.equal(await rp.autoPaymentBalance(buyer.address), E('10'));
      assert.equal(await rp.getSellerBalance(seller.address), 0n);

      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 2n)).wait();
      assert.equal(await rp.autoPaymentTokenBalance(buyer.address, usdAddr), 0n);

      // Pool exhausted; the ETH pool still cannot cover the shortfall.
      await warp(30n * DAY);
      await expectCustomError(
        rp.connect(buyer).processPayment.staticCall(id, 3n),
        'InsufficientAutoPaymentBalance'
      );
      assert.equal(await rp.getSellerBalance(seller.address), 0n);

      await (await rp.connect(buyer).depositAutoPaymentTokens(usdAddr, E('2'))).wait();
      await (await rp.connect(buyer).processPayment(id, 3n)).wait();
      assert.equal((await rp.getAgreement(id)).state, 1n);
      assert.equal(await nft.ownerOf(tokenId), buyer.address);
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('6'));
      assert.equal(await rp.getSellerBalance(seller.address), 0n);
    });

    it('[v2] the token auto-payment pool round-trips and is not gated on the settlement registry', async () => {
      const usdAddr = await enableStable();
      const rpAddr = await rp.getAddress();

      await expectCustomError(
        rp.connect(buyer).depositAutoPaymentTokens.staticCall(ethers.ZeroAddress, E('1')),
        'InvalidSettlementToken'
      );
      await expectCustomError(
        rp.connect(buyer).depositAutoPaymentTokens.staticCall(usdAddr, 0n),
        'Amount must be greater than 0'
      );

      await (await rp.connect(buyer).depositAutoPaymentTokens(usdAddr, E('10'))).wait();
      assert.equal(await usd.balanceOf(rpAddr), E('10'));
      assert.equal(await usd.balanceOf(buyer.address), E('90'));

      await expectCustomError(
        rp.connect(buyer).withdrawAutoPaymentTokens.staticCall(usdAddr, E('11')),
        'Insufficient balance'
      );
      // and one buyer's pool is not another's
      await expectCustomError(
        rp.connect(seller).withdrawAutoPaymentTokens.staticCall(usdAddr, E('1')),
        'Insufficient balance'
      );

      await (await rp.connect(buyer).withdrawAutoPaymentTokens(usdAddr, E('4'))).wait();
      assert.equal(await rp.autoPaymentTokenBalance(buyer.address, usdAddr), E('6'));
      assert.equal(await usd.balanceOf(buyer.address), E('94'));

      // Deposits are the buyer's own always-withdrawable funds, so an owner de-authorization must
      // not lock a buyer out of topping up an agreement that is already open.
      await (await rp.authorizeSettlementToken(usdAddr, false)).wait();
      await (await rp.connect(buyer).depositAutoPaymentTokens(usdAddr, E('1'))).wait();
      assert.equal(await rp.autoPaymentTokenBalance(buyer.address, usdAddr), E('7'));
      await (await rp.connect(buyer).withdrawAutoPaymentTokens(usdAddr, E('7'))).wait();
      assert.equal(await rp.autoPaymentTokenBalance(buyer.address, usdAddr), 0n);
      assert.equal(await usd.balanceOf(rpAddr), 0n);
    });

    it('[v2] Collateral payments on a stablecoin agreement draw the settlement asset only', async () => {
      const usdAddr = await enableStableCollateral();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      await (await rp.connect(buyer).depositERC20Collateral(usdAddr, E('10'))).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 2, tokenId); // Collateral

      const ethPos = ethers.solidityPackedKeccak256(
        ['address', 'address', 'string'], [buyer.address, ethers.ZeroAddress, 'eth']
      );
      const usdPos = ethers.solidityPackedKeccak256(
        ['address', 'address', 'string'], [buyer.address, usdAddr, 'erc20']
      );
      const ethBefore = (await rp.getCollateralPosition(buyer.address, ethPos)).amount;

      for (let n = 1n; n <= 3n; n++) {
        await warp(30n * DAY);
        await (await rp.connect(buyer).processPayment(id, n)).wait();
      }

      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('6'));
      assert.equal(await rp.getSellerBalance(seller.address), 0n);
      assert.equal((await rp.getCollateralPosition(buyer.address, usdPos)).amount, E('4'));
      // The ETH position only ever grew, from its own reinvested yield. Nothing was drawn from it.
      assert.ok((await rp.getCollateralPosition(buyer.address, ethPos)).amount >= ethBefore);

      assert.equal((await rp.getAgreement(id)).state, 1n);
      assert.equal(await nft.ownerOf(tokenId), buyer.address);
      await (await rp.connect(seller).withdrawSellerTokenBalance(usdAddr)).wait();
      assert.equal(await usd.balanceOf(seller.address), E('6'));
    });

    it('[v2] a stablecoin collateral draw refuses to pay the seller in the wrong asset', async () => {
      // Buyer posts ETH only. Falling back to it would credit the seller in exactly the currency
      // they opted out of, so the draw reverts instead.
      const usdAddr = await enableStableCollateral();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 2, tokenId); // Collateral

      let r = await rp.getSettlementReadiness(id);
      assert.equal(r.token, usdAddr);
      assert.equal(r.required, E('2'));
      assert.equal(r.collateralAvailable, 0n);
      assert.equal(r.ready, false);

      await warp(30n * DAY);
      await expectCustomError(
        rp.connect(buyer).processPayment.staticCall(id, 1n),
        'InsufficientSettlementCollateral'
      );
      // Nothing moved: not the schedule, not the seller's ETH balance.
      assert.equal((await rp.getPaymentSchedule(id))[0].status, 0n);
      assert.equal(await rp.getSellerBalance(seller.address), 0n);

      // Posting the settlement asset unblocks it, and the view says so first.
      await (await rp.connect(buyer).depositERC20Collateral(usdAddr, E('5'))).wait();
      r = await rp.getSettlementReadiness(id);
      assert.equal(r.collateralAvailable, E('5'));
      assert.equal(r.ready, true);

      await (await rp.connect(buyer).processPayment(id, 1n)).wait();
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('2'));
      assert.equal(await rp.getSellerBalance(seller.address), 0n);

      // Drain it below one installment and the strictness bites again rather than reaching for ETH.
      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 2n)).wait();
      assert.equal((await rp.getSettlementReadiness(id)).collateralAvailable, E('1'));
      await warp(30n * DAY);
      await expectCustomError(
        rp.connect(buyer).processPayment.staticCall(id, 3n),
        'InsufficientSettlementCollateral'
      );
      assert.equal(await rp.getSellerBalance(seller.address), 0n);
    });

    it('[v2] AutoWithCollateral on a stablecoin agreement falls from the token pool to token collateral', async () => {
      const usdAddr = await enableStableCollateral();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      await (await rp.connect(buyer).depositERC20Collateral(usdAddr, E('10'))).wait();
      await (await rp.connect(buyer).depositAutoPaymentTokens(usdAddr, E('2'))).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 3, tokenId); // AutoWithCollateral

      const usdPos = ethers.solidityPackedKeccak256(
        ['address', 'address', 'string'], [buyer.address, usdAddr, 'erc20']
      );

      // Installment 1 comes out of the pool.
      await warp(30n * DAY);
      let rc = await (await rp.connect(buyer).processPayment(id, 1n)).wait();
      assert.equal(findEvent(rc, rp, 'PaymentProcessed').autoProcessed, true);
      assert.equal(await rp.autoPaymentTokenBalance(buyer.address, usdAddr), 0n);
      assert.equal((await rp.getCollateralPosition(buyer.address, usdPos)).amount, E('10'));

      // Pool is empty, so 2 and 3 fall through to the stablecoin collateral.
      for (const n of [2n, 3n]) {
        await warp(30n * DAY);
        rc = await (await rp.connect(buyer).processPayment(id, n)).wait();
        assert.equal(findEvent(rc, rp, 'PaymentProcessed').autoProcessed, false);
      }
      assert.equal((await rp.getCollateralPosition(buyer.address, usdPos)).amount, E('6'));
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('6'));
      assert.equal(await rp.getSellerBalance(seller.address), 0n);
      assert.equal((await rp.getAgreement(id)).state, 1n);
    });

    it('[v2] the keeper sweep honours the settlement currency', async () => {
      const usdAddr = await enableStableCollateral();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      await (await rp.connect(buyer).depositERC20Collateral(usdAddr, E('10'))).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('6'), 2, tokenId);

      await warp(120n * DAY); // every installment now past its grace period
      await (await rp.connect(s.signers[5]).processOverduePayments(id)).wait();

      assert.equal((await rp.getAgreement(id)).state, 1n);
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('6'));
      assert.equal(await rp.getSellerBalance(seller.address), 0n);
      assert.equal(await nft.ownerOf(tokenId), buyer.address);
    });

    it('[v2] default seizure takes the settlement asset first, then whatever is left', async () => {
      const usdAddr = await enableStableCollateral();
      // ETH deposited first, so under the pre-part-b single unordered pass it would be taken first.
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      await (await rp.connect(buyer).depositERC20Collateral(usdAddr, E('10'))).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('15'), 0, tokenId); // Manual, 3 x E('5')

      const usdPos = ethers.solidityPackedKeccak256(
        ['address', 'address', 'string'], [buyer.address, usdAddr, 'erc20']
      );

      await warp(40n * DAY); // past installment 1's due date + grace
      assert.equal((await rp.getDefaultStatus(id)).defaultable, true);
      await (await rp.connect(seller).triggerDefault(id)).wait();

      // The whole stablecoin position went first; ETH covered only the remainder.
      assert.equal(await rp.getSellerTokenBalance(seller.address, usdAddr), E('10'));
      assert.equal(await rp.getSellerBalance(seller.address), E('5'));
      assert.equal(await rp.getCollateralSeized(id), E('15'));
      assert.equal((await rp.getCollateralPosition(buyer.address, usdPos)).amount, 0n);
      assert.equal((await rp.getAgreement(id)).state, 2n);
      assert.equal(await nft.ownerOf(tokenId), seller.address);
      assert.equal((await rp.getCreditLine(buyer.address)).usedCredit, 0n);
    });

    it('[v2] an ETH-settled default keeps the pre-part-b seizure order', async () => {
      // Same collateral, same price, no settlement preference. ETH is drained first here, which is
      // the decisive contrast with the test above: seller ETH ends up at E('10'), impossible if
      // the stablecoin position had been taken first.
      const usdAddr = await usd.getAddress();
      await (await rp.authorizeToken(usdAddr, true)).wait();
      await (await usd.mint(buyer.address, E('100'))).wait();
      await (await usd.connect(buyer).approve(await rp.getAddress(), E('100'))).wait();

      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      await (await rp.connect(buyer).depositERC20Collateral(usdAddr, E('10'))).wait();
      const tokenId = await mintRelicToSeller();
      const id = await createRWA(E('15'), 0, tokenId);

      await warp(40n * DAY);
      await (await rp.connect(seller).triggerDefault(id)).wait();

      const ethTaken = await rp.getSellerBalance(seller.address);
      const usdTaken = await rp.getSellerTokenBalance(seller.address, usdAddr);
      // ADR-010: the ETH position gives up its 10 of principal (not its simulated yield), then the
      // stablecoin covers the tail.
      assert.equal(ethTaken, E('10'), `expected ETH first, got ${ethTaken}`);
      assert.equal(usdTaken, E('5'), `expected the stablecoin to cover only the tail, got ${usdTaken}`);
      assert.equal(ethTaken + usdTaken, E('15'));
      assert.equal(await rp.getCollateralSeized(id), E('15'));
    });

    it('[v2] getSettlementReadiness reports per method and goes quiet on terminal states', async () => {
      const usdAddr = await enableStableCollateral();
      // Generous ETH collateral so all four agreements below fit in one credit line; the
      // stablecoin position is deliberately small, since it is the number under test.
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('60') })).wait();
      await (await rp.connect(buyer).depositERC20Collateral(usdAddr, E('3'))).wait();
      await (await rp.connect(buyer).depositAutoPaymentTokens(usdAddr, E('2'))).wait();

      // Auto: satisfied by the pool alone.
      const autoId = await createRWA(E('6'), 1, await mintRelicToSeller());
      let r = await rp.getSettlementReadiness(autoId);
      assert.equal(r.autoBalance, E('2'));
      assert.equal(r.collateralAvailable, E('3'));
      assert.equal(r.ready, true);

      // Collateral: satisfied by the position alone, and the pool is irrelevant to it.
      const colId = await createRWA(E('12'), 2, await mintRelicToSeller()); // 3 x E('4')
      r = await rp.getSettlementReadiness(colId);
      assert.equal(r.required, E('4'));
      assert.equal(r.ready, false); // only E('3') of stablecoin collateral posted

      // AutoWithCollateral takes either, so it is ready when the smaller installment fits the pool.
      const bothId = await createRWA(E('6'), 3, await mintRelicToSeller());
      assert.equal((await rp.getSettlementReadiness(bothId)).ready, true);

      // Manual is never reported ready: settlement depends on the payer's allowance, which this
      // contract cannot see from the buyer alone. getSettlementTerms covers that case.
      const manualId = await createRWA(E('6'), 0, await mintRelicToSeller());
      assert.equal((await rp.getSettlementReadiness(manualId)).ready, false);
      assert.equal((await rp.getSettlementTerms(manualId)).requiresApproval, true);

      // Terminal states report nothing.
      for (let n = 1n; n <= 3n; n++) {
        await warp(30n * DAY);
        await (await rp.connect(buyer).processPayment(autoId, n)).wait();
        if (n === 1n) await (await rp.connect(buyer).depositAutoPaymentTokens(usdAddr, E('4'))).wait();
      }
      assert.equal((await rp.getAgreement(autoId)).state, 1n);
      r = await rp.getSettlementReadiness(autoId);
      assert.equal(r.token, ethers.ZeroAddress);
      assert.equal(r.required, 0n);
      assert.equal(r.ready, false);

      await expectCustomError(rp.getSettlementReadiness(ethers.ZeroHash), 'AgreementNotFound');

      // The ETH path reads the ETH pool through the same view without the caller branching.
      assert.equal(await rp.getAutoPaymentBalance(buyer.address, ethers.ZeroAddress), 0n);
      await (await rp.connect(buyer).depositAutoPaymentFunds({ value: E('1') })).wait();
      assert.equal(await rp.getAutoPaymentBalance(buyer.address, ethers.ZeroAddress), E('1'));
    });
  }

  // Collateral withdrawal. The counterpart depositETHCollateral/depositERC20Collateral never had:
  // before this, collateral left the contract only through a payment draw or a default seizure.
  if (IMPL === 'v2') {
    const ethPositionId = (who, staked = false) =>
      ethers.solidityPackedKeccak256(['address', 'address', 'string'], [who, ethers.ZeroAddress, staked ? 'staked' : 'eth']);
    const erc20PositionId = (who, token) =>
      ethers.solidityPackedKeccak256(['address', 'address', 'string'], [who, token, 'erc20']);

    async function positionIds(who) {
      const out = [];
      for (let i = 0; ; i++) {
        try { out.push(await rp.userCollateralPositionIds(who, i)); } catch (_) { return out; }
      }
    }

    it('[v2] unencumbered collateral comes back out, whole or in part', async () => {
      const pid = ethPositionId(buyer.address);
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      assert.equal((await rp.getCreditLine(buyer.address)).creditLimit, E('8'));
      assert.equal(await rp.getWithdrawableCollateral(buyer.address, pid), E('10'));

      // Partial: the position and the credit line both fall by exactly the amount taken.
      const before = await bal(buyer.address);
      const rc = await (await rp.connect(buyer).withdrawCollateral(pid, E('4'))).wait();
      const gas = rc.gasUsed * rc.gasPrice;
      assert.equal(await bal(buyer.address) - before + gas, E('4'));
      assert.equal((await rp.getCollateralPosition(buyer.address, pid)).amount, E('6'));
      assert.equal((await rp.getCreditLine(buyer.address)).creditLimit, E('4.8'));

      const ev = findEvent(rc, rp, 'CollateralWithdrawn');
      assert.equal(ev.amount, E('4'));
      assert.equal(ev.tokenAddress, ethers.ZeroAddress);
      assert.equal(ev.creditLimit, E('4.8'));

      // Remainder: position empties, credit line goes to zero, contract is left holding nothing.
      await (await rp.connect(buyer).withdrawCollateral(pid, E('6'))).wait();
      assert.equal((await rp.getCollateralPosition(buyer.address, pid)).amount, 0n);
      assert.equal((await rp.getCreditLine(buyer.address)).creditLimit, 0n);
      assert.equal(await bal(await rp.getAddress()), 0n);
    });

    it('[v2] rejects a zero amount and anything past the position', async () => {
      const pid = ethPositionId(buyer.address);
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('5') })).wait();
      await expectRevert(rp.connect(buyer).withdrawCollateral(pid, 0n), 'Amount must be greater than 0');
      await expectCustomError(rp.connect(buyer).withdrawCollateral.staticCall(pid, E('5.000000000000000001')), 'InsufficientCollateral');
      // A position the caller never opened is simply empty, not someone else's.
      await expectCustomError(rp.connect(seller).withdrawCollateral.staticCall(pid, E('1')), 'InsufficientCollateral');
    });

    // V1-BUG-2. EnhancedBnpl v1's withdrawCollateral checked nothing, so collateral backing an open
    // agreement could walk out from under it. The fix is not "refuse while any credit is open", it
    // is "refuse this withdrawal if it would leave the credit unbacked", so the spare still comes
    // back out.
    it('[v2] collateral backing open credit cannot be withdrawn, but the spare above it can', async () => {
      const pid = ethPositionId(buyer.address);
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      await createRWA(E('4'), 0, await mintRelicToSeller());
      assert.equal((await rp.getCreditLine(buyer.address)).usedCredit, E('4'));

      // 4 ETH of used credit at an 8000bp ratio needs 5 ETH of collateral behind it, so 5 is spare.
      assert.equal(await rp.getWithdrawableCollateral(buyer.address, pid), E('5'));
      await expectCustomError(
        rp.connect(buyer).withdrawCollateral.staticCall(pid, E('5.000000000000000001')),
        'CollateralBacksOpenCredit'
      );

      // Exactly the reported ceiling goes through, and lands the line precisely on its backing.
      await (await rp.connect(buyer).withdrawCollateral(pid, E('5'))).wait();
      const cl = await rp.getCreditLine(buyer.address);
      assert.equal(cl.creditLimit, E('4'));
      assert.equal(cl.usedCredit, E('4'));
      assert.equal(cl.availableCredit, 0n);
      assert.equal(await rp.getWithdrawableCollateral(buyer.address, pid), 0n);
      await expectCustomError(rp.connect(buyer).withdrawCollateral.staticCall(pid, 1n), 'CollateralBacksOpenCredit');
    });

    it('[v2] paying an agreement off frees its collateral again', async () => {
      const pid = ethPositionId(buyer.address);
      // Yield off: this test is about credit release, and leaving 5% APY on across three 30-day
      // warps just adds a reinvested remainder to every figure. The yield case has its own test.
      await (await rp.setYieldRate(ethers.ZeroAddress, 0)).wait();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const id = await createRWA(E('4'), 0, await mintRelicToSeller());
      await expectCustomError(rp.connect(buyer).withdrawCollateral.staticCall(pid, E('10')), 'CollateralBacksOpenCredit');

      for (let n = 1n; n <= 3n; n++) {
        await warp(30n * DAY);
        const due = (await rp.getPaymentSchedule(id))[Number(n) - 1].amount;
        await (await rp.connect(buyer).processPayment(id, n, { value: due })).wait();
      }
      assert.equal((await rp.getAgreement(id)).state, 1n); // Completed
      assert.equal((await rp.getCreditLine(buyer.address)).usedCredit, 0n);

      // Manual payments came from the buyer's wallet, not their collateral, so all 10 is back.
      assert.equal(await rp.getWithdrawableCollateral(buyer.address, pid), E('10'));
      await (await rp.connect(buyer).withdrawCollateral(pid, E('10'))).wait();
      assert.equal((await rp.getCollateralPosition(buyer.address, pid)).amount, 0n);
    });

    // The reason collateralPrincipal exists. position.amount is not principal: _updateYield folds
    // simulated yield into it with autoReinvest on, and nothing in this contract earns a real
    // return, so that part of the balance is backed by nothing. Withdrawing it would be paying a
    // buyer out of other users' deposits.
    it('[v2] simulated yield neither inflates the credit line nor is withdrawable', async () => {
      const pid = ethPositionId(buyer.address);
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();

      // Another buyer's deposit is the pool the phantom yield would have been paid out of.
      const stranger = s.signers[4];
      await (await rp.connect(stranger).depositETHCollateral(false, { value: E('10') })).wait();
      const held = await bal(await rp.getAddress());
      assert.equal(held, E('20'));

      await warp(365n * DAY);
      // Any credit-line touch settles yield. 5% APY on 10 ETH for a year, reinvested.
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('1') })).wait();
      const position = await rp.getCollateralPosition(buyer.address, pid);
      const principal = await rp.collateralPrincipal(buyer.address, pid);
      assert.equal(principal, E('11'));
      assert.ok(position.amount > principal, `expected yield drift, amount ${position.amount} principal ${principal}`);

      // ADR-012: the drift earns no credit. 80% of 11 ETH of principal, to the wei.
      assert.equal((await rp.getCreditLine(buyer.address)).creditLimit, E('8.8'));
      assert.equal(await rp.getTotalCollateralValue(buyer.address), E('11'));

      // It is not withdrawable, and the bound is principal rather than amount.
      assert.equal(await rp.getWithdrawableCollateral(buyer.address, pid), E('11'));
      await expectCustomError(
        rp.connect(buyer).withdrawCollateral.staticCall(pid, position.amount),
        'ExceedsWithdrawablePrincipal'
      );

      await (await rp.connect(buyer).withdrawCollateral(pid, E('11'))).wait();
      // Every wei the buyer deposited came back and not one wei of the stranger's did.
      assert.equal(await bal(await rp.getAddress()), E('10'));
      assert.equal(await rp.getWithdrawableCollateral(buyer.address, pid), 0n);

      // The drift is left stranded in the position rather than paid out: principal is spent, so
      // the remaining "balance" is unwithdrawable for good. It earns no credit either (ADR-012).
      const residual = (await rp.getCollateralPosition(buyer.address, pid)).amount;
      assert.ok(residual > 0n, 'expected the reinvested yield to remain on the position');
      assert.equal(await rp.collateralPrincipal(buyer.address, pid), 0n);
      assert.equal(await rp.getTotalCollateralValue(buyer.address), 0n);
      await expectCustomError(
        rp.connect(buyer).withdrawCollateral.staticCall(pid, residual),
        'ExceedsWithdrawablePrincipal'
      );
    });

    // The double-listing bug, which withdrawCollateral turns into a two-transaction exploit.
    // The push into userCollateralPositionIds used to be guarded on `position.amount == 0`, which
    // reads as "new position" but means "empty position" -- and an emptied position is still in the
    // array, so a refund pushed it a second time and every consumer walking the array counted the
    // same storage twice.
    it('[v2] a position emptied and refunded is listed once, not twice', async () => {
      const pid = ethPositionId(buyer.address);
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      await (await rp.connect(buyer).withdrawCollateral(pid, E('10'))).wait();
      assert.equal((await rp.getCollateralPosition(buyer.address, pid)).amount, 0n);

      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();

      assert.deepEqual(await positionIds(buyer.address), [pid]);
      assert.equal((await rp.getUserCollateralPositionIds(buyer.address)).length, 1);
      // The number that mattered: 10 ETH in the contract must not read as 20 ETH of collateral.
      assert.equal(await rp.getTotalCollateralValue(buyer.address), E('10'));
      assert.equal((await rp.getCreditLine(buyer.address)).creditLimit, E('8'));
      assert.equal(await rp.getSettlementCollateral(buyer.address, ethers.ZeroAddress), E('10'));
      assert.equal(await bal(await rp.getAddress()), E('10'));
    });

    it('[v2] ERC20 collateral round-trips through the same path', async () => {
      const usdAddr = await usd.getAddress();
      const pid = erc20PositionId(buyer.address, usdAddr);
      await (await rp.authorizeToken(usdAddr, true)).wait();
      await (await usd.mint(buyer.address, E('10'))).wait();
      await (await usd.connect(buyer).approve(await rp.getAddress(), E('10'))).wait();
      await (await rp.connect(buyer).depositERC20Collateral(usdAddr, E('10'))).wait();
      assert.equal(await usd.balanceOf(buyer.address), 0n);

      await (await rp.connect(buyer).withdrawCollateral(pid, E('6'))).wait();
      // Paid in the position's own asset, not in ETH.
      assert.equal(await usd.balanceOf(buyer.address), E('6'));
      assert.equal(await usd.balanceOf(await rp.getAddress()), E('4'));
      assert.equal(await rp.getSettlementCollateral(buyer.address, usdAddr), E('4'));

      const ev = findEvent(
        await (await rp.connect(buyer).withdrawCollateral(pid, E('4'))).wait(), rp, 'CollateralWithdrawn'
      );
      assert.equal(ev.tokenAddress, usdAddr);
      assert.equal(await usd.balanceOf(buyer.address), E('10'));
    });

    // A settlement draw spends principal too, so it has to move the withdrawal ceiling with it.
    // If it did not, a buyer could pay a seller out of collateral and then withdraw the same wei.
    it('[v2] a collateral-settled payment lowers what is left to withdraw', async () => {
      const pid = ethPositionId(buyer.address);
      // Yield off so the draw is the only thing moving the numbers; see the note above.
      await (await rp.setYieldRate(ethers.ZeroAddress, 0)).wait();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const id = await createRWA(E('3'), 2, await mintRelicToSeller()); // PaymentMethod.Collateral

      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 1n)).wait();
      assert.equal((await rp.getCollateralPosition(buyer.address, pid)).amount, E('9'));
      assert.equal(await rp.collateralPrincipal(buyer.address, pid), E('9'));
      assert.equal(await rp.getSellerBalance(seller.address), E('1'));

      // Credit is reserved for the whole agreement and released on completion, not per
      // installment, so all 3 ETH of usedCredit still stands after paying one. 3 at an 8000bp
      // ratio needs 3.75 behind it, and 9 held leaves 5.25 spare. Principal is 9 here, so the
      // backing gate binds first, not the principal one.
      assert.equal((await rp.getCreditLine(buyer.address)).usedCredit, E('3'));
      assert.equal(await rp.getWithdrawableCollateral(buyer.address, pid), E('5.25'));
      await (await rp.connect(buyer).withdrawCollateral(pid, E('5.25'))).wait();

      // The seller's 1 ETH is still there to be withdrawn: the buyer did not take it back, which
      // is the whole point of decrementing principal on a settlement draw.
      assert.equal(await bal(await rp.getAddress()), E('4.75')); // 3.75 collateral + 1 seller
      await (await rp.connect(seller).withdrawSellerBalance()).wait();
      assert.equal(await bal(await rp.getAddress()), E('3.75'));
    });

    // getWithdrawableCollateral is the dashboard's pre-flight, so it has to agree with the chain
    // exactly. Sweeping the boundary is the only way to prove it does not over-promise by a wei.
    it('[v2] getWithdrawableCollateral matches what the chain actually accepts', async () => {
      const pid = ethPositionId(buyer.address);
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();

      for (const price of [E('1'), E('3'), E('4.5'), E('7')]) {
        const fresh = await setup();
        rp = await deploy('RelicPay', [], fresh.signers[0]);
        nft = await deploy('MockNFT', [], fresh.signers[0]);
        [owner, seller, buyer] = fresh.signers;
        await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
        await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
        await createRWA(price, 0, await mintRelicToSeller());

        const max = await rp.getWithdrawableCollateral(buyer.address, ethPositionId(buyer.address));
        // One wei past the reported ceiling must be refused by the chain, not just by the view.
        await expectCustomError(
          rp.connect(buyer).withdrawCollateral.staticCall(ethPositionId(buyer.address), max + 1n),
          'CollateralBacksOpenCredit'
        );
        // And the ceiling itself must go through.
        await (await rp.connect(buyer).withdrawCollateral(ethPositionId(buyer.address), max)).wait();
        assert.equal(await rp.getWithdrawableCollateral(buyer.address, ethPositionId(buyer.address)), 0n);
      }
    });

    // Staking rewards are the other half of the same principal rule (ADR-012): simulated, so they earn no credit and
    // were never deposited, so they are not withdrawable either.
    it('[v2] the staked-ETH bonus is neither credit-bearing nor withdrawable (ADR-012)', async () => {
      const pid = ethPositionId(buyer.address, true);
      await (await rp.connect(buyer).depositETHCollateral(true, { value: E('10') })).wait();
      assert.equal(await rp.getTotalCollateralValue(buyer.address), E('10'));
      assert.equal(await rp.getWithdrawableCollateral(buyer.address, pid), E('10'));
      await expectCustomError(
        rp.connect(buyer).withdrawCollateral.staticCall(pid, E('10.05')),
        'InsufficientCollateral'
      );
      await (await rp.connect(buyer).withdrawCollateral(pid, E('10'))).wait();
      assert.equal(await bal(await rp.getAddress()), 0n);
    });
  }
});
