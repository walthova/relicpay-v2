// Monitoring: every event is classified, the committed catalog is current, scan turns real chain
// activity into the right severities, and health catches a stale oracle and role drift.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mon = require('../tools/monitor');
const { setup, deploy, warp, E } = require('./helpers');

const ZERO = '0x0000000000000000000000000000000000000000';
// Raw RPC, not provider.getBlockNumber(): ethers caches the latest block between polls.
const head = async p => parseInt(await p.send('eth_blockNumber', []), 16);
const P = n => BigInt(n) * 10n ** 8n;   // oracle prices are USD scaled by 1e8

if (process.env.IMPL === 'v2') {
  describe('monitoring', function () {
    this.timeout(120000);
    const root = path.join(__dirname, '..');

    describe('catalog', () => {
      it('every event of every scoped contract has a rule and no rule is dead', () => {
        assert.deepStrictEqual(mon.buildCatalog().missing, []);
        assert.deepStrictEqual(mon.staleRules(), []);
      });

      it('monitoring/alerts.json is current and uses only known severities', () => {
        assert.strictEqual(fs.readFileSync(mon.OUT, 'utf8'), mon.render());
        const cat = JSON.parse(fs.readFileSync(mon.OUT, 'utf8'));
        let pages = 0;
        for (const evs of Object.values(cat.contracts)) {
          for (const e of evs) {
            assert.ok(mon.SEVERITIES.includes(e.severity), e.signature);
            assert.ok(e.why && !e.why.includes('\u2014'), e.signature + ' has no reason or an em dash');
            if (e.severity === 'page') pages++;
          }
        }
        assert.ok(pages >= 10, 'expected a meaningful page tier, got ' + pages);
      });

      it('authority and funds-at-risk events are paged, user activity is not', () => {
        const sev = (c, name) => mon.buildCatalog().catalog.contracts[c].filter(e => e.event === name).map(e => e.severity);
        assert.deepStrictEqual(sev('RelicPay', 'PriceOracleUpdated'), ['page']);
        assert.deepStrictEqual(sev('RelicPay', 'GovernorUpdated'), ['page']);
        assert.deepStrictEqual(sev('PriceOracle', 'OracleAuthorized'), ['page']);
        assert.deepStrictEqual(sev('RelicPayGovernance', 'ProposalExecuted'), ['page']);
        assert.deepStrictEqual(sev('RelicPayGovernance', 'TimelockParametersUpdated'), ['page']);
        assert.deepStrictEqual(sev('RelicPay', 'CollateralDeposited'), ['info']);
        assert.deepStrictEqual(sev('RelicPay', 'PaymentProcessed'), ['info']);
        assert.deepStrictEqual(sev('RelicPay', 'AgreementDefaulted'), ['warn']);
        // The two same-named OwnershipTransferred events are classified apart.
        assert.deepStrictEqual(sev('RelicPay', 'OwnershipTransferred').sort(), ['info', 'page']);
      });
    });

    describe('scan', () => {
      let s, owner, other, oracle, rp, registry, addrs;

      beforeEach(async () => {
        s = await setup();
        [owner, other] = s.signers;
        oracle = await deploy('PriceOracle', [], owner);
        rp = await deploy('RelicPay', [], owner);
        registry = await deploy('RelicRegistry', [], owner);
        addrs = { PriceOracle: await oracle.getAddress(), RelicPay: await rp.getAddress(), RelicRegistry: await registry.getAddress() };
      });

      const names = a => a.map(x => x.contract + '.' + x.event + ':' + x.severity);

      it('pages on authority changes and warns on role changes, hiding info by default', async () => {
        const from = await head(s.provider);
        await (await oracle.authorizeOracle(other.address)).wait();                   // page
        await (await rp.setPriceOracle(addrs.PriceOracle)).wait();                    // page
        await (await registry.setIssuer(other.address, true)).wait();                 // warn
        await (await registry.connect(other).mintRelic(other.address, 'IBG-1', 'ipfs://x')).wait(); // info
        const to = await head(s.provider);

        const alerts = await mon.scan(s.provider, addrs, from + 1, to);
        assert.deepStrictEqual(names(alerts), [
          'PriceOracle.OracleAuthorized:page',
          'RelicPay.PriceOracleUpdated:page',
          'RelicRegistry.IssuerSet:warn',
        ]);
        assert.ok(alerts.every(a => a.why && a.txHash && a.blockNumber >= from + 1));

        const all = await mon.scan(s.provider, addrs, from + 1, to, { minSeverity: 'info' });
        assert.ok(names(all).includes('RelicRegistry.RelicMinted:info'));
        assert.ok(names(all).includes('RelicRegistry.Transfer:info'));
        // Oldest first.
        for (let i = 1; i < all.length; i++) assert.ok(all[i].blockNumber >= all[i - 1].blockNumber);
      });

      it('classifies inherited ownership and governor events', async () => {
        const from = await head(s.provider);
        await (await rp.setGovernor(other.address)).wait();
        await (await oracle.transferOwnership(other.address)).wait();
        const alerts = await mon.scan(s.provider, addrs, from + 1, await head(s.provider), { minSeverity: 'page' });
        assert.deepStrictEqual(names(alerts).sort(), [
          'PriceOracle.OwnershipTransferred:page',
          'RelicPay.GovernorUpdated:page',
        ]);
        assert.strictEqual(alerts.find(a => a.event === 'GovernorUpdated').args.newGovernor, other.address);
      });

      it('escalates a large price move between pushes and leaves a small one as info', async () => {
        const from = await head(s.provider);
        await (await oracle.updatePrice(ZERO, P(2000), 100)).wait();
        await (await oracle.updatePrice(ZERO, P(2100), 100)).wait();   // 5 percent
        await (await oracle.updatePrice(ZERO, P(1200), 100)).wait();   // about 43 percent down
        const alerts = await mon.scan(s.provider, { PriceOracle: addrs.PriceOracle }, from + 1, await head(s.provider), { minSeverity: 'info' });
        const updates = alerts.filter(a => a.event === 'PriceUpdated');
        assert.deepStrictEqual(updates.map(a => a.severity), ['info', 'info', 'page']);
        assert.ok(updates[2].why.includes('bps'));
      });

      it('price memory carries across windows when the caller reuses it', async () => {
        const memory = { prices: new Map() };
        await (await oracle.updatePrice(ZERO, P(2000), 100)).wait();
        const b1 = await head(s.provider);
        await mon.scan(s.provider, { PriceOracle: addrs.PriceOracle }, 0, b1, { memory, minSeverity: 'info' });
        await (await oracle.updatePrice(ZERO, P(900), 100)).wait();
        const b2 = await head(s.provider);
        const second = await mon.scan(s.provider, { PriceOracle: addrs.PriceOracle }, b2, b2, { memory });
        assert.deepStrictEqual(names(second), ['PriceOracle.PriceUpdated:page']);
      });

      it('rejects a contract outside the monitored scope', async () => {
        await assert.rejects(mon.scan(s.provider, { Bnpl: addrs.RelicPay }, 0, 1), /not a scoped contract/);
      });

      it('escalation rule: a seller withdrawal at the threshold pages, below it does not', () => {
        const mem = { prices: new Map() };
        const th = mon.DEFAULT_THRESHOLDS;
        assert.ok(mon.escalate('RelicPay', 'SellerWithdrawal', { amount: th.sellerWithdrawalWei }, mem, th));
        assert.strictEqual(mon.escalate('RelicPay', 'SellerWithdrawal', { amount: th.sellerWithdrawalWei - 1n }, mem, th), null);
        assert.strictEqual(mon.escalate('RelicPay', 'PaymentProcessed', { amount: th.sellerWithdrawalWei }, mem, th), null);
      });
    });

    describe('health', () => {
      let s, owner, other, oracle, rp;
      const targets = () => ({ relicPay: rp.target, priceOracle: oracle.target });

      beforeEach(async () => {
        s = await setup();
        [owner, other] = s.signers;
        oracle = await deploy('PriceOracle', [], owner);
        rp = await deploy('RelicPay', [], owner);
      });

      it('reports an unwired oracle as info only', async () => {
        const f = await mon.health(s.provider, targets());
        assert.deepStrictEqual(f.map(x => x.check + ':' + x.severity), ['ORACLE_UNWIRED:info']);
      });

      it('is clean with a fresh oracle, warns near the window and pages past it', async () => {
        await (await rp.setPriceOracle(oracle.target)).wait();
        await (await oracle.updatePrice(ZERO, P(2000), 100)).wait();
        assert.deepStrictEqual(await mon.health(s.provider, targets()), []);

        const info = await oracle.getAssetInfo(ZERO);
        const window = Number(info.maxPriceAge);
        await warp(Math.floor(window * 0.9));
        const soon = await mon.health(s.provider, targets());
        assert.deepStrictEqual(soon.map(x => x.check + ':' + x.severity), ['ORACLE_STALE_SOON:warn']);

        await warp(Math.ceil(window * 0.2));
        const stale = await mon.health(s.provider, targets());
        assert.deepStrictEqual(stale.map(x => x.check + ':' + x.severity), ['ORACLE_STALE:page']);

        await (await oracle.updatePrice(ZERO, P(2000), 100)).wait();
        assert.deepStrictEqual(await mon.health(s.provider, targets()), []);
      });

      it('pages when RelicPay points at a different oracle than expected', async () => {
        const rogue = await deploy('PriceOracle', [], owner);
        await (await rp.setPriceOracle(rogue.target)).wait();
        const f = await mon.health(s.provider, targets());
        assert.ok(f.some(x => x.check === 'ORACLE_MISMATCH' && x.severity === 'page'));
      });

      it('pages on owner and governor drift', async () => {
        await (await rp.setGovernor(other.address)).wait();
        const ok = await mon.health(s.provider, { ...targets(), expected: { owner: owner.address, governor: other.address } });
        assert.ok(!ok.some(x => x.severity === 'page'));
        const bad = await mon.health(s.provider, { ...targets(), expected: { owner: other.address, governor: owner.address } });
        assert.deepStrictEqual(bad.filter(x => x.severity === 'page').map(x => x.check).sort(), ['GOVERNOR_DRIFT', 'OWNER_DRIFT']);
      });
    });

    describe('deployments file and doc', () => {
      it('parses the key=value file DeployAll writes and drops a zero governance address', () => {
        const a = '0x' + '11'.repeat(20), z = '0x' + '00'.repeat(20);
        const book = mon.parseDeployments(['RELIC_REGISTRY=' + a, 'RELIC_PAY=' + a, 'GOVERNANCE=' + z, 'DEPLOYER=' + a, 'JUNK', ''].join('\n'));
        assert.deepStrictEqual(Object.keys(book).sort(), ['RelicPay', 'RelicRegistry']);
      });

      it('every DeployAll output key that names a scoped contract is understood', () => {
        const src = fs.readFileSync(path.join(root, 'script', 'DeployAll.s.sol'), 'utf8');
        const keys = [...src.matchAll(/"([A-Z_]+)=", vm\.toString/g)].map(m => m[1]).filter(k => k !== 'DEPLOYER');
        for (const k of keys) assert.ok(mon.DEPLOYMENT_KEYS[k], 'DeployAll writes ' + k + ' but the monitor cannot read it');
      });

      it('docs/MONITORING.md names every page-tier event, points at real files and has no em dash', () => {
        const doc = fs.readFileSync(path.join(root, 'docs', 'MONITORING.md'), 'utf8');
        assert.ok(!doc.includes('\u2014'), 'em dash in MONITORING.md');
        const { catalog } = mon.buildCatalog();
        for (const [c, evs] of Object.entries(catalog.contracts)) {
          for (const e of evs.filter(x => x.severity === 'page')) {
            assert.ok(doc.includes(e.event), 'doc does not mention page event ' + c + '.' + e.event);
          }
        }
        for (const ref of ['monitoring/alerts.json', 'tools/monitor.js', 'docs/ADR-009-collateral-valuation.md', 'docs/ADR-010-yield-backed-draws.md', 'docs/AUDIT_PREP.md']) {
          assert.ok(doc.includes(ref), 'doc should reference ' + ref);
          assert.ok(fs.existsSync(path.join(root, ref)), ref + ' missing');
        }
      });
    });
  });
}

