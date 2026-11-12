// Tests for the extension's chrome shell, part c2b of the browser extension revival: runtime config,
// listing scrape, the quote surface, the content script and background cores, and the popup
// controller. docs/ADR-007-extension-chrome-shell.md is the spec.
//
// v2 only. Pure: chrome, the DOM, the operator and the wallet are fakes. The wallet is a real viem
// account behind an EIP-1193 shaped provider, and the popup is wired to the real worker, so the
// signature, the replay store and the domain check are the real ones.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { privateKeyToAccount } = require('viem/accounts');

const { IMPL } = require('./helpers');
const { buildManifest, validateManifest } = require('../extension/lib/manifest');
const { ConfigError, buildRuntimeConfig } = require('../extension/lib/runtime-config');
const { scrapeListing } = require('../extension/lib/scrape');
const { quoteView, resultView, applyTree, ALLOWED_TAGS } = require('../extension/lib/surface');
const { createContent } = require('../extension/lib/content-core');
const { createBackground } = require('../extension/lib/background-core');
const { createPopupController, POPUP_STATE, POPUP_TEXT } = require('../extension/lib/popup');
const { createWorker, BUYER_KEY, LAST_QUOTE_KEY } = require('../extension/lib/worker');
const { createPersistentSeenStore } = require('../extension/lib/store');
const { toWire, fromWire } = require('../extension/lib/wire');
const messages = require('../extension/lib/messages');

const ROOT = path.join(__dirname, '..');
const rawCfg = () => {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'config.json'), 'utf8'));
  c.deployment.relicPay = RELICPAY;
  c.deployment.rates = { [SELLER]: { creditDenominated: true } };
  return c;
};

const buyerAcct = privateKeyToAccount('0x' + '11'.repeat(32));
const otherAcct = privateKeyToAccount('0x' + '22'.repeat(32));
const RELICPAY = '0x' + 'ab'.repeat(20);
const NFT = '0x' + 'cd'.repeat(20);
const SELLER = '0x' + 'ef'.repeat(20);
const SELLER_ORIGIN = 'https://position.gallery';
const NOW = 1_800_000_000;
const E18 = 10n ** 18n;

function memoryArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(key) {
      return key in data ? { [key]: JSON.parse(JSON.stringify(data[key])) } : {};
    },
    async set(obj) {
      Object.assign(data, JSON.parse(JSON.stringify(obj)));
    },
  };
}

// A real quote shape, without a chain.
function okQuote(buyer, over = {}) {
  return {
    ok: true,
    unconfirmed: false,
    buyer,
    listing: { nftContract: NFT, tokenId: 7n, seller: SELLER, physicalId: 'PAGE-CLAIM' },
    price: { amount: 30000n, decimals: 2, currency: 'USD' },
    totalPrice: 300n * E18,
    installmentCount: 3,
    dueIntervalSeconds: 2592000n,
    gracePeriodSeconds: 259200n,
    warnings: [],
    ...over,
  };
}

