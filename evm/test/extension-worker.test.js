// Tests for the service worker core (extension/lib/worker.js, store.js, wire.js), part c2a of the
// browser extension revival. docs/ADR-006-extension-signing-and-wire.md is the spec.
//
// v2 only. Pure: the quoter, storage, tab messaging and operator are fakes, so nothing needs a
// chain or a browser. A real viem account signs, so signature checks are the real ones.

const assert = require('assert');
const { privateKeyToAccount } = require('viem/accounts');

const { IMPL } = require('./helpers');
const { toWire, fromWire, WireError } = require('../extension/lib/wire');
const { createPersistentSeenStore } = require('../extension/lib/store');
const { createWorker, BUYER_KEY } = require('../extension/lib/worker');
const messages = require('../extension/lib/messages');
const { buildDomain, buildAgreementRequest, signAgreementRequest } = require('../extension/lib/request');

const buyerAcct = privateKeyToAccount('0x' + '11'.repeat(32));
const otherAcct = privateKeyToAccount('0x' + '22'.repeat(32));
const RELICPAY = '0x' + 'ab'.repeat(20);
const NFT = '0x' + 'cd'.repeat(20);
const SELLER = '0x' + 'ef'.repeat(20);
const SELLER_ORIGIN = 'https://position.gallery';
const NOW = 1_800_000_000;

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

function rig({ buyer = buyerAcct.address, quoteResult, fetchImpl } = {}) {
  const storage = memoryArea(buyer ? { [BUYER_KEY]: buyer } : {});
  const sent = [];
  const quoteCalls = [];
  const quoter = {
    async quote(args) {
      quoteCalls.push(args);
      return quoteResult || { ok: true, buyer: args.buyer, totalPrice: 1000n };
    },
  };
  const posts = [];
  const worker = createWorker({
    config: {
      chainId: 11155111,
      relicPay: RELICPAY,
      operatorEndpoint: 'https://operator.position.gallery/requests',
      sellerOrigins: [SELLER_ORIGIN],
      terms: { installmentCount: 3 },
      rates: { [SELLER]: { creditDenominated: true } },
    },
    quoter,
    storage,
    sendToTab: async (tabId, wire) => sent.push({ tabId, wire: JSON.parse(JSON.stringify(wire)) }),
    createStore: () => createPersistentSeenStore(storage),
    fetchImpl:
      fetchImpl ||
      (async (url, init) => {
        posts.push({ url, body: JSON.parse(init.body) });
        return { ok: true, json: async () => ({ accepted: true }) };
      }),
    now: () => NOW,
  });
  return { worker, storage, sent, quoteCalls, posts };
}

const contentSender = (origin = SELLER_ORIGIN, id = 7) => ({ tab: { id, url: origin + '/item/1' }, url: origin + '/item/1' });
const popupSender = { id: 'ext', url: 'chrome-extension://ext/popup.html' };
const listing = () => ({ priceText: '10.00', currency: 'USD', nftContract: NFT, tokenId: 1, seller: SELLER });
const wireListing = (tabId = 1) => toWire(messages.listingScraped({ listing: listing(), tabId }));

async function signedMsg({ account = buyerAcct, domain, expiry = NOW + 600, requestId = '0x' + '01'.repeat(32), tabId = 7 } = {}) {
  const d = domain || buildDomain({ chainId: 11155111, verifyingContract: RELICPAY });
  const message = buildAgreementRequest(
    {
      ok: true,
      buyer: buyerAcct.address,
      listing: { seller: SELLER, nftContract: NFT, tokenId: 1 },
      totalPrice: 1000n,
      installmentCount: 3,
      dueIntervalSeconds: 86400n,
      gracePeriodSeconds: 0n,
    },
    { requestId, expiry }
  );
  const signature = await signAgreementRequest({ signTypedData: (a) => account.signTypedData(a), domain: d, message });
  return toWire(messages.requestSigned({ domain: d, message, signature, tabId }));
}

