// Reading a listing off a storefront page. Part c2b.
//
// A scraped listing is a claim from a hostile page (ADR-003). This module's only job is to read the
// claim in a fixed, narrow shape and never to trust it: the worker and quoter check every field that
// can be checked against the chain. The storefront opts in by marking one element:
//
//   <div data-relicpay-listing
//        data-nft-contract="0x..." data-token-id="7" data-seller="0x..." data-physical-id="OR-001">
//     <span data-relicpay-price>$450.00</span>
//   </div>
//
// Exactly one such element. Zero is "no listing here", more than one is refused rather than guessed
// at, the same stance as parseMoney on two prices. The reader is injected so the suite can drive it
// without a DOM; content.js builds one over `document`.
//
// Chrome free and DOM free.

const SCRAPE_REFUSAL = {
  NO_LISTING: 'No relic listing found on this page.',
  MULTIPLE_LISTINGS: 'This page marks more than one relic listing, so it is unclear which to quote.',
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGITS = /^\d{1,78}$/;
const MAX_TEXT = 200;

/**
 * @param {object} reader
 * @param {function} reader.count    (selector) -> number of matching elements
 * @param {function} reader.attr     (selector, name) -> string | null, first match
 * @param {function} reader.text     (selector) -> string | null, first match, textContent
 * @returns {{ok: true, listing: object} | {ok: false, code: string, reason: string}}
 */
function scrapeListing(reader) {
  const n = reader.count('[data-relicpay-listing]');
  if (n === 0) return { ok: false, code: 'NO_LISTING', reason: SCRAPE_REFUSAL.NO_LISTING };
  if (n > 1) return { ok: false, code: 'MULTIPLE_LISTINGS', reason: SCRAPE_REFUSAL.MULTIPLE_LISTINGS };

  const attr = (name) => reader.attr('[data-relicpay-listing]', name);
  const address = (name) => {
    const v = attr(name);
    return typeof v === 'string' && ADDRESS.test(v) ? v : undefined;
  };
  const tokenRaw = attr('data-token-id');
  const physical = attr('data-physical-id');
  const price = reader.text('[data-relicpay-listing] [data-relicpay-price]');

  const listing = {
    nftContract: address('data-nft-contract'),
    seller: address('data-seller'),
    tokenId: typeof tokenRaw === 'string' && DIGITS.test(tokenRaw) ? BigInt(tokenRaw) : undefined,
    priceText: typeof price === 'string' ? price.trim().slice(0, MAX_TEXT) : '',
    physicalId: typeof physical === 'string' ? physical.slice(0, MAX_TEXT) : undefined,
  };
  // Missing fields stay missing, so the quoter refuses with its own NO_LISTING_ASSET / NO_SELLER
  // text rather than this module inventing a default.
  for (const k of Object.keys(listing)) if (listing[k] === undefined) delete listing[k];
  return { ok: true, listing };
}

module.exports = { SCRAPE_REFUSAL, scrapeListing };