(IMPL === 'v2' ? describe : describe.skip)('extension chrome shell: manifest and runtime config (ADR-007)', () => {
  it('requires walletOrigins and grants each one as an exact host', () => {
    const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'config.json'), 'utf8'));
    const m = buildManifest(base);
    assert.ok(m.host_permissions.includes('https://relay.walletconnect.org/*'));
    assert.ok(validateManifest(m).ok);
    assert.throws(() => buildManifest({ ...base, walletOrigins: undefined }));
    assert.throws(() => buildManifest({ ...base, walletOrigins: [] }));
    for (const bad of ['wss://relay.walletconnect.org', 'https://*.walletconnect.org', 'https://relay.walletconnect.org/x']) {
      assert.throws(() => buildManifest({ ...base, walletOrigins: [bad] }), bad);
    }
  });

  it('builds the worker, unit and popup config from a valid deployment block', () => {
    const r = buildRuntimeConfig(rawCfg());
    assert.strictEqual(r.worker.chainId, 11155111);
    assert.strictEqual(r.worker.relicPay.toLowerCase(), RELICPAY);
    assert.strictEqual(r.worker.terms.dueIntervalSeconds, 2592000n);
    assert.deepStrictEqual(r.worker.rates[SELLER], { creditDenominated: true });
    assert.deepStrictEqual(r.unit, { symbol: 'RPC', decimals: 18 });
    assert.deepStrictEqual(r.worker.sellerOrigins, [SELLER_ORIGIN]);
  });

  it('refuses the shipped placeholder address, so an unconfigured build cannot sign', () => {
    const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'config.json'), 'utf8'));
    assert.throws(() => buildRuntimeConfig(shipped), ConfigError);
  });

  it('refuses an endpoint or rpc outside the origins the manifest grants', () => {
    const a = rawCfg();
    a.deployment.operatorEndpoint = 'https://evil.example.com/requests';
    assert.throws(() => buildRuntimeConfig(a), /operatorOrigins/);
    const b = rawCfg();
    b.deployment.rpcUrl = 'https://rpc.evil.example.com';
    assert.throws(() => buildRuntimeConfig(b), /rpcOrigins/);
    const c = rawCfg();
    c.deployment.operatorEndpoint = 'http://operator.position.gallery/requests';
    assert.throws(() => buildRuntimeConfig(c), /https/);
  });

  it('refuses a bad unit, bad terms and a malformed rate', () => {
    const mk = (fn) => { const c = rawCfg(); fn(c.deployment); return c; };
    assert.throws(() => buildRuntimeConfig(mk((d) => { d.unit = { symbol: 'USD $', decimals: 18 }; })), ConfigError);
    assert.throws(() => buildRuntimeConfig(mk((d) => { d.unit = { symbol: 'RPC', decimals: 99 }; })), ConfigError);
    assert.throws(() => buildRuntimeConfig(mk((d) => { d.terms.installmentCount = 0; })), ConfigError);
    assert.throws(() => buildRuntimeConfig(mk((d) => { d.rates = { notanaddress: { creditDenominated: true } }; })), ConfigError);
    assert.throws(() => buildRuntimeConfig(mk((d) => { d.rates = { [SELLER]: { currency: 'USD', rate: '0' } }; })), ConfigError);
    const ok = buildRuntimeConfig(mk((d) => { d.rates = { [SELLER.toUpperCase().replace('0X', '0x')]: { currency: 'USD', rate: '1000000000000000000', rateDecimals: 18 } }; }));
    assert.strictEqual(ok.worker.rates[SELLER].rate, E18);
  });
});

(IMPL === 'v2' ? describe : describe.skip)('extension chrome shell: scrape and surface (ADR-007)', () => {
  const reader = (over = {}) => {
    const d = { count: 1, attrs: { 'data-nft-contract': NFT, 'data-seller': SELLER, 'data-token-id': '7', 'data-physical-id': 'OR-1' }, price: '  $300.00 ', ...over };
    return { count: () => d.count, attr: (_s, n) => (n in d.attrs ? d.attrs[n] : null), text: () => d.price };
  };

  it('reads one marked listing in a fixed shape with BigInt token id', () => {
    const r = scrapeListing(reader());
    assert.ok(r.ok);
    assert.deepStrictEqual(r.listing, { nftContract: NFT, seller: SELLER, tokenId: 7n, priceText: '$300.00', physicalId: 'OR-1' });
  });

  it('refuses none and more than one rather than guessing', () => {
    assert.strictEqual(scrapeListing(reader({ count: 0 })).code, 'NO_LISTING');
    assert.strictEqual(scrapeListing(reader({ count: 2 })).code, 'MULTIPLE_LISTINGS');
  });

  it('drops a field that is not the right shape instead of passing it on', () => {
    const r = scrapeListing(reader({ attrs: { 'data-nft-contract': '0xnope', 'data-seller': 'x', 'data-token-id': '-1' } }));
    assert.ok(r.ok);
    assert.deepStrictEqual(Object.keys(r.listing).sort(), ['priceText']);
    const long = scrapeListing(reader({ price: '9'.repeat(5000) }));
    assert.strictEqual(long.listing.priceText.length, 200);
  });

  it('the quote surface carries no amount, only the count and the extension words', () => {
    const tree = quoteView(okQuote(buyerAcct.address));
    const flat = JSON.stringify(tree);
    assert.ok(/3 payments/.test(flat));
    assert.ok(!/300|3e20|USD|RPC/.test(flat), 'no figure and no unit on the page surface');
    const refused = quoteView({ ok: false, code: 'NO_PRICE', reason: 'No price found on this listing.' });
    assert.ok(/No price found/.test(JSON.stringify(refused)));
    assert.ok(/not be enough|may not cover/.test(JSON.stringify(quoteView(okQuote(buyerAcct.address, { unconfirmed: true })))));
    assert.strictEqual(resultView({ ok: true }).children[0].text, 'Request sent');
  });

  it('applyTree uses textContent, drops other tags and attributes, and never sets html', () => {
    const log = [];
    const doc = {
      createElement(tag) {
        const el = {
          tag, attrs: {}, children: [],
          setAttribute(k, v) { this.attrs[k] = v; },
          appendChild(c) { this.children.push(c); },
          set innerHTML(v) { log.push('innerHTML'); },
          set textContent(v) { this._t = v; },
        };
        log.push(tag);
        return el;
      },
    };
    const hostile = '<img src=x onerror=alert(1)>';
    const el = applyTree(doc, {
      tag: 'div',
      attrs: { class: 'a', onclick: 'x()', href: 'javascript:1', role: 'status' },
      children: [
        { tag: 'p', text: hostile },
        { tag: 'script', text: 'alert(1)' },
        { tag: 'iframe' },
      ],
    });
    assert.deepStrictEqual(el.attrs, { class: 'a', role: 'status' });
    assert.strictEqual(el.children.length, 1);
    assert.strictEqual(el.children[0]._t, hostile, 'text is set as text, not parsed');
    assert.ok(!log.includes('innerHTML') && !log.includes('script') && !log.includes('iframe'));
    assert.strictEqual(applyTree(doc, { tag: 'a' }), null);
    assert.ok(![...ALLOWED_TAGS].some((t) => ['script', 'iframe', 'a', 'img', 'style'].includes(t)));
  });
});

