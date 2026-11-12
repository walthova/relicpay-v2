const assert = require('assert');
const {
  setup, deploy, warp, latestTimestamp, blockTimestamp,
  expectRevert, findEvent, E, IMPL, getProvider,
} = require('./helpers');

// Property-based ("fuzz") suite for the three areas the roadmap called out: payment sequencing,
// credit math, and yield accrual. There is no Foundry in this offline toolchain, so this is
// randomized property testing driven from mocha against a real ganache chain rather than
// forge's built-in fuzzer. Two things make it usable as a fuzzer instead of just noise:
//
//   1. Cases come from a seeded PRNG, so a failure is reproducible. The seed is printed on
//      failure and can be pinned with FUZZ_SEED=... npm run test:v2.
//   2. Every generated case is materialized up front as a plain, printable object, and each
//      assertion carries the case in its message, so a red run names the exact inputs.
//
// FUZZ_RUNS controls cases per property (default 8). This sandbox runs ganache without native
// bindings, so the default is tuned to keep the suite inside the 120s mocha timeout; bump it
// on a real machine when hunting for something.

const DAY = 86400n;
const YEAR = 365n * DAY;
const RUNS = Number(process.env.FUZZ_RUNS || 8);
const SEED = process.env.FUZZ_SEED || 'relicpay-v2';

// deterministic PRNG (mulberry32 over an FNV-1a hash of the seed string)
function makeRng(seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let a = h >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, arr) => arr[rInt(r, 0, arr.length - 1)];

// A wei amount in [minEth, maxEth] with a random sub-wei-of-ether remainder bolted on, so
// totalPrice is almost never cleanly divisible by installmentCount. That remainder is the whole
// point: it is where off-by-one payment math hides.
function randWei(r, minEth, maxEth) {
  const milli = rInt(r, Math.round(minEth * 1000), Math.round(maxEth * 1000));
  return E((milli / 1000).toFixed(3)) + BigInt(rInt(r, 0, 999999));
}

const ceilDiv = (a, b) => (a + b - 1n) / b;

function ctx(label, c) {
  return `${label} | seed=${SEED} case=${JSON.stringify(c)}`;
}

// helpers.expectRevert only takes a match string, so a bare "Expected revert, but tx succeeded"
// carries no case. Wrap it so a revert-shaped failure names its inputs like every assert does.
async function expectRevertCase(promise, c, label, match) {
  try {
    await expectRevert(promise, match);
  } catch (e) {
    throw new Error(`${ctx(label, c)} -> ${e.message}`);
  }
}

// ---------------------------------------------------------------- case generators
// Kept pure and separate from execution so the same seed always yields the same cases and the
// determinism test below can prove it. BigInts are carried as strings so cases stay printable
// and JSON-comparable.

function genPaymentCases(rng, n) {
  const cases = [];
  for (let i = 0; i < n; i++) {
    const count = rInt(rng, 1, 6);
    cases.push({
      run: i,
      count,
      totalPrice: randWei(rng, 1, 20).toString(),
      // 0 Manual, 1 Auto, 2 Collateral
      method: pick(rng, [0, 1, 2]),
      intervalDays: rInt(rng, 1, 60),
      graceDays: rInt(rng, 0, 14),
      // warp this many days before each payment, mixing prepayment with overdue
      warpDaysBeforePay: Array.from({ length: count }, () => rInt(rng, 0, 70)),
    });
  }
  return cases;
}

function genCreditCases(rng, n) {
  const cases = [];
  for (let i = 0; i < n; i++) {
    const collateral = randWei(rng, 1, 50);
    // draw somewhere in [1%, 100%] of the 80% limit
    const limit = (collateral * 80n) / 100n;
    const drawPct = rInt(rng, 1, 100);
    let draw = (limit * BigInt(drawPct)) / 100n;
    if (draw === 0n) draw = 1n;
    cases.push({
      run: i,
      collateral: collateral.toString(),
      draw: draw.toString(),
      count: rInt(rng, 1, 5),
      intervalDays: rInt(rng, 1, 30),
    });
  }
  return cases;
}

