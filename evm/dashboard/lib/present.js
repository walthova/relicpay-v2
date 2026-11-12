// The render model: reader output turned into something React can serialize.
//
// See docs/ADR-001-dashboard-reads.md. Reads happen in server components calling reader.js
// directly, which is the only shape that preserves the reader's one-render-one-block pin. The price
// of that decision is this file: React cannot pass a BigInt across the server/client boundary, and
// the reader returns BigInt for every amount, timestamp and duration. Part c's write flows are
// interactive, so the boundary is real and cannot be dodged by rendering everything on the server.
//
// Rules this file holds to, all of them learned from the reader's own header notes:
//
// 1. Nothing here decides anything. The reader derives overdue, defaultable and readiness from
//    chain state; the presenter formats what it is given. If a flag is missing from the view model
//    the fix is in reader.js, not a conditional here, or the two layers start disagreeing about
//    whether a buyer is late.
//
// 2. Every amount carries its own currency. The contract does no conversion, so an agreement's
//    totalPrice is in that agreement's settlement token's units and is not wei. Formatting a
//    6-decimal stablecoin at 18 shows 0.000000000001 on a screen that tells someone what they owe.
//
// 3. An unknown currency renders as nothing, never as a plausible number. No decimals means
//    `display: null` and `known: false`, and the UI says "unknown currency". A wrong number that
//    looks right is worse than a blank.
//
// 4. Output is JSON-safe by construction and `assertSerializable` proves it. A BigInt that escapes
//    this layer does not fail here, it fails in React's serializer at render time with a message
//    that names neither the field nor the agreement.

const { formatUnits } = require('viem');
const { NATIVE, tokenMetaFrom } = require('./tokens');

class PresenterError extends Error {}

const SECOND = 1n;
const MINUTE = 60n;
const HOUR = 3600n;
const DAY = 86400n;
const WEEK = 604800n;
const MONTH = 2592000n; // 30 days, the protocol's own default interval
const YEAR = 31536000n;

const UNITS = [
  [YEAR, 'year'],
  [MONTH, 'month'],
  [WEEK, 'week'],
  [DAY, 'day'],
  [HOUR, 'hour'],
  [MINUTE, 'minute'],
  [SECOND, 'second'],
];

function isBigIntish(v) {
  return typeof v === 'bigint';
}

function big(value, what) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new PresenterError(`${what} must be an integer, got ${String(value)}`);
}

/**
 * A duration in seconds as a coarse human string. One unit, not "1 month 3 days 4 hours": this
 * appears next to a due date, where the useful question is "roughly when", and a compound string
 * reads as precision the chain's block timestamps do not have.
 */
function humanDuration(seconds) {
  let s = big(seconds, 'duration');
  const negative = s < 0n;
  if (negative) s = -s;
  if (s === 0n) return 'now';
  for (const [size, name] of UNITS) {
    if (s >= size) {
      const n = s / size;
      return `${n} ${name}${n === 1n ? '' : 's'}`;
    }
  }
  return 'now';
}

/** Signed seconds relative to now: positive is future. */
function presentDuration(seconds) {
  if (seconds === null || seconds === undefined) return null;
  const s = big(seconds, 'duration');
  return {
    seconds: s.toString(),
    human: humanDuration(s),
    // The phrase a UI puts next to a date, so "12 days ago" and "in 12 days" are not assembled
    // from `human` at four call sites with three different word orders.
    relative: s === 0n ? 'now' : s > 0n ? `in ${humanDuration(s)}` : `${humanDuration(s)} ago`,
    isPast: s < 0n,
  };
}

/**
 * A chain timestamp. `now` is the pinned block timestamp, never Date.now(): the whole dashboard
 * describes one block, and mixing in wall-clock time makes "overdue in 3 minutes" drift against the
 * overdue flag the reader computed from the block.
 */
function presentTime(unix, now) {
  if (unix === null || unix === undefined) return null;
  const v = big(unix, 'timestamp');
  const ms = Number(v) * 1000;
  return {
    unix: v.toString(),
    iso: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
    in: now === undefined || now === null ? null : presentDuration(v - big(now, 'now')),
  };
}

/**
 * An amount in a currency.
 *
 * `display` is null whenever the currency's decimals are unknown; see rule 3. `raw` is always the
 * exact integer as a string, so a UI that wants to render something for an unknown currency can
 * show the integer and say so, and so part c can pass the value straight back to a write call
 * without a lossy round trip through a float.
 */
