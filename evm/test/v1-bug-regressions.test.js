// Named regressions for V1-BUG-3, V1-BUG-4 and V1-BUG-5 (docs/RELICPAY_SPEC.md, docs/AUDIT_PREP.md).
// V1-BUG-1 and V1-BUG-2 already have their own named cases in bnpl/enhanced/relicpay tests. These
// three were only covered indirectly, and writing the V1-BUG-4 case found that the fix the audit
// pack claimed was never in the governor: vote() still handed a timestamp to getPastVotes.
// v2 only: legacy is the frozen spec and keeps the bugs.
const assert = require('assert');
const {
  setup, deploy, warp, expectRevert, expectCustomError, findEvent, E, IMPL, ethers, getProvider,
} = require('./helpers');

const DAY = 86400n;

(IMPL === 'v2' ? describe : describe.skip)(`V1 bug regressions [${IMPL}]`, function () {
  this.timeout(120000);
  let s, owner, seller, buyer, alice, bob;

  beforeEach(async () => {
    s = await setup();
    [owner, seller, buyer, alice, bob] = s.signers;
  });

  describe('V1-BUG-3: _releaseCredit must not inflate availableCredit past the live limit', () => {
    let rp, nft;
    beforeEach(async () => {
      rp = await deploy('RelicPay', [], owner);
      nft = await deploy('MockNFT', [], owner);
      await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
    });

    async function relic() {
      const rc = await (await nft.connect(seller).mint(seller.address)).wait();
      const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
      await (await nft.connect(seller).approve(await rp.getAddress(), tokenId)).wait();
      return {
        physicalId: 'IBG-OPTIC-003', nftContract: nft.target, tokenId, metadataURI: 'ipfs://r/3',
        ownershipTransferred: false, currentOwner: seller.address,
      };
    }

    it('after collateral-funded payments complete, availability equals the limit recomputed from what is left', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const r = await relic();
      const rc = await (await rp.createAgreementWithRWA(
        seller.address, buyer.address, E('6'), 3n, 30n * DAY, 7n * DAY, 2, r)).wait(); // Collateral
      const id = findEvent(rc, rp, 'AgreementCreated').agreementId;

      for (let n = 1n; n <= 3n; n++) {
        await warp(30n * DAY);
        await (await rp.connect(buyer).processPayment(id, n)).wait();
      }
      assert.equal((await rp.getAgreement(id)).state, 1n); // Completed

      const cl = await rp.getCreditLine(buyer.address);
      const live = await rp.getTotalCollateralValue(buyer.address);
      assert.equal(cl.usedCredit, 0n);
      // The v1 shape: available was 8 - 6 = 2 at creation, then += 6 on release = 8 ETH of credit
      // against roughly 4 ETH of collateral left. v2 recomputes: 80 percent of what is really there.
      assert.equal(cl.creditLimit, (live * 8000n) / 10000n);
      assert.equal(cl.availableCredit, cl.creditLimit, 'availability must equal the recomputed limit');
      assert.ok(cl.availableCredit < E('8'), 'must not return to the pre-payment limit');
    });

    it('after a default releases the reservation, the line is capped by surviving collateral', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const r = await relic();
      const rc = await (await rp.createAgreementWithRWA(
        seller.address, buyer.address, E('6'), 3n, 30n * DAY, 7n * DAY, 0, r)).wait();
      const id = findEvent(rc, rp, 'AgreementCreated').agreementId;
      await warp(30n * DAY + 7n * DAY + DAY);
      await (await rp.connect(seller).triggerDefault(id)).wait();

      const cl = await rp.getCreditLine(buyer.address);
      const live = await rp.getTotalCollateralValue(buyer.address);
      assert.equal(cl.usedCredit, 0n);
      assert.equal(cl.availableCredit, (live * 8000n) / 10000n);
      assert.ok(cl.availableCredit <= cl.creditLimit);
      // 6 of the 10 ETH went to the seller, so the line cannot be the original 8.
      assert.ok(cl.availableCredit < E('8'));
    });
  });

  describe('V1-BUG-4: voting power is read at a block number, not a timestamp', () => {
    let gov, token;
    beforeEach(async () => {
      token = await deploy('MockVotesToken', [], owner); // real ERC20Votes, reverts on future lookups
      gov = await deploy('RelicPayGovernance', [await token.getAddress()], owner);
    });

    async function fund(who, amount) {
      await (await token.mint(who.address, amount)).wait();
      await (await token.connect(who).delegate(who.address)).wait();
    }
    async function propose(from) {
      const rc = await (await gov.connect(from).propose('Raise ratio', 'to 85%', [])).wait();
      return findEvent(rc, gov, 'ProposalCreated').proposalId;
    }

    it('a checkpointed token accepts the vote, and the weight is the delegated balance', async () => {
      await fund(alice, E('15000'));
      const id = await propose(alice);
      await warp(DAY + 60n);
      await (await gov.connect(alice).vote(id, true)).wait();
      const p = await gov.getProposal(id);
      assert.equal(p.forVotes, E('15000'));
    });

    it('the stored snapshot is a block number strictly before the proposal block', async () => {
      await fund(alice, E('2000'));
      const rc = await (await gov.connect(alice).propose('x', 'y', [])).wait();
      const id = findEvent(rc, gov, 'ProposalCreated').proposalId;
      const snap = await gov.proposalSnapshotBlock(id);
      assert.equal(snap, BigInt(rc.blockNumber) - 1n);
      const p = await gov.getProposal(id);
      assert.ok(p.startTime > 1_000_000_000n, 'startTime is a unix timestamp');
      assert.ok(snap < 1_000_000n, 'the snapshot is a block number, not that timestamp');
    });

    it('the v1 call shape really does revert against this token', async () => {
      await fund(alice, E('2000'));
      const id = await propose(alice);
      const p = await gov.getProposal(id);
      // What v1 asked: getPastVotes(voter, startTime - 1). A future lookup on a block-clock token.
      await expectRevert(token.getPastVotes.staticCall(alice.address, p.startTime - 1n));
    });

    it('tokens delegated after the proposal exists carry no weight on it', async () => {
      await fund(alice, E('2000'));
      const id = await propose(alice);
      await fund(bob, E('50000')); // arrives after the snapshot
      await warp(DAY + 60n);
      await expectCustomError(gov.connect(bob).vote.staticCall(id, true), 'InsufficientVotingPower');
      await (await gov.connect(alice).vote(id, true)).wait(); // alice held 2000 at the snapshot
      assert.equal((await gov.getProposal(id)).forVotes, E('2000'));
    });

    it('votingDelay of zero still works: the snapshot is already in the past', async () => {
      await fund(alice, E('2000'));
      await (await gov.updateGovernanceParameters(0n, 3n * DAY, E('1000'), E('1'))).wait();
      const id = await propose(alice);
      await (await gov.connect(alice).vote(id, true)).wait();
      assert.equal((await gov.getProposal(id)).forVotes, E('2000'));
    });
  });

  describe('V1-BUG-5: no push transfer() to sellers, so contract wallets get paid by pull', () => {
    let rp, nft, wallet, walletAddr;
    beforeEach(async () => {
      rp = await deploy('RelicPay', [], owner);
      nft = await deploy('MockNFT', [], owner);
      await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
      wallet = await deploy('MockSmartWallet', [], owner);
      walletAddr = await wallet.getAddress();
    });

    async function walletRelic() {
      const rc = await (await nft.mint(walletAddr)).wait();
      const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
      const approve = nft.interface.encodeFunctionData('approve', [await rp.getAddress(), tokenId]);
      await (await wallet.exec(await nft.getAddress(), approve, 0n)).wait();
      return {
        physicalId: 'IBG-OPTIC-005', nftContract: nft.target, tokenId, metadataURI: 'ipfs://r/5',
        ownershipTransferred: false, currentOwner: walletAddr,
      };
    }
    async function agreement(method = 0) {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const r = await walletRelic();
      const rc = await (await rp.createAgreementWithRWA(
        walletAddr, buyer.address, E('6'), 3n, 30n * DAY, 7n * DAY, method, r)).wait();
      return findEvent(rc, rp, 'AgreementCreated').agreementId;
    }
    const withdrawData = () => rp.interface.encodeFunctionData('withdrawSellerBalance', []);

    it('a contract wallet seller that needs more than 2300 gas to receive can withdraw', async () => {
      const id = await agreement();
      for (let n = 1n; n <= 3n; n++) {
        await warp(30n * DAY);
        await (await rp.connect(buyer).processPayment(id, n, { value: E('2') })).wait();
      }
      assert.equal(await rp.getSellerBalance(walletAddr), E('6'));
      await (await wallet.exec(await rp.getAddress(), withdrawData(), 0n)).wait();
      assert.equal(await wallet.received(), E('6')); // receive() ran a storage write: well over 2300 gas
      assert.equal(await rp.getSellerBalance(walletAddr), 0n);
    });

    it('a wallet that rejects ETH cannot block buyer payments or a default, and keeps its claim', async () => {
      await (await wallet.setReject(true)).wait();
      const id = await agreement();
      await warp(30n * DAY);
      await (await rp.connect(buyer).processPayment(id, 1n, { value: E('2') })).wait(); // payment does not push
      assert.equal(await rp.getSellerBalance(walletAddr), E('2'));

      await warp(30n * DAY + 7n * DAY + DAY);
      const trigger = rp.interface.encodeFunctionData('triggerDefault', [id]);
      await (await wallet.exec(await rp.getAddress(), trigger, 0n)).wait(); // seizure does not push either
      assert.equal((await rp.getAgreement(id)).state, 2n); // Defaulted
      const owed = await rp.getSellerBalance(walletAddr);
      assert.ok(owed > E('2'), 'the seizure was credited to the seller balance');

      // Withdrawal fails while the wallet rejects, and nothing is lost or zeroed by the failure.
      await expectRevert(wallet.exec(await rp.getAddress(), withdrawData(), 0n));
      assert.equal(await rp.getSellerBalance(walletAddr), owed);

      await (await wallet.setReject(false)).wait();
      await (await wallet.exec(await rp.getAddress(), withdrawData(), 0n)).wait();
      assert.equal(await wallet.received(), owed);
      assert.equal(await rp.getSellerBalance(walletAddr), 0n);
    });
  });
});