(IMPL === 'v2' ? describe : describe.skip)('extension worker: wire encoding (ADR-006)', () => {
  it('round-trips BigInt through JSON, which chrome.runtime uses', () => {
    const v = { a: 1n, b: [2n, { c: 3n }], s: 'x', n: null, big: 2n ** 200n };
    assert.deepStrictEqual(fromWire(JSON.parse(JSON.stringify(toWire(v)))), v);
  });

  it('plain JSON.stringify of a BigInt throws, which is why the encoding exists', () => {
    assert.throws(() => JSON.stringify({ a: 1n }), TypeError);
  });

  it('only the exact tag shape becomes a BigInt, a lookalike string stays a string', () => {
    assert.strictEqual(fromWire('{"$bigint":"5"}'), '{"$bigint":"5"}');
    assert.throws(() => fromWire({ $bigint: 'abc' }), WireError);
    assert.throws(() => fromWire({ $bigint: '5', extra: 1 }), WireError);
    assert.throws(() => toWire({ $bigint: '5' }), WireError);
  });

  it('refuses functions, which cannot cross', () => {
    assert.throws(() => toWire({ f() {} }), WireError);
  });
});

(IMPL === 'v2' ? describe : describe.skip)('extension worker: persistent replay store (ADR-006)', () => {
  it('survives a worker restart', async () => {
    const area = memoryArea();
    const a = await createPersistentSeenStore(area);
    a.remember('0xaa', 100n);
    await a.save();
    const b = await createPersistentSeenStore(area);
    assert.strictEqual(b.hasSeen('0xaa'), true);
    assert.strictEqual(b.size(), 1);
  });

  it('sweeps expired entries and drops corrupt ones', async () => {
    const area = memoryArea({ 'relicpay/seen-requests': { '0x01': '50', '0x02': '500', '0x03': 'nope' } });
    const s = await createPersistentSeenStore(area);
    assert.strictEqual(s.size(), 2);
    s.sweep(100);
    assert.strictEqual(s.hasSeen('0x01'), false);
    assert.strictEqual(s.hasSeen('0x02'), true);
  });
});

(IMPL === 'v2' ? describe : describe.skip)('extension worker: listings (ADR-006)', () => {
  it('quotes a listing from a seller tab and replies to that tab with the sender tab id', async () => {
    const r = rig();
    const ack = await r.worker.handle(wireListing(999), contentSender(SELLER_ORIGIN, 7));
    assert.deepStrictEqual(ack, { ok: true, quoteOk: true });
    assert.strictEqual(r.sent.length, 1);
    assert.strictEqual(r.sent[0].tabId, 7, 'routed by sender, not by the message body');
    const out = fromWire(r.sent[0].wire);
    assert.strictEqual(out.type, messages.MESSAGE_TYPE.QUOTE_READY);
    assert.strictEqual(out.quote.totalPrice, 1000n);
  });

  it('takes the buyer from storage and the rate from config, never from the page', async () => {
    const r = rig();
    const msg = toWire(messages.listingScraped({ listing: { ...listing(), buyer: otherAcct.address, rate: { creditDenominated: false } }, tabId: 1 }));
    await r.worker.handle(msg, contentSender());
    assert.strictEqual(r.quoteCalls[0].buyer, buyerAcct.address);
    assert.deepStrictEqual(r.quoteCalls[0].rate, { creditDenominated: true });
  });

  it('refuses a listing from a tab that is not a seller storefront', async () => {
    const r = rig();
    for (const sender of [contentSender('https://evil.example'), contentSender('https://position.gallery.evil.example'), popupSender, undefined]) {
      const res = await r.worker.handle(wireListing(), sender);
      assert.strictEqual(res.code, 'UNTRUSTED_SENDER');
    }
    assert.strictEqual(r.sent.length, 0);
    assert.strictEqual(r.quoteCalls.length, 0);
  });

  it('answers a missing wallet with a refusal quote rather than a silent drop', async () => {
    const r = rig({ buyer: null });
    const ack = await r.worker.handle(wireListing(), contentSender());
    assert.strictEqual(ack.quoteOk, false);
    const out = fromWire(r.sent[0].wire);
    assert.strictEqual(out.quote.code, 'NO_BUYER');
  });

  it('a throwing quoter becomes a refusal quote, not an unhandled rejection', async () => {
    const r = rig();
    r.worker = createWorker({
      config: { chainId: 1, relicPay: RELICPAY, operatorEndpoint: 'https://o.example/r', sellerOrigins: [SELLER_ORIGIN], terms: { installmentCount: 3 } },
      quoter: { async quote() { throw new Error('rpc down'); } },
      storage: r.storage,
      sendToTab: async (tabId, wire) => r.sent.push({ tabId, wire }),
      createStore: () => createPersistentSeenStore(r.storage),
    });
    const ack = await r.worker.handle(wireListing(), contentSender());
    assert.strictEqual(ack.quoteOk, false);
    assert.strictEqual(fromWire(r.sent[0].wire).quote.code, 'QUOTE_ERROR');
  });

  it('refuses unknown and malformed messages', async () => {
    const r = rig();
    for (const m of [null, {}, { type: 'nope' }, { type: messages.MESSAGE_TYPE.LISTING_SCRAPED }, { $bigint: 'x' }, toWire(messages.quoteReady({ quote: { ok: true }, tabId: 1 }))]) {
      const res = await r.worker.handle(m, contentSender());
      assert.strictEqual(res.code, 'UNKNOWN_MESSAGE');
    }
  });
});

