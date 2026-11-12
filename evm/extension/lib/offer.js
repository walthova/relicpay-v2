// The extension's quote layer: can this buyer finance this listing, and on what terms.
//
// Part a of the "Browser extension revival against v2 ABI" roadmap item. Everything here is
// framework free and `chrome.*` free, for the same reason dashboard/lib is React free: the point of
// the split is that the layer deciding what a buyer is offered can be proved against a real chain
// without a browser. Nothing in this directory may import `chrome.*`, a bundler runtime, or
// anything from dashboard/app.
//
// Read docs/ADR-003-extension-offers.md before changing the shape of a quote. The four constraints
// it records are all load-bearing here:
//
//   1. `createAgreementWithRWA` is onlyOwner, so a quote is a quote. There is no plan object here
//      and no viem request list, deliberately: dashboard/lib/writes.js plans transactions its
//      caller can send, and the whole finding of ADR-003 is that this caller cannot send one.
//      Returning a request-shaped object would invite someone to try.
//   2. Creation requires an authorized NFT contract, so a quote needs a listing and not a price.
//   3. RelicPay never calls PriceOracle, so a fiat price needs a declared rate to become a
//      totalPrice, and the quoter refuses rather than inventing one.
//   4. A scraped figure is a claim from a hostile page, so it is checked against chain state before
//      it is quoted from.

const { relicPayAbi } = require('../../dashboard/lib/abis');

class OfferError extends Error {}

// Mirrors of contract constants. Named here rather than imported from dashboard/lib/reader.js
// because that module does not export them, and duplicating two numbers is better than widening a
// read layer's public surface for a consumer in another directory.
const YIELD_ACCRUAL_INTERVAL = 86400n; // seconds, the `timeElapsed < 1 days` guard in _updateYield
const UINT32_MAX = 4294967295n;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// The quoter's own policy ceiling on schedule length, in seconds. Read from governanceParams when a
// quote has chain access; this is the fallback when it does not. The contract enforces
// `maxAgreementDuration` in createAgreementWithRWA (AgreementTooLong), so a longer schedule is a refusal.
const DEFAULT_MAX_DURATION = 365n * 86400n;

/**
 * Every way a quote can come back refused, and the sentence each one earns.
 *
 * Distinct codes rather than one failure, on the same reasoning as the three withdrawal reverts:
 * "we cannot offer financing here" collapses a scrape that failed, a relic that is not tokenized,
 * and a buyer who needs to deposit more collateral into one message, and those are three different
 * problems with three different next steps. Two of them are not even the buyer's to fix.
 */
const REFUSAL = {
  NO_PRICE: 'No price found on this listing.',
  AMBIGUOUS_PRICE:
    'This listing shows more than one price, so the amount to finance is unclear. Open the item page for a single price.',
  MALFORMED_PRICE: 'The price on this listing could not be read.',
  NO_RATE:
    'This listing is priced in a currency the protocol does not convert. A rate has to be set for this seller before it can be financed.',
  RATE_CURRENCY_MISMATCH:
    'This listing is priced in a different currency from the rate set for this seller, so it cannot be converted.',
  ZERO_PRICE: 'This listing has no price to finance.',
  DUE_INTERVAL_INVALID: 'The time between payments has to be more than zero.',
  NO_LISTING_ASSET: 'This listing is not a tokenized relic, so it cannot be financed.',
  NFT_NOT_AUTHORIZED:
    'This relic comes from a collection the protocol has not authorized. The seller has to register the collection first.',
  NO_SELLER: 'This listing does not say who is selling it.',
  NO_CREDIT_LINE: 'You have no collateral deposited, so there is no credit line to finance against.',
  INSUFFICIENT_CREDIT: 'Your available credit does not cover this listing.',
  INSTALLMENT_ROUNDS_TO_ZERO:
    'Split this many ways, each payment rounds to zero. Choose fewer payments.',
  INSTALLMENT_COUNT_INVALID: 'Choose at least one payment.',
  EXCEEDS_MAX_DURATION:
    'This payment schedule runs longer than the protocol allows. Choose fewer payments or a shorter time between them.',
  VALUE_TOO_LARGE: 'These terms are outside the range the protocol accepts.',
};

