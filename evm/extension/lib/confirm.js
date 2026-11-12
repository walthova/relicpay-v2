// The confirmation the popup renders: what the buyer is told they are agreeing to. Part c1 of the
// "Browser extension revival against v2 ABI" roadmap item.
//
// ADR-003: "the amount a buyer confirms is rendered by the extension, not by the page." ADR-005
// makes that checkable by fixing where the view is derived from. It is built from the
// AgreementRequest *message*, the exact struct the buyer's wallet is about to sign, and never from
// the scraped listing. A confirmation derived from the listing could disagree with the signature
// (a page that changes what it says between quote and click); one derived from the signed struct
// cannot, because the two are the same bytes.
//
// The quote is accepted as optional context (warnings, the unconfirmed flag) but is cross-checked
// against the message first. A disagreement throws rather than picks a side.
//
// Amounts are formatted from BigInt with viem's formatUnits. No Number, no float, no rounding: the
// digits shown are the digits signed. Framework free and `chrome.*` free.

const { formatUnits, getAddress } = require('viem');
const { decodePaymentMethod } = require('../../dashboard/lib/enums');

class ConfirmError extends Error {}

const DAY = 86400n;
const HOUR = 3600n;

// Fields the quote and the signed message both carry. If they differ, the quote is stale or was
// built for a different request, and the popup must not show one thing while signing another.
const CROSS_CHECKED = ['buyer', 'totalPrice', 'installmentCount', 'dueIntervalSeconds', 'gracePeriodSeconds'];

function sameValue(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return BigInt(a) === BigInt(b);
}

function duration(seconds) {
  const s = BigInt(seconds);
  if (s === 0n) return { seconds: s, text: 'none' };
  if (s % DAY === 0n) {
    const d = s / DAY;
    return { seconds: s, text: `${d} ${d === 1n ? 'day' : 'days'}` };
  }
  if (s % HOUR === 0n) {
    const h = s / HOUR;
    return { seconds: s, text: `${h} ${h === 1n ? 'hour' : 'hours'}` };
  }
  return { seconds: s, text: `${s} seconds` };
}

/**
 * @param {object} args
 * @param {object} args.message   an AgreementRequest message from request.js buildAgreementRequest
 * @param {{symbol: string, decimals: number}} args.unit
 *        the credit unit, from operator config. Never from the page: a listing that could name the
 *        unit could print "USD" over a raw 18-decimal amount.
 * @param {object} [args.quote]   the ok:true quote the message was built from, for warnings
 * @param {bigint} [args.now]     unix seconds, to say whether the request has already expired
 */
function buildConfirmation({ message, unit, quote, now } = {}) {
  if (!message || typeof message !== 'object') throw new ConfirmError('message is required');
  if (
    !unit ||
    typeof unit.symbol !== 'string' ||
    !/^[A-Za-z0-9]{1,8}$/.test(unit.symbol) ||
    !Number.isInteger(unit.decimals) ||
    unit.decimals < 0 ||
    unit.decimals > 36
  ) {
    throw new ConfirmError('unit must be { symbol, decimals } from operator config');
  }

  const total = BigInt(message.totalPrice);
  const n = BigInt(message.installmentCount);
  if (n <= 0n) throw new ConfirmError('installmentCount must be at least 1');
  const each = total / n;
  const last = total - each * (n - 1n);
  const fmt = (v) => `${formatUnits(v, unit.decimals)} ${unit.symbol}`;

  if (quote) {
    if (quote.ok !== true) throw new ConfirmError('a refused quote cannot be confirmed');
    for (const k of CROSS_CHECKED) {
      if (!sameValue(quote[k], message[k])) {
        throw new ConfirmError(`quote and request disagree on ${k}; refusing to show one and sign the other`);
      }
    }
  }

  const expired = now !== undefined && BigInt(now) >= BigInt(message.expiry);

  return {
    // The one figure the buyer is asked to agree to, first and alone.
    total: fmt(total),
    installments: {
      count: Number(n),
      each: fmt(each),
      // The last payment absorbs the remainder (quoteInstallments). Say so rather than show a
      // schedule whose parts do not sum to the total.
      last: last === each ? null : fmt(last),
      every: duration(message.dueIntervalSeconds).text,
      grace: duration(message.gracePeriodSeconds).text,
    },
    paymentMethod: decodePaymentMethod(message.paymentMethod),
    // Checksummed, so a lowercase address from a page and a checksummed one from the chain render
    // identically and a reader is not asked to compare two casings.
    buyer: getAddress(message.buyer),
    seller: getAddress(message.seller),
    relic: { nftContract: getAddress(message.nftContract), tokenId: BigInt(message.tokenId).toString() },
    expires: { at: BigInt(message.expiry).toString(), expired },
    // From the quote, which the service worker computed against chain state. Text here is the
    // extension's own (offer.js REFUSAL / warning strings), never the page's.
    unconfirmed: quote ? quote.unconfirmed === true : false,
    warnings: quote ? quote.warnings.map((w) => ({ code: w.code, message: w.message })) : [],
    // The request's own hash is what a wallet shows as the signing payload; nothing derived from the
    // listing (physicalId, page title, price text) appears anywhere in this object.
    canSign: !expired,
  };
}

module.exports = { ConfirmError, buildConfirmation, duration };
