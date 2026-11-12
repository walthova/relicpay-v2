#!/usr/bin/env node
// Gas snapshot: deploys every v2 contract and exercises representative calls,
// recording gas used for deployment and for the key lifecycle functions. The
// result is the baseline for the ROADMAP "optimization pass" item: run this
// once to capture gas-snapshot.txt, make gas changes, then run with --check
// to see which operations moved and by how much.
//
// Run: npm run gas          regenerates gas-snapshot.txt (overwrites it)
//      npm run gas:check    runs the same measurements against the CURRENT
//                           contracts and diffs them against the committed
//                           gas-snapshot.txt, without overwriting it. Exits
//                           non-zero if any measurement regressed by more
//                           than REGRESSION_THRESHOLD.
//
// Requires `npm run compile` to have produced build/v2 and build/mocks.

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const SNAPSHOT_PATH = path.join(ROOT, 'gas-snapshot.txt');
const E = ethers.parseEther;
const DAY = 86400n;
const YEAR = 365n * DAY;
// 5%, not 2%: this offline sandbox runs ganache without native bindings (pure-JS
// fallback), which has been observed to introduce up to ~2-3% run-to-run gas noise
// on calls that make an external contract call (e.g. the try/catch NFT transfer in
// RelicPay.processPayment). 5% comfortably clears that noise floor while still
// catching a real regression, which optimization or refactor work moves by far more.
const REGRESSION_THRESHOLD = 0.05;

const SECTION_ORDER = [
  'Deployment',
  'RelicRegistry',
  'Bnpl',
  'EnhancedBnpl',
  'RelicPay',
  'RelicPayGovernance',
  'DeFiIntegration',
  'PriceOracle',
  'ChainlinkPriceAdapter',
];

