// The message contract between the extension's three JS contexts: content script, service worker,
// and popup. Part b of the "Browser extension revival against v2 ABI" roadmap item, alongside
// request.js.
//
// Per ADR-003 and ADR-004, chain reads and quoting run only in the service worker; the content
// script observes and renders a listing but never computes terms, and the popup is where the buyer
// sees and signs a request, never the page. This module names the four messages that cross those
// boundaries and validates each one's shape before it is trusted at the receiving end.
//
// Framework free and `chrome.*` free: wiring these builders and validators into
// chrome.runtime.sendMessage / onMessage listeners is part c's job (the extension shell), once a
// manifest and contexts exist to wire them into.

class MessageError extends Error {}

const MESSAGE_TYPE = {
  // content script -> service worker: a claim scraped from the page's DOM. Untrusted, per
  // ADR-003; the service worker checks it against chain state before it becomes a quote.
  LISTING_SCRAPED: 'relicpay/listing-scraped',
  // service worker -> content script and popup: the result of extension/lib/offer.js's quote().
  // Computed only in the service worker; the content script renders it without recomputing it.
  QUOTE_READY: 'relicpay/quote-ready',
  // popup -> service worker: the EIP-712 domain, message and signature once the buyer's wallet
  // has signed an AgreementRequest built from a QUOTE_READY quote.
  REQUEST_SIGNED: 'relicpay/request-signed',
  // service worker -> popup: whether the operator accepted the submitted request.
  SUBMIT_RESULT: 'relicpay/submit-result',
};

// The order a single financing attempt's messages are expected to occur in. Not enforced by this
// module (a service worker may field LISTING_SCRAPED from several tabs interleaved), but useful
// for a caller wiring a state machine on top of these four message types.
const FLOW_ORDER = [
  MESSAGE_TYPE.LISTING_SCRAPED,
  MESSAGE_TYPE.QUOTE_READY,
  MESSAGE_TYPE.REQUEST_SIGNED,
  MESSAGE_TYPE.SUBMIT_RESULT,
];

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * A listing scraped by the content script, addressed to a specific tab so a service worker
 * fielding several tabs at once can route a quote back to the one that asked.
 *
 * `listing` is passed through unvalidated beyond "it is an object": extension/lib/offer.js already
 * treats every field of a listing as an untrusted claim and is where that validation actually
 * happens. This builder's job is only to make sure a listing arrives shaped like a listing at all,
 * not to duplicate offer.js's refusal logic.
 */
function listingScraped({ listing, tabId }) {
  if (!isPlainObject(listing)) throw new MessageError('listing must be an object');
  if (tabId === undefined || tabId === null) throw new MessageError('tabId is required');
  return { type: MESSAGE_TYPE.LISTING_SCRAPED, tabId, listing, scrapedAt: Date.now() };
}

function isListingScraped(msg) {
  return !!msg && msg.type === MESSAGE_TYPE.LISTING_SCRAPED && isPlainObject(msg.listing) && msg.tabId !== undefined;
}

/**
 * The quote a service worker computed for a listing, on its way to render in the content script's
 * injected surface and/or the popup. `quote` is an offer.js quote() result verbatim (`ok: true` or
 * `ok: false`); this builder does not interpret it, only carries it.
 */
function quoteReady({ quote, tabId }) {
  if (!isPlainObject(quote) || typeof quote.ok !== 'boolean') {
    throw new MessageError('quote must be an extension/lib/offer.js quote() result');
  }
  if (tabId === undefined || tabId === null) throw new MessageError('tabId is required');
  return { type: MESSAGE_TYPE.QUOTE_READY, tabId, quote };
}

function isQuoteReady(msg) {
  return !!msg && msg.type === MESSAGE_TYPE.QUOTE_READY && isPlainObject(msg.quote) && typeof msg.quote.ok === 'boolean';
}

/**
 * A signed AgreementRequest, on its way from the popup (where the buyer's wallet produced the
 * signature) to the service worker (which runs checkRequest and, if that passes, submitRequest).
 * `domain` and `message` are exactly what extension/lib/request.js's buildDomain /
 * buildAgreementRequest produced; this module does not re-derive or check them, only shuttles them.
 */
function requestSigned({ domain, message, signature, tabId }) {
  if (!isPlainObject(domain)) throw new MessageError('domain must be an object');
  if (!isPlainObject(message)) throw new MessageError('message must be an object');
  if (!isNonEmptyString(signature)) throw new MessageError('signature must be a non-empty string');
  if (tabId === undefined || tabId === null) throw new MessageError('tabId is required');
  return { type: MESSAGE_TYPE.REQUEST_SIGNED, tabId, domain, message, signature };
}

function isRequestSigned(msg) {
  return (
    !!msg &&
    msg.type === MESSAGE_TYPE.REQUEST_SIGNED &&
    isPlainObject(msg.domain) &&
    isPlainObject(msg.message) &&
    isNonEmptyString(msg.signature)
  );
}

/**
 * The outcome of submitting a signed request, whether it was refused before ever reaching the
 * operator (an expired or already-seen request, a bad signature; see request.js's REQUEST_REFUSAL)
 * or refused or accepted by the operator itself.
 */
function submitResult({ tabId, ok, code, reason, response }) {
  if (tabId === undefined || tabId === null) throw new MessageError('tabId is required');
  if (typeof ok !== 'boolean') throw new MessageError('ok must be a boolean');
  if (!ok && !isNonEmptyString(code)) throw new MessageError('a refusal must carry a code');
  return { type: MESSAGE_TYPE.SUBMIT_RESULT, tabId, ok, code: code ?? null, reason: reason ?? null, response: response ?? null };
}

function isSubmitResult(msg) {
  return !!msg && msg.type === MESSAGE_TYPE.SUBMIT_RESULT && typeof msg.ok === 'boolean';
}

const VALIDATORS = {
  [MESSAGE_TYPE.LISTING_SCRAPED]: isListingScraped,
  [MESSAGE_TYPE.QUOTE_READY]: isQuoteReady,
  [MESSAGE_TYPE.REQUEST_SIGNED]: isRequestSigned,
  [MESSAGE_TYPE.SUBMIT_RESULT]: isSubmitResult,
};

/**
 * The single gate a receiving end (a service worker's onMessage listener, a popup's message
 * handler) should run every inbound message through before acting on it. Unlike the four `isX`
 * predicates, this does not require the caller to already know which message type to expect: it
 * looks up the validator by `msg.type` itself, and an unrecognized or malformed message is treated
 * the same way, as not valid, rather than as a crash.
 */
function isValidMessage(msg) {
  if (!msg || typeof msg.type !== 'string') return false;
  const validator = VALIDATORS[msg.type];
  return typeof validator === 'function' && validator(msg);
}

module.exports = {
  MessageError,
  MESSAGE_TYPE,
  FLOW_ORDER,
  listingScraped,
  isListingScraped,
  quoteReady,
  isQuoteReady,
  requestSigned,
  isRequestSigned,
  submitResult,
  isSubmitResult,
  isValidMessage,
};
