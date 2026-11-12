// Tests for the request channel (extension/lib/request.js and extension/lib/messages.js), part b
// of the browser extension revival. ADR-004 is the spec this suite checks.
//
// v2 only, same reasoning as extension-offer.test.js: the extension is a v2 artifact and legacy/
// is the frozen spec, so the legacy run stays at exactly 51.
//
// Three parts:
//
// 1. Pure. Typed-data construction, signing and verification with a real private key (no chain),
//    the freshness and replay guards, and the JSON transport round trip.
//
// 2. Against a live chain. A buyer signs a request built from a real offer.js quote, an operator
//    creates the matching agreement, and matchAgreementToRequest / verifyCreatedAgreement confirm
//    they describe the same deal. The inverse: a created agreement that diverges from what was
//    signed is caught, field by field.
//
// 3. The message contract in messages.js: each builder validates its own payload, and
//    isValidMessage refuses anything that does not match one of the four known shapes.

const assert = require('assert');
const crypto = require('crypto');
const { ethers } = require('ethers');
const ganache = require('ganache');
const { createPublicClient, custom } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const { deploy, findEvent, IMPL } = require('./helpers');
const { createRelicPayReader } = require('../dashboard/lib/reader');
const { createOfferQuoter } = require('../extension/lib/offer');
const {
  RequestError,
  REQUEST_REFUSAL,
  AGREEMENT_REQUEST_TYPES,
  buildDomain,
  buildAgreementRequest,
  signAgreementRequest,
  hashAgreementRequest,
  recoverRequestSigner,
  verifyRequestSignature,
  checkFreshness,
  createSeenRequestStore,
  checkRequest,
  serializeRequest,
  deserializeRequest,
  submitRequest,
  matchAgreementToRequest,
  verifyCreatedAgreement,
} = require('../extension/lib/request');
const {
  MessageError,
  MESSAGE_TYPE,
  listingScraped,
  isListingScraped,
  quoteReady,
  isQuoteReady,
  requestSigned,
  isRequestSigned,
  submitResult,
  isSubmitResult,
  isValidMessage,
} = require('../extension/lib/messages');

const DAY = 86400n;
const E18 = 10n ** 18n;
const ZERO = '0x0000000000000000000000000000000000000000';

