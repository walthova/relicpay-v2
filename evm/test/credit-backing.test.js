// ADR-012: the credit line counts recorded principal only. Simulated yield and simulated staking
// rewards are backed by nothing (ADR-010), so they earn no credit.
const assert = require('assert');
const { setup, deploy, warp, expectCustomError, findEvent, E, IMPL, ethers } = require('./helpers');

const DAY = 86400n;
const ZERO = ethers.ZeroAddress;
const pid = (who, kind) => ethers.solidityPackedKeccak256(['address', 'address', 'string'], [who, ZERO, kind]);

(IMPL === 'v2' ? describe : describe.skip)(`credit backing [${IMPL}]`, function () {
  this.timeout(120000);
  let owner, seller, buyer, other, rp, nft;

  beforeEach(async () => {
    const s = await setup();
    [owner, seller, buyer, other] = s.signers;
    rp = await deploy('RelicPay', [], owner);
    nft = await deploy('MockNFT', [], owner);
    await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
  });

  async function relic() {
    const rc = await (await nft.connect(seller).mint(seller.address)).wait();
    const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
    await (await nft.connect(seller).approve(await rp.getAddress(), tokenId)).wait();
    return tokenId;
  }
  async function agree(total, method = 0, count = 1n) {
    const tokenId = await relic();
    const r = { physicalId: 'IBG-OPTIC-001', nftContract: nft.target, tokenId, metadataURI: 'ipfs://r',
      ownershipTransferred: false, currentOwner: seller.address };
    const tx = await rp.createAgreementWithRWA(seller.address, buyer.address, total, count, 30n * DAY, 7n * DAY, method, r);
    return findEvent(await tx.wait(), rp, 'AgreementCreated').agreementId;
  }
  // Any credit-line touch settles pending yield.
  const touch = () => rp.connect(buyer).depositETHCollateral(false, { value: E('1') }).then((t) => t.wait());

  it('a year of simulated yield leaves the credit limit at principal times the ratio', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    await warp(365n * DAY);
    await touch();
    const position = await rp.getCollateralPosition(buyer.address, pid(buyer.address, 'eth'));
    assert.ok(position.amount > E('11'), 'yield drifted into the position');
    const cl = await rp.getCreditLine(buyer.address);
    assert.equal(cl.collateralValue, E('11'));
    assert.equal(cl.creditLimit, E('8.8'));
    assert.equal(cl.availableCredit, E('8.8'));
    assert.equal(await rp.getTotalCollateralValue(buyer.address), E('11'));
  });

  it('an agreement that only fits inside the yield is refused', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    await warp(365n * DAY);
    await touch(); // limit 8.8 on 11 principal; yield would have lifted it past 9.2
    await assert.rejects(agree(E('9')), /InsufficientCredit|reverted/);
    await agree(E('8.8')); // the principal-backed limit is still fully usable
    assert.equal((await rp.getCreditLine(buyer.address)).availableCredit, 0n);
  });

  it('the staked-ETH bonus is recorded but earns no credit', async () => {
    await (await rp.connect(buyer).depositETHCollateral(true, { value: E('10') })).wait();
    const p = await rp.getCollateralPosition(buyer.address, pid(buyer.address, 'staked'));
    assert.equal(p.stakingRewards, E('0.05'));
    assert.equal(await rp.getTotalCollateralValue(buyer.address), E('10'));
    assert.equal((await rp.getCreditLine(buyer.address)).creditLimit, E('8'));
  });

  it('credit extended can always be covered by what a default seizes', async () => {
    // The solvency tie: with the limit principal-backed, the full line fits inside settlement collateral.
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    await warp(365n * DAY);
    await touch();
    const cl = await rp.getCreditLine(buyer.address);
    const settleable = await rp.getSettlementCollateral(buyer.address, ZERO);
    assert.equal(cl.collateralValue, settleable, 'credit-bearing value equals what a draw or seizure can take');
    assert.ok(cl.creditLimit <= settleable);
  });

  it('getWithdrawableCollateral is exact with yield pending: the max goes through, one wei more does not', async () => {
    const id = pid(buyer.address, 'eth');
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    await agree(E('4'));
    await warp(365n * DAY); // a year of accrual is waiting, nothing has settled it
    const max = await rp.getWithdrawableCollateral(buyer.address, id);
    assert.equal(max, E('5')); // 4 used / 0.8 = 5 ETH must stay behind
    await expectCustomError(rp.connect(buyer).withdrawCollateral.staticCall(id, max + 1n), 'CollateralBacksOpenCredit');
    await (await rp.connect(buyer).withdrawCollateral(id, max)).wait();
    assert.equal(await rp.getWithdrawableCollateral(buyer.address, id), 0n);
  });

  it('yield on one position does not lift the combined line', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    await (await rp.connect(buyer).depositETHCollateral(true, { value: E('10') })).wait();
    await warp(365n * DAY);
    await touch();
    assert.equal(await rp.getTotalCollateralValue(buyer.address), E('21'));
    assert.equal((await rp.getCreditLine(buyer.address)).creditLimit, E('16.8'));
  });

  it('a fresh deposit by another user is unaffected and independent', async () => {
    await (await rp.connect(other).depositETHCollateral(false, { value: E('5') })).wait();
    assert.equal((await rp.getCreditLine(other.address)).creditLimit, E('4'));
  });
});