/**
 * Parse a price out of scraped text, or refuse.
 *
 * Refusing is the whole point, and it is where v1 went wrong rather than merely got unlucky.
 * `parsePrice` there did `text.replace(/[^\d.,]/g, '')` then `parseFloat`, which turns "Save 20%,
 * now $49" into 20.49 and "$1,299.00" into 1.29900 depending on comma position, and then divides
 * the result by four and shows it to someone as a payment. A parser that guesses on ambiguous
 * input produces a confident wrong number, which is worse than no number on a money surface.
 *
 * So: find every currency-shaped amount, and return one only when exactly one distinct value is
 * present. Two different prices in the same blob (a sale price beside a struck-through original, a
 * "$45 - $89" range) is AMBIGUOUS, not a coin flip.
 *
 * Returns minor units as a BigInt, never a float. Prices are money and money is integers; the
 * moment a price becomes a Number it is one `0.1 + 0.2` away from an installment that does not sum
 * to the total.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.decimals] minor units per major unit, default 2
 * @returns {{ok: true, amount: bigint, decimals: number, currency: string|null, matches: number}
 *          | {ok: false, code: string}}
 */
function parseMoney(text, { decimals = 2 } = {}) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, code: 'NO_PRICE' };

  const SYMBOLS = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
  // A digit group, optionally with , . or a non-breaking / narrow non-breaking space as thousands
  // separators. Not a plain ASCII space: "$5 100 reviews" is five dollars and a review count, not
  // 5100. The currency marker may lead or trail, which is the difference between "$45.99" and
  // "45,99 €".
  //
  // The `(?![.,]?\d)` tail is load-bearing. Without it the grouped alternative matches a prefix
  // and stops: "$12345.67" matched "123" as a complete grouped number and quoted $123.00. A number
  // that is followed by more digits was not fully read, so it is not a candidate at that length.
  const re =
    /(?:(\$|€|£|¥|USD|EUR|GBP|JPY)\s*)?(\d{1,3}(?:[.,\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![.,]?\d)(?:\s*(\$|€|£|¥|USD|EUR|GBP|JPY))?/gi;

  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    // A leading marker owns this amount, so a trailing one belongs to the next. Without handing it
    // back, "$45 $89" reads the second "$" as the first price's suffix, leaves 89 unmarked, and
    // quotes $45 for a listing that shows two prices.
    if (m[1] && m[3]) re.lastIndex = m.index + m[0].length - m[3].length;
    const marker = m[1] || m[3] || null;
    // A bare number with no currency marker anywhere is not a price. This is what keeps a review
    // count, a model number or a "12 in stock" out of the candidate set.
    if (!marker) continue;
    const parsed = toMinorUnits(m[2], decimals);
    if (parsed === null) return { ok: false, code: 'MALFORMED_PRICE' };
    found.push({ amount: parsed, currency: SYMBOLS[marker] || marker.toUpperCase() });
  }

  if (found.length === 0) return { ok: false, code: 'NO_PRICE' };

  // Distinct by value and currency together: the same price repeated (a listing that prints it
  // twice) is one price, while two different ones are a question the scraper cannot answer.
  const distinct = new Set(found.map((f) => `${f.currency}:${f.amount}`));
  if (distinct.size > 1) return { ok: false, code: 'AMBIGUOUS_PRICE' };

  return {
    ok: true,
    amount: found[0].amount,
    decimals,
    currency: found[0].currency,
    matches: found.length,
  };
}

/**
 * Digit group to minor units, refusing rather than guessing which separator is the decimal point.
 *
 * "1,299.00" and "1.299,00" are the same money written under two conventions, and "1,299" is
 * either 1299 or 1.299 depending on which one is in force. The rule used here: when both separators
 * appear, the last one is the decimal point, which is true under both conventions. When only one
 * appears, three trailing digits means it grouped thousands and one or two means it is the decimal
 * point. Anything else is null.
 */