function presentAmount(raw, meta = NATIVE) {
  const v = big(raw, 'amount');
  const known = meta && Number.isInteger(meta.decimals);
  return {
    raw: v.toString(),
    display: known ? formatUnits(v, meta.decimals) : null,
    symbol: known ? meta.symbol : null,
    decimals: known ? meta.decimals : null,
    currency: {
      address: meta ? meta.address ?? null : null,
      symbol: meta ? meta.symbol ?? null : null,
      decimals: known ? meta.decimals : null,
      native: !!(meta && meta.native),
      known: !!known,
    },
    isZero: v === 0n,
  };
}

/** Basis points as both the exact integer and a rendered percentage. */
function presentBps(bps) {
  const v = big(bps, 'bps');
  const whole = v / 100n;
  const frac = (v < 0n ? -v : v) % 100n;
  return {
    bps: v.toString(),
    percent: `${whole}.${String(frac).padStart(2, '0')}%`,
    ratio: Number(v) / 10000,
  };
}

/**
 * Status as a label plus a tone the UI maps to a colour, decided once here rather than in a
 * component. `tone` is one of ok, warn, danger, neutral.
 */
function agreementTone(a) {
  if (a.state === 'Defaulted') return 'danger';
  if (a.state === 'Completed') return 'ok';
  if (a.defaultable) return 'danger';
  if (a.overdueCount > 0) return 'warn';
  if (a.settlement && !a.paymentMethod.requiresBuyerTransaction && !a.settlement.ready) return 'warn';
  return 'ok';
}

/**
 * How far the pools a payment method draws from fall short of the next installment.
 *
 * Mirrors the `ready` branch in RelicPay.getSettlementReadiness exactly: Auto sees only the
 * auto-payment balance, Collateral sees only drawable collateral, AutoWithCollateral settles from
 * whichever single source covers it, so its shortfall is measured against the larger one and not
 * against the two added together.
 *
 * Manual returns null. The money comes from the buyer's wallet, which the contract cannot see and
 * neither can this; the UI's job there is to show the amount due and let the wallet reject it.
 */
function shortfallOf(a) {
  const s = a.settlement;
  const m = a.paymentMethod;
  if (m.requiresBuyerTransaction) return null;
  let available = 0n;
  if (m.usesAutoBalance) available = s.autoBalance;
  if (m.usesCollateral && s.collateralAvailable > available) available = s.collateralAvailable;
  return s.required > available ? s.required - available : 0n;
}

function presentSchedule(schedule, now, meta) {
  return schedule.map((s) => ({
    installmentNumber: Number(s.installmentNumber),
    amount: presentAmount(s.amount, meta),
    dueDate: presentTime(s.dueDate, now),
    storedStatus: s.storedStatus,
    paidAmount: presentAmount(s.paidAmount, meta),
    paidAt: s.paidAt === null || s.paidAt === undefined ? null : presentTime(s.paidAt, now),
    isOverdue: !!s.isOverdue,
    // The reader's derived truth and the chain's stored record disagreeing is not an error, it is
    // the normal state of an overdue installment nobody has paid gas to advance. Naming it here
    // keeps the seller's "stale schedule" screen from re-deriving the same comparison.
    isStale: !!s.isOverdue && s.storedStatus === 'Pending',
    secondsUntilDue: presentDuration(s.secondsUntilDue),
  }));
}

/**
 * One agreement.
 *
 * `tokens` is the resolved metadata map from tokens.js `load`/`loadForDashboard`, keyed by
 * lowercased address. An address missing from it presents as an unknown currency, which is the
 * honest outcome and not a throw: one non-compliant ERC20 must not blank the page.
 */
