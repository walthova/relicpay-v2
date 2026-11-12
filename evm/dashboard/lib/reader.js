// The dashboard read layer: everything the buyer and seller screens need, as plain data.
//
// This is deliberately framework free. It takes a viem PublicClient and returns objects; it knows
// nothing about React, wagmi hooks, or rendering. That is what lets the characterization suite run
// the exact code the browser will run, against ganache, with no jsdom and no component tree. Part b
// of this roadmap item wraps these in hooks; nothing here should ever have to change for that.
//
// Three decisions shape the whole file.
//
// 1. Every dashboard read is pinned to one block.
//    `getBuyerDashboard` makes on the order of twenty eth_calls. Left unpinned they land across
//    several blocks, so a credit line from block N can be rendered next to a payment schedule from
//    N+2 that already consumed it, and the page shows available credit that is gone. The pin is
//    taken once at the top and threaded through every read, so a dashboard is always a consistent
//    snapshot of one block, and `blockNumber`/`timestamp` are returned so the UI can say as of
//    when.
//
// 2. Agreement discovery is by event, agreement truth is by call.
//    RelicPay has no enumeration: `agreements` is a mapping keyed by an id derived at creation, and
//    there is no getAgreementsForBuyer. The only way to find a user's agreements is the
//    AgreementCreated log, whose seller and buyer are both indexed. So logs supply the id set and
//    nothing else. Every field rendered comes from a fresh `getAgreement` call, because the log
//    payload is frozen at creation time while state, paidInstallments and ownershipTransferred all
//    move afterwards.
//
// 3. Overdue is derived, never read.
//    PaymentSchedule.status is storage that only advances when someone calls
//    processOverduePayments. An installment a month past due still reads `Pending` until then, so a
//    UI that trusts the stored status tells a buyer they are current while their grace period runs
//    out. Every overdue and defaultable flag here is computed from dueDate against the pinned block
//    timestamp. The stored status is still returned, as `storedStatus`, because the seller does
//    need to know whether the on-chain record has been advanced.

const { getAbiItem } = require('viem');
const { relicPayAbi } = require('./abis');
const {
  decodeBnplState,
  decodeCollateralType,
  decodePaymentMethod,
  decodePaymentStatus,
  paymentMethodTraits,
} = require('./enums');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const MAX_CREDIT_UTILIZATION = 10000n; // basis points, mirrors RelicPay.MAX_CREDIT_UTILIZATION
// ADR-012: the credit line counts recorded principal only, so a pending yield accrual cannot raise
// it and getWithdrawableCollateral is exact on the credit-headroom term. Kept as a switch rather
// than deleted so the floor handling downstream stays exercised and reversible if a real yield
// source ever backs the accrual.
const ACCRUAL_RAISES_CREDIT = false;
// RelicPay._updateYield returns early below this, so no accrual is pending until it passes.
const YIELD_ACCRUAL_INTERVAL = 86400n; // seconds, mirrors the `timeElapsed < 1 days` guard

const AGREEMENT_CREATED = getAbiItem({ abi: relicPayAbi, name: 'AgreementCreated' });

class ReaderError extends Error {}

function requireAddress(value, what) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ReaderError(`${what} must be an address, got ${value}`);
  }
  return value;
}

function lower(a) {
  return String(a).toLowerCase();
}

/**
 * @param {object} opts
 * @param {import('viem').PublicClient} opts.publicClient
 * @param {{relicPay: string, relicRegistry?: string, priceOracle?: string}} opts.addresses
 * @param {bigint} [opts.fromBlock]  first block to scan for AgreementCreated. Defaults to 0n, which
 *   is correct for a local chain and wasteful on a public one; pass the deploy block on Sepolia.
 * @param {bigint} [opts.logChunkSize]  eth_getLogs range per request. 10k is under the cap every
 *   major hosted RPC enforces; a self-hosted node can raise it.
 */
