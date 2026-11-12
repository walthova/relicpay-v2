#!/usr/bin/env node
// RelicPay v2 MVP demo: mint relic -> collateral -> agreement -> payments -> ownership transfer.
//
// Two ways to run it:
//   node tools/demo.js                     local, offline ganache instance, deploys fresh contracts.
//                                           Run `npm run compile` first (reads build/v2/*.json).
//   node tools/demo.js --network sepolia   attaches to the addresses in deployments/sepolia.txt
//   node tools/demo.js --network base-sepolia   same, from deployments/base-sepolia.txt (ADR-011 rehearsal)
//                                           (written by script/DeployAll.s.sol). RPC_URL must be on the
//                                           chain id of the named network. Needs RPC_URL and
//                                           PRIVATE_KEY env vars (the deployer: RelicRegistry issuer +
//                                           RelicPay owner). Optional GALLERY_KEY / BUYER_KEY give the
//                                           seller and buyer roles their own funded wallets; without
//                                           them the deployer wallet plays all three parts, which still
//                                           exercises every call but collapses the ownership-transfer
//                                           story onto one address.
//
// Exports runDemo() + setupLocal()/setupSepolia() so the characterization suite (test/demo.test.js)
// can run the exact same walkthrough in-process and assert on the outcome.

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { resolveNetwork, readDeployments, assertChain } = require('./networks');

const ROOT = path.join(__dirname, '..');
const E = ethers.parseEther;
const DAY = 86400n;

function heading(step, msg) {
  console.log(`\n[${step}/5] ${msg}`);
}

function line(msg) {
  console.log(`      -> ${msg}`);
}

function artifact(name) {
  const p = path.join(ROOT, 'build', 'v2', name + '.json');
  if (!fs.existsSync(p)) {
    throw new Error(`Missing ${p}. Run "npm run compile" first.`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function findEvent(receipt, contract, name) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed && parsed.name === name) return parsed.args;
    } catch (_) {}
  }
  return null;
}

async function deployLocal(signer, name, args = []) {
  const a = artifact(name);
  const f = new ethers.ContractFactory(a.abi, a.bytecode, signer);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  return c;
}

function attach(runner, name, address) {
  const a = artifact(name);
  return new ethers.Contract(address, a.abi, runner);
}

function parseDeployments(network) {
  const out = readDeployments(network);
  if (!out) {
    throw new Error(
      `deployments/${network}.txt not found. Run script/DeployAll.s.sol with DEPLOY_NETWORK=${network} first (see README).`
    );
  }
  return out;
}

async function setupLocal() {
  const ganache = require('ganache');
  const g = ganache.provider({
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 10, defaultBalance: 10000 },
    miner: { blockGasLimit: 30_000_000 },
    chain: { hardfork: 'shanghai' },
  });
  const provider = new ethers.BrowserProvider(g);
  provider.estimateGas = async () => 15000000n;
  const accounts = await provider.send('eth_accounts', []);
  const [owner, gallery, buyer] = await Promise.all(
    accounts.slice(0, 3).map(a => provider.getSigner(a))
  );

  const registry = await deployLocal(owner, 'RelicRegistry');
  const relicPay = await deployLocal(owner, 'RelicPay');
  await (await registry.connect(owner).setIssuer(gallery.address, true)).wait();
  await (await relicPay.connect(owner).authorizeNFT(await registry.getAddress(), true)).wait();

  return {
    network: 'local',
    owner,
    gallery,
    buyer,
    registry,
    relicPay,
    warp: async seconds => {
      await provider.send('evm_increaseTime', [Number(seconds)]);
      await provider.send('evm_mine', []);
    },
  };
}

async function setupLive(network = 'sepolia') {
  resolveNetwork(network);
  const rpcUrl = process.env.RPC_URL;
  const pk = process.env.PRIVATE_KEY;
  if (!rpcUrl || !pk) {
    throw new Error('RPC_URL and PRIVATE_KEY env vars are required for --network ' + network);
  }
  const addrs = parseDeployments(network);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  await assertChain(provider, network);
  const owner = new ethers.Wallet(pk, provider); // deployer: RelicRegistry issuer + RelicPay owner
  const gallery = process.env.GALLERY_KEY ? new ethers.Wallet(process.env.GALLERY_KEY, provider) : owner;
  const buyer = process.env.BUYER_KEY ? new ethers.Wallet(process.env.BUYER_KEY, provider) : owner;

  if (gallery.address === owner.address || buyer.address === owner.address) {
    console.warn(
      'Warning: GALLERY_KEY and/or BUYER_KEY not set. The deployer wallet is filling in for the ' +
        'missing role(s), so the ownership-transfer step will not visibly move the relic between ' +
        'distinct addresses. Fund and set both env vars for the full three-party demo.'
    );
  }

  const registry = attach(owner, 'RelicRegistry', addrs.RELIC_REGISTRY);
  const relicPay = attach(owner, 'RelicPay', addrs.RELIC_PAY);

  if (gallery.address !== owner.address && !(await registry.issuers(gallery.address))) {
    await (await registry.setIssuer(gallery.address, true)).wait();
  }

  return {
    network,
    owner,
    gallery,
    buyer,
    registry,
    relicPay,
    warp: async () => {}, // real chain time; v2 allows early payment so no waiting is needed
  };
}