function toMinorUnits(digits, decimals) {
  const s = String(digits).replace(/[\u00a0\u202f]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let intPart;
  let fracPart = '';

  if (lastComma === -1 && lastDot === -1) {
    intPart = s;
  } else {
    const sep = lastComma > lastDot ? ',' : '.';
    const tail = s.slice(s.lastIndexOf(sep) + 1);
    if (tail.length === 3 && (lastComma === -1 || lastDot === -1)) {
      // A single separator with exactly three digits after it groups thousands: 1,299 is 1299.
      intPart = s.replace(/[.,]/g, '');
    } else if (tail.length >= 1 && tail.length <= 2) {
      intPart = s.slice(0, s.lastIndexOf(sep)).replace(/[.,]/g, '');
      fracPart = tail;
    } else {
      return null;
    }
  }

  if (!/^\d+$/.test(intPart)) return null;
  if (fracPart !== '' && !/^\d+$/.test(fracPart)) return null;
  if (fracPart.length > decimals) return null;

  const scaled = fracPart.padEnd(decimals, '0');
  return BigInt(intPart) * 10n ** BigInt(decimals) + (scaled === '' ? 0n : BigInt(scaled));
}

/**
 * A priced amount in minor units to a totalPrice in the credit line's own unit.
 *
 * `rate` is how many of the credit unit one major unit of the price currency buys, expressed with
 * `rateDecimals` of precision, and it is required. ADR-003 finding 3 is why there is no fallback to
 * PriceOracle here: RelicPay compares `totalPrice` against `availableCredit`, `availableCredit`
 * comes from an unpriced raw sum of collateral amounts, and so a price routed through an oracle the
 * settlement path never consults yields a figure that compares against nothing while looking
 * carefully derived.
 *
 * Rounds up. The rounding is a tenth of a wei on a real quote and the direction still matters: the
 * buyer's obligation should never be quoted below what it is, and `totalPrice` is what the credit
 * check and every installment derive from.
 */
function convertToCredit({ amount, decimals, rate, rateDecimals = 18, creditDecimals = 18 }) {
  if (typeof amount !== 'bigint') throw new OfferError('amount must be a BigInt in minor units');
  if (rate === undefined || rate === null) return null;
  if (typeof rate !== 'bigint') throw new OfferError('rate must be a BigInt');
  if (rate <= 0n) throw new OfferError('rate must be positive');

  const numerator = amount * rate * 10n ** BigInt(creditDecimals);
  const denominator = 10n ** BigInt(decimals) * 10n ** BigInt(rateDecimals);
  // Ceiling division on integers.
  return (numerator + denominator - 1n) / denominator;
}

/**
 * The payment schedule the contract would build, including the final installment.
 *
 * Mirrors `_createPaymentSchedule`: installments 1..n-1 are `totalPrice / installmentCount` and the
 * last absorbs the integer-division remainder (the v2 fix for V1-QUIRK-5). This is the reason the
 * quote cannot say "4 payments of X" the way v1's button did, and the discrepancy is not always a
 * rounding crumb: at count 3 on a totalPrice ending in 2 wei the final payment is 2 wei heavier,
 * but the shape generalizes to any remainder, and a buyer shown a flat figure for all four is
 * shown a final payment that is not the one they will owe.
 *
 * Due dates mirror the same function: installment i is due at `startTime + i * interval`, so the
 * first is due one interval in, not immediately.
 */
function quoteInstallments({ totalPrice, installmentCount, dueIntervalSeconds, startTime = 0n }) {
  if (typeof totalPrice !== 'bigint') throw new OfferError('totalPrice must be a BigInt');
  const n = BigInt(installmentCount);
  if (totalPrice <= 0n) return { ok: false, code: 'ZERO_PRICE' };
  if (n <= 0n) return { ok: false, code: 'INSTALLMENT_COUNT_INVALID' };
  // The contract's `require(dueIntervalSeconds > 0)`. Checked here rather than left to the chain
  // because a zero interval also makes every due date equal the start time, which would render as
  // a schedule that is entirely due the moment it opens.
  if (BigInt(dueIntervalSeconds) <= 0n) return { ok: false, code: 'DUE_INTERVAL_INVALID' };
  if (n > UINT32_MAX || BigInt(dueIntervalSeconds) > UINT32_MAX) {
    return { ok: false, code: 'VALUE_TOO_LARGE' };
  }

  const installmentAmount = totalPrice / n;
  // The contract's own `require(installmentAmount > 0)`.
  if (installmentAmount === 0n) return { ok: false, code: 'INSTALLMENT_ROUNDS_TO_ZERO' };

  const finalAmount = totalPrice - installmentAmount * (n - 1n);
  const interval = BigInt(dueIntervalSeconds);
  const schedule = [];
  for (let i = 1n; i <= n; i += 1n) {
    schedule.push({
      installmentNumber: Number(i),
      amount: i === n ? finalAmount : installmentAmount,
      dueDate: BigInt(startTime) + i * interval,
    });
  }

  return {
    ok: true,
    installmentAmount,
    finalAmount,
    // True whenever the last payment differs, which is what a UI needs to decide between one figure
    // and two rather than having to diff the schedule itself.
    hasRemainder: finalAmount !== installmentAmount,
    totalDuration: n * interval,
    schedule,
  };
}

/**
 * Collateral soundness, which is ADR-003 finding 3 made visible instead of assumed away.
 *
 * `_getCollateralValue` returns `position.amount + position.stakingRewards` and
 * `_getTotalCollateralValue` sums that across positions, with no decimal normalization and no
 * oracle call anywhere. So a buyer holding 1 ETH (1e18 wei) and 1000 USDC (1e9 units at 6 decimals)
 * has a contract-reported collateral value of 1000000001000000000, a number in no unit at all.
 *
 * Which direction the error runs depends on the asset: below 18 decimals a position contributes
 * far less than its worth and the credit limit is understated, which only costs the buyer offers
 * they could have had. Above 18 it is overstated, and an overstated limit is the dangerous one,
 * because the offer is real and the backing is not. So this reports both figures rather than
 * picking one: the contract's own, and a conservative sum over 18-decimal positions only.
 *
 * Returns `sound: true` when every position is 18 decimals, in which case the two agree and a
 * caller can ignore the rest of this.
 */
function assessCollateral(positions, { decimalsOf } = {}) {
  const resolve =
    decimalsOf ||
    ((p) => (p.token === null || p.token === undefined ? 18 : p.tokenDecimals));

  let conservative = 0n;
  let unsound = 0n;
  const offending = [];
  let anyUnknown = false;

  for (const p of positions) {
    const value = (p.amount ?? 0n) + (p.stakingRewards ?? 0n);
    const d = resolve(p);
    if (d === undefined || d === null) {
      anyUnknown = true;
      offending.push({ token: p.token, decimals: null, value });
      continue;
    }
    if (Number(d) === 18) {
      conservative += value;
    } else {
      unsound += value;
      offending.push({ token: p.token, decimals: Number(d), value });
    }
  }

  return {
    sound: offending.length === 0 && !anyUnknown,
    conservativeValue: conservative,
    unsoundValue: unsound,
    offending,
    hasUnknownDecimals: anyUnknown,
  };
}

// ADR-012: the credit line counts recorded principal only. A pending yield accrual cannot close a
// shortfall, so quotes are no longer softened on its account. Switch kept for reversibility.
const ACCRUAL_RAISES_CREDIT = false;

/**
 * Would `_updateYield` move at least one of this buyer's positions if a transaction landed now.
 *
 * The same four-guard mirror `reader.getCollateralPositions` uses per position, applied across the
 * set, and it is here for the reason ADR-002 gave: `createAgreementWithRWA` calls `_updateAllYields`
 * then `_updateCreditLine` *before* it checks `availableCredit < totalPrice`, so the
 * `availableCredit` a view reports is a floor whenever an accrual is pending. Refusing on a floor
 * is a quote declining terms the chain would have accepted, which is the one failure this layer is
 * not allowed to have.
 *
 * The fourth guard is the one that makes the flag mean anything: `_updateYield` returns early
 * unless a full day has passed since `lastUpdateTime`. Every deposit sets autoReinvest and ETH
 * carries a 5% rate from the constructor, so a flag built from the first three alone is true on
 * essentially every position and softens every refusal into a permanent maybe.
 */
function mayCreditGrow(positions, at) {
  return positions.some(
    (p) =>
      Boolean(p.autoReinvest) &&
      (p.yieldRateBps ?? 0n) > 0n &&
      (p.amount ?? 0n) > 0n &&
      at.timestamp - (p.lastUpdateTime ?? 0n) >= YIELD_ACCRUAL_INTERVAL
  );
}

/**
 * The quoter. One call per listing, pinned to one block, same discipline as the dashboard reader.
 *
 * @param {object} opts
 * @param {object} opts.publicClient a viem public client
 * @param {object} opts.addresses    at least { relicPay }
 * @param {object} opts.reader       a dashboard/lib reader, for credit line and positions
 * @param {object} [opts.tokenDecimals] lowercase token address to decimals, from the operator's
 *                                    token registry. Deliberately a quoter option and not a listing
 *                                    field: the listing comes from the page, and a page that can
 *                                    declare a collateral token 18-decimal can suppress the
 *                                    unsound-units warning about it.
 */
function createOfferQuoter({ publicClient, addresses, reader, tokenDecimals = {} }) {
  if (!publicClient) throw new OfferError('publicClient is required');
  if (!addresses || !addresses.relicPay) throw new OfferError('addresses.relicPay is required');
  if (!reader) throw new OfferError('reader is required');

  function read(functionName, args, blockNumber) {
    return publicClient.readContract({
      address: addresses.relicPay,
      abi: relicPayAbi,
      functionName,
      args,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    });
  }

  function refuse(code, extra = {}) {
    return { ok: false, code, reason: REFUSAL[code] || code, ...extra };
  }

  /**
   * Validate a scraped listing against chain state, then quote terms against the buyer's line.
   *
   * `listing` is a *claim* from a content script, per ADR-003: it came out of a DOM the merchant
   * page controls, so every field of it that can be checked against the chain is, before any of it
   * reaches a number the buyer sees. `nftContract` is checked against `authorizedNFTs` rather than
   * trusted, which is both the authorization gate `createAgreementWithRWA` would hit and the check
   * that stops a page claiming a relic it has nothing to do with.
   *
   * @param {object} args
   * @param {string} args.buyer
   * @param {object} args.listing  { priceText | price, currency, nftContract, tokenId, seller }
   * @param {object} args.terms    { installmentCount, dueIntervalSeconds, gracePeriodSeconds }
   * @param {object} [args.rate]   the seller's pricing, from operator config and never from the
   *                               page. Either { currency, rate, rateDecimals } for a fiat-priced
   *                               listing, or { creditDenominated: true } for a seller who prices in
   *                               the credit unit directly. `currency` is required on a fiat rate:
   *                               a rate that does not say what it converts from would convert
   *                               whatever the page printed.
   */
  async function quote({ buyer, listing, terms, rate, at }) {
    if (!buyer) throw new OfferError('buyer is required');
    if (!listing) throw new OfferError('listing is required');
    if (!terms || terms.installmentCount === undefined) {
      throw new OfferError('terms.installmentCount is required');
    }

    const when = at || (await pinnedBlock());

    // Price first, since a listing whose price cannot be read is refused without spending a read.
    let priceMinor;
    let priceDecimals = listing.decimals ?? 2;
    let currency = listing.currency ?? null;
    if (listing.price !== undefined && listing.price !== null) {
      if (typeof listing.price !== 'bigint') {
        throw new OfferError('listing.price must be a BigInt in minor units');
      }
      priceMinor = listing.price;
    } else {
      const parsed = parseMoney(listing.priceText ?? '', { decimals: priceDecimals });
      if (!parsed.ok) return refuse(parsed.code);
      priceMinor = parsed.amount;
      currency = parsed.currency;
    }

    // The asset. Both of these are refusals about the listing and not about the buyer, so they come
    // before anything is read about the buyer.
    if (!listing.nftContract || listing.nftContract === ZERO_ADDRESS) {
      return refuse('NO_LISTING_ASSET');
    }
    if (!listing.seller || listing.seller === ZERO_ADDRESS) return refuse('NO_SELLER');

    const authorized = await read('authorizedNFTs', [listing.nftContract], when.blockNumber);
    if (!authorized) return refuse('NFT_NOT_AUTHORIZED', { nftContract: listing.nftContract });

    // The conversion. A listing already denominated in the credit unit needs no rate; a fiat one
    // does, and there is no fallback (ADR-003 finding 3).
    //
    // Whether the price is already in the credit unit is a property of the seller's configuration,
    // passed in as `rate`, not of the listing. An earlier draft read `listing.isCreditDenominated`,
    // which let the page decide to skip conversion.
    let totalPrice;
    if (rate && rate.creditDenominated === true) {
      totalPrice = priceMinor;
    } else {
      if (rate && rate.rate !== undefined && rate.rate !== null) {
        if (!rate.currency) return refuse('NO_RATE', { currency });
        if (!currency || String(rate.currency).toUpperCase() !== String(currency).toUpperCase()) {
          return refuse('RATE_CURRENCY_MISMATCH', { currency, rateCurrency: rate.currency });
        }
      }
      totalPrice = convertToCredit({
        amount: priceMinor,
        decimals: priceDecimals,
        rate: rate?.rate,
        rateDecimals: rate?.rateDecimals ?? 18,
      });
      if (totalPrice === null) return refuse('NO_RATE', { currency });
    }

    // Terms, checked against the contract's own arithmetic gates before the credit gate, because a
    // schedule that cannot exist is not a credit problem.
    const installments = quoteInstallments({
      totalPrice,
      installmentCount: terms.installmentCount,
      dueIntervalSeconds: terms.dueIntervalSeconds ?? 30n * 86400n,
      startTime: when.timestamp,
    });
    if (!installments.ok) return refuse(installments.code);
    if (BigInt(terms.gracePeriodSeconds ?? 0) > UINT32_MAX) return refuse('VALUE_TOO_LARGE');

    // The buyer. Both reads pinned to the same block as the authorization check above.
    const [line, positions] = await Promise.all([
      reader.getCreditLine(buyer, { at: when }),
      reader.getCollateralPositions(buyer, { at: when }),
    ]);

    if (line.creditLimit === 0n && line.collateralValue === 0n) {
      return refuse('NO_CREDIT_LINE');
    }

    const collateral = assessCollateral(positions, { decimalsOf: decimalsFrom(tokenDecimals) });
    // ADR-012: accrual no longer raises the credit line (principal only), so a shortfall is final.
    const canGrow = ACCRUAL_RAISES_CREDIT && mayCreditGrow(positions, when);
    const warnings = [];

    // The unsound-sum warning, and it is ordered deliberately: it is attached to an offer that is
    // otherwise fine, rather than turned into a refusal, because the unsoundness is the protocol's
    // and refusing would punish a buyer for it. The overstated direction is the one worth saying
    // out loud, since there the offer is real and the backing is not.
    if (!collateral.sound) {
      warnings.push({
        code: 'COLLATERAL_UNITS_UNSOUND',
        message:
          'Your credit limit is computed from a raw sum of collateral amounts across assets with different decimals, so it is not a figure in any single unit.',
        contractValue: line.collateralValue,
        conservativeValue: collateral.conservativeValue,
        offending: collateral.offending,
      });
    }

    // The contract enforces maxAgreementDuration, so a longer schedule would revert on creation.
    const maxDuration = await maxAgreementDuration(when.blockNumber);
    if (installments.totalDuration > maxDuration) {
      return refuse('EXCEEDS_MAX_DURATION', {
        totalDuration: installments.totalDuration,
        maxDuration,
      });
    }

    const covered = line.availableCredit >= totalPrice;
    if (!covered && !canGrow) {
      return refuse('INSUFFICIENT_CREDIT', {
        totalPrice,
        availableCredit: line.availableCredit,
        shortfall: totalPrice - line.availableCredit,
        at: when,
      });
    }

    return {
      ok: true,
      // `unconfirmed` is the softened refusal: the view says the line does not cover this, but a
      // pending accrual raises the line on the way in and the chain may well accept it. Quoted
      // rather than refused, flagged rather than presented as firm.
      unconfirmed: !covered,
      ...(covered
        ? {}
        : {
            unconfirmedReason:
              'Your available credit does not cover this yet, but yield accrues when the agreement is opened and may close the gap.',
            shortfall: totalPrice - line.availableCredit,
          }),
      buyer,
      listing: {
        nftContract: listing.nftContract,
        tokenId: listing.tokenId ?? null,
        seller: listing.seller,
        physicalId: listing.physicalId ?? null,
      },
      price: { amount: priceMinor, decimals: priceDecimals, currency },
      totalPrice,
      installmentCount: Number(terms.installmentCount),
      installmentAmount: installments.installmentAmount,
      finalAmount: installments.finalAmount,
      hasRemainder: installments.hasRemainder,
      dueIntervalSeconds: BigInt(terms.dueIntervalSeconds ?? 30n * 86400n),
      gracePeriodSeconds: BigInt(terms.gracePeriodSeconds ?? 0),
      schedule: installments.schedule,
      credit: {
        availableCredit: line.availableCredit,
        creditLimit: line.creditLimit,
        collateralValue: line.collateralValue,
        isFloor: canGrow,
      },
      warnings,
      at: when,
    };
  }

  async function pinnedBlock() {
    const block = await publicClient.getBlock({ blockTag: 'latest' });
    return { blockNumber: block.number, timestamp: BigInt(block.timestamp) };
  }

  async function maxAgreementDuration(blockNumber) {
    try {
      const params = await read('governanceParams', [], blockNumber);
      // Tuple or named-field return depending on how the ABI surfaced it.
      const value = Array.isArray(params) ? params[3] : params.maxAgreementDuration;
      return value === undefined ? DEFAULT_MAX_DURATION : BigInt(value);
    } catch {
      return DEFAULT_MAX_DURATION;
    }
  }

  return { quote, pinnedBlock };
}

/**
 * Decimals for a collateral position, from whatever the caller was able to supply.
 *
 * Native ETH positions carry `token: null` and are 18 by definition. For an ERC20 the decimals have
 * to come from somewhere: a `tokenDecimals` already on the position is preferred, then the
 * operator-supplied map. A token in neither is unknown, which assessCollateral counts as unsound
 * rather than guessing 18.
 */
function decimalsFrom(map) {
  const hint = {};
  for (const [k, v] of Object.entries(map || {})) hint[k.toLowerCase()] = v;
  return (p) => {
    if (p.token === null || p.token === undefined) return 18;
    if (p.tokenDecimals !== undefined && p.tokenDecimals !== null) return p.tokenDecimals;
    const k = String(p.token).toLowerCase();
    return hint[k] === undefined ? null : hint[k];
  };
}

module.exports = {
  OfferError,
  REFUSAL,
  YIELD_ACCRUAL_INTERVAL,
  DEFAULT_MAX_DURATION,
  parseMoney,
  toMinorUnits,
  convertToCredit,
  quoteInstallments,
  assessCollateral,
  mayCreditGrow,
  createOfferQuoter,
  decimalsFrom,
};