function fakeDoc({ anchor = true } = {}) {
  const mk = (tag) => ({
    tag, children: [], parentNode: null, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
    attachShadow(init) { this.shadowInit = init; this.shadow = mk('#shadow'); return this.shadow; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text ?? ''; },
  });
  const listing = mk('div');
  listing.attrs = { 'data-relicpay-listing': '', 'data-nft-contract': NFT, 'data-seller': SELLER, 'data-token-id': '7' };
  const price = mk('span');
  price._text = '$300.00';
  const doc = {
    listing,
    createElement: mk,
    querySelectorAll: (sel) => (sel === '[data-relicpay-listing]' && anchor ? [listing] : []),
    querySelector: (sel) => {
      if (sel === '[data-relicpay-listing]') return anchor ? listing : null;
      if (sel === '[data-relicpay-listing] [data-relicpay-price]') return anchor ? price : null;
      return null;
    },
  };
  return doc;
}

(IMPL === 'v2' ? describe : describe.skip)('extension chrome shell: content script core (ADR-007)', () => {
  it('scrapes, sends a wire-safe listing message, and renders a quote in a closed shadow root', async () => {
    const doc = fakeDoc();
    const sent = [];
    const c = createContent({ doc, send: async (m) => sent.push(JSON.parse(JSON.stringify(m))), extensionId: 'ext-1' });
    const r = await c.start();
    assert.ok(r.ok);
    const msg = fromWire(sent[0]);
    assert.strictEqual(msg.type, messages.MESSAGE_TYPE.LISTING_SCRAPED);
    assert.strictEqual(msg.listing.tokenId, 7n);

    const quoteMsg = toWire(messages.quoteReady({ quote: okQuote(buyerAcct.address), tabId: 1 }));
    assert.strictEqual(c.onMessage(JSON.parse(JSON.stringify(quoteMsg)), { id: 'ext-1' }), true);
    const host = doc.listing.children[0];
    assert.deepStrictEqual(host.shadowInit, { mode: 'closed' });
    assert.ok(host.shadow.children.length >= 2);
    // a second quote replaces the first rather than stacking
    c.onMessage(JSON.parse(JSON.stringify(quoteMsg)), { id: 'ext-1' });
    assert.strictEqual(doc.listing.children.length, 1);
  });

  it('does not send when there is no listing, and says why', async () => {
    const sent = [];
    const c = createContent({ doc: fakeDoc({ anchor: false }), send: async (m) => sent.push(m), extensionId: 'ext-1' });
    const r = await c.start();
    assert.strictEqual(r.code, 'NO_LISTING');
    assert.strictEqual(sent.length, 0);
  });

  it('ignores messages from another sender, malformed messages and unrelated types', () => {
    const doc = fakeDoc();
    const c = createContent({ doc, send: async () => {}, extensionId: 'ext-1' });
    const good = toWire(messages.quoteReady({ quote: okQuote(buyerAcct.address), tabId: 1 }));
    assert.strictEqual(c.onMessage(good, { id: 'someone-else' }), false);
    assert.strictEqual(c.onMessage(good, undefined), false);
    assert.strictEqual(c.onMessage({ type: 'relicpay/quote-ready', quote: 'x' }, { id: 'ext-1' }), false);
    assert.strictEqual(c.onMessage({ $bigint: 'zz', x: 1 }, { id: 'ext-1' }), false);
    assert.strictEqual(c.onMessage(toWire(messages.listingScraped({ listing: {}, tabId: 1 })), { id: 'ext-1' }), false);
    assert.strictEqual(doc.listing.children.length, 0);
  });

  it('renders a submit result', () => {
    const doc = fakeDoc();
    const c = createContent({ doc, send: async () => {}, extensionId: 'ext-1' });
    const res = toWire(messages.submitResult({ tabId: 1, ok: false, code: 'X', reason: 'Not sent for a reason.' }));
    assert.strictEqual(c.onMessage(res, { id: 'ext-1' }), true);
  });
});

