// The popup's logic: connect a wallet, show the confirmation, sign, submit. Part c2b.
//
// popup.html's script is a few lines of DOM glue over this controller. Everything that decides
// something is here, with every dependency injected, so the suite drives it without a browser.
//
// ADR-006 decision 1: the signer is a provider the popup owns (an EIP-1193 object, a WalletConnect v2
// session being the intended one). It is asked for exactly two things: `eth_requestAccounts`, and
// `eth_signTypedData_v4` over typed data this module built. The page is not involved at any step.
//
// What the buyer is shown is what is signed. load() builds the AgreementRequest once and keeps it;
// sign() signs that object and nothing else, and the confirmation is derived from that same object
// (ADR-005). The returned signature is recovered locally and must be the connected buyer's before
// anything is sent, so a wallet that signs from a different account cannot get a request submitted.
//
// Chrome free and framework free.

const { getAddress, getTypesForEIP712Domain } = require('viem');
const { buildAgreementRequest, buildDomain, verifyRequestSignature, AGREEMENT_REQUEST_TYPES } = require('./request');
const { buildConfirmation } = require('./confirm');
const { requestSigned } = require('./messages');
const { fromWire, toWire } = require('./wire');
const { BUYER_KEY, LAST_QUOTE_KEY } = require('./worker');

const POPUP_STATE = {
  NO_BUYER: 'NO_BUYER',
  NO_QUOTE: 'NO_QUOTE',
  STALE: 'STALE',
  REFUSED: 'REFUSED',
  READY: 'READY',
};

const POPUP_TEXT = {
  NO_BUYER: 'Connect a wallet to see financing terms.',
  NO_QUOTE: 'Open a relic listing on a supported storefront to get a quote.',
  STALE: 'This quote is out of date. Reload the listing to get a fresh one.',
  NO_PENDING: 'Nothing to sign yet.',
  WALLET_REFUSED: 'The wallet did not sign the request.',
  WALLET_BAD_ACCOUNT: 'The wallet returned an invalid account.',
  WRONG_SIGNER: 'The signature came from a different account than the connected wallet. Nothing was sent.',
  EXPIRED: 'This request has expired. Reload the listing to get a fresh one.',
};

function defaultRandomId() {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function jsonSafe(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
  return v;
}

/**
 * @param {object} deps
 * @param {object} deps.runtime   a buildRuntimeConfig() result
 * @param {object} deps.storage   chrome.storage.local-like area
 * @param {function} deps.send    async (wireMessage) -> wire response (chrome.runtime.sendMessage)
 * @param {object} deps.provider  EIP-1193 provider the popup owns
 * @param {function} [deps.now]   () -> unix seconds
 * @param {function} [deps.randomId] () -> bytes32 hex
 */
function createPopupController({ runtime, storage, send, provider, now, randomId = defaultRandomId }) {
  for (const [name, v] of Object.entries({ runtime, storage, send, provider })) {
    if (!v) throw new Error(`${name} is required`);
  }
  const clock = () => BigInt(now ? now() : Math.floor(Date.now() / 1000));
  let pending = null;

  async function readBuyer() {
    const got = await storage.get(BUYER_KEY);
    return (got && got[BUYER_KEY]) || null;
  }

  async function connect() {
    let accounts;
    try {
      accounts = await provider.request({ method: 'eth_requestAccounts' });
    } catch {
      return { ok: false, reason: POPUP_TEXT.WALLET_REFUSED };
    }
    let buyer;
    try {
      buyer = getAddress(Array.isArray(accounts) ? accounts[0] : '');
    } catch {
      return { ok: false, reason: POPUP_TEXT.WALLET_BAD_ACCOUNT };
    }
    await storage.set({ [BUYER_KEY]: buyer });
    pending = null;
    return { ok: true, buyer };
  }

  async function disconnect() {
    await storage.set({ [BUYER_KEY]: null });
    pending = null;
    return { ok: true };
  }

  /** Build the view for the most recent quote. Replaces any earlier pending request. */
  async function load() {
    pending = null;
    const buyer = await readBuyer();
    if (!buyer) return { state: POPUP_STATE.NO_BUYER, text: POPUP_TEXT.NO_BUYER };

    const got = await storage.get(LAST_QUOTE_KEY);
    const raw = got && got[LAST_QUOTE_KEY];
    if (!raw) return { state: POPUP_STATE.NO_QUOTE, buyer, text: POPUP_TEXT.NO_QUOTE };
    let stored;
    try {
      stored = fromWire(raw);
    } catch {
      return { state: POPUP_STATE.NO_QUOTE, buyer, text: POPUP_TEXT.NO_QUOTE };
    }
    const { quote, tabId } = stored;
    const t = clock();

    if (!quote || quote.ok !== true) {
      return {
        state: POPUP_STATE.REFUSED,
        buyer,
        text: String((quote && (quote.reason || quote.code)) || POPUP_TEXT.NO_QUOTE),
      };
    }
    const age = t - BigInt(stored.at ?? 0);
    if (age < 0n || age > BigInt(runtime.requestTtlSeconds) || String(quote.buyer).toLowerCase() !== buyer.toLowerCase()) {
      return { state: POPUP_STATE.STALE, buyer, text: POPUP_TEXT.STALE };
    }

    const message = buildAgreementRequest(quote, { requestId: randomId(), expiry: t + BigInt(runtime.requestTtlSeconds) });
    const domain = buildDomain({ chainId: runtime.worker.chainId, verifyingContract: runtime.worker.relicPay });
    const confirmation = buildConfirmation({ message, unit: runtime.unit, quote, now: t });
    pending = { domain, message, tabId, buyer };
    return { state: POPUP_STATE.READY, buyer, confirmation };
  }

  /** Sign the pending request exactly as shown, then submit it through the service worker. */
  async function sign() {
    if (!pending) return { ok: false, reason: POPUP_TEXT.NO_PENDING };
    const { domain, message, tabId, buyer } = pending;
    if (clock() >= message.expiry) {
      pending = null;
      return { ok: false, reason: POPUP_TEXT.EXPIRED };
    }

    const typedData = {
      domain: jsonSafe(domain),
      types: { EIP712Domain: getTypesForEIP712Domain({ domain }), ...AGREEMENT_REQUEST_TYPES },
      primaryType: 'AgreementRequest',
      message: jsonSafe(message),
    };
    let signature;
    try {
      signature = await provider.request({ method: 'eth_signTypedData_v4', params: [buyer, JSON.stringify(typedData)] });
    } catch {
      return { ok: false, reason: POPUP_TEXT.WALLET_REFUSED };
    }
    if (typeof signature !== 'string' || !(await verifyRequestSignature({ domain, message, signature, expectedSigner: buyer }))) {
      return { ok: false, reason: POPUP_TEXT.WRONG_SIGNER };
    }

    pending = null; // a signed request is single use; a retry builds a fresh one with a new requestId
    const response = fromWire(await send(toWire(requestSigned({ domain, message, signature, tabId }))));
    return response && response.ok ? { ok: true, response: response.response } : { ok: false, reason: (response && response.reason) || 'Submission failed.', code: response && response.code };
  }

  return { connect, disconnect, load, sign };
}

module.exports = { POPUP_STATE, POPUP_TEXT, createPopupController };
