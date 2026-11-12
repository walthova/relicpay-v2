// Address book for the dashboard.
//
// DeployAll.s.sol already writes deployments/<network>.txt as key=value lines, and the demo script
// already reads it. Rather than invent a second format (a JSON file the deploy script would have to
// start emitting, which means the deploy script and the dashboard can disagree about which one is
// current), this parses the same file the deploy script writes. One artifact, one writer.
//
// Resolution order, most specific first:
//   1. explicit `overrides` passed by the caller
//   2. environment variables (NEXT_PUBLIC_RELICPAY_ADDRESS and friends), for deploys that were not
//      done through DeployAll or for pointing a hosted dashboard at a different stack without a
//      rebuild
//   3. the parsed deployments/<network>.txt
// Nothing is hardcoded. A wrong hardcoded address on a money contract is the failure mode where
// everything looks like it works and the funds went somewhere else.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// Keys as DeployAll.s.sol writes them, mapped to the names the dashboard uses.
const KEY_MAP = {
  RELIC_REGISTRY: 'relicRegistry',
  RELIC_PAY: 'relicPay',
  PRICE_ORACLE: 'priceOracle',
  DEFI_INTEGRATION: 'defiIntegration',
  GOVERNANCE: 'governance',
  CHAINLINK_ADAPTER: 'chainlinkAdapter',
};

const ENV_MAP = {
  relicRegistry: ['NEXT_PUBLIC_RELIC_REGISTRY_ADDRESS', 'RELIC_REGISTRY_ADDRESS'],
  relicPay: ['NEXT_PUBLIC_RELICPAY_ADDRESS', 'RELICPAY_ADDRESS'],
  priceOracle: ['NEXT_PUBLIC_PRICE_ORACLE_ADDRESS', 'PRICE_ORACLE_ADDRESS'],
  defiIntegration: ['NEXT_PUBLIC_DEFI_INTEGRATION_ADDRESS', 'DEFI_INTEGRATION_ADDRESS'],
  governance: ['NEXT_PUBLIC_GOVERNANCE_ADDRESS', 'GOVERNANCE_ADDRESS'],
  chainlinkAdapter: ['NEXT_PUBLIC_CHAINLINK_ADAPTER_ADDRESS', 'CHAINLINK_ADAPTER_ADDRESS'],
};

const ZERO = '0x0000000000000000000000000000000000000000';

class AddressError extends Error {}

function isAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

// EIP-55 checksum. The dashboard renders these to the user and passes them to viem, which rejects
// a mixed-case address whose checksum does not validate. Normalising here means a deployments file
// written in any casing cannot produce a runtime error three layers away in a read call.
function checksum(address, keccak256) {
  if (!isAddress(address)) throw new AddressError(`not an address: ${address}`);
  const lower = address.slice(2).toLowerCase();
  if (typeof keccak256 !== 'function') return '0x' + lower;
  const hash = keccak256(lower).replace(/^0x/, '');
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

/**
 * Parse a deployments/<network>.txt body. Tolerates blank lines, `#` comments and surrounding
 * whitespace; anything else that is not KEY=VALUE is an error rather than a silent skip, because a
 * malformed line in an address file is far more likely to be a truncated write than a comment
 * somebody forgot to prefix.
 */
function parseDeployments(text) {
  const out = {};
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) throw new AddressError(`deployments line ${i + 1} is not KEY=VALUE: ${line}`);
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const name = KEY_MAP[key];
    if (!name) continue; // unknown keys are informational (DEPLOYER, CHAIN_ID, notes)
    if (!isAddress(value)) throw new AddressError(`deployments key ${key} is not an address: ${value}`);
    out[name] = value;
  }
  return out;
}

function readDeploymentsFile(network, { root = ROOT } = {}) {
  const p = path.join(root, 'deployments', `${network}.txt`);
  if (!fs.existsSync(p)) return {};
  return parseDeployments(fs.readFileSync(p, 'utf8'));
}

function fromEnv(env) {
  const out = {};
  for (const [name, keys] of Object.entries(ENV_MAP)) {
    for (const key of keys) {
      const value = env[key];
      if (value === undefined || value === '') continue;
      if (!isAddress(value)) throw new AddressError(`${key} is not an address: ${value}`);
      out[name] = value;
      break;
    }
  }
  return out;
}

/**
 * Build the address book.
 *
 * `require` names the contracts this caller cannot function without. A missing address is thrown at
 * resolve time with the contract named, rather than surfacing later as an eth_call to the zero
 * address that returns empty data and decodes into a confusing "0 agreements, 0 collateral"
 * dashboard. The zero address is treated as missing for the same reason: DeployAll writes
 * GOVERNANCE=0x0 for an ungoverned deploy, which is a legitimate state to render as "not deployed",
 * never as a contract to call.
 */
function resolveAddresses({
  network = 'sepolia',
  overrides = {},
  env = typeof process !== 'undefined' ? process.env : {},
  root = ROOT,
  require: required = ['relicPay'],
  keccak256,
} = {}) {
  const file = readDeploymentsFile(network, { root });
  const merged = { ...file, ...fromEnv(env) };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) continue;
    if (!isAddress(value)) throw new AddressError(`override ${name} is not an address: ${value}`);
    merged[name] = value;
  }

  const out = {};
  for (const [name, value] of Object.entries(merged)) {
    if (value.toLowerCase() === ZERO) continue;
    out[name] = checksum(value, keccak256);
  }

  const missing = required.filter((name) => !out[name]);
  if (missing.length) {
    throw new AddressError(
      `no address for ${missing.join(', ')} on network "${network}". ` +
        `Set ${missing.map((m) => (ENV_MAP[m] || ['?'])[0]).join(', ')} or run script/DeployAll.s.sol.`
    );
  }
  return out;
}

module.exports = {
  AddressError,
  ENV_MAP,
  KEY_MAP,
  ZERO,
  checksum,
  isAddress,
  parseDeployments,
  readDeploymentsFile,
  resolveAddresses,
};
