// The service worker's logic, with every chrome.* and network dependency injected. Part c2a.
//
// background.js (part c2b) is meant to be a few lines: build the dependencies from chrome.runtime,
// chrome.storage and fetch, then forward each onMessage to handle(). Everything that decides
// something lives here so the suite can drive it without a browser.
//
// Trust boundaries enforced here (ADR-003, ADR-004, ADR-005, ADR-006):
//   - LISTING_SCRAPED is accepted only from a tab whose origin is a configured seller storefront,
//     and the tab id is taken from the sender, never from the message body.
//   - REQUEST_SIGNED is accepted only from an extension page (a sender with no tab). A content
//     script, and so a page, cannot submit a signature.
//   - The signed domain must be this deployment's (configured chain id and RelicPay address), so a
//     request signed for another deployment is refused before it costs a signature recovery.
//   - The buyer comes from extension storage, never from the page.
//   - The seller's rate comes from operator config, never from the listing.

const { isValidMessage, MESSAGE_TYPE, quoteReady, submitResult } = require('./messages');
const { checkRequest, submitRequest } = require('./request');
const { fromWire, toWire } = require('./wire');

const BUYER_KEY = 'relicpay/buyer';
// The most recent quote, for the popup. The popup cannot ask which tab is active (no `tabs`,
// ADR-005), so the worker leaves the quote where an extension page can read it. Part c2b.
const LAST_QUOTE_KEY = 'relicpay/last-quote';

const WORKER_REFUSAL = {
  UNKNOWN_MESSAGE: 'Message not recognised.',
  UNTRUSTED_SENDER: 'This message did not come from a place allowed to send it.',
  NO_BUYER: 'Connect a wallet in the extension popup before asking for a quote.',
  DOMAIN_MISMATCH: 'This request was signed for a different deployment.',
  SUBMIT_FAILED: 'The operator could not be reached or refused the request.',
};

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * @param {object} deps
 * @param {object} deps.config   { chainId, relicPay, operatorEndpoint, sellerOrigins, terms,
 *                                 rates } where rates maps a lowercase seller address to the rate
 *                                 object offer.js quote() takes
 * @param {object} deps.quoter   a createOfferQuoter() result
 * @param {object} deps.storage  a chrome.storage.local-like area
 * @param {function} deps.sendToTab async (tabId, wireMessage) -> void
 * @param {function} deps.createStore async () -> persistent seen store (see store.js)
 * @param {function} [deps.fetchImpl]
 * @param {function} [deps.now]  () -> unix seconds
 */
function createWorker({ config, quoter, storage, sendToTab, createStore, fetchImpl, now }) {
  for (const [name, v] of Object.entries({ config, quoter, storage, sendToTab, createStore })) {
    if (!v) throw new Error(`${name} is required`);
  }
  const sellerOrigins = new Set(config.sellerOrigins);
  const clock = () => (now ? BigInt(now()) : BigInt(Math.floor(Date.now() / 1000)));

  function refusal(code, extra = {}) {
    return { ok: false, code, reason: WORKER_REFUSAL[code] || code, ...extra };
  }

  async function onListing(msg, sender) {
    const tab = sender && sender.tab;
    const origin = tab && originOf(sender.url || tab.url);
    if (!tab || tab.id === undefined || !origin || !sellerOrigins.has(origin)) {
      return refusal('UNTRUSTED_SENDER');
    }
    const tabId = tab.id;

    const stored = await storage.get(BUYER_KEY);
    const buyer = stored && stored[BUYER_KEY];
    let quote;
    if (!buyer) {
      quote = refusal('NO_BUYER');
    } else {
      const seller = String(msg.listing.seller || '').toLowerCase();
      try {
        quote = await quoter.quote({
          buyer,
          listing: msg.listing,
          terms: config.terms,
          rate: (config.rates || {})[seller],
        });
      } catch (e) {
        quote = refusal('QUOTE_ERROR', { reason: String(e && e.message ? e.message : e) });
      }
    }
    const out = quoteReady({ quote, tabId });
    await storage.set({ [LAST_QUOTE_KEY]: toWire({ tabId, quote, at: Number(clock()) }) });
    await sendToTab(tabId, toWire(out));
    return { ok: true, quoteOk: quote.ok };
  }

  async function onSigned(msg, sender) {
    if (!sender || sender.tab) return refusal('UNTRUSTED_SENDER');

    const { domain, message, signature, tabId } = msg;
    if (
      Number(domain.chainId) !== Number(config.chainId) ||
      String(domain.verifyingContract).toLowerCase() !== String(config.relicPay).toLowerCase()
    ) {
      return notify(tabId, refusal('DOMAIN_MISMATCH'));
    }

    const store = await createStore();
    const t = clock();
    store.sweep(t);
    const checked = await checkRequest({ domain, message, signature, seenStore: store, now: t });
    if (!checked.ok) return notify(tabId, checked);

    // Remember before sending. A double submit is worse than a failed one: on a transport failure
    // the buyer signs a fresh request with a new requestId rather than the old one being replayed.
    store.remember(message.requestId, message.expiry);
    await store.save();

    try {
      const response = await submitRequest({
        endpoint: config.operatorEndpoint,
        domain,
        message,
        signature,
        fetchImpl,
      });
      return notify(tabId, { ok: true, response });
    } catch (e) {
      return notify(tabId, refusal('SUBMIT_FAILED', { detail: String(e && e.message ? e.message : e) }));
    }
  }

  async function notify(tabId, result) {
    const out = result.ok
      ? submitResult({ tabId, ok: true, response: result.response })
      : submitResult({ tabId, ok: false, code: result.code, reason: result.reason });
    await sendToTab(tabId, toWire(out));
    return result;
  }

  /**
   * Entry point for chrome.runtime.onMessage. `wireMsg` is what arrived over JSON; `sender` is the
   * chrome MessageSender. Returns a small JSON-safe acknowledgement, never the quote itself (that
   * goes out through sendToTab).
   */
  async function handle(wireMsg, sender) {
    let msg;
    try {
      msg = fromWire(wireMsg);
    } catch {
      return refusal('UNKNOWN_MESSAGE');
    }
    if (!isValidMessage(msg)) return refusal('UNKNOWN_MESSAGE');
    if (msg.type === MESSAGE_TYPE.LISTING_SCRAPED) return onListing(msg, sender);
    if (msg.type === MESSAGE_TYPE.REQUEST_SIGNED) return onSigned(msg, sender);
    return refusal('UNKNOWN_MESSAGE');
  }

  return { handle };
}

module.exports = { createWorker, WORKER_REFUSAL, BUYER_KEY, LAST_QUOTE_KEY };