function fakeChrome() {
  const listeners = [];
  const tabMessages = [];
  return {
    listeners, tabMessages,
    runtime: { onMessage: { addListener: (l) => listeners.push(l) } },
    tabs: { sendMessage: async (id, m) => tabMessages.push({ id, m: JSON.parse(JSON.stringify(m)) }) },
    storage: { local: memoryArea({ [BUYER_KEY]: buyerAcct.address }) },
  };
}

(IMPL === 'v2' ? describe : describe.skip)('extension chrome shell: background core (ADR-007)', () => {
  const quoter = { async quote(a) { return okQuote(a.buyer); } };

  it('does not start on a bad config', () => {
    const ch = fakeChrome();
    const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'config.json'), 'utf8'));
    assert.throws(() => createBackground({ chromeApi: ch, rawConfig: shipped, makeQuoter: () => quoter }), ConfigError);
    assert.strictEqual(ch.listeners.length, 0, 'no listener is registered for a worker that did not start');
  });

  it('registers one async listener that answers over the wire and quotes a seller tab', async () => {
    const ch = fakeChrome();
    createBackground({ chromeApi: ch, rawConfig: rawCfg(), makeQuoter: () => quoter, now: () => NOW });
    assert.strictEqual(ch.listeners.length, 1);

    const msg = toWire(messages.listingScraped({ listing: { nftContract: NFT, seller: SELLER, tokenId: 7n, priceText: '$300.00' }, tabId: 0 }));
    const answered = await new Promise((resolve) => {
      const ret = ch.listeners[0](JSON.parse(JSON.stringify(msg)), { tab: { id: 5, url: SELLER_ORIGIN + '/relic/7' }, url: SELLER_ORIGIN + '/relic/7' }, resolve);
      assert.strictEqual(ret, true, 'must return true to keep the channel open');
    });
    assert.deepStrictEqual(answered, { ok: true, quoteOk: true });
    assert.strictEqual(ch.tabMessages[0].id, 5);
    assert.strictEqual(fromWire(ch.tabMessages[0].m).type, messages.MESSAGE_TYPE.QUOTE_READY);
  });

  it('refuses a listing from a page that is not a seller origin, and answers JSON', async () => {
    const ch = fakeChrome();
    createBackground({ chromeApi: ch, rawConfig: rawCfg(), makeQuoter: () => quoter });
    const msg = toWire(messages.listingScraped({ listing: { seller: SELLER }, tabId: 0 }));
    const answered = await new Promise((resolve) =>
      ch.listeners[0](JSON.parse(JSON.stringify(msg)), { tab: { id: 5, url: 'https://evil.example.com/' }, url: 'https://evil.example.com/' }, resolve));
    assert.strictEqual(answered.code, 'UNTRUSTED_SENDER');
    assert.strictEqual(ch.tabMessages.length, 0);
  });

  it('turns an internal failure into a JSON refusal instead of a hung channel', async () => {
    const ch = fakeChrome();
    ch.tabs.sendMessage = async () => { throw new Error('tab closed'); };
    createBackground({ chromeApi: ch, rawConfig: rawCfg(), makeQuoter: () => quoter });
    const msg = toWire(messages.listingScraped({ listing: { seller: SELLER }, tabId: 0 }));
    const answered = await new Promise((resolve) =>
      ch.listeners[0](JSON.parse(JSON.stringify(msg)), { tab: { id: 5, url: SELLER_ORIGIN + '/' }, url: SELLER_ORIGIN + '/' }, resolve));
    assert.strictEqual(answered.code, 'INTERNAL');
  });
});

