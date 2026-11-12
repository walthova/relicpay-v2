// ADR-011 is a decision record, so the checks here keep it honest: it must name its follow-ups,
// point at real files, and the facts it leans on in the build must still hold.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (process.env.IMPL === 'v2') {
  describe('ADR-011 L2 deployment decision', () => {
    const root = path.join(__dirname, '..');
    const adr = fs.readFileSync(path.join(root, 'docs', 'ADR-011-l2-deployment.md'), 'utf8');

    it('has no em dashes and references real files', () => {
      assert.ok(!adr.includes('—'), 'em dash found');
      for (const ref of ['tools/compile.js', 'docs/MONITORING.md', 'docs/DEVELOPMENT_PLAN.md', 'gas-snapshot.txt', 'script/', 'ROADMAP.md']) {
        assert.ok(adr.includes(ref), 'should reference ' + ref);
        assert.ok(fs.existsSync(path.join(root, ref.replace(/\/$/, ''))), ref + ' missing');
      }
    });

    it('the paris EVM claim matches the compiler settings', () => {
      assert.ok(fs.readFileSync(path.join(root, 'tools', 'compile.js'), 'utf8').includes("evmVersion: 'paris'"));
    });

    it('the sequencer gap it reports is real until the follow-up lands', () => {
      const src = fs.readFileSync(path.join(root, 'contracts', 'ChainlinkPriceAdapter.sol'), 'utf8');
      const roadmap = fs.readFileSync(path.join(root, 'ROADMAP.md'), 'utf8');
      const hasCheck = /sequencer/i.test(src);
      const queued = /sequencer uptime/i.test(roadmap);
      assert.ok(hasCheck || queued, 'sequencer risk must be either implemented or queued in ROADMAP.md');
    });

    it('names the recommendation, the alternatives and the owner decisions', () => {
      for (const s of ['Base mainnet', 'Arbitrum One', 'Ethereum L1', 'Owner decisions', 'Gate list']) {
        assert.ok(adr.includes(s), 'missing section text: ' + s);
      }
    });
  });
}
