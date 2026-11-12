// The request channel: what a buyer-signed request for an agreement is, how it reaches an
// operator, and how an operator checks a created agreement against it.
//
// Part b of the "Browser extension revival against v2 ABI" roadmap item. Framework free and
// `chrome.*` free, for the same reason extension/lib/offer.js is: the layer deciding whether a
// signature is real, fresh, unreplayed and matches what actually landed on chain has to be
// provable against a real chain without a browser.
//
// Read docs/ADR-004-extension-request-channel.md before changing the typed data shape. A field
// added to or removed from AGREEMENT_REQUEST_TYPES changes what a wallet renders to the buyer and
// changes the domain-separated hash for every request already in flight but not yet submitted.

const { verifyTypedData, recoverTypedDataAddress, hashTypedData } = require('viem');
const { encodePaymentMethod, decodePaymentMethod } = require('../../dashboard/lib/enums');

class RequestError extends Error {}

const PRIMARY_TYPE = 'AgreementRequest';

const AGREEMENT_REQUEST_TYPES = {
  AgreementRequest: [
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'nftContract', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'totalPrice', type: 'uint256' },
    { name: 'installmentCount', type: 'uint32' },
    { name: 'dueIntervalSeconds', type: 'uint32' },
    { name: 'gracePeriodSeconds', type: 'uint32' },
    { name: 'paymentMethod', type: 'uint8' },
    { name: 'requestId', type: 'bytes32' },
    { name: 'expiry', type: 'uint256' },
  ],
};

/**
 * Every way a request can be refused before (or instead of) reaching a signature check, and the
 * sentence each one earns. Distinct codes for the same reason offer.js's REFUSAL is: "this request
 * is no good" collapses a clock problem, a replay, a forged signature and a signer who is not the
 * named buyer into one message, and a buyer or operator debugging a rejected request needs to know
 * which of those four completely different problems they actually have.
 */
const REQUEST_REFUSAL = {
  EXPIRED: 'This request has expired. Ask for a new quote.',
  ALREADY_SEEN: 'This request has already been submitted.',
  SIGNATURE_INVALID: 'This request signature does not check out.',
  SIGNER_MISMATCH: 'This request was not signed by the buyer it names.',
};

function assertAddress(value, what) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new RequestError(`${what} must be an address, got ${value}`);
  }
  return value;
}

function assertBytes32(value, what) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new RequestError(`${what} must be a bytes32 hex string, got ${value}`);
  }
  return value;
}

/**
 * The EIP-712 domain a request is signed under. `verifyingContract` and `chainId` are what stop a
 * request signed for one RelicPay deployment from meaning anything for another: the typed-data hash
 * the buyer's wallet actually produces does not exist under a different domain, so recovering a
 * signer against the wrong domain yields a different address, not the buyer.
 */
function buildDomain({ chainId, verifyingContract, name = 'RelicPay', version = '1' } = {}) {
  if (chainId === undefined || chainId === null) throw new RequestError('chainId is required');
  assertAddress(verifyingContract, 'verifyingContract');
  return { name, version, chainId: Number(chainId), verifyingContract };
}

/**
 * The message half of a request, built from an accepted quote (extension/lib/offer.js's `quote()`
 * result with `ok: true`).
 *
 * Deliberately narrow: only fields `createAgreementWithRWA` reads, or the buyer needs to recognize
 * the deal, cross into the signed struct. `physicalId` and `metadataURI` are not contract-checked
 * (only `authorizedNFTs[nftContract]` is) and are left out of what the signature protects; see
 * ADR-004 for why a field the contract cannot enforce does not belong in the thing the buyer's
 * signature is supposed to be relying on.
 *
 * @param {object} quote an `ok: true` result from createOfferQuoter().quote()
 * @param {object} opts
 * @param {string} opts.requestId a bytes32 hex string, fresh per request, for operator dedupe only
 * @param {bigint|number} opts.expiry unix seconds after which the request is stale
 * @param {number|string} [opts.paymentMethod] a PaymentMethod label or its uint8, default 'Manual'
 */
function buildAgreementRequest(quote, { requestId, expiry, paymentMethod = 'Manual' } = {}) {
  if (!quote || quote.ok !== true) {
    throw new RequestError('quote must be an accepted quote (ok: true)');
  }
  assertBytes32(requestId, 'requestId');
  if (expiry === undefined || expiry === null) throw new RequestError('expiry is required');
  if (!quote.listing || !quote.listing.seller || !quote.listing.nftContract) {
    throw new RequestError('quote.listing must carry seller and nftContract');
  }

  return {
    buyer: quote.buyer,
    seller: quote.listing.seller,
    nftContract: quote.listing.nftContract,
    tokenId: BigInt(quote.listing.tokenId ?? 0),
    totalPrice: BigInt(quote.totalPrice),
    installmentCount: Number(quote.installmentCount),
    dueIntervalSeconds: Number(quote.dueIntervalSeconds),
    gracePeriodSeconds: Number(quote.gracePeriodSeconds),
    paymentMethod: typeof paymentMethod === 'string' ? encodePaymentMethod(paymentMethod) : Number(paymentMethod),
    requestId,
    expiry: BigInt(expiry),
  };
}