/**
 * Runs the full MVP walkthrough against an already-wired {registry, relicPay, owner, gallery, buyer}.
 * Returns the key on-chain facts so callers (CLI output or test/demo.test.js) can verify the outcome.
 */
async function runDemo(ctx) {
  const { registry, relicPay, owner, gallery, buyer, warp, network } = ctx;
  const results = {};

  heading(1, `Minting an Optic Relic on RelicRegistry (network: ${network})...`);
  const mintRc = await (
    await registry.connect(gallery).mintRelic(gallery.address, 'IBG-OPTIC-001', 'ipfs://relic/1')
  ).wait();
  const tokenId = findEvent(mintRc, registry, 'RelicMinted').tokenId;
  results.tokenId = tokenId;
  line(`Relic #${tokenId} minted to gallery ${gallery.address} (physicalId: IBG-OPTIC-001)`);

  await (await registry.connect(gallery).approve(await relicPay.getAddress(), tokenId)).wait();
  line(`Gallery approved RelicPay to move relic #${tokenId} once the agreement completes`);

  heading(2, 'Buyer deposits ETH collateral...');
  await (await relicPay.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
  const creditLine = await relicPay.getCreditLine(buyer.address);
  results.creditLimit = creditLine.creditLimit;
  line(`Credit line: ${ethers.formatEther(creditLine.creditLimit)} ETH available`);

  heading(3, 'Creating a BNPL agreement backed by the relic (6 ETH over 3 monthly installments)...');
  const rwaAsset = {
    physicalId: 'IBG-OPTIC-001',
    nftContract: await registry.getAddress(),
    tokenId,
    metadataURI: 'ipfs://relic/1',
    ownershipTransferred: false,
    currentOwner: gallery.address,
  };
  const agreeRc = await (
    await relicPay
      .connect(owner)
      .createAgreementWithRWA(gallery.address, buyer.address, E('6'), 3n, 30n * DAY, 7n * DAY, 0, rwaAsset)
  ).wait();
  const agreementId = findEvent(agreeRc, relicPay, 'AgreementCreated').agreementId;
  results.agreementId = agreementId;
  line(`Agreement ${agreementId} created (seller: ${gallery.address}, buyer: ${buyer.address})`);

  heading(4, 'Buyer pays installments...');
  for (let n = 1; n <= 3; n++) {
    await warp(30n * DAY);
    await (await relicPay.connect(buyer).processPayment(agreementId, n, { value: E('2') })).wait();
    line(`Installment ${n}/3 paid (2 ETH)`);
  }

  heading(5, 'Verifying the outcome...');
  const agreement = await relicPay.getAgreement(agreementId);
  const relicOwner = await registry.ownerOf(tokenId);
  const sellerBalance = await relicPay.getSellerBalance(gallery.address);
  results.finalState = agreement.state;
  results.relicOwner = relicOwner;
  results.sellerBalance = sellerBalance;
  line(`Agreement state: ${['Active', 'Completed', 'Defaulted'][Number(agreement.state)]}`);
  line(`Relic #${tokenId} owner: ${relicOwner} (buyer: ${buyer.address})`);
  line(`Seller balance owed: ${ethers.formatEther(sellerBalance)} ETH`);

  await (await relicPay.connect(gallery).withdrawSellerBalance()).wait();
  line('Seller withdrew proceeds.');

  console.log('\n=== Demo complete: relic tokenized, financed, and ownership transferred on-chain. ===\n');
  return results;
}

async function main() {
  const idx = process.argv.indexOf('--network');
  const network = idx !== -1 ? process.argv[idx + 1] : process.env.NETWORK || 'local';
  console.log('=== RelicPay v2 MVP Demo ===');
  const ctx = network === 'local' ? await setupLocal() : await setupLive(network);
  await runDemo(ctx);
}

if (require.main === module) {
  main().catch(e => {
    console.error('Demo failed:', e.message || e);
    process.exit(1);
  });
}

const setupSepolia = () => setupLive('sepolia');

module.exports = { runDemo, setupLocal, setupLive, setupSepolia };