function presentAgreement(a, { tokens = {} } = {}) {
  if (!a || typeof a !== 'object') throw new PresenterError('agreement is required');
  const now = a.at ? big(a.at.timestamp, 'at.timestamp') : undefined;
  const meta = tokenMetaFrom(tokens, a.settlementToken);
  const amount = (v) => presentAmount(v, meta);

  return {
    id: a.id,
    seller: a.seller,
    buyer: a.buyer,
    state: a.state,
    tone: agreementTone(a),
    currency: {
      address: meta.address ?? null,
      symbol: meta.symbol ?? null,
      decimals: Number.isInteger(meta.decimals) ? meta.decimals : null,
      native: !!meta.native,
      known: !!Number.isInteger(meta.decimals),
    },
    totalPrice: amount(a.totalPrice),
    installmentAmount: amount(a.installmentAmount),
    totalPaid: amount(a.totalPaid),
    outstanding: amount(a.outstanding),
    installmentCount: a.installmentCount,
    paidInstallments: a.paidInstallments,
    progress: {
      paid: a.progress.paid,
      total: a.progress.total,
      ratio: a.progress.ratio,
      percent: `${Math.round(a.progress.ratio * 100)}%`,
    },
    paymentMethod: {
      label: a.paymentMethod.label,
      usesAutoBalance: a.paymentMethod.usesAutoBalance,
      usesCollateral: a.paymentMethod.usesCollateral,
      requiresBuyerTransaction: a.paymentMethod.requiresBuyerTransaction,
    },
    autoPaymentEnabled: a.autoPaymentEnabled,
    // bytes32, not a counter: the contract derives position and agreement ids by hashing. Already a
    // hex string over the ABI boundary, so it crosses to the client untouched.
    collateralPositionId: a.collateralPositionId,
    startTime: presentTime(a.startTime, now),
    lastPaymentTime: a.lastPaymentTime === null ? null : presentTime(a.lastPaymentTime, now),
    dueInterval: presentDuration(a.dueIntervalSeconds),
    gracePeriod: presentDuration(a.gracePeriodSeconds),
    relic: {
      physicalId: a.relic.physicalId,
      nftContract: a.relic.nftContract,
      tokenId: big(a.relic.tokenId, 'relic.tokenId').toString(),
      metadataURI: a.relic.metadataURI,
      ownershipTransferred: a.relic.ownershipTransferred,
      currentOwner: a.relic.currentOwner,
    },
    schedule: presentSchedule(a.schedule, now, meta),
    next:
      a.next === null || a.next === undefined
        ? null
        : {
            installmentNumber: Number(a.next.installmentNumber),
            amount: amount(a.next.amount),
            dueDate: presentTime(a.next.dueDate, now),
            graceExpiry: presentTime(a.next.graceExpiry, now),
            secondsUntilDue: presentDuration(a.next.secondsUntilDue),
            secondsUntilGraceExpiry: presentDuration(a.next.secondsUntilGraceExpiry),
            isOverdue: a.next.isOverdue,
            isDefaultable: a.next.isDefaultable,
          },
    settlement:
      a.settlement === null || a.settlement === undefined
        ? null
        : {
            tokenAddress: a.settlement.token, // null means native ETH
            required: amount(a.settlement.required),
            autoBalance: amount(a.settlement.autoBalance),
            collateralAvailable: amount(a.settlement.collateralAvailable),
            ready: a.settlement.ready,
            requiresApproval: a.settlement.requiresApproval,
            // What the pools this method actually draws from are short by, so the "top up" screen
            // has the number instead of subtracting two formatted strings.
            //
            // Which pools is load-bearing, not a detail. An Auto agreement settles from the
            // auto-payment balance and nothing else, so a buyer with 10 ETH of collateral and an
            // empty pool is still short the whole installment. Taking the larger of the two would
            // report a shortfall of zero on an agreement the contract is about to refuse to settle,
            // which is the same number the page would show if everything were fine.
            shortfall: shortfallOf(a) === null ? null : amount(shortfallOf(a)),
          },
    defaultable: a.defaultable,
    overdueCount: a.overdueCount,
    collateralSeized: amount(a.collateralSeized),
    defaultedAt: a.defaultedAt === null ? null : presentTime(a.defaultedAt, now),
    at: presentAt(a.at),
  };
}

function presentAt(at) {
  if (!at) return null;
  return {
    blockNumber: big(at.blockNumber, 'at.blockNumber').toString(),
    timestamp: big(at.timestamp, 'at.timestamp').toString(),
    iso: new Date(Number(big(at.timestamp, 'at.timestamp')) * 1000).toISOString(),
  };
}

function presentCredit(credit) {
  return {
    collateralValue: presentAmount(credit.collateralValue, NATIVE),
    totalCollateralValue: presentAmount(credit.totalCollateralValue, NATIVE),
    creditLimit: presentAmount(credit.creditLimit, NATIVE),
    availableCredit: presentAmount(credit.availableCredit, NATIVE),
    usedCredit: presentAmount(credit.usedCredit, NATIVE),
    utilization: presentBps(credit.utilizationBps),
    // The contract clamps creditUtilization at 100%, so the stored figure cannot show how far over
    // the limit a buyer is. The reader recomputes the real ratio; both are carried so a UI can show
    // a 100% bar and still say "over limit" beside it.
    trueUtilization: presentBps(credit.trueUtilizationBps),
    isClamped: credit.isClamped,
    isOverLimit: credit.isOverLimit,
    lastUpdateTime: presentTime(credit.lastUpdateTime),
  };
}

