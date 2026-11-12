const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const ganache = require('ganache');

const IMPL = process.env.IMPL || 'legacy';
const ROOT = path.join(__dirname, '..');

let provider, signers;

async function setup() {
  const g = ganache.provider({
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 10, defaultBalance: 10000 },
    miner: { blockGasLimit: 30_000_000 },
    chain: { hardfork: 'shanghai' },
  });
  provider = new ethers.BrowserProvider(g);
  // ganache's estimateGas runs against a block whose timestamp ignores evm_increaseTime;
  // pin a generous gas limit so txs are mined and reverts surface via receipt status.
  provider.estimateGas = async () => 15000000n;
  const accounts = await provider.send('eth_accounts', []);
  signers = await Promise.all(accounts.map(a => provider.getSigner(a)));
  return { provider, signers };
}

function artifact(name, dir) {
  const d = dir || (['MockERC20','MockStablecoin','MockNFT','MockGovToken','MockAggregatorV3','MockVotesToken','MockSmartWallet'].includes(name) ? 'mocks' : IMPL);
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'build', d, name + '.json'), 'utf8'));
}

async function deploy(name, args = [], signer = signers[0], value = 0n) {
  const a = artifact(name);
  const f = new ethers.ContractFactory(a.abi, a.bytecode, signer);
  const c = await f.deploy(...args, { value });
  await c.waitForDeployment();
  return c;
}

async function warp(seconds) {
  await provider.send('evm_increaseTime', [Number(seconds)]);
  await provider.send('evm_mine', []);
}

// Read a block timestamp over the raw RPC rather than provider.getBlock(). ethers caches the
// "latest" block for its poll interval, so after evm_increaseTime getBlock('latest') can hand
// back a stale timestamp while an eth_call on the same node already sees the advanced clock.
// Anything asserting an exact time-dependent value needs the un-cached number.
async function latestTimestamp() {
  const b = await provider.send('eth_getBlockByNumber', ['latest', false]);
  return BigInt(b.timestamp);
}

async function blockTimestamp(blockNumber) {
  const tag = '0x' + BigInt(blockNumber).toString(16);
  const b = await provider.send('eth_getBlockByNumber', [tag, false]);
  return BigInt(b.timestamp);
}

async function expectRevert(promise, match) {
  try {
    const tx = await promise;
    if (tx && tx.wait) await tx.wait();
  } catch (e) {
    const msg = (e && (e.message || '')) + JSON.stringify(e && e.info || {}) + (e && e.data || '');
    if (match && !msg.includes(match)) {
      // custom errors surface as data selectors; accept any revert when selector unknown
      if (!/revert|reverted|invalid opcode|VM Exception/i.test(msg)) {
        throw new Error(`Reverted but message mismatch. wanted "${match}" got: ${msg.slice(0, 400)}`);
      }
    }
    return;
  }
  throw new Error('Expected revert, but tx succeeded' + (match ? ` (wanted ${match})` : ''));
}

// Assert the exact revert reason.
//
// expectRevert above can only prove "something reverted": estimateGas is stubbed out (see setup),
// so a failing transaction comes back as a receipt with status 0 and no revert data at all, and
// its `match` argument silently degrades to "accept any revert". An eth_call does carry the
// revert data, so pass a `.staticCall(...)` here to pin down which error actually fired. A
// staticCall that reverts is proof the transaction would revert for the same reason.
//
// `expected` is either a custom error name ("UnauthorizedCaller", parameterless) or a require
// string, which is matched as a substring of the decoded Error(string) payload.
async function expectCustomError(staticCallPromise, expected) {
  const ERROR_STRING_SELECTOR = '0x08c379a0';
  try {
    await staticCallPromise;
  } catch (e) {
    const data = e && e.data;
    if (typeof data !== 'string' || !data.startsWith('0x')) {
      throw new Error(`Reverted without decodable data, wanted "${expected}". Got: ${(e && e.message || '').slice(0, 300)}`);
    }
    if (data.startsWith(ERROR_STRING_SELECTOR)) {
      const [reason] = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + data.slice(10));
      if (!reason.includes(expected)) {
        throw new Error(`Reverted with require("${reason}"), wanted "${expected}"`);
      }
      return;
    }
    const selector = ethers.id(expected + '()').slice(0, 10);
    if (data.slice(0, 10) !== selector) {
      throw new Error(`Reverted with ${data.slice(0, 10)}, wanted ${expected} (${selector})`);
    }
    return;
  }
  throw new Error(`Expected revert "${expected}", but the call succeeded`);
}

// find event args in receipt by contract interface + event name
function findEvent(receipt, contract, name) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed && parsed.name === name) return parsed.args;
    } catch (_) {}
  }
  return null;
}

const E = ethers.parseEther;

async function bal(addr) {
  return BigInt(await provider.send('eth_getBalance', [addr, 'latest']));
}

module.exports = { setup, bal, deploy, warp, latestTimestamp, blockTimestamp, expectRevert, expectCustomError, findEvent, E, IMPL, artifactDir: () => IMPL, getProvider: () => provider, getSigners: () => signers, ethers };