/**
 * Ask a wallet (or a viem local account, in tests) to sign the request. `signTypedData` is
 * injected rather than imported, on the same reasoning as offer.js taking a `publicClient`: this
 * module does not know whether the caller is a wagmi wallet client in a popup or a viem
 * `privateKeyToAccount` in a test, and it should not have to.
 */
async function signAgreementRequest({ signTypedData, domain, message }) {
  if (typeof signTypedData !== 'function') {
    throw new RequestError('signTypedData must be a function, e.g. a viem account or wallet client');
  }
  return signTypedData({ domain, types: AGREEMENT_REQUEST_TYPES, primaryType: PRIMARY_TYPE, message });
}

/** The EIP-712 hash of a request, for callers that want it directly (logging, dedupe by hash). */
function hashAgreementRequest({ domain, message }) {
  return hashTypedData({ domain, types: AGREEMENT_REQUEST_TYPES, primaryType: PRIMARY_TYPE, message });
}

/** Recover the address that produced `signature` over this exact domain and message. */
async function recoverRequestSigner({ domain, message, signature }) {
  return recoverTypedDataAddress({
    domain,
    types: AGREEMENT_REQUEST_TYPES,
    primaryType: PRIMARY_TYPE,
    message,
    signature,
  });
}

/** Whether `signature` was produced by `expectedSigner` over this exact domain and message. */
async function verifyRequestSignature({ domain, message, signature, expectedSigner }) {
  try {
    return await verifyTypedData({
      address: expectedSigner,
      domain,
      types: AGREEMENT_REQUEST_TYPES,
      primaryType: PRIMARY_TYPE,
      message,
      signature,
    });
  } catch {
    return false;
  }
}

/** now (unix seconds, default the real clock) against `message.expiry`. */
function checkFreshness(message, { now } = {}) {
  const t = now === undefined || now === null ? BigInt(Math.floor(Date.now() / 1000)) : BigInt(now);
  if (t > BigInt(message.expiry)) return { ok: false, code: 'EXPIRED', reason: REQUEST_REFUSAL.EXPIRED };
  return { ok: true };
}

/**
 * An in-memory replay guard for `requestId`s an operator has already accepted for submission.
 * Deliberately the simplest thing that can be correct: a Map keyed by requestId, so an operator
 * backing this with persistent storage can implement the same three methods against a database
 * without touching anything else in this module.
 */
function createSeenRequestStore() {
  const seen = new Map(); // requestId -> expiry (bigint), so a sweep can drop entries once stale

  return {
    hasSeen(requestId) {
      return seen.has(requestId);
    },
    remember(requestId, expiry) {
      seen.set(requestId, BigInt(expiry));
    },
    // Drop entries whose request has already expired: once a requestId's expiry has passed, no
    // future resubmission of it could pass checkFreshness anyway, so remembering it forever would
    // only leak memory.
    sweep(now) {
      const t = BigInt(now);
      for (const [id, expiry] of seen) {
        if (expiry < t) seen.delete(id);
      }
    },
    size() {
      return seen.size;
    },
  };
}

/**
 * The full pre-chain gate an operator runs before treating a submitted request as anything more
 * than noise: freshness, then replay, then signature, in that order because each check is cheaper
 * than the one after it and a request failing an early one should never pay for a later one.
 *
 * This does NOT authorize creating an agreement. It only establishes that the request is real,
 * current, and actually signed by the buyer it names. Per ADR-004, the operator still has to
 * re-quote the request's own terms against live chain state before acting on it.
 */
async function checkRequest({ domain, message, signature, seenStore, now }) {
  const fresh = checkFreshness(message, { now });
  if (!fresh.ok) return fresh;

  if (seenStore && seenStore.hasSeen(message.requestId)) {
    return { ok: false, code: 'ALREADY_SEEN', reason: REQUEST_REFUSAL.ALREADY_SEEN };
  }

  let signer;
  try {
    signer = await recoverRequestSigner({ domain, message, signature });
  } catch {
    return { ok: false, code: 'SIGNATURE_INVALID', reason: REQUEST_REFUSAL.SIGNATURE_INVALID };
  }

  if (String(signer).toLowerCase() !== String(message.buyer).toLowerCase()) {
    return { ok: false, code: 'SIGNER_MISMATCH', reason: REQUEST_REFUSAL.SIGNER_MISMATCH, signer };
  }

  return { ok: true, signer };
}

/**
 * BigInt fields, JSON-safe, for the one hop in this system that is not a `chrome.*` structured
 * clone: the HTTP body between the service worker and an operator's endpoint.
 */