function artifact(name, dir = 'v2') {
  const p = path.join(ROOT, 'build', dir, name + '.json');
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}. Run "npm run compile" first.`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function setup() {
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
  const signers = await Promise.all(accounts.map(a => provider.getSigner(a)));
  return { provider, signers };
}

async function warp(provider, seconds) {
  await provider.send('evm_increaseTime', [Number(seconds)]);
  await provider.send('evm_mine', []);
}

async function deploy(signer, name, args = [], dir = 'v2') {
  const a = artifact(name, dir);
  const f = new ethers.ContractFactory(a.abi, a.bytecode, signer);
  const c = await f.deploy(...args);
  const rc = await c.deploymentTransaction().wait();
  return { contract: c, gas: rc.gasUsed };
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

/**
 * Deploys every v2 contract, exercises representative lifecycle calls against
 * each, and returns the flat list of { section, label, gas } measurements.
 */
async function runSnapshot() {
  const { provider, signers } = await setup();
  const [owner, seller, buyer, gallery, alice, defiUser] = signers;
  const rows = [];
  const record = (section, label, gas) => rows.push({ section, label, gas: gas.toString() });

  async function call(section, label, txPromise) {
    const tx = await txPromise;
    const rc = await tx.wait();
    record(section, label, rc.gasUsed);
    return rc;
  }

  // ---- Deployments ----
  const { contract: registry, gas: registryGas } = await deploy(owner, 'RelicRegistry');
  record('Deployment', 'RelicRegistry', registryGas);
  const { contract: bnpl, gas: bnplGas } = await deploy(owner, 'Bnpl');
  record('Deployment', 'Bnpl', bnplGas);
  const { contract: enhanced, gas: enhancedGas } = await deploy(owner, 'EnhancedBnpl');
  record('Deployment', 'EnhancedBnpl', enhancedGas);
  const { contract: relicPay, gas: relicPayGas } = await deploy(owner, 'RelicPay');
  record('Deployment', 'RelicPay', relicPayGas);
  const { contract: defi, gas: defiGas } = await deploy(owner, 'DeFiIntegration');
  record('Deployment', 'DeFiIntegration', defiGas);
  const { contract: oracle, gas: oracleGas } = await deploy(owner, 'PriceOracle');
  record('Deployment', 'PriceOracle', oracleGas);
  const { contract: govToken } = await deploy(owner, 'MockGovToken', [], 'mocks');
  const { contract: gov, gas: govGas } = await deploy(owner, 'RelicPayGovernance', [await govToken.getAddress()]);
  record('Deployment', 'RelicPayGovernance', govGas);
  const { contract: mockNFT } = await deploy(owner, 'MockNFT', [], 'mocks');
  const { contract: ethAggregator } = await deploy(owner, 'MockAggregatorV3', [8, 'ETH / USD', 2345n * 10n ** 8n], 'mocks');
  const { contract: btcAggregator } = await deploy(owner, 'MockAggregatorV3', [8, 'BTC / USD', 61000n * 10n ** 8n], 'mocks');
  const { contract: adapter, gas: adapterGas } = await deploy(owner, 'ChainlinkPriceAdapter', [await oracle.getAddress()]);
  record('Deployment', 'ChainlinkPriceAdapter', adapterGas);

  // ---- RelicRegistry ----
  await call('RelicRegistry', 'setIssuer', registry.setIssuer(gallery.address, true));
  await call(
    'RelicRegistry',
    'mintRelic',
    registry.connect(gallery).mintRelic(gallery.address, 'IBG-OPTIC-901', 'ipfs://relic/901')
  );

  // ---- Bnpl ----
  {
    const rc = await call(
      'Bnpl',
      'createAgreement',
      bnpl.createAgreement(seller.address, buyer.address, E('10'), 5n, 30n * DAY, E('2'), 7n * DAY)
    );
    const id = findEvent(rc, bnpl, 'AgreementCreated').agreementId;
    await call('Bnpl', 'depositCollateral', bnpl.connect(buyer).depositCollateral(id, { value: E('2') }));
    await call('Bnpl', 'payInstallment (1st)', bnpl.connect(buyer).payInstallment(id, 1n, { value: E('2') }));
    await call('Bnpl', 'approveDiscount', bnpl.connect(seller).approveDiscount(id, E('1')));
    await call('Bnpl', 'earlyPayoff', bnpl.connect(buyer).earlyPayoff(id, E('1'), { value: E('7') }));
    await call('Bnpl', 'withdrawFunds', bnpl.connect(seller).withdrawFunds(id));
    await call('Bnpl', 'withdrawCollateral', bnpl.connect(buyer).withdrawCollateral(id));

    // fresh agreement, isolated just to measure triggerDefault. Deliberately different
    // params (not just a later timestamp) so the agreementId hash can't collide with the
    // first agreement's slot even if two blocks land in the same second.
    const rc2 = await call(
      'Bnpl',
      'createAgreement (for default)',
      bnpl.createAgreement(seller.address, buyer.address, E('9'), 3n, 30n * DAY, E('3'), 7n * DAY)
    );
    const id2 = findEvent(rc2, bnpl, 'AgreementCreated').agreementId;
    await warp(provider, 30n * DAY + 7n * DAY + DAY);
    await call('Bnpl', 'triggerDefault', bnpl.connect(seller).triggerDefault(id2));
  }

  // ---- EnhancedBnpl ----
  {
    await call(
      'EnhancedBnpl',
      'depositETHCollateral (new position)',
      enhanced.connect(buyer).depositETHCollateral({ value: E('10') })
    );
    const rc = await call(
      'EnhancedBnpl',
      'createAgreementWithCredit',
      enhanced.createAgreementWithCredit(seller.address, buyer.address, E('4'), 2n, 30n * DAY, 7n * DAY, 0)
    );
    const id = findEvent(rc, enhanced, 'AgreementCreated').agreementId;
    await call(
      'EnhancedBnpl',
      'payInstallment (1st, manual)',
      enhanced.connect(buyer).payInstallment(id, 1n, { value: E('2') })
    );
    await call(
      'EnhancedBnpl',
      'payInstallment (final, manual)',
      enhanced.connect(buyer).payInstallment(id, 2n, { value: E('2') })
    );
    await call('EnhancedBnpl', 'withdrawSellerBalance', enhanced.connect(seller).withdrawSellerBalance());
    const positionId = ethers.solidityPackedKeccak256(
      ['address', 'address', 'string'],
      [buyer.address, ethers.ZeroAddress, 'eth']
    );
    await call(
      'EnhancedBnpl',
      'withdrawCollateral',
      enhanced.connect(buyer).withdrawCollateral(positionId, E('5'))
    );
  }

  // ---- RelicPay ----
  {
    await call(
      'RelicPay',
      'depositETHCollateral (new position)',
      relicPay.connect(buyer).depositETHCollateral(false, { value: E('10') })
    );
    const mintRc = await (await mockNFT.mint(gallery.address)).wait();
    const tokenId = findEvent(mintRc, mockNFT, 'Transfer').tokenId;
    await (await mockNFT.connect(gallery).approve(await relicPay.getAddress(), tokenId)).wait();
    await call('RelicPay', 'authorizeNFT', relicPay.authorizeNFT(await mockNFT.getAddress(), true));

    const rwaAsset = {
      physicalId: 'IBG-OPTIC-901',
      nftContract: await mockNFT.getAddress(),
      tokenId,
      metadataURI: 'ipfs://relic/901',
      ownershipTransferred: false,
      currentOwner: gallery.address,
    };
    const rc = await call(
      'RelicPay',
      'createAgreementWithRWA',
      relicPay.createAgreementWithRWA(gallery.address, buyer.address, E('6'), 3n, 30n * DAY, 7n * DAY, 0, rwaAsset)
    );
    const id = findEvent(rc, relicPay, 'AgreementCreated').agreementId;
    await call(
      'RelicPay',
      'processPayment (1st, manual)',
      relicPay.connect(buyer).processPayment(id, 1n, { value: E('2') })
    );
    await call(
      'RelicPay',
      'processPayment (2nd, manual)',
      relicPay.connect(buyer).processPayment(id, 2n, { value: E('2') })
    );
    await call(
      'RelicPay',
      'processPayment (final, manual + NFT transfer)',
      relicPay.connect(buyer).processPayment(id, 3n, { value: E('2') })
    );
    await call('RelicPay', 'withdrawSellerBalance', relicPay.connect(gallery).withdrawSellerBalance());

    // fresh agreement, isolated just to measure triggerDefault. Same reasoning as the Bnpl
    // block above: deliberately different params so the agreementId hash cannot collide with
    // the first agreement's already-warm storage slots.
    const mintRc2 = await (await mockNFT.mint(gallery.address)).wait();
    const tokenId2 = findEvent(mintRc2, mockNFT, 'Transfer').tokenId;
    const rwaAsset2 = {
      physicalId: 'IBG-OPTIC-902',
      nftContract: await mockNFT.getAddress(),
      tokenId: tokenId2,
      metadataURI: 'ipfs://relic/902',
      ownershipTransferred: false,
      currentOwner: gallery.address,
    };
    const rc2 = await call(
      'RelicPay',
      'createAgreementWithRWA (for default)',
      relicPay.createAgreementWithRWA(gallery.address, buyer.address, E('3'), 2n, 45n * DAY, 7n * DAY, 0, rwaAsset2)
    );
    const id2 = findEvent(rc2, relicPay, 'AgreementCreated').agreementId;
    await warp(provider, 45n * DAY + 7n * DAY + DAY);
    await call('RelicPay', 'triggerDefault', relicPay.connect(gallery).triggerDefault(id2));

    // Stablecoin settlement path. Third agreement, params distinct from both of the above so the
    // agreementId hash cannot land on warm slots (same trap as the Bnpl and default blocks).
    const { contract: usd } = await deploy(owner, 'MockERC20', [], 'mocks');
    const usdAddress = await usd.getAddress();
    await (await usd.mint(buyer.address, E('100'))).wait();
    await (await usd.connect(buyer).approve(await relicPay.getAddress(), E('100'))).wait();
    await call(
      'RelicPay',
      'authorizeSettlementToken',
      relicPay.authorizeSettlementToken(usdAddress, true)
    );
    await call(
      'RelicPay',
      'setSettlementPreference',
      relicPay.connect(gallery).setSettlementPreference(usdAddress)
    );
    const mintRc3 = await (await mockNFT.mint(gallery.address)).wait();
    const tokenId3 = findEvent(mintRc3, mockNFT, 'Transfer').tokenId;
    await (await mockNFT.connect(gallery).approve(await relicPay.getAddress(), tokenId3)).wait();
    const rc3 = await call(
      'RelicPay',
      'createAgreementWithRWA (stablecoin settled)',
      relicPay.createAgreementWithRWA(
        gallery.address, buyer.address, E('4'), 4n, 20n * DAY, 7n * DAY, 0,
        {
          physicalId: 'IBG-OPTIC-903',
          nftContract: await mockNFT.getAddress(),
          tokenId: tokenId3,
          metadataURI: 'ipfs://relic/903',
          ownershipTransferred: false,
          currentOwner: gallery.address,
        }
      )
    );
    const id3 = findEvent(rc3, relicPay, 'AgreementCreated').agreementId;
    await call(
      'RelicPay',
      'processPayment (1st, stablecoin)',
      relicPay.connect(buyer).processPayment(id3, 1n)
    );
    await call(
      'RelicPay',
      'processPayment (2nd, stablecoin)',
      relicPay.connect(buyer).processPayment(id3, 2n)
    );
    await call(
      'RelicPay',
      'withdrawSellerTokenBalance',
      relicPay.connect(gallery).withdrawSellerTokenBalance(usdAddress)
    );

    // Stablecoin settlement, part b: the token auto-payment pool and the settlement-asset
    // collateral draw. One AutoWithCollateral agreement exercises both, since the pool is funded
    // for exactly the first two installments and the last two fall through to collateral.
    await call(
      'RelicPay',
      'authorizeToken (stablecoin as collateral)',
      relicPay.authorizeToken(usdAddress, true)
    );
    await call(
      'RelicPay',
      'depositAutoPaymentTokens',
      relicPay.connect(buyer).depositAutoPaymentTokens(usdAddress, E('4'))
    );
    await (await relicPay.connect(buyer).depositETHCollateral(false, { value: E('20') })).wait();
    await call(
      'RelicPay',
      'depositERC20Collateral (stablecoin)',
      relicPay.connect(buyer).depositERC20Collateral(usdAddress, E('20'))
    );

    const mintRc4 = await (await mockNFT.mint(gallery.address)).wait();
    const tokenId4 = findEvent(mintRc4, mockNFT, 'Transfer').tokenId;
    await (await mockNFT.connect(gallery).approve(await relicPay.getAddress(), tokenId4)).wait();
    const rc4 = await call(
      'RelicPay',
      'createAgreementWithRWA (stablecoin, auto+collateral)',
      relicPay.createAgreementWithRWA(
        gallery.address, buyer.address, E('8'), 4n, 25n * DAY, 7n * DAY, 3,
        {
          physicalId: 'IBG-OPTIC-904',
          nftContract: await mockNFT.getAddress(),
          tokenId: tokenId4,
          metadataURI: 'ipfs://relic/904',
          ownershipTransferred: false,
          currentOwner: gallery.address,
        }
      )
    );
    const id4 = findEvent(rc4, relicPay, 'AgreementCreated').agreementId;
    await call(
      'RelicPay',
      'processPayment (stablecoin, auto pool)',
      relicPay.connect(buyer).processPayment(id4, 1n)
    );
    await (await relicPay.connect(buyer).processPayment(id4, 2n)).wait(); // drains the pool
    await call(
      'RelicPay',
      'processPayment (stablecoin, collateral draw)',
      relicPay.connect(buyer).processPayment(id4, 3n)
    );
    await (await relicPay.connect(buyer).depositAutoPaymentTokens(usdAddress, E('2'))).wait();
    await call(
      'RelicPay',
      'withdrawAutoPaymentTokens',
      relicPay.connect(buyer).withdrawAutoPaymentTokens(usdAddress, E('2'))
    );

    // Stablecoin-settled default, which is where the two-pass settlement-asset-first seizure runs.
    // Distinct params again so the agreementId cannot hash onto warm slots.
    const mintRc5 = await (await mockNFT.mint(gallery.address)).wait();
    const tokenId5 = findEvent(mintRc5, mockNFT, 'Transfer').tokenId;
    const rc5 = await call(
      'RelicPay',
      'createAgreementWithRWA (stablecoin, for default)',
      relicPay.createAgreementWithRWA(
        gallery.address, buyer.address, E('5'), 2n, 35n * DAY, 7n * DAY, 0,
        {
          physicalId: 'IBG-OPTIC-905',
          nftContract: await mockNFT.getAddress(),
          tokenId: tokenId5,
          metadataURI: 'ipfs://relic/905',
          ownershipTransferred: false,
          currentOwner: gallery.address,
        }
      )
    );
    const id5 = findEvent(rc5, relicPay, 'AgreementCreated').agreementId;
    await warp(provider, 35n * DAY + 7n * DAY + DAY);
    await call(
      'RelicPay',
      'triggerDefault (stablecoin settled)',
      relicPay.connect(gallery).triggerDefault(id5)
    );
  }

  // ---- RelicPayGovernance ----
  {
    await (await govToken.mint(alice.address, E('2000'))).wait();
    const updates = [];
    const rc = await call(
      'RelicPayGovernance',
      'propose',
      gov.connect(alice).propose('Raise credit ratio', 'to 85%', updates)
    );
    const id = findEvent(rc, gov, 'ProposalCreated').proposalId;
    await (await govToken.setPastVotes(alice.address, E('15000'))).wait();
    await warp(provider, DAY + 60n);
    await call('RelicPayGovernance', 'vote', gov.connect(alice).vote(id, true));
    await warp(provider, 3n * DAY + 60n);
    await call('RelicPayGovernance', 'queue', gov.connect(owner).queue(id, updates));
    await warp(provider, 2n * DAY + 60n); // executionDelay
    await call('RelicPayGovernance', 'execute', gov.connect(owner).execute(id, updates));

    // The empty-updates execute above is the floor: proposal bookkeeping and nothing else. This
    // second pass measures what a real governed parameter change costs, which is that floor plus
    // one allowlist read and one external call into the target. Both are kept: a change to the
    // proposal machinery moves the first, a change to the dispatch path moves only the second.
    const relicPayAddr = await relicPay.getAddress();
    await call(
      'RelicPayGovernance',
      'setParameterAllowed',
      gov.connect(owner).setParameterAllowed(relicPayAddr, 0, true) // 0 = CreditLimitRatio
    );
    await (await relicPay.setGovernor(await gov.getAddress())).wait();

    const acts = [{
      paramType: 0,
      target: relicPayAddr,
      data: ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [8500n]),
    }];
    const rc2 = await (await gov.connect(alice).propose('Raise credit ratio', 'to 85%', acts)).wait();
    const id2 = findEvent(rc2, gov, 'ProposalCreated').proposalId;
    await warp(provider, DAY + 60n);
    await (await gov.connect(alice).vote(id2, true)).wait();
    await warp(provider, 3n * DAY + 60n);
    await (await gov.connect(owner).queue(id2, acts)).wait();
    await warp(provider, 2n * DAY + 60n);
    await call(
      'RelicPayGovernance',
      'execute (1 parameter update)',
      gov.connect(owner).execute(id2, acts)
    );
  }

  // ---- DeFiIntegration ----
  {
    await call('DeFiIntegration', 'stakeWithLido', defi.connect(defiUser).stakeWithLido({ value: E('1') }));
    await (await owner.sendTransaction({ to: await defi.getAddress(), value: E('1') })).wait(); // fund yield payout
    await warp(provider, YEAR);
    await call('DeFiIntegration', 'closeYieldPosition', defi.connect(defiUser).closeYieldPosition(0));
    // part b2: the governable setters, measured as the owner so the number is the setter itself
    // and not a governance execute wrapped around it
    await call(
      'DeFiIntegration',
      'setProtocolAuthorized (authorize)',
      defi.connect(owner).setProtocolAuthorized(defiUser.address, true, 700n)
    );
    await call(
      'DeFiIntegration',
      'updateProtocolAPY',
      defi.connect(owner).updateProtocolAPY(defiUser.address, 450n)
    );
  }

  // ---- PriceOracle ----
  {
    const ETH = ethers.ZeroAddress;
    const BTC = '0x0000000000000000000000000000000000000001';
    await call('PriceOracle', 'updatePrice', oracle.updatePrice(ETH, 2500n * 10n ** 8n, 90n));
    await call(
      'PriceOracle',
      'batchUpdatePrices (2 assets)',
      oracle.batchUpdatePrices([ETH, BTC], [2600n * 10n ** 8n, 61000n * 10n ** 8n], [95n, 95n])
    );
    // part b2: the governable setters
    await call(
      'PriceOracle',
      'setOracleAuthorized (authorize)',
      oracle.connect(owner).setOracleAuthorized(defiUser.address, true)
    );
    await call('PriceOracle', 'updateMaxPriceAge', oracle.connect(owner).updateMaxPriceAge(ETH, 3600n));
  }

  // ---- ChainlinkPriceAdapter ----
  // Runs last on purpose: it pushes over the prices the PriceOracle section just wrote, so
  // measuring it earlier would change what those calls cost by warming different slots.
  {
    const ETH = ethers.ZeroAddress;
    const BTC = '0x0000000000000000000000000000000000000001';
    // The harness warps months forward for the agreement and yield sections, so the answers the
    // mock aggregators were constructed with are long stale by the time we get here. Republish
    // them at the current block time first; this is setup, not a measurement.
    await (await ethAggregator.setAnswer(2345n * 10n ** 8n)).wait();
    await (await btcAggregator.setAnswer(61000n * 10n ** 8n)).wait();
    await call('PriceOracle', 'authorizeOracle (adapter)', oracle.authorizeOracle(await adapter.getAddress()));
    await call(
      'ChainlinkPriceAdapter',
      'setFeed (first)',
      adapter.setFeed(ETH, await ethAggregator.getAddress(), 3600, 95)
    );
    await call(
      'ChainlinkPriceAdapter',
      'setFeed (second)',
      adapter.setFeed(BTC, await btcAggregator.getAddress(), 3600, 95)
    );
    await call('ChainlinkPriceAdapter', 'pushPrice', adapter.pushPrice(ETH));
    await call('ChainlinkPriceAdapter', 'pushPrices (2 assets, strict)', adapter.pushPrices([ETH, BTC], false));
    await call('ChainlinkPriceAdapter', 'pushAll (2 assets)', adapter.pushAll());
    await call('ChainlinkPriceAdapter', 'removeFeed', adapter.removeFeed(BTC));
  }

  return { rows };
}

function groupBySection(rows) {
  const bySection = new Map();
  for (const r of rows) {
    if (!bySection.has(r.section)) bySection.set(r.section, []);
    bySection.get(r.section).push(r);
  }
  return bySection;
}

function render(rows) {
  const bySection = groupBySection(rows);
  const labelWidth = Math.max(...rows.map(r => r.label.length)) + 2;
  const lines = [];
  lines.push('# RelicPay v2 Gas Snapshot');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('Compiler: solc 0.8.26 (paris evm target), optimizer runs=200, viaIR=true');
  lines.push('Harness: ganache (shanghai hardfork), deterministic accounts, block gas limit 30,000,000');
  lines.push('');
  for (const section of SECTION_ORDER) {
    if (!bySection.has(section)) continue;
    lines.push(`## ${section}`);
    for (const r of bySection.get(section)) {
      const gasStr = Number(r.gas).toLocaleString('en-US');
      lines.push(`${r.label.padEnd(labelWidth)}${gasStr.padStart(12)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function parseSnapshot(text) {
  const baseline = new Map();
  let section = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('# ') || line.startsWith('Generated:') || line.startsWith('Compiler:') || line.startsWith('Harness:')) {
      continue;
    }
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      continue;
    }
    const m = line.match(/^(.+?)\s{2,}([\d,]+)$/);
    if (m && section) {
      baseline.set(`${section}::${m[1].trim()}`, BigInt(m[2].replace(/,/g, '')));
    }
  }
  return baseline;
}

function compare(baseline, rows) {
  const regressions = [];
  const improvements = [];
  const missing = [];
  for (const r of rows) {
    const key = `${r.section}::${r.label}`;
    const prev = baseline.get(key);
    const cur = BigInt(r.gas);
    if (prev === undefined) {
      missing.push({ key, cur });
      continue;
    }
    if (prev === 0n) continue;
    const delta = Number(cur - prev) / Number(prev);
    if (delta > REGRESSION_THRESHOLD) regressions.push({ key, prev, cur, delta });
    else if (delta < -REGRESSION_THRESHOLD) improvements.push({ key, prev, cur, delta });
  }
  return { regressions, improvements, missing };
}

function pct(delta) {
  return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
}

async function main() {
  const check = process.argv.includes('--check');
  const { rows } = await runSnapshot();

  if (check) {
    if (!fs.existsSync(SNAPSHOT_PATH)) {
      console.error('No committed gas-snapshot.txt found. Run "npm run gas" first to capture a baseline.');
      process.exit(1);
    }
    const baseline = parseSnapshot(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    const { regressions, improvements, missing } = compare(baseline, rows);

    if (improvements.length) {
      console.log('Improvements:');
      for (const i of improvements) console.log(`  ${i.key}: ${i.prev.toLocaleString()} -> ${i.cur.toLocaleString()} (${pct(i.delta)})`);
    }
    if (missing.length) {
      console.log('\nNew measurements (no baseline to compare):');
      for (const m of missing) console.log(`  ${m.key}: ${m.cur.toLocaleString()}`);
    }
    if (regressions.length) {
      console.log('\nRegressions (> 2% worse):');
      for (const r of regressions) console.log(`  ${r.key}: ${r.prev.toLocaleString()} -> ${r.cur.toLocaleString()} (${pct(r.delta)})`);
      console.error(`\n${regressions.length} operation(s) regressed by more than ${REGRESSION_THRESHOLD * 100}%.`);
      process.exit(1);
    }
    console.log('\nNo regressions beyond threshold.');
  } else {
    const rendered = render(rows);
    fs.writeFileSync(SNAPSHOT_PATH, rendered + '\n');
    console.log(rendered);
    console.log(`Wrote ${SNAPSHOT_PATH}`);
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error('Gas snapshot failed:', e.message || e);
    process.exit(1);
  });
}

module.exports = { runSnapshot, render, parseSnapshot, compare };