(IMPL === 'v2' ? describe : describe.skip)('extension worker: signed requests (ADR-006)', () => {
  it('submits a good request to the operator and tells the tab', async () => {
    const r = rig();
    const res = await r.worker.handle(await signedMsg(), popupSender);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(r.posts.length, 1);
    assert.strictEqual(r.posts[0].body.message.tokenId, '1');
    const out = fromWire(r.sent[0].wire);
    assert.strictEqual(out.type, messages.MESSAGE_TYPE.SUBMIT_RESULT);
    assert.strictEqual(r.sent[0].tabId, 7);
    assert.strictEqual(out.ok, true);
  });

  it('refuses a signature submitted from a content script', async () => {
    const r = rig();
    const res = await r.worker.handle(await signedMsg(), contentSender());
    assert.strictEqual(res.code, 'UNTRUSTED_SENDER');
    assert.strictEqual(r.posts.length, 0);
  });

  it('refuses a request signed for another chain or deployment', async () => {
    const r = rig();
    for (const domain of [
      buildDomain({ chainId: 1, verifyingContract: RELICPAY }),
      buildDomain({ chainId: 11155111, verifyingContract: '0x' + '99'.repeat(20) }),
    ]) {
      const res = await r.worker.handle(await signedMsg({ domain }), popupSender);
      assert.strictEqual(res.code, 'DOMAIN_MISMATCH');
    }
    assert.strictEqual(r.posts.length, 0);
  });

  it('refuses expired, wrongly signed and replayed requests', async () => {
    const r = rig();
    assert.strictEqual((await r.worker.handle(await signedMsg({ expiry: NOW - 1 }), popupSender)).code, 'EXPIRED');
    assert.strictEqual((await r.worker.handle(await signedMsg({ account: otherAcct }), popupSender)).code, 'SIGNER_MISMATCH');
    assert.strictEqual((await r.worker.handle(await signedMsg(), popupSender)).ok, true);
    assert.strictEqual((await r.worker.handle(await signedMsg(), popupSender)).code, 'ALREADY_SEEN');
    assert.strictEqual(r.posts.length, 1);
  });

  it('replay protection survives a worker restart because the store is persisted', async () => {
    const r = rig();
    await r.worker.handle(await signedMsg(), popupSender);
    const again = createWorker({
      config: { chainId: 11155111, relicPay: RELICPAY, operatorEndpoint: 'https://o.example/r', sellerOrigins: [SELLER_ORIGIN], terms: { installmentCount: 3 } },
      quoter: {},
      storage: r.storage,
      sendToTab: async () => {},
      createStore: () => createPersistentSeenStore(r.storage),
      now: () => NOW,
    });
    assert.strictEqual((await again.handle(await signedMsg(), popupSender)).code, 'ALREADY_SEEN');
  });

  it('an operator failure is reported and the requestId stays spent', async () => {
    const r = rig({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ reason: 'down' }) }) });
    const res = await r.worker.handle(await signedMsg(), popupSender);
    assert.strictEqual(res.code, 'SUBMIT_FAILED');
    const out = fromWire(r.sent[0].wire);
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.code, 'SUBMIT_FAILED');
    assert.strictEqual((await r.worker.handle(await signedMsg(), popupSender)).code, 'ALREADY_SEEN');
  });
});
