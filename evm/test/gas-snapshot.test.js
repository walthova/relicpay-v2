const assert = require('assert');
const { IMPL } = require('./helpers');
const { runSnapshot, render, parseSnapshot, compare } = require('../tools/gas-snapshot');

const EXPECTED_SECTIONS = [
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

const BLOCK_GAS_LIMIT = 30_000_000n;

// v2-only: this tool measures gas on the v2 contracts specifically (the
// optimization pass this feeds is scoped to v2, legacy stays frozen).
(IMPL === 'v2' ? describe : describe.skip)(`Gas snapshot tooling [${IMPL}]`, function () {
  this.timeout(180000);
  let rows;

  before(async () => {
    ({ rows } = await runSnapshot());
  });

  it('measures deployment gas for every v2 contract, within the block gas limit', () => {
    const deployment = rows.filter(r => r.section === 'Deployment');
    const names = deployment.map(r => r.label);
    for (const name of ['RelicRegistry', 'Bnpl', 'EnhancedBnpl', 'RelicPay', 'RelicPayGovernance', 'DeFiIntegration', 'PriceOracle', 'ChainlinkPriceAdapter']) {
      assert.ok(names.includes(name), `missing deployment gas measurement for ${name}`);
    }
    for (const r of deployment) {
      const gas = BigInt(r.gas);
      assert.ok(gas > 0n, `${r.label} deployment reported zero gas`);
      assert.ok(gas < BLOCK_GAS_LIMIT, `${r.label} deployment gas (${gas}) exceeds block gas limit`);
    }
  });

  it('measures gas for the core lifecycle calls on every contract', () => {
    const labels = new Set(rows.map(r => `${r.section}::${r.label}`));
    for (const expected of [
      'RelicRegistry::mintRelic',
      'Bnpl::createAgreement',
      'Bnpl::triggerDefault',
      'EnhancedBnpl::createAgreementWithCredit',
      'RelicPay::createAgreementWithRWA',
      'RelicPay::processPayment (final, manual + NFT transfer)',
      'RelicPayGovernance::queue',
      'RelicPayGovernance::execute',
      'DeFiIntegration::closeYieldPosition',
      'PriceOracle::batchUpdatePrices (2 assets)',
      'ChainlinkPriceAdapter::pushPrice',
      'ChainlinkPriceAdapter::pushAll (2 assets)',
    ]) {
      assert.ok(labels.has(expected), `missing gas measurement for ${expected}`);
    }
  });

  it('every measured operation reports positive gas under the block gas limit', () => {
    for (const r of rows) {
      const gas = BigInt(r.gas);
      assert.ok(gas > 0n, `${r.section}::${r.label} reported zero gas`);
      assert.ok(gas < BLOCK_GAS_LIMIT, `${r.section}::${r.label} (${gas}) exceeds block gas limit`);
    }
  });

  it('renders every section and round-trips through the snapshot parser', () => {
    const sections = new Set(rows.map(r => r.section));
    for (const s of EXPECTED_SECTIONS) assert.ok(sections.has(s), `missing section ${s}`);

    const text = render(rows);
    const parsed = parseSnapshot(text);
    for (const r of rows) {
      const key = `${r.section}::${r.label}`;
      assert.ok(parsed.has(key), `round-trip lost ${key}`);
      assert.equal(parsed.get(key), BigInt(r.gas), `round-trip changed gas for ${key}`);
    }

    // comparing a snapshot against itself must report neither regressions nor improvements
    const { regressions, improvements } = compare(parsed, rows);
    assert.equal(regressions.length, 0);
    assert.equal(improvements.length, 0);
  });
});
