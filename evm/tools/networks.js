// Live networks the off-chain tools (demo, pilot) can target, and where each one's DeployAll output lives.
// ADR-011: Base Sepolia is the dress rehearsal for Base mainnet; Sepolia stays for the older deploy.
// A tool that talks to a live chain checks the RPC's chain id against this table before it sends
// anything, so a Base Sepolia run cannot silently land on Sepolia because of a stale RPC_URL.
//
// script/DeployAll.s.sol keeps the same names and chain ids (DEPLOY_NETWORK). test/networks.test.js
// fails if the two tables drift.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const NETWORKS = {
  sepolia: { chainId: 11155111n, label: 'Sepolia' },
  'base-sepolia': { chainId: 84532n, label: 'Base Sepolia' },
};

function resolveNetwork(name) {
  if (!Object.prototype.hasOwnProperty.call(NETWORKS, name)) {
    throw new Error(`unknown network "${name}", expected one of: ${Object.keys(NETWORKS).join(', ')}`);
  }
  return { name, ...NETWORKS[name] };
}

function deploymentsPath(name) {
  resolveNetwork(name);
  return path.join(ROOT, 'deployments', `${name}.txt`);
}

// key=value file DeployAll writes. Missing file returns null so each caller words its own error.
function readDeployments(name) {
  const p = deploymentsPath(name);
  if (!fs.existsSync(p)) return null;
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const [k, v] = line.split('=');
    if (k && v) out[k.trim()] = v.trim();
  }
  return out;
}

// Throws unless the provider is on the chain the named network expects.
async function assertChain(provider, name) {
  const net = resolveNetwork(name);
  const got = (await provider.getNetwork()).chainId;
  if (got !== net.chainId) {
    throw new Error(`RPC_URL is chain ${got} but --network ${name} expects ${net.chainId} (${net.label})`);
  }
  return net;
}

// Value following --network in argv, or null.
function networkArg(argv) {
  const i = argv.indexOf('--network');
  return i === -1 ? null : argv[i + 1] || null;
}

module.exports = { NETWORKS, resolveNetwork, deploymentsPath, readDeployments, assertChain, networkArg };