// A wallet: EIP-1193 over a real viem account. eth_signTypedData_v4 receives JSON text, as a real
// wallet does, so BigInts have been stringified and have to be turned back for the account to sign.
function walletFor(account, { reject = false, log = [] } = {}) {
  return {
    log,
    async request({ method, params }) {
      log.push({ method, params });
      if (reject) throw new Error('User rejected');
      if (method === 'eth_requestAccounts') return [account.address.toLowerCase()];
      if (method === 'eth_signTypedData_v4') {
        const [from, json] = params;
        assert.strictEqual(from.toLowerCase(), account.address.toLowerCase());
        const td = JSON.parse(json);
        const message = { ...td.message };
        for (const f of td.types.AgreementRequest) if (f.type.startsWith('uint') && f.type !== 'uint8' && f.type !== 'uint32') message[f.name] = BigInt(message[f.name]);
        return account.signTypedData({ domain: td.domain, types: { AgreementRequest: td.types.AgreementRequest }, primaryType: td.primaryType, message });
      }
      throw new Error('unsupported');
    },
  };
}

(IMPL === 'v2' ? describe : describe.skip)('extension chrome shell: popup controller (ADR-007)', () => {
  function rig({ wallet, storageInit = {}, quote } = {}) {
    const runtime = buildRuntimeConfig(rawCfg());
    const storage = memoryArea(storageInit);
    const posts = [];
    const worker = createWorker({
      config: runtime.worker,
      quoter: { async quote(a) { return quote || okQuote(a.buyer); } },
      storage,
      sendToTab: async () => {},
      createStore: () => createPersistentSeenStore(storage),
      fetchImpl: async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ accepted: true }), text: async () => '{"accepted":true}' }; },
      now: () => NOW,
    });
    let sendCount = 0;
    const controller = createPopupController({
      runtime, storage, provider: wallet || walletFor(buyerAcct),
      send: async (wire) => { sendCount++; return toWire(await worker.handle(JSON.parse(JSON.stringify(wire)), {})); },
      now: () => NOW,
      randomId: () => '0x' + '77'.repeat(32),
    });
    return { controller, storage, worker, posts, sends: () => sendCount };
  }
  const listingMsg = toWire(messages.listingScraped({ listing: { nftContract: NFT, seller: SELLER, tokenId: 7n, priceText: '$300.00' }, tabId: 0 }));
  const seed = (r) => r.worker.handle(JSON.parse(JSON.stringify(listingMsg)), { tab: { id: 9, url: SELLER_ORIGIN + '/r' }, url: SELLER_ORIGIN + '/r' });

  it('the worker leaves the latest quote where the popup can read it', async () => {
    const r = rig({ storageInit: { [BUYER_KEY]: buyerAcct.address } });
    await seed(r);
    const stored = fromWire(r.storage.data[LAST_QUOTE_KEY]);
    assert.strictEqual(stored.tabId, 9);
    assert.strictEqual(stored.quote.totalPrice, 300n * E18);
    assert.strictEqual(stored.at, NOW);
  });

  it('walks connect, confirm, sign, submit end to end against the real worker', async () => {
    const r = rig();
    assert.strictEqual((await r.controller.load()).state, POPUP_STATE.NO_BUYER);
    const c = await r.controller.connect();
    assert.ok(c.ok);
    assert.strictEqual(c.buyer, buyerAcct.address, 'checksummed');
    assert.strictEqual((await r.controller.load()).state, POPUP_STATE.NO_QUOTE);

    await seed(r);
    const view = await r.controller.load();
    assert.strictEqual(view.state, POPUP_STATE.READY);
    assert.strictEqual(view.confirmation.total, '300 RPC');
    assert.strictEqual(view.confirmation.installments.count, 3);

    const out = await r.controller.sign();
    assert.ok(out.ok, JSON.stringify(out));
    assert.strictEqual(r.posts.length, 1);
    assert.strictEqual(r.posts[0].url, 'https://operator.position.gallery/requests');
    const again = await r.controller.sign();
    assert.strictEqual(again.reason, POPUP_TEXT.NO_PENDING, 'a signed request is single use');
  });

  it('signs exactly the request it showed', async () => {
    const wallet = walletFor(buyerAcct);
    const r = rig({ wallet });
    await r.controller.connect();
    await seed(r);
    const view = await r.controller.load();
    await r.controller.sign();
    const call = wallet.log.find((l) => l.method === 'eth_signTypedData_v4');
    const typed = JSON.parse(call.params[1]);
    assert.strictEqual(BigInt(typed.message.totalPrice), 300n * E18);
    assert.strictEqual(typed.message.requestId, '0x' + '77'.repeat(32));
    assert.strictEqual(typed.domain.verifyingContract.toLowerCase(), RELICPAY);
    assert.strictEqual(typed.domain.chainId, 11155111);
    assert.strictEqual(view.confirmation.seller, require('viem').getAddress(SELLER));
    assert.ok(typed.types.EIP712Domain.length > 0);
  });

  it('refuses and sends nothing when the wallet signs from a different account', async () => {
    const wallet = walletFor(buyerAcct);
    const real = wallet.request.bind(wallet);
    const impostor = walletFor(otherAcct);
    wallet.request = async (a) => (a.method === 'eth_signTypedData_v4' ? impostor.request({ ...a, params: [otherAcct.address, a.params[1]] }) : real(a));
    const r = rig({ wallet });
    await r.controller.connect();
    await seed(r);
    await r.controller.load();
    const out = await r.controller.sign();
    assert.strictEqual(out.reason, POPUP_TEXT.WRONG_SIGNER);
    assert.strictEqual(r.sends(), 0);
    assert.strictEqual(r.posts.length, 0);
  });

  it('reports a wallet that rejects, at connect and at sign', async () => {
    const rejecting = rig({ wallet: walletFor(buyerAcct, { reject: true }) });
    assert.strictEqual((await rejecting.controller.connect()).reason, POPUP_TEXT.WALLET_REFUSED);

    const r = rig({ storageInit: { [BUYER_KEY]: buyerAcct.address }, wallet: walletFor(buyerAcct, { reject: true }) });
    await seed(r);
    await r.controller.load();
    assert.strictEqual((await r.controller.sign()).reason, POPUP_TEXT.WALLET_REFUSED);
    assert.strictEqual(r.sends(), 0);
  });

  it('refuses a malformed account from the wallet and stores nothing', async () => {
    const r = rig({ wallet: { request: async () => ['not an address'] } });
    assert.strictEqual((await r.controller.connect()).reason, POPUP_TEXT.WALLET_BAD_ACCOUNT);
    assert.ok(!(BUYER_KEY in r.storage.data));
  });

  it('shows a refused quote in the extension words and offers no signature', async () => {
    const r = rig({ storageInit: { [BUYER_KEY]: buyerAcct.address }, quote: { ok: false, code: 'INSUFFICIENT_CREDIT', reason: 'Your available credit does not cover this listing.' } });
    await seed(r);
    const v = await r.controller.load();
    assert.strictEqual(v.state, POPUP_STATE.REFUSED);
    assert.ok(/credit/.test(v.text));
    assert.strictEqual((await r.controller.sign()).reason, POPUP_TEXT.NO_PENDING);
  });

  it('treats an old quote, or one for a previous buyer, as stale', async () => {
    const r = rig({ storageInit: { [BUYER_KEY]: buyerAcct.address } });
    await seed(r);
    r.storage.data[LAST_QUOTE_KEY].at = NOW - 10_000;
    assert.strictEqual((await r.controller.load()).state, POPUP_STATE.STALE);

    const r2 = rig({ storageInit: { [BUYER_KEY]: buyerAcct.address } });
    await seed(r2);
    r2.storage.data[BUYER_KEY] = otherAcct.address;
    assert.strictEqual((await r2.controller.load()).state, POPUP_STATE.STALE);
  });

  it('refuses to sign once the request expired, and disconnect clears the buyer and the pending request', async () => {
    let t = NOW;
    const runtime = buildRuntimeConfig(rawCfg());
    const storage = memoryArea({ [BUYER_KEY]: buyerAcct.address });
    const worker = createWorker({ config: runtime.worker, quoter: { async quote(a) { return okQuote(a.buyer); } }, storage, sendToTab: async () => {}, createStore: () => createPersistentSeenStore(storage), now: () => t });
    await worker.handle(JSON.parse(JSON.stringify(listingMsg)), { tab: { id: 9, url: SELLER_ORIGIN + '/r' }, url: SELLER_ORIGIN + '/r' });
    const wallet = walletFor(buyerAcct);
    const controller = createPopupController({ runtime, storage, provider: wallet, send: async () => toWire({ ok: true }), now: () => t });
    assert.strictEqual((await controller.load()).state, POPUP_STATE.READY);
    t = NOW + runtime.requestTtlSeconds + 1;
    assert.strictEqual((await controller.sign()).reason, POPUP_TEXT.EXPIRED);
    assert.strictEqual(wallet.log.length, 0, 'the wallet is never asked to sign an expired request');

    t = NOW;
    await controller.load();
    await controller.disconnect();
    assert.strictEqual(storage.data[BUYER_KEY], null);
    assert.strictEqual((await controller.sign()).reason, POPUP_TEXT.NO_PENDING);
    assert.strictEqual((await controller.load()).state, POPUP_STATE.NO_BUYER);
  });

  it('surfaces a worker refusal (replay) as the reason, not a crash', async () => {
    const r = rig({ storageInit: { [BUYER_KEY]: buyerAcct.address } });
    await seed(r);
    await r.controller.load();
    assert.ok((await r.controller.sign()).ok);
    await r.controller.load(); // same fixed randomId, so the same requestId
    const second = await r.controller.sign();
    assert.strictEqual(second.ok, false);
    assert.ok(second.reason);
    assert.strictEqual(r.posts.length, 1, 'the replay never reached the operator');
  });
});

