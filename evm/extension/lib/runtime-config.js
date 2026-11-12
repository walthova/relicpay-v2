// Operator config the shell runs on, validated. Part c2b.
//
// extension/config.json carries the origin lists the manifest is built from (ADR-005) and a
// `deployment` block the shell runs on: which RelicPay, which chain, where requests go, what the
// credit unit is, and each seller's rate. All of it is operator-set and none of it ever comes from a
// page (ADR-003, ADR-006). This module turns the raw JSON into the objects worker.js and the popup
// take, and refuses a config that would let an origin or an address drift out from under the
// manifest: the operator endpoint and RPC URL must sit inside the origins the manifest grants, and
// the shipped placeholder RelicPay address (zero) is refused so an unconfigured build cannot sign.
//
// Chrome free and framework free.

const { getAddress } = require('viem');

class ConfigError extends Error {}

const ZERO = /^0x0{40}$/i;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function originOf(url, what) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new ConfigError(`${what} is not a URL: ${url}`);
  }
  if (u.protocol !== 'https:') throw new ConfigError(`${what} must be https, got ${u.protocol}`);
  return u.origin;
}

function positiveInt(v, what) {
  if (!Number.isInteger(v) || v <= 0) throw new ConfigError(`${what} must be a positive integer`);
  return v;
}

/**
 * @param {object} raw  parsed extension/config.json
 * @returns {{worker: object, unit: object, rpcUrl: string, requestTtlSeconds: number,
 *            walletOrigins: string[], addresses: {relicPay: string}}}
 */
function buildRuntimeConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new ConfigError('config must be an object');
  const d = raw.deployment;
  if (!d || typeof d !== 'object') throw new ConfigError('config.deployment is required');

  const chainId = positiveInt(d.chainId, 'deployment.chainId');
  if (typeof d.relicPay !== 'string' || !ADDRESS.test(d.relicPay) || ZERO.test(d.relicPay)) {
    throw new ConfigError('deployment.relicPay must be a real RelicPay address (the shipped zero placeholder is refused)');
  }
  const relicPay = getAddress(d.relicPay);

  const operatorOrigin = originOf(d.operatorEndpoint, 'deployment.operatorEndpoint');
  if (!(raw.operatorOrigins || []).includes(operatorOrigin)) {
    throw new ConfigError(`deployment.operatorEndpoint origin ${operatorOrigin} is not in operatorOrigins, so the manifest would not allow it`);
  }
  const rpcOrigin = originOf(d.rpcUrl, 'deployment.rpcUrl');
  if (!(raw.rpcOrigins || []).includes(rpcOrigin)) {
    throw new ConfigError(`deployment.rpcUrl origin ${rpcOrigin} is not in rpcOrigins, so the manifest would not allow it`);
  }

  const unit = d.unit;
  if (!unit || typeof unit.symbol !== 'string' || !/^[A-Za-z0-9]{1,8}$/.test(unit.symbol) || !Number.isInteger(unit.decimals) || unit.decimals < 0 || unit.decimals > 36) {
    throw new ConfigError('deployment.unit must be { symbol, decimals }');
  }

  const t = d.terms || {};
  const terms = {
    installmentCount: positiveInt(t.installmentCount, 'terms.installmentCount'),
    dueIntervalSeconds: BigInt(positiveInt(t.dueIntervalSeconds, 'terms.dueIntervalSeconds')),
    gracePeriodSeconds: BigInt(Number.isInteger(t.gracePeriodSeconds) && t.gracePeriodSeconds >= 0 ? t.gracePeriodSeconds : (() => { throw new ConfigError('terms.gracePeriodSeconds must be a non-negative integer'); })()),
  };

  const rates = {};
  for (const [seller, r] of Object.entries(d.rates || {})) {
    if (!ADDRESS.test(seller)) throw new ConfigError(`rates key ${seller} is not an address`);
    if (r && r.creditDenominated === true) {
      rates[seller.toLowerCase()] = { creditDenominated: true };
    } else if (r && typeof r.currency === 'string' && /^\d+$/.test(String(r.rate)) && BigInt(r.rate) > 0n) {
      rates[seller.toLowerCase()] = {
        currency: r.currency,
        rate: BigInt(r.rate),
        rateDecimals: Number.isInteger(r.rateDecimals) ? r.rateDecimals : 18,
      };
    } else {
      throw new ConfigError(`rate for ${seller} must be { creditDenominated: true } or { currency, rate, rateDecimals }`);
    }
  }

  return {
    worker: {
      chainId,
      relicPay,
      operatorEndpoint: d.operatorEndpoint,
      sellerOrigins: [...(raw.sellerOrigins || [])],
      terms,
      rates,
    },
    unit: { symbol: unit.symbol, decimals: unit.decimals },
    rpcUrl: d.rpcUrl,
    requestTtlSeconds: positiveInt(d.requestTtlSeconds === undefined ? 900 : d.requestTtlSeconds, 'requestTtlSeconds'),
    walletOrigins: [...(raw.walletOrigins || [])],
    addresses: { relicPay },
  };
}

module.exports = { ConfigError, buildRuntimeConfig };
