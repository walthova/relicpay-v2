const assert = require('assert');
const { setup, deploy, expectRevert, expectCustomError, findEvent, E, IMPL } = require('./helpers');

const DAY = 86400n;

// Roadmap: maxAgreementDuration was declared and read by nothing (ADR-003 finding 4). v2 enforces it.
if (IMPL === 'v2') {
  describe('RelicPay maxAgreementDuration [v2]', function () {
    this.timeout(120000);
    let owner, seller, buyer, other, rp, nft;

    beforeEach(async () => {
      const s = await setup();
      [owner, seller, buyer, other] = s.signers;
      rp = await deploy('RelicPay', [], owner);
      nft = await deploy('MockNFT', [], owner);
      await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    });

    async function create(count, interval) {
      const rc = await (await nft.connect(seller).mint(seller.address)).wait();
      const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
      await (await nft.connect(seller).approve(await rp.getAddress(), tokenId)).wait();
      const rwa = {
        physicalId: 'IBG-OPTIC-001', nftContract: nft.target, tokenId,
        metadataURI: 'ipfs://relic/1', ownershipTransferred: false, currentOwner: seller.address,
      };
      return rp.createAgreementWithRWA(seller.address, buyer.address, E('1'), count, interval, 7n * DAY, 0, rwa);
    }

    it('accepts a schedule at and under the maximum', async () => {
      await (await create(12n, 30n * DAY)).wait();
      await (await create(73n, 5n * DAY)).wait();
    });

    it('refuses a schedule one second past the maximum', async () => {
      await expectRevert(create(73n, 5n * DAY + 1n), 'AgreementTooLong');
    });

    it('refuses 20 x 30 days', async () => {
      await expectRevert(create(20n, 30n * DAY), 'AgreementTooLong');
    });

    it('count * interval cannot overflow: both are uint32-bounded first', async () => {
      await expectRevert(create(2n ** 32n - 1n, 2n ** 32n - 1n), 'AgreementTooLong');
    });

    it('governor can raise it, and the new bound applies to new agreements', async () => {
      await expectCustomError(rp.connect(other).setMaxAgreementDuration.staticCall(730n * DAY), 'UnauthorizedGovernance');
      await expectRevert(create(20n, 30n * DAY), 'AgreementTooLong');
      const rc = await (await rp.setMaxAgreementDuration(730n * DAY)).wait();
      const ev = findEvent(rc, rp, 'MaxAgreementDurationUpdated');
      assert.equal(ev.oldValue, 365n * DAY);
      assert.equal(ev.newValue, 730n * DAY);
      assert.equal((await rp.getGovernanceParams()).maxAgreementDuration, 730n * DAY);
      await (await create(20n, 30n * DAY)).wait();
    });

    it('an appointed governor may set it too', async () => {
      await (await rp.setGovernor(other.address)).wait();
      await (await rp.connect(other).setMaxAgreementDuration(90n * DAY)).wait();
      await expectRevert(create(4n, 30n * DAY), 'AgreementTooLong');
      await (await create(3n, 30n * DAY)).wait();
    });

    it('lowering it does not touch the other governed params', async () => {
      await (await rp.setMaxAgreementDuration(90n * DAY)).wait();
      const g = await rp.getGovernanceParams();
      assert.equal(g.creditLimitRatio, 8000n);
      assert.equal(g.defaultGracePeriod, 7n * DAY);
      assert.equal(g.minCollateralAmount, E('1'));
    });

    it('refuses zero, which would make every agreement unmakeable', async () => {
      await expectCustomError(rp.setMaxAgreementDuration.staticCall(0n), 'InvalidMaxAgreementDuration');
    });
  });
}