/**
 * `withdrawable` is presented as an amount like any other, with one difference a UI has to respect:
 * it is a ceiling the chain may exceed, never one it falls short of. `isFloor` carries that. When
 * the position auto-reinvests a nonzero yield rate, the pending accrual raises the collateral value
 * on the way into `withdrawCollateral`, so the credit-headroom term the view reported was a lower
 * bound. Rendering the figure as "max" without the caveat promises an exactness the contract does
 * not offer, which is the one thing the roadmap item asked this not to do.
 */
function presentCollateral(positions, tokens = {}) {
  return positions.map((p) => {
    const meta = tokenMetaFrom(tokens, p.token);
    const withdrawable = p.withdrawable === undefined || p.withdrawable === null ? null : p.withdrawable;
    const principal = p.principal === undefined || p.principal === null ? null : p.principal;
    return {
      id: p.id, // bytes32, see presentAgreement.collateralPositionId
      collateralType: p.collateralType,
      tokenAddress: p.token, // null means native ETH
      amount: presentAmount(p.amount, meta),
      yieldAccrued: presentAmount(p.yieldAccrued, meta),
      stakingRewards: presentAmount(p.stakingRewards, meta),
      autoReinvest: p.autoReinvest,
      isStaked: p.isStaked,
      lastUpdateTime: presentTime(p.lastUpdateTime),
      principal: principal === null ? null : presentAmount(principal, meta),
      withdrawable: withdrawable === null ? null : presentAmount(withdrawable, meta),
      // True when the reported withdrawable is a floor rather than the exact maximum.
      isFloor: Boolean(p.mayAccrue),
      yieldRateBps: p.yieldRateBps === undefined || p.yieldRateBps === null ? null : String(p.yieldRateBps),
    };
  });
}

function balanceMap(map, tokens) {
  return Object.entries(map || {}).map(([address, value]) => ({
    tokenAddress: address,
    balance: presentAmount(value, tokenMetaFrom(tokens, address)),
  }));
}

function presentBuyerDashboard(d, { tokens = {} } = {}) {
  const agreements = d.agreements.map((a) => presentAgreement(a, { tokens }));
  const byId = new Map(agreements.map((a) => [a.id, a]));
  // Summary buckets are re-derived from the presented agreements rather than presenting the
  // reader's arrays a second time: the reader hands back the same object in `agreements` and in
  // `summary.overdue`, and presenting both produces two copies that a UI can render out of sync.
  // Ids preserve the relationship across the serialization boundary, where object identity does
  // not survive.
  const ids = (list) => list.map((a) => a.id).filter((id) => byId.has(id));

  return {
    role: 'buyer',
    address: d.address,
    at: presentAt(d.at),
    credit: presentCredit(d.credit),
    collateral: presentCollateral(d.collateral, tokens),
    totalCollateral: presentAmount(d.totalCollateral, NATIVE),
    autoPayment: {
      enabled: d.autoPayment.enabled,
      ethBalance: presentAmount(d.autoPayment.ethBalance, NATIVE),
      tokenBalances: balanceMap(d.autoPayment.tokenBalances, tokens),
    },
    agreements,
    summary: {
      total: d.summary.total,
      active: d.summary.active,
      completed: d.summary.completed,
      defaulted: d.summary.defaulted,
      relicsHeld: d.summary.relicsHeld,
      // Outstanding is a sum across agreements that may settle in different currencies, so there is
      // no single total to render. Kept as the reader's raw sum for the ETH-only case and broken
      // out per currency for the general one; a UI that prints `outstanding` unconditionally would
      // be adding USDC to wei.
      outstanding: presentAmount(d.summary.outstanding, NATIVE),
      outstandingByCurrency: sumByCurrency(
        d.agreements.filter((a) => a.state === 'Active'),
        (a) => a.outstanding,
        tokens
      ),
      overdue: ids(d.summary.overdue),
      atRisk: ids(d.summary.atRisk),
      underfunded: ids(d.summary.underfunded),
    },
  };
}

