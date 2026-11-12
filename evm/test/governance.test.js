const assert = require('assert');
const {
  setup, deploy, warp, expectRevert, expectCustomError, findEvent, E, IMPL,
  getProvider, latestTimestamp, ethers,
} = require('./helpers');

const DAY = 86400;
const EXECUTION_DELAY = 2 * DAY;   // v2 default
const GRACE_PERIOD = 14 * DAY;     // v2 default

describe(`RelicPayGovernance [${IMPL}]`, function () {
  this.timeout(120000);
  let s, owner, alice, bob, gov, token;
  const updates = [];

  beforeEach(async () => {
    s = await setup();
    [owner, alice, bob] = s.signers;
    token = await deploy('MockGovToken', [], owner);
    gov = await deploy('RelicPayGovernance', [await token.getAddress()], owner);
    await (await token.mint(alice.address, E('2000'))).wait(); // above 1000 threshold
  });

  async function propose(from = alice) {
    const tx = await gov.connect(from).propose('Raise credit ratio', 'to 85%', updates);
    const rc = await tx.wait();
    return findEvent(rc, gov, 'ProposalCreated').proposalId;
  }

  // v2 gates execution behind a timelock: a passed proposal has to be queued and then waited
  // out. Legacy executes straight from the vote result, so shared tests route through here.
  async function clearTimelock(id, acts = updates, from = owner) {
    if (IMPL !== 'v2') return;
    await (await gov.connect(from).queue(id, acts)).wait();
    await warp(EXECUTION_DELAY + 60);
  }

  it('requires threshold to propose', async () => {
    await expectRevert(gov.connect(bob).propose('x', 'y', updates), 'Insufficient voting power');
    const id = await propose();
    assert.equal(id, 1n);
    const p = await gov.getProposal(id);
    assert.equal(p.proposer, alice.address);
    assert.equal(p.title, 'Raise credit ratio');
  });

  it('voting only inside window, power from token, revote replaces', async () => {
    const id = await propose();
    await (await token.setPastVotes(alice.address, E('500'))).wait();
    await expectRevert(gov.connect(alice).vote(id, true), 'ProposalNotActive'); // before start
    await warp(DAY + 60);
    await (await gov.connect(alice).vote(id, true)).wait();
    let p = await gov.getProposal(id);
    assert.equal(p.forVotes, E('500'));
    await (await gov.connect(alice).vote(id, false)).wait(); // revote
    p = await gov.getProposal(id);
    assert.equal(p.forVotes, 0n);
    assert.equal(p.againstVotes, E('500'));
    const [voted, forV, againstV] = await gov.getVote(id, alice.address);
    assert.ok(voted); assert.equal(forV, 0n); assert.equal(againstV, E('500'));
  });

  it('zero voting power cannot vote', async () => {
    const id = await propose();
    await warp(DAY + 60);
    await expectRevert(gov.connect(bob).vote(id, true), 'InsufficientVotingPower');
  });

  it('execute requires end, majority, quorum, authorized executor', async () => {
    const id = await propose();
    await (await token.setPastVotes(alice.address, E('15000'))).wait();
    await warp(DAY + 60);
    await (await gov.connect(alice).vote(id, true)).wait();
    await expectRevert(gov.execute(id, updates), 'ProposalNotActive'); // not ended
    await warp(3 * DAY + 60);
    await expectRevert(gov.connect(bob).execute(id, updates), 'Unauthorized executor');
    if (IMPL === 'v2') {
      // passed every vote check and still not executable: the timelock has not been entered
      await expectCustomError(gov.execute.staticCall(id, updates), 'ProposalNotQueued');
    }
    await clearTimelock(id);
    await (await gov.execute(id, updates)).wait();
    const p = await gov.getProposal(id);
    assert.ok(p.executed);
    await expectRevert(gov.execute(id, updates), 'ProposalAlreadyExecuted');
  });

  it('quorum not met blocks execution', async () => {
    const id = await propose();
    await (await token.setPastVotes(alice.address, E('500'))).wait();
    await warp(DAY + 60);
    await (await gov.connect(alice).vote(id, true)).wait();
    await warp(3 * DAY + 60);
    await expectRevert(gov.execute(id, updates), 'Quorum not met');
  });

  it('cancel by proposer or owner only', async () => {
    const id = await propose();
    await expectRevert(gov.connect(bob).cancel(id), 'Not authorized');
    await (await gov.connect(alice).cancel(id)).wait();
    const p = await gov.getProposal(id);
    assert.ok(p.canceled);
    await warp(DAY + 60);
    await (await token.setPastVotes(alice.address, E('500'))).wait();
    await expectRevert(gov.connect(alice).vote(id, true), 'ProposalAlreadyCanceled');
  });

  it('owner tunes governance parameters and executors', async () => {
    await (await gov.updateGovernanceParameters(2 * DAY, 5 * DAY, E('1'), E('2'))).wait();
    assert.equal(await gov.votingDelay(), BigInt(2 * DAY));
    assert.equal(await gov.quorumVotes(), E('2'));
    await (await gov.setExecutor(bob.address, true)).wait();
    assert.ok(await gov.authorizedExecutors(bob.address));
  });

  if (IMPL === 'v2') {
    // ---- parameter execution wiring (part b) ----

    const ABI = ethers.AbiCoder.defaultAbiCoder();

    // ParameterType enum, mirrored from the contract
    const P = {
      CreditLimitRatio: 0,
      GracePeriod: 1,
      MinimumCollateral: 2,
      YieldRate: 3,
      ProtocolFee: 4,
      MaxInstallments: 5,
      AuthorizedToken: 6,
      AuthorizedNFT: 7,
      AuthorizedOracle: 8,
      MaxPriceAge: 9,
      AuthorizedProtocol: 10,
      ProtocolAPY: 11,
    };

    // Deploy a real RelicPay and complete BOTH halves of the opt-in unless told otherwise:
    // governance allowlists the action, and the target names governance as its governor.
    async function wireRelicPay({ allow = [P.CreditLimitRatio], appointGovernor = true } = {}) {
      const rp = await deploy('RelicPay', [], owner);
      const rpAddr = await rp.getAddress();
      for (const paramType of allow) {
        await (await gov.setParameterAllowed(rpAddr, paramType, true)).wait();
      }
      if (appointGovernor) {
        await (await rp.setGovernor(await gov.getAddress())).wait();
      }
      return { rp, rpAddr };
    }

    function ratioUpdate(rpAddr, ratio) {
      return [{ paramType: P.CreditLimitRatio, target: rpAddr, data: ABI.encode(['uint256'], [ratio]) }];
    }

    it('[v2] execute rejects updates that do not match proposed actions', async () => {
      const { rpAddr } = await wireRelicPay();
      const real = ratioUpdate(rpAddr, 8500n);
      const tx = await gov.connect(alice).propose('t', 'd', real);
      const id = findEvent(await tx.wait(), gov, 'ProposalCreated').proposalId;
      await (await token.setPastVotes(alice.address, E('15000'))).wait();
      await warp(DAY + 60);
      await (await gov.connect(alice).vote(id, true)).wait();
      await warp(3 * DAY + 60);
      // same shape, different value: the hash must catch it even though it would execute fine
      const tampered = ratioUpdate(rpAddr, 12000n);
      // the hash is checked at both halves of execution, so a swap cannot sneak in at either
      await expectCustomError(gov.queue.staticCall(id, tampered), 'Actions mismatch');
      await (await gov.queue(id, real)).wait();
      await warp(EXECUTION_DELAY + 60);
      await expectRevert(gov.execute(id, tampered));
      await expectCustomError(gov.execute.staticCall(id, tampered), 'Actions mismatch');
      await (await gov.execute(id, real)).wait();
      assert.ok((await gov.getProposal(id)).executed);
    });

    it('[v2] oversized voting delay/period revert instead of silently truncating', async () => {
      const UINT40_MAX = (1n << 40n) - 1n;

      // config time: a value that could never produce a storable timestamp fails fast
      await expectRevert(
        gov.updateGovernanceParameters(UINT40_MAX + 1n, BigInt(3 * DAY), E('1000'), E('10000')),
        'ValueTooLarge'
      );
      await expectRevert(
        gov.updateGovernanceParameters(BigInt(DAY), UINT40_MAX + 1n, E('1000'), E('10000')),
        'ValueTooLarge'
      );
      // the fail-fast guard did not corrupt state
      assert.equal(await gov.votingDelay(), BigInt(DAY));
      assert.equal(await gov.votingPeriod(), BigInt(3 * DAY));

      // propose time: each value fits uint40 alone, but block.timestamp + delay + period does not
      await (await gov.updateGovernanceParameters(UINT40_MAX, UINT40_MAX, E('1000'), E('10000'))).wait();
      await expectRevert(gov.connect(alice).propose('t', 'd', updates), 'ValueTooLarge');
      assert.equal(await gov.getProposalCount(), 0n); // reverted before consuming an id

      // large but storable round-trips exactly, so the guard is not just rejecting everything
      const period = UINT40_MAX - 8000000000n;
      await (await gov.updateGovernanceParameters(0n, period, E('1000'), E('10000'))).wait();
      const rc = await (await gov.connect(alice).propose('t', 'd', updates)).wait();
      const id = findEvent(rc, gov, 'ProposalCreated').proposalId;
      const ts = BigInt((await getProvider().getBlock(rc.blockNumber)).timestamp);
      const p = await gov.getProposal(id);
      assert.equal(p.startTime, ts);
      assert.equal(p.endTime, ts + period);
      assert.ok(p.endTime > UINT40_MAX - 8100000000n); // well past uint32, would have truncated
    });

    // ---- timelock (part a) ----

    // drive a proposal all the way to "passed, not yet queued"
    async function passProposal(acts = updates) {
      const tx = await gov.connect(alice).propose('t', 'd', acts);
      const id = findEvent(await tx.wait(), gov, 'ProposalCreated').proposalId;
      await (await token.setPastVotes(alice.address, E('15000'))).wait();
      await warp(DAY + 60);
      await (await gov.connect(alice).vote(id, true)).wait();
      await warp(3 * DAY + 60);
      return id;
    }

    it('[v2] a passed proposal waits out the timelock before it can execute', async () => {
      const id = await passProposal();

      assert.equal(await gov.executionDelay(), BigInt(EXECUTION_DELAY));
      assert.equal(await gov.executionGracePeriod(), BigInt(GRACE_PERIOD));

      // passed every vote check, still not executable
      await expectCustomError(gov.execute.staticCall(id, updates), 'ProposalNotQueued');
      let w = await gov.getExecutionWindow(id);
      assert.equal(w.queued, false);
      assert.equal(w.eta, 0n);

      const rc = await (await gov.queue(id, updates)).wait();
      const queuedAt = await latestTimestamp();
      const ev = findEvent(rc, gov, 'ProposalQueued');
      assert.equal(ev.proposalId, id);
      assert.equal(ev.eta, queuedAt + BigInt(EXECUTION_DELAY));
      assert.equal(ev.expiresAt, ev.eta + BigInt(GRACE_PERIOD));
      assert.equal(await gov.proposalEta(id), ev.eta);

      // queued but the clock has not run out
      w = await gov.getExecutionWindow(id);
      assert.equal(w.queued, true);
      assert.equal(w.ready, false);
      assert.equal(w.expired, false);
      assert.equal(w.eta, ev.eta);
      assert.equal(w.expiresAt, ev.expiresAt);
      await expectCustomError(gov.execute.staticCall(id, updates), 'TimelockNotExpired');
      assert.equal((await gov.getProposal(id)).executed, false);

      // one second short of the eta is still short
      await warp(EXECUTION_DELAY - 120);
      await expectCustomError(gov.execute.staticCall(id, updates), 'TimelockNotExpired');

      await warp(240);
      w = await gov.getExecutionWindow(id);
      assert.equal(w.ready, true);
      await (await gov.execute(id, updates)).wait();
      assert.ok((await gov.getProposal(id)).executed);

      // an executed proposal reports no window and cannot be re-queued
      w = await gov.getExecutionWindow(id);
      assert.equal(w.queued, false);
      await expectCustomError(gov.queue.staticCall(id, updates), 'ProposalAlreadyExecuted');
    });

    it('[v2] queue is executor-gated, refuses a live re-queue, and refuses a failed proposal', async () => {
      const id = await passProposal();
      await expectRevert(gov.connect(bob).queue(id, updates), 'Unauthorized executor');
      await (await gov.queue(id, updates)).wait();
      const eta = await gov.proposalEta(id);

      // a second queue inside the live window cannot reset the countdown
      await expectCustomError(gov.queue.staticCall(id, updates), 'ProposalAlreadyQueued');
      assert.equal(await gov.proposalEta(id), eta);

      // a proposal that never met quorum never reaches the timelock at all
      const tx = await gov.connect(alice).propose('weak', 'd', updates);
      const weak = findEvent(await tx.wait(), gov, 'ProposalCreated').proposalId;
      await (await token.setPastVotes(alice.address, E('500'))).wait();
      await warp(DAY + 60);
      await (await gov.connect(alice).vote(weak, true)).wait();
      await warp(3 * DAY + 60);
      await expectCustomError(gov.queue.staticCall(weak, updates), 'Quorum not met');
      assert.equal(await gov.proposalEta(weak), 0n);
    });

    it('[v2] cancelling inside the timelock kills the proposal and clears its eta', async () => {
      const id = await passProposal();
      await (await gov.queue(id, updates)).wait();
      assert.notEqual(await gov.proposalEta(id), 0n);

      // the delay exists so this is possible: the guardian pulls it mid-window
      await (await gov.connect(owner).cancel(id)).wait();
      assert.equal(await gov.proposalEta(id), 0n);
      const w = await gov.getExecutionWindow(id);
      assert.equal(w.queued, false);
      assert.equal(w.ready, false);

      await warp(EXECUTION_DELAY + 60);
      await expectCustomError(gov.execute.staticCall(id, updates), 'ProposalAlreadyCanceled');
      await expectCustomError(gov.queue.staticCall(id, updates), 'ProposalAlreadyCanceled');
      assert.equal((await gov.getProposal(id)).executed, false);
    });

    it('[v2] execution expires after the grace period, and a stale proposal can be re-queued', async () => {
      const id = await passProposal();
      await (await gov.queue(id, updates)).wait();
      const firstEta = await gov.proposalEta(id);

      await warp(EXECUTION_DELAY + GRACE_PERIOD + 60);
      let w = await gov.getExecutionWindow(id);
      assert.equal(w.expired, true);
      assert.equal(w.ready, false);
      await expectCustomError(gov.execute.staticCall(id, updates), 'ProposalStale');

      // expiry is recoverable, not terminal: re-queue starts a fresh window
      await (await gov.queue(id, updates)).wait();
      const secondEta = await gov.proposalEta(id);
      assert.ok(secondEta > firstEta + BigInt(GRACE_PERIOD), 'second eta should be a fresh window');
      w = await gov.getExecutionWindow(id);
      assert.equal(w.expired, false);
      await expectCustomError(gov.execute.staticCall(id, updates), 'TimelockNotExpired');

      await warp(EXECUTION_DELAY + 60);
      await (await gov.execute(id, updates)).wait();
      assert.ok((await gov.getProposal(id)).executed);
    });

    it('[v2] timelock parameters are owner-only, bounded, and never move an in-flight eta', async () => {
      await expectRevert(gov.connect(bob).updateTimelockParameters(DAY, GRACE_PERIOD));
      await expectCustomError(
        gov.updateTimelockParameters.staticCall(31 * DAY, GRACE_PERIOD),
        'InvalidTimelockParameters'
      );
      await expectCustomError(
        gov.updateTimelockParameters.staticCall(DAY, DAY - 1),
        'InvalidTimelockParameters'
      );
      await expectCustomError(
        gov.updateTimelockParameters.staticCall(DAY, 91 * DAY),
        'InvalidTimelockParameters'
      );
      // rejected values did not land
      assert.equal(await gov.executionDelay(), BigInt(EXECUTION_DELAY));
      assert.equal(await gov.executionGracePeriod(), BigInt(GRACE_PERIOD));

      const id = await passProposal();
      await (await gov.queue(id, updates)).wait();
      const eta = await gov.proposalEta(id);

      // an owner cannot stretch a countdown voters are already watching
      const rc = await (await gov.updateTimelockParameters(30 * DAY, 30 * DAY)).wait();
      const ev = findEvent(rc, gov, 'TimelockParametersUpdated');
      assert.equal(ev.executionDelay, BigInt(30 * DAY));
      assert.equal(await gov.proposalEta(id), eta);

      await warp(EXECUTION_DELAY + 60);
      await (await gov.execute(id, updates)).wait();
      assert.ok((await gov.getProposal(id)).executed);

      // the new delay does apply to whatever is queued next
      const next = await passProposal();
      await (await gov.queue(next, updates)).wait();
      const nextEta = await gov.proposalEta(next);
      assert.equal(nextEta - (await latestTimestamp()), BigInt(30 * DAY));
    });

    it('[v2] proposals() getter keeps the pre-packing ABI and agrees with getProposal', async () => {
      // _proposals is internal now; proposals(uint256) must still return the exact tuple the
      // auto-generated public getter did, with uint256 timestamps despite the uint40 storage.
      const outputs = gov.interface.getFunction('proposals').outputs.map(o => o.type);
      assert.deepEqual(outputs, [
        'uint256', 'address', 'string', 'string',
        'uint256', 'uint256', 'uint256', 'uint256',
        'bool', 'bool',
      ]);

      const id = await propose();
      await (await token.setPastVotes(alice.address, E('15000'))).wait();
      await warp(DAY + 60);
      await (await gov.connect(alice).vote(id, true)).wait();

      const viaMapping = await gov.proposals(id);
      const viaGetter = await gov.getProposal(id);
      for (let i = 0; i < viaGetter.length; i++) {
        assert.equal(viaMapping[i], viaGetter[i], `field ${i} disagrees`);
      }
      assert.equal(viaMapping[1], alice.address);
      assert.equal(viaMapping[6], E('15000'));
      assert.equal(viaMapping[5] - viaMapping[4], BigInt(3 * DAY)); // endTime - startTime
      assert.equal(viaMapping[8], false);
      assert.equal(viaMapping[9], false);

      // unknown proposal still reads back as an empty struct, same as the old getter
      const missing = await gov.proposals(9999);
      assert.equal(missing[0], 0n);
      assert.equal(missing[1], '0x0000000000000000000000000000000000000000');
    });

    // ---- part b: the proposal actually moves a parameter ----

    // drive a proposal with real actions all the way through queue and the timelock
    async function passAndQueue(acts) {
      const tx = await gov.connect(alice).propose('t', 'd', acts);
      const id = findEvent(await tx.wait(), gov, 'ProposalCreated').proposalId;
      await (await token.setPastVotes(alice.address, E('15000'))).wait();
      await warp(DAY + 60);
      await (await gov.connect(alice).vote(id, true)).wait();
      await warp(3 * DAY + 60);
      await (await gov.queue(id, acts)).wait();
      await warp(EXECUTION_DELAY + 60);
      return id;
    }

    it('[v2] a passed proposal moves the parameter on the target contract', async () => {
      const { rp, rpAddr } = await wireRelicPay();
      const before = await rp.getGovernanceParams();
      assert.equal(before.creditLimitRatio, 8000n); // constructor default

      const acts = ratioUpdate(rpAddr, 8500n);
      const id = await passAndQueue(acts);
      const rc = await (await gov.execute(id, acts)).wait();

      // the parameter actually moved
      const after = await rp.getGovernanceParams();
      assert.equal(after.creditLimitRatio, 8500n);
      // and the single-parameter setter left the other two exactly where they were, which is the
      // whole reason it exists instead of routing through updateGovernanceParams
      assert.equal(after.defaultGracePeriod, before.defaultGracePeriod);
      assert.equal(after.minCollateralAmount, before.minCollateralAmount);

      // ParameterUpdated is now emitted only after the call succeeds
      const ev = findEvent(rc, gov, 'ParameterUpdated');
      assert.equal(ev.paramType, BigInt(P.CreditLimitRatio));
      assert.equal(ev.target, rpAddr);
      assert.equal(ev.data, acts[0].data);
      // the target's own event is in the same receipt, so an indexer following GovernanceUpdated
      // sees the full triple regardless of which setter wrote it
      const targetEv = findEvent(rc, rp, 'GovernanceUpdated');
      assert.equal(targetEv.creditLimitRatio, 8500n);
      assert.equal(targetEv.defaultGracePeriod, before.defaultGracePeriod);
    });

    it('[v2] execution needs both halves of the opt-in, and either side can revoke', async () => {
      // governance allowlists nothing: the call never leaves this contract
      const noAllow = await wireRelicPay({ allow: [] });
      let acts = ratioUpdate(noAllow.rpAddr, 8500n);
      let id = await passAndQueue(acts);
      await expectCustomError(gov.execute.staticCall(id, acts), 'ActionNotAllowed');
      assert.equal((await noAllow.rp.getGovernanceParams()).creditLimitRatio, 8000n);
      assert.equal((await gov.getProposal(id)).executed, false);

      // target never appointed a governor: the call leaves, and the target refuses it
      const noGovernor = await wireRelicPay({ appointGovernor: false });
      acts = ratioUpdate(noGovernor.rpAddr, 8500n);
      id = await passAndQueue(acts);
      await expectCustomError(gov.execute.staticCall(id, acts), 'ExecutionFailed');
      assert.equal((await noGovernor.rp.getGovernanceParams()).creditLimitRatio, 8000n);

      // appointing the governor is the missing half, and the same proposal now lands
      await (await noGovernor.rp.setGovernor(await gov.getAddress())).wait();
      assert.ok(await noGovernor.rp.hasGovernanceRights(await gov.getAddress()));
      await (await gov.execute(id, acts)).wait();
      assert.equal((await noGovernor.rp.getGovernanceParams()).creditLimitRatio, 8500n);

      // revoking on the target side is one transaction and takes effect immediately
      await (await noGovernor.rp.setGovernor(ethers.ZeroAddress)).wait();
      assert.equal(await noGovernor.rp.governor(), ethers.ZeroAddress);
      assert.equal(await noGovernor.rp.hasGovernanceRights(await gov.getAddress()), false);
      const acts2 = ratioUpdate(noGovernor.rpAddr, 9000n);
      const id2 = await passAndQueue(acts2);
      await expectCustomError(gov.execute.staticCall(id2, acts2), 'ExecutionFailed');

      // and revoking on the governance side works too, with the governor still appointed
      await (await noGovernor.rp.setGovernor(await gov.getAddress())).wait();
      await (await gov.setParameterAllowed(noGovernor.rpAddr, P.CreditLimitRatio, false)).wait();
      await expectCustomError(gov.execute.staticCall(id2, acts2), 'ActionNotAllowed');
      assert.equal((await noGovernor.rp.getGovernanceParams()).creditLimitRatio, 8500n);
    });

    it('[v2] the dispatch table pins each type to one selector and refuses the rest', async () => {
      // contract name each type is expected to resolve against, so the assertion below proves the
      // selector exists on the contract that will actually receive the call, not just somewhere
      const expected = {
        [P.CreditLimitRatio]: ['RelicPay', 'setCreditLimitRatio(uint256)', 32n],
        [P.GracePeriod]: ['RelicPay', 'setDefaultGracePeriod(uint256)', 32n],
        [P.MinimumCollateral]: ['RelicPay', 'setMinCollateralAmount(uint256)', 32n],
        [P.YieldRate]: ['RelicPay', 'setYieldRate(address,uint256)', 64n],
        [P.AuthorizedToken]: ['RelicPay', 'authorizeToken(address,bool)', 64n],
        [P.AuthorizedNFT]: ['RelicPay', 'authorizeNFT(address,bool)', 64n],
        [P.AuthorizedOracle]: ['PriceOracle', 'setOracleAuthorized(address,bool)', 64n],
        [P.MaxPriceAge]: ['PriceOracle', 'updateMaxPriceAge(address,uint256)', 64n],
        [P.AuthorizedProtocol]: ['DeFiIntegration', 'setProtocolAuthorized(address,bool,uint256)', 96n],
        [P.ProtocolAPY]: ['DeFiIntegration', 'updateProtocolAPY(address,uint256)', 64n],
      };
      const targets = {
        RelicPay: await deploy('RelicPay', [], owner),
        PriceOracle: await deploy('PriceOracle', [], owner),
        DeFiIntegration: await deploy('DeFiIntegration', [], owner),
      };
      for (const [paramType, [contractName, sig, argBytes]] of Object.entries(expected)) {
        const [selector, len] = await gov.paramSelector(paramType);
        assert.equal(selector, ethers.id(sig).slice(0, 10), `selector for ${sig}`);
        assert.equal(len, argBytes, `arg length for ${sig}`);
        // every selector the table can produce is a function that really exists on the target
        assert.ok(targets[contractName].interface.getFunction(sig), `${sig} missing on ${contractName}`);
      }

      // the numbering is the ABI. b2 appended four entries rather than reusing the two dead ones,
      // so pin the values a proposal encodes: a future insertion that renumbers AuthorizedToken
      // would silently repoint every queued proposal carrying a 6.
      assert.equal(P.AuthorizedToken, 6);
      assert.equal(P.AuthorizedNFT, 7);
      assert.equal(Object.keys(P).length, 12);

      const rp = targets.RelicPay;
      // neither of these names a parameter that exists in v2, so they resolve to nothing rather
      // than to a silent no-op the way the old stub did. b2 kept them retired in place rather
      // than repurposing them, so they must still revert after four entries were appended.
      for (const paramType of [P.ProtocolFee, P.MaxInstallments]) {
        await expectCustomError(gov.paramSelector.staticCall(paramType), 'UnsupportedParameterType');
        await expectCustomError(
          gov.setParameterAllowed.staticCall(await rp.getAddress(), paramType, true),
          'UnsupportedParameterType'
        );
      }

      // one past the end of the enum is rejected by the decoder before the dispatch table sees it
      await expectRevert(gov.paramSelector.staticCall(12));
    });

    it('[v2] argument length is enforced exactly, in both directions', async () => {
      const { rp, rpAddr } = await wireRelicPay();
      const good = ABI.encode(['uint256'], [8500n]);

      // trailing bytes would hash into the committed actions and then be silently discarded by
      // the target's decoder, so a reviewed 32-byte proposal could carry anything
      const padded = [{ paramType: P.CreditLimitRatio, target: rpAddr, data: good + 'de'.repeat(32) }];
      let id = await passAndQueue(padded);
      await expectCustomError(gov.execute.staticCall(id, padded), 'InvalidParameterData');

      const truncated = [{ paramType: P.CreditLimitRatio, target: rpAddr, data: good.slice(0, 40) }];
      id = await passAndQueue(truncated);
      await expectCustomError(gov.execute.staticCall(id, truncated), 'InvalidParameterData');

      const empty = [{ paramType: P.CreditLimitRatio, target: rpAddr, data: '0x' }];
      id = await passAndQueue(empty);
      await expectCustomError(gov.execute.staticCall(id, empty), 'InvalidParameterData');

      // nothing landed through any of the three
      assert.equal((await rp.getGovernanceParams()).creditLimitRatio, 8000n);

      // exactly 32 does land, so the check is not just rejecting everything
      const exact = ratioUpdate(rpAddr, 8500n);
      id = await passAndQueue(exact);
      await (await gov.execute(id, exact)).wait();
      assert.equal((await rp.getGovernanceParams()).creditLimitRatio, 8500n);
    });

    it('[v2] the allowlist is owner-only, refuses degenerate targets, and reports its writes', async () => {
      const rp = await deploy('RelicPay', [], owner);
      const rpAddr = await rp.getAddress();
      const selector = ethers.id('setCreditLimitRatio(uint256)').slice(0, 10);

      await expectRevert(
        gov.connect(bob).setParameterAllowed(rpAddr, P.CreditLimitRatio, true),
        'OwnableUnauthorizedAccount'
      );
      await expectRevert(
        gov.connect(bob).setActionAllowed(rpAddr, selector, true),
        'OwnableUnauthorizedAccount'
      );
      assert.equal(await gov.allowedActions(rpAddr, selector), false);

      // governance allowlisting itself would let a proposal call setActionAllowed and widen its
      // own reach, which is the one thing an allowlist has to refuse
      const govAddr = await gov.getAddress();
      await expectCustomError(gov.setActionAllowed.staticCall(govAddr, selector, true), 'InvalidTarget');
      await expectCustomError(
        gov.setParameterAllowed.staticCall(govAddr, P.CreditLimitRatio, true),
        'InvalidTarget'
      );
      await expectCustomError(
        gov.setActionAllowed.staticCall(ethers.ZeroAddress, selector, true),
        'InvalidTarget'
      );

      const rc = await (await gov.setParameterAllowed(rpAddr, P.CreditLimitRatio, true)).wait();
      const ev = findEvent(rc, gov, 'ActionAllowanceUpdated');
      assert.equal(ev.target, rpAddr);
      assert.equal(ev.selector, selector); // the convenience path resolved the same selector
      assert.equal(ev.allowed, true);
      assert.equal(await gov.allowedActions(rpAddr, selector), true);

      // the raw-selector path is equivalent and can revoke what the convenience path allowed
      await (await gov.setActionAllowed(rpAddr, selector, false)).wait();
      assert.equal(await gov.allowedActions(rpAddr, selector), false);
    });

    it('[v2] checkParameterUpdate answers before a proposal is ever written', async () => {
      const { rpAddr } = await wireRelicPay();
      const good = ABI.encode(['uint256'], [8500n]);
      const selector = ethers.id('setCreditLimitRatio(uint256)').slice(0, 10);

      let r = await gov.checkParameterUpdate({ paramType: P.CreditLimitRatio, target: rpAddr, data: good });
      assert.equal(r.ok, true);
      assert.equal(r.selector, selector);
      assert.equal(r.reason, '');

      // an unsupported type is answered, not thrown: this is the input most worth asking about
      r = await gov.checkParameterUpdate({ paramType: P.ProtocolFee, target: rpAddr, data: good });
      assert.equal(r.ok, false);
      assert.equal(r.selector, '0x00000000');
      assert.equal(r.reason, 'unsupported parameter type');

      r = await gov.checkParameterUpdate({ paramType: P.CreditLimitRatio, target: bob.address, data: good });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'action not allowed');

      r = await gov.checkParameterUpdate({ paramType: P.CreditLimitRatio, target: rpAddr, data: '0x1234' });
      assert.equal(r.ok, false);
      assert.equal(r.selector, selector);
      assert.equal(r.reason, 'invalid parameter data');
    });

    it('[v2] a multi-action proposal lands every action or none of them', async () => {
      const { rp, rpAddr } = await wireRelicPay({ allow: [P.CreditLimitRatio] });
      const nftAddr = bob.address; // any address, authorizeNFT does not call into it

      const acts = [
        { paramType: P.CreditLimitRatio, target: rpAddr, data: ABI.encode(['uint256'], [8500n]) },
        { paramType: P.AuthorizedNFT, target: rpAddr, data: ABI.encode(['address', 'bool'], [nftAddr, true]) },
      ];

      // the second action is not allowlisted, so the whole proposal reverts and the first action
      // does not survive: partial execution of a voted-on bundle would be the worst outcome here
      const id = await passAndQueue(acts);
      await expectCustomError(gov.execute.staticCall(id, acts), 'ActionNotAllowed');
      await expectRevert(gov.execute(id, acts));
      assert.equal((await rp.getGovernanceParams()).creditLimitRatio, 8000n);
      assert.equal(await rp.authorizedNFTs(nftAddr), false);
      assert.equal((await gov.getProposal(id)).executed, false);

      // allowlist the missing action and the same queued proposal lands both
      await (await gov.setParameterAllowed(rpAddr, P.AuthorizedNFT, true)).wait();
      await (await gov.execute(id, acts)).wait();
      assert.equal((await rp.getGovernanceParams()).creditLimitRatio, 8500n);
      assert.equal(await rp.authorizedNFTs(nftAddr), true);
      assert.ok((await gov.getProposal(id)).executed);
    });

    // ---- second and third targets (part b2) ----

    // wireRelicPay's shape for any Governable target, which is what DeployAll.s.sol now does at
    // deploy time: appoint the governor on the target, allowlist the types on governance.
    async function wireTarget(name, allow) {
      const c = await deploy(name, [], owner);
      const addr = await c.getAddress();
      for (const paramType of allow) {
        await (await gov.setParameterAllowed(addr, paramType, true)).wait();
      }
      await (await c.setGovernor(await gov.getAddress())).wait();
      return { c, addr };
    }

    it('[v2] a proposal moves PriceOracle parameters and its own events still fire', async () => {
      const { c: oracle, addr } = await wireTarget('PriceOracle', [P.MaxPriceAge, P.AuthorizedOracle]);
      const ETH = ethers.ZeroAddress;
      assert.equal((await oracle.getAssetInfo(ETH)).maxPriceAge, 300n); // constructor default
      assert.equal(await oracle.isOracleAuthorized(bob.address), false);

      const acts = [
        { paramType: P.MaxPriceAge, target: addr, data: ABI.encode(['address', 'uint256'], [ETH, 3600n]) },
        { paramType: P.AuthorizedOracle, target: addr, data: ABI.encode(['address', 'bool'], [bob.address, true]) },
      ];
      const id = await passAndQueue(acts);
      const rc = await (await gov.execute(id, acts)).wait();

      assert.equal((await oracle.getAssetInfo(ETH)).maxPriceAge, 3600n);
      assert.equal(await oracle.isOracleAuthorized(bob.address), true);

      // the target emits exactly what it always emitted, so an indexer watching the oracle set
      // does not have to learn that governance exists to keep following it
      assert.equal(findEvent(rc, oracle, 'MaxPriceAgeUpdated').maxAge, 3600n);
      assert.equal(findEvent(rc, oracle, 'OracleAuthorized').oracle, bob.address);

      // the authorization is real, not just a flag: the new oracle can push a price, and the
      // widened staleness window is what lets that price still read as fresh
      await (await oracle.connect(bob).updatePrice(ETH, 2500n * 10n ** 8n, 90n)).wait();
      assert.equal(await oracle.getPrice(ETH), 2500n * 10n ** 8n);

      // and the same type in the other direction takes the authorization away
      const revoke = [
        { paramType: P.AuthorizedOracle, target: addr, data: ABI.encode(['address', 'bool'], [bob.address, false]) },
      ];
      const id2 = await passAndQueue(revoke);
      const rc2 = await (await gov.execute(id2, revoke)).wait();
      assert.equal(await oracle.isOracleAuthorized(bob.address), false);
      assert.equal(findEvent(rc2, oracle, 'OracleDeauthorized').oracle, bob.address);
    });

    it('[v2] a proposal moves DeFiIntegration parameters, and a dirty deauthorize is refused', async () => {
      const { c: defi, addr } = await wireTarget('DeFiIntegration', [P.AuthorizedProtocol, P.ProtocolAPY]);
      const proto = bob.address; // any address; nothing calls into it
      assert.equal(await defi.authorizedProtocols(proto), false);

      const authorize = [{
        paramType: P.AuthorizedProtocol,
        target: addr,
        data: ABI.encode(['address', 'bool', 'uint256'], [proto, true, 700n]),
      }];
      let id = await passAndQueue(authorize);
      await (await gov.execute(id, authorize)).wait();
      assert.equal(await defi.authorizedProtocols(proto), true);
      assert.equal(await defi.protocolAPYs(proto), 700n);

      // the rate moves on its own, without restating the authorization
      const reprice = [{
        paramType: P.ProtocolAPY,
        target: addr,
        data: ABI.encode(['address', 'uint256'], [proto, 450n]),
      }];
      id = await passAndQueue(reprice);
      await (await gov.execute(id, reprice)).wait();
      assert.equal(await defi.protocolAPYs(proto), 450n);
      assert.equal(await defi.authorizedProtocols(proto), true);

      // deauthorizing does not read the apy, so an unchecked non-zero one would let two
      // byte-different proposals have identical effects while hashing differently
      const dirty = [{
        paramType: P.AuthorizedProtocol,
        target: addr,
        data: ABI.encode(['address', 'bool', 'uint256'], [proto, false, 450n]),
      }];
      id = await passAndQueue(dirty);
      await expectCustomError(gov.execute.staticCall(id, dirty), 'ExecutionFailed');
      await expectCustomError(
        defi.setProtocolAuthorized.staticCall(proto, false, 450n),
        'InvalidProtocolUpdate'
      );
      assert.equal(await defi.authorizedProtocols(proto), true); // nothing landed

      const clean = [{
        paramType: P.AuthorizedProtocol,
        target: addr,
        data: ABI.encode(['address', 'bool', 'uint256'], [proto, false, 0n]),
      }];
      id = await passAndQueue(clean);
      await (await gov.execute(id, clean)).wait();
      assert.equal(await defi.authorizedProtocols(proto), false);
      assert.equal(await defi.protocolAPYs(proto), 0n);
    });

    it('[v2] the allowlist binds a type to one target, and aiming it elsewhere cannot land', async () => {
      const { rpAddr } = await wireRelicPay({ allow: [] });
      const { c: oracle, addr: oracleAddr } = await wireTarget('PriceOracle', [P.MaxPriceAge]);
      const ETH = ethers.ZeroAddress;
      const data = ABI.encode(['address', 'uint256'], [ETH, 3600n]);

      // an oracle parameter aimed at RelicPay is refused before the call ever leaves governance
      const wrong = [{ paramType: P.MaxPriceAge, target: rpAddr, data }];
      const id = await passAndQueue(wrong);
      await expectCustomError(gov.execute.staticCall(id, wrong), 'ActionNotAllowed');

      // the allowlist does not know what RelicPay implements, so an owner can allowlist this pair
      // by mistake. checkParameterUpdate then reports ok, which is honest rather than a gap: it
      // answers "is this encoded and permitted", not "does this function exist over there". The
      // target is what catches it, by having no such function and no fallback.
      await (await gov.setParameterAllowed(rpAddr, P.MaxPriceAge, true)).wait();
      assert.equal((await gov.checkParameterUpdate(wrong[0])).ok, true);
      await expectCustomError(gov.execute.staticCall(id, wrong), 'ExecutionFailed');

      // byte-identical data aimed at the contract that does implement it lands
      const right = [{ paramType: P.MaxPriceAge, target: oracleAddr, data }];
      const id2 = await passAndQueue(right);
      await (await gov.execute(id2, right)).wait();
      assert.equal((await oracle.getAssetInfo(ETH)).maxPriceAge, 3600n);
    });
  }
});
