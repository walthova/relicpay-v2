// Server-side viem client and the one function a page calls.
//
// Per docs/ADR-001-dashboard-reads.md, reads run in server components, so the RPC URL lives here
// and never reaches the browser bundle. The env var is deliberately RPC_URL and not
// NEXT_PUBLIC_RPC_URL: the NEXT_PUBLIC_ prefix is what inlines a value into client JavaScript, and
// a keyed endpoint inlined into the bundle is handed to every visitor. The address book already
// accepts NEXT_PUBLIC_* names because addresses are public; an endpoint is not.

const { createPublicClient, http, keccak256, toBytes } = require('viem');
const { resolveAddresses } = require('./addresses');
const { createRelicPayReader } = require('./reader');
const { createTokenRegistry } = require('./tokens');
const { presentBuyerDashboard, presentSellerDashboard, assertSerializable } = require('./present');

class ClientError extends Error {}

const CHAINS = {
  sepolia: { id: 11155111, name: 'Sepolia' },
  mainnet: { id: 1, name: 'Ethereum' },
  base: { id: 8453, name: 'Base' },
  'base-sepolia': { id: 84532, name: 'Base Sepolia' },
  local: { id: 1337, name: 'Local' },
};

function chainFor(network) {
  const c = CHAINS[network];
  if (!c) throw new ClientError(`unknown network "${network}", expected one of ${Object.keys(CHAINS).join(', ')}`);
  return {
    id: c.id,
    name: c.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [] } },
  };
}

/**
 * @param {object} opts
 * @param {string} [opts.network] key into CHAINS, defaults to $NETWORK then sepolia
 * @param {string} [opts.rpcUrl] defaults to $RPC_URL
 * @param {object} [opts.transport] a viem transport, for tests driving ganache over EIP-1193
 */
function createServerClient({ network, rpcUrl, transport, env = process.env } = {}) {
  const net = network || env.NETWORK || 'sepolia';
  const chain = chainFor(net);
  const url = rpcUrl || env.RPC_URL;
  if (!transport && !url) {
    throw new ClientError('set RPC_URL (server-side only, not NEXT_PUBLIC_RPC_URL) or pass a transport');
  }
  return {
    network: net,
    chain,
    publicClient: createPublicClient({ chain, transport: transport || http(url) }),
  };
}

/**
 * Everything a buyer or seller page needs, already serializable.
 *
 * One call, one block. The reader takes the pin, the token registry is resolved after the reader
 * has finished (metadata is immutable, so it is the one read that does not belong inside the pin),
 * and the presenter formats. `assertSerializable` runs here rather than in the page so a BigInt
 * that escapes the presenter is named at its path instead of surfacing inside React's serializer.
 *
 * `fromBlock` matters on a public network: agreement discovery scans AgreementCreated from this
 * block, and scanning Sepolia from 0 is minutes of eth_getLogs for a handful of agreements. Set
 * DEPLOY_BLOCK to the block DeployAll landed in.
 */
async function loadDashboard(
  address,
  { role = 'buyer', network, rpcUrl, transport, env = process.env, blockNumber, seedTokens } = {}
) {
  if (role !== 'buyer' && role !== 'seller') {
    throw new ClientError(`role must be buyer or seller, got ${role}`);
  }
  const { publicClient, network: net, chain } = createServerClient({ network, rpcUrl, transport, env });
  // addresses.js checksums only when it is handed a keccak256, and falls back to lowercase
  // otherwise so it stays dependency-free. Here viem is already loaded, so pass it: EIP-55 hashes
  // the ASCII text of the lowercased address, hence toBytes on a string rather than a hex decode.
  const addresses = resolveAddresses({
    network: net,
    env,
    keccak256: (hex) => keccak256(toBytes(hex)),
  });
  const fromBlock = env.DEPLOY_BLOCK ? BigInt(env.DEPLOY_BLOCK) : 0n;
  const reader = createRelicPayReader({ publicClient, addresses, fromBlock });

  const raw =
    role === 'buyer'
      ? await reader.getBuyerDashboard(address, { blockNumber })
      : await reader.getSellerDashboard(address, { blockNumber });

  const registry = createTokenRegistry({ publicClient, seed: seedTokens });
  const tokens = await registry.loadForDashboard(raw);

  const view = role === 'buyer'
    ? presentBuyerDashboard(raw, { tokens })
    : presentSellerDashboard(raw, { tokens });

  return assertSerializable({ ...view, network: net, chainId: chain.id, contract: addresses.relicPay });
}

module.exports = { CHAINS, ClientError, chainFor, createServerClient, loadDashboard };