function presentSellerDashboard(d, { tokens = {} } = {}) {
  const agreements = d.agreements.map((a) => presentAgreement(a, { tokens }));
  const byId = new Map(agreements.map((a) => [a.id, a]));
  const ids = (list) => list.map((a) => a.id).filter((id) => byId.has(id));

  return {
    role: 'seller',
    address: d.address,
    at: presentAt(d.at),
    settlementPreference: d.settlementPreference
      ? {
          tokenAddress: d.settlementPreference,
          ...pickCurrency(tokenMetaFrom(tokens, d.settlementPreference)),
        }
      : { tokenAddress: null, ...pickCurrency(NATIVE) },
    balances: {
      eth: presentAmount(d.balances.eth, NATIVE),
      tokens: balanceMap(d.balances.tokens, tokens),
    },
    withdrawable: {
      eth: d.withdrawable.eth,
      tokens: d.withdrawable.tokens,
    },
    agreements,
    summary: {
      total: d.summary.total,
      active: d.summary.active,
      completed: d.summary.completed,
      defaulted: d.summary.defaulted,
      receivable: presentAmount(d.summary.receivable, NATIVE),
      receivableByCurrency: sumByCurrency(
        d.agreements.filter((a) => a.state === 'Active'),
        (a) => a.outstanding,
        tokens
      ),
      defaultable: ids(d.summary.defaultable),
      overdue: ids(d.summary.overdue),
      staleSchedules: ids(d.summary.staleSchedules),
    },
  };
}

function pickCurrency(meta) {
  return {
    symbol: meta.symbol ?? null,
    decimals: Number.isInteger(meta.decimals) ? meta.decimals : null,
    native: !!meta.native,
    known: Number.isInteger(meta.decimals),
  };
}

/**
 * Sum a field across agreements, grouped by settlement currency.
 *
 * Totals across currencies are the one place a dashboard can produce a number that is not merely
 * mis-formatted but meaningless. Grouping is the only honest total when a seller has one agreement
 * in ETH and one in USDC.
 */
function sumByCurrency(agreements, pick, tokens) {
  const sums = new Map();
  for (const a of agreements) {
    const key = a.settlementToken ? String(a.settlementToken).toLowerCase() : 'native';
    const prev = sums.get(key) || { total: 0n, address: a.settlementToken || null, count: 0 };
    prev.total += big(pick(a), 'sum');
    prev.count += 1;
    sums.set(key, prev);
  }
  return [...sums.values()].map((s) => ({
    tokenAddress: s.address,
    count: s.count,
    total: presentAmount(s.total, tokenMetaFrom(tokens, s.address)),
  }));
}

function presentProtocolInfo(p) {
  return {
    at: presentAt(p.at),
    address: p.address,
    owner: p.owner,
    governor: p.governor, // null means ungoverned
    isGoverned: p.governor !== null,
    params: {
      creditLimitRatio: presentBps(p.params.creditLimitRatioBps),
      defaultGracePeriod: presentDuration(p.params.defaultGracePeriod),
      minCollateralAmount: presentAmount(p.params.minCollateralAmount, NATIVE),
      maxAgreementDuration: presentDuration(p.params.maxAgreementDuration),
      autoPaymentEnabled: p.params.autoPaymentEnabled,
    },
  };
}

/**
 * Prove a value can cross the server/client boundary.
 *
 * React's own serializer throws on a BigInt with a message that names neither the field nor the
 * agreement it came from, three layers inside a render. This walks the tree and reports the path.
 * Cheap enough to run on every server render in development; the suite runs it on real reader
 * output so a new BigInt field added to the reader fails the test rather than the page.
 */
function assertSerializable(value, path = '$') {
  const t = typeof value;
  if (value === null || t === 'string' || t === 'boolean') return value;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new PresenterError(`${path} is a non-finite number`);
    return value;
  }
  if (t === 'bigint') throw new PresenterError(`${path} is a BigInt, React cannot serialize it`);
  if (t === 'function') throw new PresenterError(`${path} is a function`);
  if (t === 'symbol') throw new PresenterError(`${path} is a Symbol`);
  if (t === 'undefined') throw new PresenterError(`${path} is undefined, use null`);
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertSerializable(v, `${path}[${i}]`));
    return value;
  }
  if (value instanceof Date) throw new PresenterError(`${path} is a Date, use an ISO string`);
  if (value instanceof Map || value instanceof Set) {
    throw new PresenterError(`${path} is a ${value.constructor.name}, use a plain object or array`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new PresenterError(`${path} is a ${value.constructor?.name || 'class'} instance`);
  }
  for (const [k, v] of Object.entries(value)) assertSerializable(v, `${path}.${k}`);
  return value;
}

module.exports = {
  PresenterError,
  agreementTone,
  assertSerializable,
  humanDuration,
  isBigIntish,
  presentAgreement,
  presentAmount,
  presentAt,
  presentBps,
  presentBuyerDashboard,
  presentCollateral,
  presentCredit,
  presentDuration,
  presentProtocolInfo,
  presentSellerDashboard,
  presentTime,
  shortfallOf,
  sumByCurrency,
};
