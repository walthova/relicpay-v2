const assert = require('assert');
const { setup, deploy, warp, expectRevert, findEvent, E, IMPL } = require('./helpers');

const DAY = 86400n;

(IMPL === 'v2' ? describe : describe.skip)(`RelicRegistry [${IMPL}]`, function () {
  this.timeout(120000);
  let s, owner, gallery, collector, registry;

  beforeEach(async () => {
    s = await setup();
    [owner, gallery, collector] = s.signers;
    registry = await deploy('RelicRegistry', [], owner);
    await (await registry.setIssuer(gallery.address, true)).wait();
  });

  it('verified issuer mints a relic with provenance', async () => {
    const tx = await registry.connect(gallery).mintRelic(gallery.address, 'IBG-OPTIC-001', 'ipfs://relic/1');
    const ev = findEvent(await tx.wait(), registry, 'RelicMinted');
    assert.equal(ev.physicalId, 'IBG-OPTIC-001');
    const r = await registry.getRelic(ev.tokenId);
    assert.equal(r.issuer, gallery.address);
    assert.equal(await registry.tokenURI(ev.tokenId), 'ipfs://relic/1');
    assert.equal(await registry.ownerOf(ev.tokenId), gallery.address);
  });

  it('non-issuers cannot mint; duplicate physical ids rejected', async () => {
    await expectRevert(registry.connect(collector).mintRelic(collector.address, 'X-1', 'ipfs://x'));
    await (await registry.connect(gallery).mintRelic(gallery.address, 'X-1', 'ipfs://x')).wait();
    await expectRevert(registry.connect(gallery).mintRelic(gallery.address, 'X-1', 'ipfs://x2'));
  });

  it('owner gates issuers', async () => {
    await expectRevert(registry.connect(collector).setIssuer(collector.address, true));
    await (await registry.setIssuer(gallery.address, false)).wait();
    await expectRevert(registry.connect(gallery).mintRelic(gallery.address, 'Y-1', 'ipfs://y'));
  });

  it('MVP end to end: tokenize relic, finance it via RelicPay, buyer takes ownership', async () => {
    const rp = await deploy('RelicPay', [], owner);
    await (await rp.authorizeNFT(await registry.getAddress(), true)).wait();
    // 1. gallery tokenizes the physical Optic Relic
    const mintEv = findEvent(await (await registry.connect(gallery).mintRelic(gallery.address, 'IBG-OPTIC-007', 'ipfs://relic/7')).wait(), registry, 'RelicMinted');
    const tokenId = mintEv.tokenId;
    await (await registry.connect(gallery).approve(await rp.getAddress(), tokenId)).wait();
    // 2. collector posts collateral and gets credit
    await (await rp.connect(collector).depositETHCollateral(false, { value: E('10') })).wait();
    // 3. BNPL agreement against the relic
    const rwa = { physicalId: 'IBG-OPTIC-007', nftContract: registry.target, tokenId, metadataURI: 'ipfs://relic/7', ownershipTransferred: false, currentOwner: gallery.address };
    const tx = await rp.createAgreementWithRWA(gallery.address, collector.address, E('6'), 3n, 30n * DAY, 7n * DAY, 0, rwa);
    const id = findEvent(await tx.wait(), rp, 'AgreementCreated').agreementId;
    // 4. pay all installments (prepayment allowed in v2)
    for (let n = 1n; n <= 3n; n++) {
      await (await rp.connect(collector).processPayment(id, n, { value: E('2') })).wait();
    }
    // 5. relic now belongs to the collector, gallery can withdraw proceeds
    assert.equal(await registry.ownerOf(tokenId), collector.address);
    assert.equal(await rp.getSellerBalance(gallery.address), E('6'));
  });
});
