// ADR-010 / FINDING-1: settlement draws and seizures never pay out simulated yield.
const assert = require('assert');
const { setup, deploy, warp, expectRevert, findEvent, E, IMPL } = require('./helpers');

const DAY = 86400n;

(IMPL === 'v2' ? describe : describe.skip)(`yield backing [${IMPL}]`, function () {
  this.timeout(120000);
  let owner, seller, buyer, rp, nft;

  beforeEach(async () => {
    const s = await setup();
    [owner, seller, buyer] = s.signers;
    rp = await deploy('RelicPay', [], owner);
    nft = await deploy('MockNFT', [], owner);
    await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
    // 200% credit ratio so a small agreement can exceed principal once yield inflates the position
    await (await rp.updateGovernanceParams(20000n, 7n * DAY, E('1'))).wait();
  });

  async function relic() {
    const rc = await (await nft.connect(seller).mint(seller.address)).wait();
    const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
    await (await nft.connect(seller).approve(await rp.getAddress(), tokenId)).wait();
    return tokenId;
  }
  async function agree(total, method, count = 1n) {
    const tokenId = await relic();
    const r = { physicalId: 'IBG-OPTIC-001', nftContract: nft.target, tokenId, metadataURI: 'ipfs://r',
      ownershipTransferred: false, currentOwner: seller.address };
    const tx = await rp.createAgreementWithRWA(seller.address, buyer.address, total, count, 30n * DAY, 7n * DAY, method, r);
    return findEvent(await tx.wait(), rp, 'AgreementCreated').agreementId;
  }

  it('a collateral draw cannot reach into simulated yield', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('1') })).wait();
    const id = await agree(E('1.02'), 2);
    await warp(200n * DAY);
    await (await rp.updateGovernanceParams(20000n, 7n * DAY, E('1'))).wait(); // mine a block, no effect
    // the position now holds more than 1.02 ETH on paper, but only 1 ETH of it is real
    await expectRevert(rp.connect(buyer).processPayment(id, 0n), 'Insufficient collateral');
    assert.equal(await rp.getSellerBalance(seller.address), 0n);
  });

  it('getSettlementCollateral reports principal, not the yield-inflated amount', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('1') })).wait();
    await agree(E('1.02'), 2);
    await warp(200n * DAY);
    assert.equal(await rp.getSettlementCollateral(buyer.address, '0x0000000000000000000000000000000000000000'), E('1'));
  });

  it('seller is never credited more than the contract holds after a default', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    const id = await agree(E('15'), 0, 2n);
    await warp(30n * DAY + 7n * DAY + DAY);
    await (await rp.connect(seller).triggerDefault(id)).wait();
    const credited = await rp.getSellerBalance(seller.address);
    const held = await rp.runner.provider.getBalance(await rp.getAddress());
    assert.equal(credited, E('10'));
    assert.ok(credited <= held);
  });
});