function serializeRequest({ domain, message, signature }) {
  return {
    domain,
    message: {
      buyer: message.buyer,
      seller: message.seller,
      nftContract: message.nftContract,
      tokenId: message.tokenId.toString(),
      totalPrice: message.totalPrice.toString(),
      installmentCount: message.installmentCount,
      dueIntervalSeconds: message.dueIntervalSeconds,
      gracePeriodSeconds: message.gracePeriodSeconds,
      paymentMethod: message.paymentMethod,
      requestId: message.requestId,
      expiry: message.expiry.toString(),
    },
    signature,
  };
}

/** The inverse of serializeRequest. Refuses rather than guessing on a malformed payload. */
function deserializeRequest(payload) {
  if (!payload || typeof payload !== 'object') throw new RequestError('payload must be an object');
  const { domain, message: m, signature } = payload;
  if (!domain || !m || !signature) {
    throw new RequestError('payload must carry domain, message and signature');
  }
  return {
    domain,
    message: {
      buyer: m.buyer,
      seller: m.seller,
      nftContract: m.nftContract,
      tokenId: BigInt(m.tokenId),
      totalPrice: BigInt(m.totalPrice),
      installmentCount: Number(m.installmentCount),
      dueIntervalSeconds: Number(m.dueIntervalSeconds),
      gracePeriodSeconds: Number(m.gracePeriodSeconds),
      paymentMethod: Number(m.paymentMethod),
      requestId: m.requestId,
      expiry: BigInt(m.expiry),
    },
    signature,
  };
}

/**
 * POST a signed request to an operator endpoint. Transport-agnostic beyond "HTTP POST of the
 * serialized envelope": per ADR-004, this module does not pick the endpoint or authenticate the
 * operator, both of which are deployment concerns.
 */
async function submitRequest({ endpoint, domain, message, signature, fetchImpl } = {}) {
  if (!endpoint) throw new RequestError('endpoint is required');
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : undefined);
  if (typeof doFetch !== 'function') {
    throw new RequestError('no fetch implementation available; pass fetchImpl explicitly');
  }

  const res = await doFetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(serializeRequest({ domain, message, signature })),
  });

  if (!res.ok) {
    let detail = null;
    try {
      detail = await res.json();
    } catch {
      // no JSON body to parse; report the bare status
    }
    throw new RequestError(
      `operator rejected the request (${res.status})${detail && detail.reason ? `: ${detail.reason}` : ''}`
    );
  }

  return res.json();
}

/**
 * Compare a created agreement (a dashboard/lib reader's `getAgreement` result) against the signed
 * terms it is supposed to fulfil. Returns every mismatch found, not just the first, since a buyer
 * disputing a created agreement needs the whole diff, not the first field the comparison happened
 * to check.
 *
 * `agreementId` cannot be predicted from a request (it hashes in `block.timestamp` and a
 * contract-side nonce neither party controls at signing time), which is why this compares the
 * agreement's own fields rather than an expected id. See ADR-004.
 */
function matchAgreementToRequest({ agreement, message }) {
  if (!agreement) throw new RequestError('agreement is required');
  if (!message) throw new RequestError('message is required');

  const mismatches = [];
  const eqAddress = (field, actual, expected) => {
    if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
      mismatches.push({ field, actual, expected });
    }
  };
  const eqValue = (field, actual, expected) => {
    if (actual !== expected) mismatches.push({ field, actual, expected });
  };

  eqAddress('seller', agreement.seller, message.seller);
  eqAddress('buyer', agreement.buyer, message.buyer);
  eqValue('totalPrice', agreement.totalPrice, BigInt(message.totalPrice));
  eqValue('installmentCount', BigInt(agreement.installmentCount), BigInt(message.installmentCount));
  eqValue('dueIntervalSeconds', BigInt(agreement.dueIntervalSeconds), BigInt(message.dueIntervalSeconds));
  eqValue('gracePeriodSeconds', BigInt(agreement.gracePeriodSeconds), BigInt(message.gracePeriodSeconds));

  // reader.getAgreement returns `paymentMethod` as a paymentMethodTraits() object ({ label, ... }),
  // not a bare label, so both shapes are accepted here: the traits object from a real reader, and a
  // plain label string for a caller building a fixture by hand.
  const paymentMethodLabel =
    typeof agreement.paymentMethod === 'string' ? agreement.paymentMethod : agreement.paymentMethod?.label;
  eqValue('paymentMethod', encodePaymentMethod(paymentMethodLabel), Number(message.paymentMethod));

  if (agreement.relic) {
    eqAddress('nftContract', agreement.relic.nftContract, message.nftContract);
    eqValue('tokenId', BigInt(agreement.relic.tokenId), BigInt(message.tokenId));
  } else {
    mismatches.push({ field: 'relic', actual: null, expected: 'an RWA-backed agreement' });
  }

  return { matches: mismatches.length === 0, mismatches };
}

/** Read the created agreement and match it against the request in one call. */
async function verifyCreatedAgreement({ reader, agreementId, message, at }) {
  const agreement = await reader.getAgreement(agreementId, { at });
  return { ...matchAgreementToRequest({ agreement, message }), agreement };
}

module.exports = {
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
  decodePaymentMethod,
};