function genYieldCases(rng, n) {
  const cases = [];
  for (let i = 0; i < n; i++) {
    cases.push({
      run: i,
      protocol: pick(rng, ['LIDO', 'AAVE', 'COMPOUND']),
      // 0 is included deliberately: a zero-APY protocol must never accrue
      apy: pick(rng, [0, 1, 25, 300, 500, 1234, 10000, 65535]),
      amount: randWei(rng, 0.01, 5).toString(),
      warpSeconds: [rInt(rng, 1, 90 * 86400), rInt(rng, 1, 400 * 86400), rInt(rng, 1, 3)],
    });
  }
  return cases;
}

const PROTOCOLS = {
  LIDO: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  AAVE: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  COMPOUND: '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5',
};

// linear simple-interest accrual, mirroring _getCurrentValue / calculateProjectedYield exactly,
// including Solidity's floor division
const expectedYield = (amount, apy, elapsed) => (amount * apy * elapsed) / (YEAR * 10000n);

// v2-only. legacy/ is the frozen spec; these properties assert v2's fixed behaviour (strict
// payment sequencing, remainder on the final installment, clamped utilization), which legacy
// does not have.
(IMPL === 'v2' ? describe : describe.skip)(`Fuzz properties [${IMPL}]`, function () {
  this.timeout(600000);

  let s, owner, seller, buyer;

  before(async () => {
    s = await setup();
    [owner, seller, buyer] = s.signers;
  });

  // -------------------------------------------------------------- payment sequencing
  describe('payment sequencing (RelicPay)', () => {
    let rp, nft;

    before(async () => {
      rp = await deploy('RelicPay', [], owner);
      nft = await deploy('MockNFT', [], owner);
      await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
    });

    async function mintRelic() {
      const rc = await (await nft.connect(seller).mint(seller.address)).wait();
      const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
      await (await nft.connect(seller).approve(await rp.getAddress(), tokenId)).wait();
      return tokenId;
    }

    // Top the buyer up so availableCredit covers the price, then open the agreement.
    async function openAgreement(c) {
      const totalPrice = BigInt(c.totalPrice);
      const tokenId = await mintRelic();

      let cl = await rp.getCreditLine(buyer.address);
      if (cl.availableCredit < totalPrice) {
        // 2x price of ETH collateral yields 1.6x price of credit, comfortably above the need,
        // and also covers the Collateral payment method draining the position as it pays.
        await (await rp.connect(buyer).depositETHCollateral(false, { value: totalPrice * 2n })).wait();
        cl = await rp.getCreditLine(buyer.address);
      }

      const asset = {
        physicalId: `IBG-FUZZ-${c.run}`,
        nftContract: nft.target,
        tokenId,
        metadataURI: `ipfs://fuzz/${c.run}`,
        ownershipTransferred: false,
        currentOwner: seller.address,
      };
      const rc = await (await rp.createAgreementWithRWA(
        seller.address, buyer.address, totalPrice,
        c.count, BigInt(c.intervalDays) * DAY, BigInt(c.graceDays) * DAY,
        c.method, asset,
      )).wait();
      return { id: findEvent(rc, rp, 'AgreementCreated').agreementId, tokenId, usedBefore: cl.usedCredit };
    }

    async function payInstallment(id, n, amount, method) {
      if (method === 0) return rp.connect(buyer).processPayment(id, n, { value: amount });
      if (method === 1) {
        await (await rp.connect(buyer).depositAutoPaymentFunds({ value: amount })).wait();
        return rp.connect(buyer).processPayment(id, n);
      }
      return rp.connect(buyer).processPayment(id, n); // Collateral
    }

    it('[v2] fuzz: schedules sum to the price and pay off in strict order', async () => {
      const cases = genPaymentCases(makeRng(SEED + ':pay'), RUNS);
      for (const c of cases) {
        const totalPrice = BigInt(c.totalPrice);
        const { id, tokenId, usedBefore } = await openAgreement(c);

        const sched = await rp.getPaymentSchedule(id);
        assert.equal(sched.length, c.count, ctx('schedule length', c));

        // the schedule must account for every wei: n-1 equal installments plus a final one
        // absorbing the integer-division remainder
        const base = totalPrice / BigInt(c.count);
        let sum = 0n;
        for (let i = 0; i < c.count; i++) {
          sum += sched[i].amount;
          assert.equal(sched[i].installmentNumber, BigInt(i + 1), ctx(`installmentNumber ${i}`, c));
          if (i < c.count - 1) assert.equal(sched[i].amount, base, ctx(`even installment ${i}`, c));
        }
        assert.equal(sum, totalPrice, ctx('schedule sums to totalPrice', c));
        assert.equal(sched[c.count - 1].amount, totalPrice - base * BigInt(c.count - 1), ctx('remainder on final', c));

        const agr0 = await rp.getAgreement(id);
        for (let i = 0; i < c.count; i++) {
          assert.equal(sched[i].dueDate, agr0.startTime + BigInt(i + 1) * BigInt(c.intervalDays) * DAY,
            ctx(`dueDate ${i}`, c));
        }

        const clOpen = await rp.getCreditLine(buyer.address);
        assert.equal(clOpen.usedCredit, usedBefore + totalPrice, ctx('credit consumed on open', c));

        const sellerBefore = await rp.getSellerBalance(seller.address);
        let paidSoFar = 0n;
        for (let i = 1; i <= c.count; i++) {
          const days = c.warpDaysBeforePay[i - 1];
          if (days > 0) await warp(BigInt(days) * DAY);

          const amount = sched[i - 1].amount;
          await (await payInstallment(id, i, amount, c.method)).wait();
          paidSoFar += amount;

          const agr = await rp.getAgreement(id);
          assert.equal(agr.paidInstallments, BigInt(i), ctx(`paidInstallments after ${i}`, c));
          assert.equal(await rp.totalPaid(id), paidSoFar, ctx(`totalPaid after ${i}`, c));
          const sNow = await rp.getPaymentSchedule(id);
          assert.equal(sNow[i - 1].status, 1n, ctx(`status Paid after ${i}`, c));
          assert.equal(sNow[i - 1].paidAmount, amount, ctx(`paidAmount after ${i}`, c));
          // state stays Active until the very last installment lands
          assert.equal(agr.state, i === c.count ? 1n : 0n, ctx(`state after ${i}`, c));
        }

        assert.equal(await rp.totalPaid(id), totalPrice, ctx('totalPaid equals price', c));
        assert.equal(await nft.ownerOf(tokenId), buyer.address, ctx('relic transferred on completion', c));
        assert.equal(
          (await rp.getSellerBalance(seller.address)) - sellerBefore, totalPrice,
          ctx('seller credited the full price', c),
        );
        assert.equal((await rp.getCreditLine(buyer.address)).usedCredit, usedBefore,
          ctx('credit released on completion', c));
      }
    });

    it('[v2] fuzz: out-of-order and duplicate payments revert without mutating state', async () => {
      const cases = genPaymentCases(makeRng(SEED + ':seq'), RUNS)
        .map(c => Object.assign({}, c, { count: Math.max(2, c.count), method: 0 }));

      for (const c of cases) {
        c.warpDaysBeforePay = c.warpDaysBeforePay.concat([0, 0]).slice(0, c.count);
        const { id } = await openAgreement(c);
        const sched = await rp.getPaymentSchedule(id);

        // walk the agreement forward, and at every position try every illegal move
        for (let next = 1; next <= c.count; next++) {
          const snapshot = await rp.getAgreement(id);
          const paidSnapshot = await rp.totalPaid(id);

          const illegal = [0, c.count + 1];
          if (next + 1 <= c.count) illegal.push(next + 1); // skipping ahead
          if (next - 1 >= 1) illegal.push(next - 1);       // replaying a settled installment

          for (const n of illegal) {
            // send the money the legal payment would have needed, so a pass here can only mean
            // the sequence check let it through, not that the tx was starved of value
            const value = n >= 1 && n <= c.count ? sched[n - 1].amount : sched[next - 1].amount;
            await expectRevertCase(
              rp.connect(buyer).processPayment(id, n, { value }),
              c, `illegal installment ${n} at next=${next}`,
            );
            const after = await rp.getAgreement(id);
            assert.equal(after.paidInstallments, snapshot.paidInstallments,
              ctx(`paidInstallments unchanged after illegal ${n} at next=${next}`, c));
            assert.equal(after.state, snapshot.state, ctx(`state unchanged after illegal ${n}`, c));
            assert.equal(await rp.totalPaid(id), paidSnapshot,
              ctx(`totalPaid unchanged after illegal ${n}`, c));
          }

          await (await rp.connect(buyer).processPayment(id, next, { value: sched[next - 1].amount })).wait();
        }

        // and the whole thing is closed to further payment once complete
        const done = await rp.getAgreement(id);
        assert.equal(done.state, 1n, ctx('completed', c));
        await expectRevertCase(
          rp.connect(buyer).processPayment(id, c.count, { value: sched[c.count - 1].amount }),
          c, 'payment against a completed agreement',
        );
      }
    });
  });

  // -------------------------------------------------------------- credit math
  describe('credit math (EnhancedBnpl)', () => {
    // A fresh contract per case, so every run gets a virgin credit line for the same buyer
    // instead of inheriting the previous case's collateral.
    async function freshBnpl() {
      return deploy('EnhancedBnpl', [], owner);
    }

    // the four invariants that must hold on any CreditLine at any time
    async function assertInvariants(bnpl, c, label) {
      const cl = await bnpl.getCreditLine(buyer.address);
      const expectedLimit = (cl.collateralValue * 80n) / 100n;
      assert.equal(cl.creditLimit, expectedLimit, ctx(`${label}: limit is 80% of collateral`, c));
      if (cl.creditLimit >= cl.usedCredit) {
        assert.equal(cl.availableCredit, cl.creditLimit - cl.usedCredit,
          ctx(`${label}: available + used == limit`, c));
      } else {
        assert.equal(cl.availableCredit, 0n, ctx(`${label}: available floors at zero`, c));
      }
      assert.ok(cl.availableCredit <= cl.creditLimit, ctx(`${label}: available never exceeds limit`, c));
      const expectedUtil = cl.usedCredit === 0n || cl.creditLimit === 0n
        ? 0n
        : (u => (u > 100n ? 100n : u))((cl.usedCredit * 100n) / cl.creditLimit);
      assert.equal(cl.creditUtilization, expectedUtil, ctx(`${label}: utilization`, c));
      assert.ok(cl.creditUtilization <= 100n, ctx(`${label}: utilization capped`, c));
      return cl;
    }

    it('[v2] fuzz: credit line invariants hold across deposit, draw and payoff', async () => {
      const cases = genCreditCases(makeRng(SEED + ':credit'), RUNS);
      for (const c of cases) {
        const bnpl = await freshBnpl();
        const collateral = BigInt(c.collateral);
        const draw = BigInt(c.draw);

        await (await bnpl.connect(buyer).depositETHCollateral({ value: collateral })).wait();
        let cl = await assertInvariants(bnpl, c, 'after deposit');
        assert.equal(cl.collateralValue, collateral, ctx('collateral recorded exactly', c));
        assert.equal(cl.usedCredit, 0n, ctx('nothing drawn yet', c));
        assert.equal(cl.availableCredit, cl.creditLimit, ctx('full limit available', c));

        // anything above the limit is refused, at the wei boundary
        await expectRevertCase(bnpl.createAgreementWithCredit(
          seller.address, buyer.address, cl.availableCredit + 1n, c.count,
          BigInt(c.intervalDays) * DAY, 0n, 0,
        ), c, 'draw one wei above availableCredit');
        await assertInvariants(bnpl, c, 'after rejected overdraw');

        const rc = await (await bnpl.createAgreementWithCredit(
          seller.address, buyer.address, draw, c.count,
          BigInt(c.intervalDays) * DAY, 0n, 0,
        )).wait();
        const id = findEvent(rc, bnpl, 'AgreementCreated').agreementId;

        cl = await assertInvariants(bnpl, c, 'after draw');
        assert.equal(cl.usedCredit, draw, ctx('used credit equals the draw', c));

        // paying the agreement off returns the line to where it started
        const agr = await bnpl.getAgreement(id);
        for (let i = 1; i <= c.count; i++) {
          await (await bnpl.connect(buyer).payInstallment(id, i, { value: agr.installmentAmount })).wait();
          await assertInvariants(bnpl, c, `mid payoff ${i}`);
        }
        cl = await assertInvariants(bnpl, c, 'after payoff');
        assert.equal(cl.usedCredit, 0n, ctx('credit fully released', c));
        assert.equal(cl.availableCredit, cl.creditLimit, ctx('full limit available again', c));
        assert.equal(cl.creditUtilization, 0n, ctx('utilization back to zero', c));
      }
    });

    it('[v2] fuzz: collateral withdrawal boundary keeps used credit fully backed', async () => {
      const cases = genCreditCases(makeRng(SEED + ':withdraw'), RUNS);
      for (const c of cases) {
        const bnpl = await freshBnpl();
        const collateral = BigInt(c.collateral);
        const draw = BigInt(c.draw);

        await (await bnpl.connect(buyer).depositETHCollateral({ value: collateral })).wait();
        await (await bnpl.createAgreementWithCredit(
          seller.address, buyer.address, draw, c.count, BigInt(c.intervalDays) * DAY, 0n, 0,
        )).wait();

        const positionId = (await bnpl.getUserCollateralPositionIds(buyer.address))[0];

        // smallest collateral that still satisfies floor(x * 80 / 100) >= draw
        const minBacking = ceilDiv(draw * 100n, 80n);
        const maxWithdraw = collateral > minBacking ? collateral - minBacking : 0n;

        // one wei past the boundary must be refused
        await expectRevertCase(
          bnpl.connect(buyer).withdrawCollateral(positionId, maxWithdraw + 1n),
          c, `withdraw one wei past the boundary (maxWithdraw=${maxWithdraw})`,
          'Collateral backs open credit',
        );
        let cl = await assertInvariants(bnpl, c, 'after rejected withdrawal');
        assert.equal(cl.collateralValue, collateral, ctx('rejected withdrawal did not move collateral', c));

        if (maxWithdraw > 0n) {
          await (await bnpl.connect(buyer).withdrawCollateral(positionId, maxWithdraw)).wait();
          cl = await assertInvariants(bnpl, c, 'at withdrawal boundary');
          assert.equal(cl.collateralValue, collateral - maxWithdraw, ctx('collateral reduced exactly', c));
          assert.ok(cl.creditLimit >= cl.usedCredit, ctx('used credit still backed at the boundary', c));
          // and having taken the maximum, nothing further can come out
          await expectRevertCase(
            bnpl.connect(buyer).withdrawCollateral(positionId, 1n),
            c, 'withdraw one more wei after taking the maximum',
            'Collateral backs open credit',
          );
        }
      }
    });
  });

  // -------------------------------------------------------------- yield accrual
  describe('yield accrual (DeFiIntegration)', () => {
    async function stake(defi, protocol, value) {
      if (protocol === 'LIDO') return defi.connect(buyer).stakeWithLido({ value });
      if (protocol === 'AAVE') return defi.connect(buyer).supplyToAave({ value });
      return defi.connect(buyer).supplyToCompound({ value });
    }

    it('[v2] fuzz: position value tracks the linear APY formula exactly and never decreases', async () => {
      const cases = genYieldCases(makeRng(SEED + ':yield'), RUNS);
      for (const c of cases) {
        const defi = await deploy('DeFiIntegration', [], owner);
        const protocol = PROTOCOLS[c.protocol];
        const amount = BigInt(c.amount);
        const apy = BigInt(c.apy);

        await (await defi.updateProtocolAPY(protocol, apy)).wait();
        await (await stake(defi, c.protocol, amount)).wait();

        const pos = (await defi.getUserYieldPositions(buyer.address))[0];
        assert.equal(pos.amount, amount, ctx('principal recorded', c));
        assert.equal(pos.apy, apy, ctx('apy snapshotted at stake time', c));

        let prev = await defi.getPositionValue(buyer.address, 0);
        assert.equal(prev, amount, ctx('no yield before any time passes', c));

        for (const secs of c.warpSeconds) {
          await warp(secs);
          const now = await latestTimestamp();
          const elapsed = now - pos.timestamp;
          const value = await defi.getPositionValue(buyer.address, 0);

          assert.equal(value, amount + expectedYield(amount, apy, elapsed),
            ctx(`value at elapsed=${elapsed}`, c));
          assert.ok(value >= prev, ctx(`monotonic at elapsed=${elapsed}`, c));
          if (apy === 0n) {
            assert.equal(value, amount, ctx('zero APY never accrues', c));
          }

          // the projection helper and the live valuation must agree on the same inputs
          assert.equal(
            await defi.calculateProjectedYield(amount, protocol, elapsed),
            value - amount,
            ctx(`projection agrees at elapsed=${elapsed}`, c),
          );
          prev = value;
        }
      }
    });

    it('[v2] fuzz: closing a position pays principal plus exactly the accrued yield', async () => {
      const cases = genYieldCases(makeRng(SEED + ':close'), RUNS);
      for (const c of cases) {
        const defi = await deploy('DeFiIntegration', [], owner);
        const protocol = PROTOCOLS[c.protocol];
        const amount = BigInt(c.amount);
        const apy = BigInt(c.apy);

        await (await defi.updateProtocolAPY(protocol, apy)).wait();
        await (await stake(defi, c.protocol, amount)).wait();
        // fund the simulator so it can actually pay the yield it promises
        await (await owner.sendTransaction({ to: await defi.getAddress(), value: E('50') })).wait();

        const pos = (await defi.getUserYieldPositions(buyer.address))[0];
        await warp(c.warpSeconds[0]);

        const contractBefore = BigInt(await getProvider().send('eth_getBalance', [await defi.getAddress(), 'latest']));
        const rc = await (await defi.connect(buyer).closeYieldPosition(0)).wait();

        // settle against the block the close actually landed in, not a wall-clock guess
        const closedAt = await blockTimestamp(rc.blockNumber);
        const yieldPaid = expectedYield(amount, apy, closedAt - pos.timestamp);

        assert.equal(await defi.getTotalYieldEarned(buyer.address), yieldPaid, ctx('yield booked exactly', c));
        const contractAfter = BigInt(await getProvider().send('eth_getBalance', [await defi.getAddress(), 'latest']));
        assert.equal(contractBefore - contractAfter, amount + yieldPaid, ctx('contract paid principal + yield', c));

        const closed = (await defi.getUserYieldPositions(buyer.address))[0];
        assert.equal(closed.amount, 0n, ctx('position zeroed', c));
        assert.equal(closed.shares, 0n, ctx('shares zeroed', c));
        assert.equal(await defi.getPositionValue(buyer.address, 0), 0n, ctx('closed position values at zero', c));
        // and a closed position cannot be drained twice
        await expectRevertCase(
          defi.connect(buyer).closeYieldPosition(0),
          c, 'double close', 'Position already closed',
        );
      }
    });
  });

  // -------------------------------------------------------------- reproducibility
  it('[v2] fuzz: case generation is deterministic and seed-dependent', () => {
    const gens = [genPaymentCases, genCreditCases, genYieldCases];
    for (const gen of gens) {
      const a = gen(makeRng('fixed-seed'), 25);
      const b = gen(makeRng('fixed-seed'), 25);
      assert.deepStrictEqual(a, b, `${gen.name} is not reproducible from the same seed`);
      const other = gen(makeRng('fixed-seed-2'), 25);
      assert.notDeepStrictEqual(a, other, `${gen.name} ignores the seed`);
      assert.equal(a.length, 25, `${gen.name} generated the wrong number of cases`);
    }
    // the generators must actually vary their inputs, or the "fuzz" is 8 copies of one case
    const pay = genPaymentCases(makeRng('spread'), 60);
    assert.ok(new Set(pay.map(c => c.count)).size >= 4, 'installment counts are not being varied');
    assert.ok(new Set(pay.map(c => c.method)).size === 3, 'payment methods are not being varied');
    assert.ok(new Set(pay.map(c => c.totalPrice)).size >= 55, 'prices are not being varied');
    const yields = genYieldCases(makeRng('spread'), 60);
    assert.ok(new Set(yields.map(c => c.apy)).size >= 5, 'APYs are not being varied');
    assert.ok(yields.some(c => c.apy === 0), 'the zero-APY edge case is never generated');
  });
});
