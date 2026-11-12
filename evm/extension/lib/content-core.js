// The content script's logic, with the DOM and the messaging injected. Part c2b.
//
// content.js is a few lines of glue over this. The content script scrapes a listing, asks the
// service worker for a quote, and renders the answer in a closed shadow root next to the listing. It
// never computes terms and never renders the confirmation (ADR-003): the surface says financing is
// available and how many payments, and the buyer reviews amounts in the popup.
//
// Trust: it acts only on messages from this extension's own id, and it validates a message's shape
// before rendering it. Rendering is applyTree, which uses createElement and textContent only.
//
// Chrome free: `chromeApi` is passed in.

const { listingScraped, isValidMessage, MESSAGE_TYPE } = require('./messages');
const { scrapeListing } = require('./scrape');
const { SURFACE_STYLE, quoteView, resultView, applyTree } = require('./surface');
const { fromWire, toWire } = require('./wire');

const LISTING_SELECTOR = '[data-relicpay-listing]';

function domReader(doc) {
  return {
    count: (sel) => doc.querySelectorAll(sel).length,
    attr: (sel, name) => {
      const el = doc.querySelector(sel);
      return el ? el.getAttribute(name) : null;
    },
    text: (sel) => {
      const el = doc.querySelector(sel);
      return el ? el.textContent : null;
    },
  };
}

/**
 * @param {object} deps
 * @param {object} deps.doc        the page document
 * @param {function} deps.send     async (wireMessage) -> void   (the runtime sendMessage)
 * @param {string} deps.extensionId  runtime.id, the only sender a message may come from
 */
function createContent({ doc, send, extensionId }) {
  if (!doc || !send || !extensionId) throw new Error('doc, send and extensionId are required');
  let host = null;

  function show(tree) {
    const anchor = doc.querySelector(LISTING_SELECTOR);
    if (!anchor) return;
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = doc.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = SURFACE_STYLE;
    shadow.appendChild(style);
    const node = applyTree(doc, tree);
    if (node) shadow.appendChild(node);
    anchor.appendChild(host);
  }

  /** Scrape and ask for a quote. Returns the scrape outcome so a caller can tell why nothing was sent. */
  async function start() {
    const scraped = scrapeListing(domReader(doc));
    if (!scraped.ok) return scraped;
    // The worker takes the tab id from the sender and ignores this one; the message shape wants a value.
    await send(toWire(listingScraped({ listing: scraped.listing, tabId: 0 })));
    return scraped;
  }

  /** the runtime onMessage handler body. Returns true when it rendered something. */
  function onMessage(wireMsg, sender) {
    if (!sender || sender.id !== extensionId) return false;
    let msg;
    try {
      msg = fromWire(wireMsg);
    } catch {
      return false;
    }
    if (!isValidMessage(msg)) return false;
    if (msg.type === MESSAGE_TYPE.QUOTE_READY) {
      show(quoteView(msg.quote));
      return true;
    }
    if (msg.type === MESSAGE_TYPE.SUBMIT_RESULT) {
      show(resultView(msg));
      return true;
    }
    return false;
  }

  return { start, onMessage };
}

module.exports = { LISTING_SELECTOR, createContent, domReader };