function createRelicPayReader({ publicClient, addresses, fromBlock = 0n, logChunkSize = 10000n }) {
  if (!publicClient) throw new ReaderError('publicClient is required');
  if (!addresses || !addresses.relicPay) throw new ReaderError('addresses.relicPay is required');
  const relicPay = requireAddress(addresses.relicPay, 'addresses.relicPay');

  function read(functionName, args, blockNumber) {
    return publicClient.readContract({
      address: relicPay,
      abi: relicPayAbi,
      functionName,
      args,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    });
  }

  /** Resolve the block everything in one dashboard call will be read at. */
  async function pin(blockNumber) {
    const n = blockNumber === undefined ? await publicClient.getBlockNumber() : BigInt(blockNumber);
    const block = await publicClient.getBlock({ blockNumber: n });
    return { blockNumber: n, timestamp: BigInt(block.timestamp) };
  }

  /**
   * AgreementCreated ids for a user, by role. `role` is 'buyer', 'seller' or 'any'; 'any' runs two
   * filtered queries rather than one unfiltered scan, because the indexed topic filter is what
   * keeps this cheap and an unfiltered scan of every agreement ever created is not something a
   * dashboard should be doing to find one user's three.
   */
  async function getAgreementIds(user, { role = 'buyer', toBlock, from = fromBlock } = {}) {
    requireAddress(user, 'user');
    const end = toBlock === undefined ? await publicClient.getBlockNumber() : BigInt(toBlock);
    const filters = [];
    if (role === 'buyer' || role === 'any') filters.push({ buyer: user });
    if (role === 'seller' || role === 'any') filters.push({ seller: user });
    if (!filters.length) throw new ReaderError(`role must be buyer, seller or any, got ${role}`);

    const seen = new Map(); // id -> first block seen, keeps creation order stable
    for (const args of filters) {
      let start = BigInt(from);
      while (start <= end) {
        let stop = start + logChunkSize - 1n;
        if (stop > end) stop = end;
        const logs = await publicClient.getLogs({
          address: relicPay,
          event: AGREEMENT_CREATED,
          args,
          fromBlock: start,
          toBlock: stop,
        });
        for (const log of logs) {
          const id = log.args.agreementId;
          if (!seen.has(id)) seen.set(id, [log.blockNumber ?? 0n, log.logIndex ?? 0]);
        }
        start = stop + 1n;
      }
    }
    return [...seen.entries()]
      .sort((a, b) => (a[1][0] === b[1][0] ? a[1][1] - b[1][1] : a[1][0] < b[1][0] ? -1 : 1))
      .map(([id]) => id);
  }

  /**
   * One agreement, fully hydrated and pinned. `at` is the {blockNumber, timestamp} from pin(); pass
   * it when hydrating several agreements so they all describe the same block.
   */
  async function getAgreement(agreementId, { at } = {}) {
    const when = at || (await pin());
    const bn = when.blockNumber;

    const [raw, schedule, status, terms, readiness, currency, paid, seized, defaultedAt] =
      await Promise.all([
        read('getAgreement', [agreementId], bn),
        read('getPaymentSchedule', [agreementId], bn),
        read('getDefaultStatus', [agreementId], bn),
        read('getSettlementTerms', [agreementId], bn),
        read('getSettlementReadiness', [agreementId], bn),
        // Not derivable from the two above: both return zeroes once the agreement leaves Active,
        // and a zeroed token address is indistinguishable from "settles in ETH". Without this a
        // completed stablecoin agreement comes back with no currency and every amount on it gets
        // rendered in ETH. getSettlementToken is not gated on state.
        read('getSettlementToken', [agreementId], bn),
        read('totalPaid', [agreementId], bn),
        read('getCollateralSeized', [agreementId], bn),
        read('defaultedAt', [agreementId], bn),
      ]);

    if (lower(raw.seller) === ZERO_ADDRESS) throw new ReaderError(`agreement ${agreementId} not found`);

    const state = decodeBnplState(raw.state);
    const method = paymentMethodTraits(decodePaymentMethod(raw.paymentMethod));
    const now = when.timestamp;

    // Outstanding is computed here rather than taken from getDefaultStatus. That getter returns
    // zeros for any non-Active agreement, so a defaulted agreement with real money still owed on it
    // would report outstanding 0 and render as settled.
    const outstanding = raw.totalPrice - paid;

    const [defaultable, nextInstallmentNumber, graceExpiry] = status;
    const nextIndex = Number(nextInstallmentNumber) - 1;

    const decoratedSchedule = schedule.map((s) => {
      const storedStatus = decodePaymentStatus(s.status);
      const settled = storedStatus === 'Paid';
      return {
        installmentNumber: s.installmentNumber,
        amount: s.amount,
        dueDate: s.dueDate,
        storedStatus,
        paidAmount: s.paidAmount,
        paidAt: s.paidAt === 0n ? null : s.paidAt,
        // Derived, see the header note: storedStatus lags reality until someone pays the gas to
        // advance it.
        isOverdue: !settled && state === 'Active' && now >= s.dueDate,
        secondsUntilDue: settled ? null : s.dueDate - now,
      };
    });

    let next = null;
    if (state === 'Active' && nextInstallmentNumber !== 0n && decoratedSchedule[nextIndex]) {
      const entry = decoratedSchedule[nextIndex];
      next = {
        installmentNumber: entry.installmentNumber,
        amount: entry.amount,
        dueDate: entry.dueDate,
        graceExpiry,
        secondsUntilDue: entry.dueDate - now,
        secondsUntilGraceExpiry: graceExpiry - now,
        isOverdue: entry.isOverdue,
        isDefaultable: defaultable,
      };
    }

    // getSettlementTerms/getSettlementReadiness also zero out for non-Active agreements, and a
    // zeroed token address is indistinguishable from "settles in ETH". Returning null instead of a
    // zero-filled object keeps a completed agreement from rendering as "needs 0 ETH, not ready".
    let settlement = null;
    if (next) {
      const [token, , required, requiresApproval] = [terms[0], terms[1], terms[2], terms[3]];
      settlement = {
        token: lower(readiness[0]) === ZERO_ADDRESS ? null : readiness[0], // null means native ETH
        tokenAddress: readiness[0],
        required: readiness[1],
        autoBalance: readiness[2],
        collateralAvailable: readiness[3],
        ready: readiness[4],
        // Manual settlement in an ERC20 needs an allowance before the payment call will succeed.
        // The UI has to know this before it shows a Pay button, not after the revert.
        requiresApproval,
        termsToken: token,
        termsAmount: required,
      };
    }

    const paidCount = Number(raw.paidInstallments);
    const totalCount = Number(raw.installmentCount);

    return {
      id: agreementId,
      seller: raw.seller,
      buyer: raw.buyer,
      totalPrice: raw.totalPrice,
      installmentAmount: raw.installmentAmount,
      installmentCount: totalCount,
      paidInstallments: paidCount,
      dueIntervalSeconds: BigInt(raw.dueIntervalSeconds),
      gracePeriodSeconds: BigInt(raw.gracePeriodSeconds),
      startTime: BigInt(raw.startTime),
      lastPaymentTime: raw.lastPaymentTime === 0 ? null : BigInt(raw.lastPaymentTime),
      state,
      paymentMethod: method,
      // The currency every amount on this agreement is denominated in, for its whole life. null
      // means native ETH. Snapshotted at creation, so it does not move when the seller changes
      // their preference, and unlike `settlement` below it survives Completed and Defaulted.
      // getSettlementTerms does no conversion: totalPrice, installmentAmount and every schedule
      // amount are already in these units, they are not wei.
      settlementToken: lower(currency) === ZERO_ADDRESS ? null : currency,
      autoPaymentEnabled: raw.autoPaymentEnabled,
      collateralPositionId: raw.collateralPositionId,
      relic: {
        physicalId: raw.rwaAsset.physicalId,
        nftContract: raw.rwaAsset.nftContract,
        tokenId: raw.rwaAsset.tokenId,
        metadataURI: raw.rwaAsset.metadataURI,
        ownershipTransferred: raw.rwaAsset.ownershipTransferred,
        currentOwner: raw.rwaAsset.currentOwner,
      },
      totalPaid: paid,
      outstanding,
      progress: {
        paid: paidCount,
        total: totalCount,
        ratio: totalCount === 0 ? 0 : paidCount / totalCount,
      },
      schedule: decoratedSchedule,
      next,
      settlement,
      defaultable,
      overdueCount: decoratedSchedule.filter((s) => s.isOverdue).length,
      collateralSeized: seized,
      defaultedAt: defaultedAt === 0n ? null : defaultedAt,
      at: when,
    };
  }

  async function getAgreements(ids, { at } = {}) {
    const when = at || (await pin());
    return Promise.all(ids.map((id) => getAgreement(id, { at: when })));
  }

  async function getCreditLine(user, { at } = {}) {
    const when = at || (await pin());
    const [line, collateralValue] = await Promise.all([
      read('getCreditLine', [user], when.blockNumber),
      read('getTotalCollateralValue', [user], when.blockNumber),
    ]);
    // creditUtilization is clamped at 10000 bps in the contract on purpose, so a reading of exactly
    // 100% means "at or over the limit" and cannot be trusted to show how far over. usedCredit and
    // creditLimit are uncapped uint256, so the true ratio is recomputed here and the clamp is
    // surfaced as a flag rather than silently rendered as a tidy 100%.
    const clamped = BigInt(line.creditUtilization) >= MAX_CREDIT_UTILIZATION;
    const trueUtilizationBps =
      line.creditLimit === 0n ? 0n : (line.usedCredit * 10000n) / line.creditLimit;
    return {
      collateralValue: line.collateralValue,
      creditLimit: line.creditLimit,
      availableCredit: line.availableCredit,
      usedCredit: line.usedCredit,
      utilizationBps: BigInt(line.creditUtilization),
      trueUtilizationBps,
      isClamped: clamped,
      isOverLimit: line.usedCredit > line.creditLimit,
      lastUpdateTime: BigInt(line.lastUpdateTime),
      totalCollateralValue: collateralValue,
      at: when,
    };
  }

  /**
   * Collateral positions, each carrying what a withdrawal needs to be planned against.
   *
   * Three reads per position rather than one, and each of the extra two exists to tell one of
   * `withdrawCollateral`'s three reverts apart from the others. The contract distinguishes them
   * deliberately, and a UI that renders "withdrawal failed" for all three throws that away:
   *
   *   `principal` is `collateralPrincipal`, the ceiling that is not `amount`. Simulated yield
   *   inflates `amount` and is backed by nothing, so the withdrawable ceiling is the deposited
   *   principal and a request above it is `ExceedsWithdrawablePrincipal`, not a shortfall.
   *
   *   `withdrawable` is `getWithdrawableCollateral`, which folds in the third gate: how far the
   *   credit line can fall before it stops covering `usedCredit`. An amount inside principal but
   *   above this one is `CollateralBacksOpenCredit`, which is a different problem with a different
   *   fix (pay the agreement down, not deposit more).
   *
   * `mayAccrue` is the caveat on `withdrawable`, and the reason it is a field rather than a
   * comment. `getWithdrawableCollateral` is a view, so it does not settle pending yield, while
   * `withdrawCollateral` calls `_updateYield` on its way in. On an autoReinvest position with a
   * nonzero yield rate that accrual raises `amount` and with it the whole collateral value, so the
   * credit headroom the view reported was a floor and the chain may accept more than it said.
   * Principal never moves, so the other two ceilings stay exact.
   *
   * It mirrors `_updateYield`'s own four guards rather than approximating them, and the fourth one
   * is why: the function returns early unless a full day has passed since `lastUpdateTime`. Every
   * deposit sets `autoReinvest` true and ETH carries a 5% rate out of the constructor, so a flag
   * built from the first three alone would be true on essentially every position, and the
   * credit-backing rejection would degrade into a permanent maybe. Measured against the pinned
   * timestamp, so it answers "would an accrual happen if this were sent now", which is the question
   * the plan is preflighted for. It can come untrue by the clock alone, which is exactly what
   * `isPlanStale` already handles: the pin moves, the plan is rebuilt.
   */
  async function getCollateralPositions(user, { at } = {}) {
    const when = at || (await pin());
    const ids = await read('getUserCollateralPositionIds', [user], when.blockNumber);
    const positions = await Promise.all(
      ids.map((id) => read('getCollateralPosition', [user, id], when.blockNumber))
    );
    const [principals, withdrawables] = await Promise.all([
      Promise.all(ids.map((id) => read('collateralPrincipal', [user, id], when.blockNumber))),
      Promise.all(ids.map((id) => read('getWithdrawableCollateral', [user, id], when.blockNumber))),
    ]);
    // One rate read per distinct asset, not per position: a buyer with five ETH positions asks the
    // node once. Keyed lowercase, read with the address as the contract returned it.
    const assets = new Map(positions.map((p) => [lower(p.tokenAddress), p.tokenAddress]));
    const keys = [...assets.keys()];
    const rates = await Promise.all(
      keys.map((k) => read('yieldRates', [assets.get(k)], when.blockNumber))
    );
    const rateOf = new Map(keys.map((k, i) => [k, BigInt(rates[i])]));

    return ids.map((id, i) => {
      const p = positions[i];
      const type = decodeCollateralType(p.collateralType);
      const yieldRateBps = rateOf.get(lower(p.tokenAddress)) ?? 0n;
      const lastUpdateTime = BigInt(p.lastUpdateTime);
      // ADR-012: accrual no longer moves the credit line, so it no longer makes withdrawable a floor.
      const mayAccrue =
        ACCRUAL_RAISES_CREDIT &&
        Boolean(p.autoReinvest) &&
        yieldRateBps > 0n &&
        p.amount > 0n &&
        when.timestamp - lastUpdateTime >= YIELD_ACCRUAL_INTERVAL;
      return {
        id,
        collateralType: type,
        // Native ETH positions carry tokenAddress 0; null keeps a UI from rendering the zero
        // address as if it were a token contract worth linking to.
        token: lower(p.tokenAddress) === ZERO_ADDRESS ? null : p.tokenAddress,
        autoReinvest: p.autoReinvest,
        lastUpdateTime,
        amount: p.amount,
        yieldAccrued: p.yieldAccrued,
        stakingRewards: p.stakingRewards,
        isStaked: type === 'StakedETH' || type === 'LiquidStakingToken',
        principal: principals[i],
        withdrawable: withdrawables[i],
        yieldRateBps,
        mayAccrue,
      };
    });
  }

  /**
   * Settlement currencies referenced by a set of agreements, for balance lookups.
   *
   * Reads the per-agreement currency, not `settlement.tokenAddress`, so a currency whose agreements
   * have all completed or defaulted is still listed. Balances outlive agreements in both
   * directions: a seller holds the proceeds of a completed stablecoin agreement until they
   * withdraw, and a buyer's auto-payment pool keeps whatever was left in it. Scoping this to Active
   * agreements hid both, so the seller with USDC owed to them saw an empty withdrawable list.
   */
  function settlementTokensOf(agreements) {
    const tokens = new Set();
    for (const a of agreements) {
      if (a.settlementToken) tokens.add(a.settlementToken);
    }
    return [...tokens];
  }

  async function getBuyerDashboard(buyer, { blockNumber, toBlock } = {}) {
    requireAddress(buyer, 'buyer');
    const at = await pin(blockNumber);
    const ids = await getAgreementIds(buyer, { role: 'buyer', toBlock: toBlock ?? at.blockNumber });
    const [agreements, credit, collateral, autoEnabled, autoEth] = await Promise.all([
      getAgreements(ids, { at }),
      getCreditLine(buyer, { at }),
      getCollateralPositions(buyer, { at }),
      read('autoPaymentEnabled', [buyer], at.blockNumber),
      read('getAutoPaymentBalance', [buyer, ZERO_ADDRESS], at.blockNumber),
    ]);

    const tokens = settlementTokensOf(agreements);
    const tokenBalances = await Promise.all(
      tokens.map((t) => read('getAutoPaymentBalance', [buyer, t], at.blockNumber))
    );

    const active = agreements.filter((a) => a.state === 'Active');
    return {
      address: buyer,
      at,
      credit,
      collateral,
      totalCollateral: collateral.reduce((sum, p) => sum + p.amount, 0n),
      autoPayment: {
        enabled: autoEnabled,
        ethBalance: autoEth,
        tokenBalances: Object.fromEntries(tokens.map((t, i) => [t, tokenBalances[i]])),
      },
      agreements,
      summary: {
        total: agreements.length,
        active: active.length,
        completed: agreements.filter((a) => a.state === 'Completed').length,
        defaulted: agreements.filter((a) => a.state === 'Defaulted').length,
        outstanding: active.reduce((sum, a) => sum + a.outstanding, 0n),
        overdue: active.filter((a) => a.next && a.next.isOverdue),
        atRisk: active.filter((a) => a.defaultable),
        // The buyer's real call to action: an active agreement whose next installment cannot be
        // covered by the pools it is configured to draw from. Manual agreements are excluded
        // because "ready" is meaningless for them, the buyer just sends the transaction.
        underfunded: active.filter(
          (a) => a.settlement && !a.paymentMethod.requiresBuyerTransaction && !a.settlement.ready
        ),
        relicsHeld: agreements.filter((a) => a.relic.ownershipTransferred).length,
      },
    };
  }

  async function getSellerDashboard(seller, { blockNumber, toBlock } = {}) {
    requireAddress(seller, 'seller');
    const at = await pin(blockNumber);
    const ids = await getAgreementIds(seller, { role: 'seller', toBlock: toBlock ?? at.blockNumber });
    const [agreements, ethBalance, preference] = await Promise.all([
      getAgreements(ids, { at }),
      read('getSellerBalance', [seller], at.blockNumber),
      read('sellerSettlementToken', [seller], at.blockNumber),
    ]);

    const tokens = settlementTokensOf(agreements);
    const prefToken = lower(preference) === ZERO_ADDRESS ? null : preference;
    if (prefToken && !tokens.some((t) => lower(t) === lower(prefToken))) tokens.push(prefToken);

    const tokenBalances = await Promise.all(
      tokens.map((t) => read('getSellerTokenBalance', [seller, t], at.blockNumber))
    );

    const active = agreements.filter((a) => a.state === 'Active');
    return {
      address: seller,
      at,
      // null means this seller takes ETH. Snapshotted per agreement at creation, so changing the
      // preference does not move agreements already open, which is why agreements carry their own
      // settlement token and this is only the default for the next one.
      settlementPreference: prefToken,
      balances: {
        eth: ethBalance,
        tokens: Object.fromEntries(tokens.map((t, i) => [t, tokenBalances[i]])),
      },
      withdrawable: {
        eth: ethBalance > 0n,
        tokens: tokens.filter((t, i) => tokenBalances[i] > 0n),
      },
      agreements,
      summary: {
        total: agreements.length,
        active: active.length,
        completed: agreements.filter((a) => a.state === 'Completed').length,
        defaulted: agreements.filter((a) => a.state === 'Defaulted').length,
        receivable: active.reduce((sum, a) => sum + a.outstanding, 0n),
        // Agreements past their grace period, where triggerDefault would succeed right now. This is
        // the seller's only time-sensitive action in the protocol.
        defaultable: active.filter((a) => a.defaultable),
        overdue: active.filter((a) => a.next && a.next.isOverdue),
        // Active agreements where processOverduePayments would advance the stored schedule status.
        // Cosmetic on chain, but it is the seller who has to pay for it and the only place the
        // stored-versus-derived gap is visible.
        staleSchedules: active.filter((a) =>
          a.schedule.some((s) => s.isOverdue && s.storedStatus === 'Pending')
        ),
      },
    };
  }

  async function getProtocolInfo({ blockNumber } = {}) {
    const at = await pin(blockNumber);
    const [params, owner, governor] = await Promise.all([
      read('getGovernanceParams', [], at.blockNumber),
      read('owner', [], at.blockNumber),
      read('governor', [], at.blockNumber),
    ]);
    return {
      at,
      address: relicPay,
      owner,
      governor: lower(governor) === ZERO_ADDRESS ? null : governor, // null means ungoverned
      params: {
        creditLimitRatioBps: params.creditLimitRatio,
        defaultGracePeriod: params.defaultGracePeriod,
        minCollateralAmount: params.minCollateralAmount,
        maxAgreementDuration: params.maxAgreementDuration,
        autoPaymentEnabled: params.autoPaymentEnabled,
      },
    };
  }

  return {
    address: relicPay,
    addresses,
    pin,
    read,
    getAgreementIds,
    getAgreement,
    getAgreements,
    getCreditLine,
    getCollateralPositions,
    getBuyerDashboard,
    getSellerDashboard,
    getProtocolInfo,
  };
}

module.exports = {
  ReaderError,
  ZERO_ADDRESS,
  MAX_CREDIT_UTILIZATION,
  YIELD_ACCRUAL_INTERVAL,
  AGREEMENT_CREATED,
  createRelicPayReader,
};