(IMPL === 'v2' ? describe : describe.skip)('extension chrome shell: structure (ADR-007)', () => {
  const strip = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('lib modules stay chrome free, and nothing in the shell can parse html or run strings', () => {
    for (const f of fs.readdirSync(path.join(ROOT, 'extension', 'lib')).map((n) => `extension/lib/${n}`)) {
      assert.ok(!/\bchrome\./.test(strip(f)), `${f} must stay chrome-free`);
    }
    for (const f of ['extension/background.js', 'extension/content.js', 'extension/popup-main.js', 'extension/wallet.js', ...fs.readdirSync(path.join(ROOT, 'extension', 'lib')).map((n) => `extension/lib/${n}`)]) {
      const code = strip(f);
      assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(code), `${f}`);
    }
  });

  it('only the glue entry points touch chrome, and the content script never injects into the page world', () => {
    const content = strip('extension/content.js');
    assert.ok(!/world\s*:\s*['"]MAIN|window\.postMessage|dispatchEvent|<script/.test(content));
    assert.ok(!/\bwindow\./.test(strip('extension/lib/content-core.js')));
    assert.ok(!/chrome\.(tabs|scripting|cookies|history|webRequest)\b(?!\.sendMessage)/.test(strip('extension/background.js')));
  });

  it('glue entry points stay a few lines over the cores', () => {
    for (const f of ['extension/background.js', 'extension/content.js']) {
      assert.ok(fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').length <= 40, f);
    }
  });

  it('every file the manifest names that exists in c2b is on disk, and popup.html loads only a same-origin script', () => {
    const html = fs.readFileSync(path.join(ROOT, 'extension', 'popup.html'), 'utf8');
    const srcs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(srcs.length > 0 && srcs.every((s) => !/^(https?:)?\/\//.test(s)));
    assert.ok(!/<script(?![^>]*src=)[^>]*>/.test(html), 'no inline script (CSP)');
    for (const f of ['background.js', 'content.js', 'popup.html']) assert.ok(fs.existsSync(path.join(ROOT, 'extension', f)), f);
  });
});