if (IMPL === 'v2') {

function randomBytes32() {
  return '0x' + crypto.randomBytes(32).toString('hex');
}

const DOMAIN = buildDomain({ chainId: 1337, verifyingContract: '0x' + '11'.repeat(20) });

const BASE_QUOTE = {
  ok: true,
  buyer: '0x' + '22'.repeat(20),
  listing: { nftContract: '0x' + '33'.repeat(20), tokenId: 7n, seller: '0x' + '44'.repeat(20) },
  totalPrice: 1000n,
  installmentCount: 4,
  dueIntervalSeconds: 30n * DAY,
  gracePeriodSeconds: 7n * DAY,
};

describe('Request channel, pure [v2]', function () {
  describe('buildDomain', () => {
    it('requires chainId and verifyingContract', () => {
      assert.throws(() => buildDomain({ verifyingContract: BASE_QUOTE.listing.seller }), RequestError);
      assert.throws(() => buildDomain({ chainId: 1 }), RequestError);
    });

    it('defaults name and version, and normalizes chainId to a Number', () => {
      const d = buildDomain({ chainId: 11155111n, verifyingContract: BASE_QUOTE.listing.seller });
      assert.strictEqual(d.name, 'RelicPay');
      assert.strictEqual(d.version, '1');
      assert.strictEqual(d.chainId, 11155111);
    });
  });

  describe('buildAgreementRequest', () => {
    it('refuses a quote that is not ok:true', () => {
      assert.throws(() => buildAgreementRequest({ ok: false }), RequestError);
      assert.throws(() => buildAgreementRequest(null), RequestError);
    });

    it('carries only the fields the contract reads or the buyer needs to recognize the deal', () => {
      const requestId = randomBytes32();
      const m = buildAgreementRequest(BASE_QUOTE, { requestId, expiry: 2000000000n });
      assert.strictEqual(m.buyer, BASE_QUOTE.buyer);
      assert.strictEqual(m.seller, BASE_QUOTE.listing.seller);
      assert.strictEqual(m.nftContract, BASE_QUOTE.listing.nftContract);
      assert.strictEqual(m.tokenId, 7n);
      assert.strictEqual(m.totalPrice, 1000n);
      assert.strictEqual(m.installmentCount, 4);
      assert.strictEqual(m.dueIntervalSeconds, Number(30n * DAY));
      assert.strictEqual(m.gracePeriodSeconds, Number(7n * DAY));
      assert.strictEqual(m.paymentMethod, 0, 'Manual defaults to 0');
      assert.strictEqual(m.requestId, requestId);
      assert.strictEqual(m.expiry, 2000000000n);
      assert.ok(!('physicalId' in m), 'physicalId is not contract-checked and stays out of the signed struct');
    });

    it('accepts a PaymentMethod label or its numeric encoding', () => {
      const requestId = randomBytes32();
      const byLabel = buildAgreementRequest(BASE_QUOTE, { requestId, expiry: 1n, paymentMethod: 'Collateral' });
      const byNumber = buildAgreementRequest(BASE_QUOTE, { requestId, expiry: 1n, paymentMethod: 2 });
      assert.strictEqual(byLabel.paymentMethod, 2);
      assert.strictEqual(byNumber.paymentMethod, 2);
    });

    it('requires a well-formed requestId and an expiry', () => {
      assert.throws(() => buildAgreementRequest(BASE_QUOTE, { requestId: '0xnotbytes32', expiry: 1n }), RequestError);
      assert.throws(() => buildAgreementRequest(BASE_QUOTE, { requestId: randomBytes32() }), RequestError);
    });
  });

  describe('signing and verification with a real key', () => {
    const pk = '0x' + '5'.repeat(64);
    const account = privateKeyToAccount(pk);
    const other = privateKeyToAccount('0x' + '6'.repeat(64));

    function messageFor(buyer) {
      return buildAgreementRequest({ ...BASE_QUOTE, buyer }, { requestId: randomBytes32(), expiry: 2000000000n });
    }

    it('recovers the exact signer for a signed request', async () => {
      const message = messageFor(account.address);
      const signature = await signAgreementRequest({ signTypedData: account.signTypedData, domain: DOMAIN, message });
      const signer = await recoverRequestSigner({ domain: DOMAIN, message, signature });
      assert.strictEqual(signer.toLowerCase(), account.address.toLowerCase());
    });

    it('verifyRequestSignature is true for the real signer and false for anyone else', async () => {
      const message = messageFor(account.address);
      const signature = await signAgreementRequest({ signTypedData: account.signTypedData, domain: DOMAIN, message });
      assert.strictEqual(
        await verifyRequestSignature({ domain: DOMAIN, message, signature, expectedSigner: account.address }),
        true
      );
      assert.strictEqual(
        await verifyRequestSignature({ domain: DOMAIN, message, signature, expectedSigner: other.address }),
        false
      );
    });

    it('a signature does not verify under a different domain (cross-deployment/cross-chain replay)', async () => {
      const message = messageFor(account.address);
      const signature = await signAgreementRequest({ signTypedData: account.signTypedData, domain: DOMAIN, message });
      const otherDomain = buildDomain({ chainId: DOMAIN.chainId, verifyingContract: '0x' + '99'.repeat(20) });
      assert.strictEqual(
        await verifyRequestSignature({ domain: otherDomain, message, signature, expectedSigner: account.address }),
        false
      );
      const recovered = await recoverRequestSigner({ domain: otherDomain, message, signature });
      assert.notStrictEqual(recovered.toLowerCase(), account.address.toLowerCase());
    });

    it('tampering with the message after signing invalidates it', async () => {
      const message = messageFor(account.address);
      const signature = await signAgreementRequest({ signTypedData: account.signTypedData, domain: DOMAIN, message });
      const tampered = { ...message, totalPrice: message.totalPrice * 10n };
      assert.strictEqual(
        await verifyRequestSignature({ domain: DOMAIN, message: tampered, signature, expectedSigner: account.address }),
        false
      );
    });

    it('hashAgreementRequest changes when any field changes', () => {
      const m1 = messageFor(account.address);
      const m2 = { ...m1, gracePeriodSeconds: m1.gracePeriodSeconds + 1 };
      assert.notStrictEqual(hashAgreementRequest({ domain: DOMAIN, message: m1 }), hashAgreementRequest({ domain: DOMAIN, message: m2 }));
    });
  });

  describe('checkFreshness', () => {
    it('accepts a request at or before its expiry and refuses after', () => {
      const message = { expiry: 1000n };
      assert.strictEqual(checkFreshness(message, { now: 999n }).ok, true);
      assert.strictEqual(checkFreshness(message, { now: 1000n }).ok, true);
      const r = checkFreshness(message, { now: 1001n });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.code, 'EXPIRED');
      assert.strictEqual(r.reason, REQUEST_REFUSAL.EXPIRED);
    });
  });

  describe('createSeenRequestStore', () => {
    it('tracks requestIds and sweeps expired ones', () => {
      const store = createSeenRequestStore();
      const id = randomBytes32();
      assert.strictEqual(store.hasSeen(id), false);
      store.remember(id, 1000n);
      assert.strictEqual(store.hasSeen(id), true);
      assert.strictEqual(store.size(), 1);
      store.sweep(500n);
      assert.strictEqual(store.hasSeen(id), true, 'not yet expired');
      store.sweep(1001n);
      assert.strictEqual(store.hasSeen(id), false, 'swept once its own expiry has passed');
      assert.strictEqual(store.size(), 0);
    });
  });

  describe('checkRequest, the full pre-chain gate', () => {
    const account = privateKeyToAccount('0x' + '7'.repeat(64));
    const impostor = privateKeyToAccount('0x' + '8'.repeat(64));

    async function signedMessage({ expiry = 2000000000n, requestId = randomBytes32(), signer = account } = {}) {
      const message = buildAgreementRequest({ ...BASE_QUOTE, buyer: account.address }, { requestId, expiry });
      const signature = await signAgreementRequest({ signTypedData: signer.signTypedData, domain: DOMAIN, message });
      return { message, signature };
    }

    it('accepts a fresh, unreplayed request signed by the buyer it names', async () => {
      const { message, signature } = await signedMessage();
      const r = await checkRequest({ domain: DOMAIN, message, signature, seenStore: createSeenRequestStore(), now: 1n });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.signer.toLowerCase(), account.address.toLowerCase());
    });

    it('refuses an expired request before ever checking the signature', async () => {
      const { message, signature } = await signedMessage({ expiry: 100n });
      const r = await checkRequest({ domain: DOMAIN, message, signature, now: 200n });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.code, 'EXPIRED');
    });

    it('refuses a requestId already recorded as seen', async () => {
      const requestId = randomBytes32();
      const { message, signature } = await signedMessage({ requestId });
      const seenStore = createSeenRequestStore();
      seenStore.remember(requestId, message.expiry);
      const r = await checkRequest({ domain: DOMAIN, message, signature, seenStore, now: 1n });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.code, 'ALREADY_SEEN');
    });

    it('refuses a request signed by someone other than the buyer it names', async () => {
      const { message, signature } = await signedMessage({ signer: impostor });
      const r = await checkRequest({ domain: DOMAIN, message, signature, now: 1n });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.code, 'SIGNER_MISMATCH');
    });

    it('refuses a garbage signature rather than throwing', async () => {
      const { message } = await signedMessage();
      const r = await checkRequest({ domain: DOMAIN, message, signature: '0xdead', now: 1n });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.code, 'SIGNATURE_INVALID');
    });
  });

  describe('serializeRequest / deserializeRequest', () => {
    it('round-trips every field through JSON, BigInts included', () => {
      const message = buildAgreementRequest(BASE_QUOTE, { requestId: randomBytes32(), expiry: 123456789n });
      const signature = '0x' + 'ab'.repeat(65);
      const json = JSON.parse(JSON.stringify(serializeRequest({ domain: DOMAIN, message, signature })));
      const back = deserializeRequest(json);
      assert.deepStrictEqual(back.message, message);
      assert.deepStrictEqual(back.domain, DOMAIN);
      assert.strictEqual(back.signature, signature);
    });

    it('refuses a payload missing domain, message or signature', () => {
      assert.throws(() => deserializeRequest({}), RequestError);
      assert.throws(() => deserializeRequest({ domain: DOMAIN, message: {} }), RequestError);
    });
  });

  describe('submitRequest', () => {
    it('POSTs the serialized envelope and returns the parsed JSON response', async () => {
      const calls = [];
      const message = buildAgreementRequest(BASE_QUOTE, { requestId: randomBytes32(), expiry: 1n });
      const fetchImpl = async (url, opts) => {
        calls.push({ url, opts });
        return { ok: true, json: async () => ({ accepted: true }) };
      };
      const result = await submitRequest({ endpoint: 'https://operator.example/requests', domain: DOMAIN, message, signature: '0xsig', fetchImpl });
      assert.deepStrictEqual(result, { accepted: true });
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].url, 'https://operator.example/requests');
      const body = JSON.parse(calls[0].opts.body);
      assert.strictEqual(body.message.requestId, message.requestId);
      assert.strictEqual(body.message.totalPrice, message.totalPrice.toString());
    });

    it('raises a RequestError with the operator-provided reason on a non-2xx response', async () => {
      const message = buildAgreementRequest(BASE_QUOTE, { requestId: randomBytes32(), expiry: 1n });
      const fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ reason: 'already fulfilled' }) });
      await assert.rejects(
        submitRequest({ endpoint: 'https://operator.example/requests', domain: DOMAIN, message, signature: '0xsig', fetchImpl }),
        (e) => e instanceof RequestError && /already fulfilled/.test(e.message)
      );
    });

    it('requires an endpoint and a fetch implementation', async () => {
      const message = buildAgreementRequest(BASE_QUOTE, { requestId: randomBytes32(), expiry: 1n });
      await assert.rejects(submitRequest({ domain: DOMAIN, message, signature: '0xsig', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), RequestError);
    });
  });

  describe('matchAgreementToRequest, pure fixtures', () => {
    const message = buildAgreementRequest(BASE_QUOTE, { requestId: randomBytes32(), expiry: 1n });

    function agreementFor(message, over = {}) {
      return {
        seller: message.seller,
        buyer: message.buyer,
        totalPrice: message.totalPrice,
        installmentCount: message.installmentCount,
        dueIntervalSeconds: BigInt(message.dueIntervalSeconds),
        gracePeriodSeconds: BigInt(message.gracePeriodSeconds),
        // reader.getAgreement returns paymentMethodTraits()'s object, not a bare label.
        paymentMethod: { label: 'Manual', usesAutoBalance: false, usesCollateral: false, requiresBuyerTransaction: true },
        relic: { nftContract: message.nftContract, tokenId: message.tokenId },
        ...over,
      };
    }

    it('matches an agreement built from the same terms', () => {
      const r = matchAgreementToRequest({ agreement: agreementFor(message), message });
      assert.strictEqual(r.matches, true);
      assert.deepStrictEqual(r.mismatches, []);
    });

    it('reports every mismatch, not just the first', () => {
      const agreement = agreementFor(message, { totalPrice: message.totalPrice + 1n, seller: ZERO });
      const r = matchAgreementToRequest({ agreement, message });
      assert.strictEqual(r.matches, false);
      const fields = r.mismatches.map((m) => m.field).sort();
      assert.deepStrictEqual(fields, ['seller', 'totalPrice']);
    });

    it('flags an agreement with no relic as a mismatch', () => {
      const r = matchAgreementToRequest({ agreement: agreementFor(message, { relic: null }), message });
      assert.strictEqual(r.matches, false);
      assert.ok(r.mismatches.some((m) => m.field === 'relic'));
    });
  });

  describe('module boundary', () => {
    it('request.js and messages.js stay chrome-free, React-free and dashboard/app-free', () => {
      for (const file of ['../extension/lib/request', '../extension/lib/messages']) {
        const src = require('fs').readFileSync(require.resolve(file), 'utf8');
        const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
        assert.ok(!/\bchrome\./.test(code), `${file} must stay chrome-free`);
        assert.ok(!/require\(['"]react/.test(code), `${file} must stay React-free`);
        assert.ok(!/dashboard\/app/.test(code), `${file} must stay dashboard/app-free`);
      }
    });

    it('gives every REQUEST_REFUSAL code a sentence with no em dash', () => {
      for (const [code, text] of Object.entries(REQUEST_REFUSAL)) {
        assert.ok(typeof text === 'string' && text.length > 10, code);
        assert.ok(!text.includes('—'), `${code} uses an em dash`);
      }
    });
  });
});

describe('Message contract [v2]', function () {
  it('builds and validates a LISTING_SCRAPED message', () => {
    const msg = listingScraped({ listing: { nftContract: '0x1', seller: '0x2' }, tabId: 5 });
    assert.strictEqual(msg.type, MESSAGE_TYPE.LISTING_SCRAPED);
    assert.strictEqual(isListingScraped(msg), true);
    assert.strictEqual(isValidMessage(msg), true);
  });

  it('builds and validates a QUOTE_READY message carrying either an ok or a refused quote', () => {
    const okMsg = quoteReady({ quote: { ok: true, totalPrice: 1n }, tabId: 5 });
    const refusedMsg = quoteReady({ quote: { ok: false, code: 'NO_PRICE' }, tabId: 5 });
    assert.strictEqual(isQuoteReady(okMsg), true);
    assert.strictEqual(isQuoteReady(refusedMsg), true);
    assert.strictEqual(isValidMessage(okMsg), true);
  });

  it('builds and validates a REQUEST_SIGNED message', () => {
    const msg = requestSigned({ domain: DOMAIN, message: { buyer: '0x1' }, signature: '0xsig', tabId: 5 });
    assert.strictEqual(isRequestSigned(msg), true);
    assert.strictEqual(isValidMessage(msg), true);
  });

  it('builds and validates a SUBMIT_RESULT message, for both success and refusal', () => {
    const ok = submitResult({ tabId: 5, ok: true, response: { accepted: true } });
    const refused = submitResult({ tabId: 5, ok: false, code: 'EXPIRED', reason: REQUEST_REFUSAL.EXPIRED });
    assert.strictEqual(isSubmitResult(ok), true);
    assert.strictEqual(isSubmitResult(refused), true);
    assert.strictEqual(isValidMessage(refused), true);
  });

  it('a refusal SUBMIT_RESULT must carry a code', () => {
    assert.throws(() => submitResult({ tabId: 5, ok: false }), MessageError);
  });

  it('every builder requires a tabId to route the reply', () => {
    assert.throws(() => listingScraped({ listing: {} }), MessageError);
    assert.throws(() => quoteReady({ quote: { ok: true } }), MessageError);
    assert.throws(() => requestSigned({ domain: {}, message: {}, signature: '0xsig' }), MessageError);
    assert.throws(() => submitResult({ ok: true }), MessageError);
  });

  it('isValidMessage refuses malformed, foreign and empty messages', () => {
    assert.strictEqual(isValidMessage(null), false);
    assert.strictEqual(isValidMessage({}), false);
    assert.strictEqual(isValidMessage({ type: 'some/other-message' }), false);
    assert.strictEqual(isValidMessage({ type: MESSAGE_TYPE.LISTING_SCRAPED, listing: 'not an object', tabId: 1 }), false);
    assert.strictEqual(isValidMessage({ type: MESSAGE_TYPE.SUBMIT_RESULT, ok: 'not a boolean' }), false);
  });
});

describe('Request channel against a live chain [v2]', function () {
  this.timeout(180000);

  let provider, owner, seller, buyer, buyerAccount, rp, rpAddr, nft, publicClient, reader, quoter;

  async function makeViemClient(prov) {
    const chainId = Number(await prov.send('eth_chainId', []));
    return createPublicClient({
      cacheTime: 0,
      pollingInterval: 0,
      chain: {
        id: chainId,
        name: 'ganache',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [] } },
      },
      transport: custom({ request: ({ method, params }) => prov.send(method, params ?? []) }),
    });
  }

  beforeEach(async () => {
    // A dedicated ganache instance, deterministic like helpers.js's setup(): getInitialAccounts()
    // exposes each account's private key, which the ethers Signers helpers.js hands out do not,
    // and the buyer's is what is needed to sign EIP-712 typed data with viem.
    //
    // `cacheTimeout: -1` disables ethers' BrowserProvider request coalescing. Without it, two
    // eth_getTransactionCount("pending") calls issued close together (as consecutive contract
    // deployments from the same signer do) can be served the same cached nonce, so the second
    // deployment computes the same CREATE address as the first and silently deploys over nothing
    // (the "mint" call then reverts against a MockNFT address that actually holds RelicPay code).
    // helpers.js's shared setup() does not hit this only because its provider instance happens to
    // be reused across many more awaits by the time any one test's deploys run; it is the same
    // caching, latent rather than absent.
    const g = ganache.provider({
      logging: { quiet: true },
      wallet: { deterministic: true, totalAccounts: 10, defaultBalance: 10000 },
      miner: { blockGasLimit: 30_000_000 },
      chain: { hardfork: 'shanghai' },
    });
    provider = new ethers.BrowserProvider(g, undefined, { cacheTimeout: -1 });
    provider.estimateGas = async () => 15000000n;

    const accounts = await provider.send('eth_accounts', []);
    const initial = g.getInitialAccounts();
    const keyFor = (address) => initial[address.toLowerCase()].secretKey;

    owner = new ethers.Wallet(keyFor(accounts[0]), provider);
    seller = new ethers.Wallet(keyFor(accounts[1]), provider);
    buyer = new ethers.Wallet(keyFor(accounts[2]), provider);
    buyerAccount = privateKeyToAccount(keyFor(accounts[2]));
    assert.strictEqual(buyerAccount.address.toLowerCase(), buyer.address.toLowerCase());

    rp = await deploy('RelicPay', [], owner);
    rpAddr = ethers.getAddress(await rp.getAddress());
    nft = await deploy('MockNFT', [], owner);
    await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();

    publicClient = await makeViemClient(provider);
    reader = createRelicPayReader({ publicClient, addresses: { relicPay: rpAddr } });
    quoter = createOfferQuoter({ publicClient, addresses: { relicPay: rpAddr }, reader });
  });

  async function mintToSeller() {
    const rc = await (await nft.connect(seller).mint(seller.address)).wait();
    const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
    await (await nft.connect(seller).approve(rpAddr, tokenId)).wait();
    return tokenId;
  }

  const USD_RATE = { currency: 'USD', rate: 5n * 10n ** 14n, rateDecimals: 18 };

  function listingFor(tokenId) {
    return {
      priceText: '$1,600.00',
      nftContract: nft.target,
      tokenId,
      seller: seller.address,
      physicalId: 'IBG-OPTIC-001',
    };
  }

  function createOnChain({ from = owner, seller: s, buyer: b, totalPrice, installmentCount, dueIntervalSeconds, gracePeriodSeconds, paymentMethod = 0, nftContract, tokenId }) {
    return rp.connect(from).createAgreementWithRWA(
      s,
      b,
      totalPrice,
      installmentCount,
      dueIntervalSeconds,
      gracePeriodSeconds,
      paymentMethod,
      {
        physicalId: 'IBG-OPTIC-001',
        nftContract,
        tokenId,
        metadataURI: 'ipfs://relic/1',
        ownershipTransferred: false,
        currentOwner: s,
      }
    );
  }

  it('a buyer-signed request matches the agreement the operator creates from it', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    const tokenId = await mintToSeller();

    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(tokenId),
      terms: { installmentCount: 3, dueIntervalSeconds: 30n * DAY, gracePeriodSeconds: 7n * DAY },
      rate: USD_RATE,
    });
    assert.strictEqual(q.ok, true, q.reason);

    const chainIdOnChain = Number(await provider.send('eth_chainId', []));
    const realDomain = buildDomain({ chainId: chainIdOnChain, verifyingContract: rpAddr });
    const requestId = randomBytes32();
    const message = buildAgreementRequest(q, { requestId, expiry: 4000000000n });
    const signature = await signAgreementRequest({ signTypedData: buyerAccount.signTypedData, domain: realDomain, message });

    const seenStore = createSeenRequestStore();
    const gate = await checkRequest({ domain: realDomain, message, signature, seenStore, now: 1n });
    assert.strictEqual(gate.ok, true);
    assert.strictEqual(gate.signer.toLowerCase(), buyer.address.toLowerCase());
    seenStore.remember(message.requestId, message.expiry);

    // The operator re-quotes the request's own terms before acting on it (ADR-004), rather than
    // trusting the stale quote embedded in the signature.
    const reQuote = await quoter.quote({
      buyer: message.buyer,
      listing: { nftContract: message.nftContract, tokenId: message.tokenId, seller: message.seller, price: message.totalPrice },
      terms: { installmentCount: message.installmentCount, dueIntervalSeconds: BigInt(message.dueIntervalSeconds), gracePeriodSeconds: BigInt(message.gracePeriodSeconds) },
      rate: { creditDenominated: true },
    });
    assert.strictEqual(reQuote.ok, true, reQuote.reason);

    const rc = await (await createOnChain({
      seller: message.seller,
      buyer: message.buyer,
      totalPrice: message.totalPrice,
      installmentCount: message.installmentCount,
      dueIntervalSeconds: message.dueIntervalSeconds,
      gracePeriodSeconds: message.gracePeriodSeconds,
      paymentMethod: message.paymentMethod,
      nftContract: message.nftContract,
      tokenId: message.tokenId,
    })).wait();
    const agreementId = findEvent(rc, rp, 'AgreementCreated').agreementId;

    const result = await verifyCreatedAgreement({ reader, agreementId, message });
    assert.strictEqual(result.matches, true, JSON.stringify(result.mismatches));

    // A resubmission of the same requestId is now a replay.
    assert.strictEqual(seenStore.hasSeen(message.requestId), true);
    const replay = await checkRequest({ domain: realDomain, message, signature, seenStore, now: 1n });
    assert.strictEqual(replay.ok, false);
    assert.strictEqual(replay.code, 'ALREADY_SEEN');
  });

  it('catches a created agreement whose terms diverge from what the buyer signed', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    const tokenId = await mintToSeller();

    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(tokenId),
      terms: { installmentCount: 3, dueIntervalSeconds: 30n * DAY, gracePeriodSeconds: 7n * DAY },
      rate: USD_RATE,
    });
    assert.strictEqual(q.ok, true, q.reason);

    const chainIdOnChain = Number(await provider.send('eth_chainId', []));
    const realDomain = buildDomain({ chainId: chainIdOnChain, verifyingContract: rpAddr });
    const message = buildAgreementRequest(q, { requestId: randomBytes32(), expiry: 4000000000n });

    // An operator (or a buggy relay) creates an agreement with a different installment count than
    // what was signed.
    const rc = await (await createOnChain({
      seller: message.seller,
      buyer: message.buyer,
      totalPrice: message.totalPrice,
      installmentCount: 5,
      dueIntervalSeconds: message.dueIntervalSeconds,
      gracePeriodSeconds: message.gracePeriodSeconds,
      nftContract: message.nftContract,
      tokenId: message.tokenId,
    })).wait();
    const agreementId = findEvent(rc, rp, 'AgreementCreated').agreementId;

    const result = await verifyCreatedAgreement({ reader, agreementId, message });
    assert.strictEqual(result.matches, false);
    assert.strictEqual(result.mismatches.length, 1);
    assert.strictEqual(result.mismatches[0].field, 'installmentCount');
  });

  it('a request signed for one deployment does not authorize a different one', async () => {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E18 })).wait();
    const tokenId = await mintToSeller();
    const q = await quoter.quote({
      buyer: buyer.address,
      listing: listingFor(tokenId),
      terms: { installmentCount: 3, dueIntervalSeconds: 30n * DAY },
      rate: USD_RATE,
    });
    assert.strictEqual(q.ok, true, q.reason);

    const chainIdOnChain = Number(await provider.send('eth_chainId', []));
    const domainA = buildDomain({ chainId: chainIdOnChain, verifyingContract: rpAddr });
    const otherDeployment = await deploy('RelicPay', [], owner);
    const domainB = buildDomain({ chainId: chainIdOnChain, verifyingContract: ethers.getAddress(await otherDeployment.getAddress()) });

    const message = buildAgreementRequest(q, { requestId: randomBytes32(), expiry: 4000000000n });
    const signature = await signAgreementRequest({ signTypedData: buyerAccount.signTypedData, domain: domainA, message });

    const gateWrongDomain = await checkRequest({ domain: domainB, message, signature, now: 1n });
    assert.strictEqual(gateWrongDomain.ok, false);
    assert.strictEqual(gateWrongDomain.code, 'SIGNER_MISMATCH');

    const gateRightDomain = await checkRequest({ domain: domainA, message, signature, now: 1n });
    assert.strictEqual(gateRightDomain.ok, true);
  });
});

}
