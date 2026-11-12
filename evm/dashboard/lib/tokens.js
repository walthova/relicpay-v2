// Settlement currency metadata.
//
// Every amount on an agreement is denominated in that agreement's settlement token and the contract
// does no conversion: `getSettlementTerms` hands back the raw schedule amount whatever the currency
// is. So `totalPrice: 3000000n` is three USDC or three millionths of an ETH depending entirely on a
// token address, and the only way to tell them apart is decimals(). Formatting without that is not
// a rounding problem, it is a six-orders-of-magnitude problem on a screen that tells someone what
// they owe.
//
// This fetches symbol/decimals once per address and caches. It is separate from reader.js because
// token metadata is immutable, so it is the one thing on the page that must NOT be re-read at the
// pinned block: caching it across renders is correct, and caching anything else is the bug the pin
// exists to prevent.

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

class TokenError extends Error {}

// Minimal ERC20 metadata surface. Not generated from build/v2: these are third-party tokens the
// protocol does not deploy, so there is no artifact to generate from.
const erc20MetadataAbi = [
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
];

/** Native ETH, the denomination of any agreement with no settlement token. */
const NATIVE = Object.freeze({
  address: null,
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  native: true,
  known: true,
});

/** What the presenter gets for a token nothing could be learned about. */
function unknownToken(address) {
  return Object.freeze({
    address,
    symbol: null,
    name: null,
    decimals: null,
    native: false,
    known: false,
  });
}

function lower(a) {
  return String(a).toLowerCase();
}

/**
 * A metadata lookup over a viem PublicClient.
 *
 * `seed` pre-populates entries so a deployment with known currencies never makes the calls, and so
 * the presenter can be tested without a chain.
 *
 * A token that does not answer symbol() or decimals() resolves to `unknownToken` rather than
 * throwing. A single non-compliant ERC20 in one agreement must not blank the whole dashboard, and
 * the presenter already renders `known: false` as "unknown currency" instead of inventing a number.
 * decimals() failing on its own is still unknown: a symbol with no decimals cannot be formatted.
 */
function createTokenRegistry({ publicClient, seed = {} } = {}) {
  const cache = new Map();
  for (const [address, meta] of Object.entries(seed)) {
    if (!Number.isInteger(meta.decimals)) {
      throw new TokenError(`seed for ${address} needs integer decimals`);
    }
    cache.set(lower(address), {
      address,
      symbol: meta.symbol ?? null,
      name: meta.name ?? meta.symbol ?? null,
      decimals: meta.decimals,
      native: false,
      known: true,
    });
  }

  const inflight = new Map();

  async function fetchOne(address) {
    const call = (functionName) =>
      publicClient.readContract({ address, abi: erc20MetadataAbi, functionName });

    const [symbol, decimals, name] = await Promise.all([
      call('symbol').catch(() => null),
      call('decimals').catch(() => null),
      call('name').catch(() => null),
    ]);
    if (decimals === null || decimals === undefined) return unknownToken(address);
    return {
      address,
      symbol: symbol ?? null,
      name: name ?? symbol ?? null,
      decimals: Number(decimals),
      native: false,
      known: true,
    };
  }

  /** One address. `null`, undefined or the zero address all mean native ETH. */
  async function get(address) {
    if (!address || lower(address) === ZERO_ADDRESS) return NATIVE;
    const key = lower(address);
    if (cache.has(key)) return cache.get(key);
    if (!publicClient) return unknownToken(address);
    if (!inflight.has(key)) {
      inflight.set(
        key,
        fetchOne(address)
          .then((meta) => {
            // An unknown is cached too. Retrying a non-compliant contract on every render just
            // multiplies the failed calls; a page reload is the retry.
            cache.set(key, meta);
            inflight.delete(key);
            return meta;
          })
          .catch((err) => {
            inflight.delete(key);
            throw err;
          })
      );
    }
    return inflight.get(key);
  }

  /** Resolve many, returning the plain `{lowercased address: meta}` map the presenter takes. */
  async function load(addresses) {
    const list = [...new Set((addresses || []).filter(Boolean).map((a) => String(a)))];
    const metas = await Promise.all(list.map((a) => get(a)));
    const out = {};
    list.forEach((a, i) => {
      out[lower(a)] = metas[i];
    });
    return out;
  }

  /**
   * Every currency a dashboard touches: the per-agreement settlement tokens plus any pool or
   * balance keyed by a token address. Collected from the dashboard object rather than passed in by
   * the caller, so a new balance map added to the reader does not silently render undenominated.
   */
  async function loadForDashboard(dashboard) {
    const addresses = [];
    for (const a of dashboard.agreements || []) {
      if (a.settlementToken) addresses.push(a.settlementToken);
    }
    if (dashboard.autoPayment) addresses.push(...Object.keys(dashboard.autoPayment.tokenBalances || {}));
    if (dashboard.balances) addresses.push(...Object.keys(dashboard.balances.tokens || {}));
    if (dashboard.settlementPreference) addresses.push(dashboard.settlementPreference);
    for (const p of dashboard.collateral || []) {
      if (p.token) addresses.push(p.token);
    }
    return load(addresses);
  }

  return { get, load, loadForDashboard, cache };
}

/**
 * Lookup against an already-resolved map, for the synchronous presenter. Unknown addresses are
 * `unknownToken`, never a guess.
 */
function tokenMetaFrom(tokens, address) {
  if (!address || lower(address) === ZERO_ADDRESS) return NATIVE;
  const meta = tokens && tokens[lower(address)];
  return meta || unknownToken(address);
}

module.exports = {
  NATIVE,
  TokenError,
  ZERO_ADDRESS,
  createTokenRegistry,
  erc20MetadataAbi,
  tokenMetaFrom,
  unknownToken,
};
