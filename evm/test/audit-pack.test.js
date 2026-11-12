// Audit pack: the generated attack-surface file must be current, the source parser must agree with
// the compiled ABI, and the facts the hand-written prep doc leans on must still hold.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pack = require('../tools/audit-pack');

if (process.env.IMPL === 'v2') {
  describe('audit pack', () => {
    const root = path.join(__dirname, '..');

    it('docs/audit/SURFACE.md is current with contracts/', () => {
      assert.strictEqual(fs.readFileSync(pack.OUT, 'utf8'), pack.build());
    });

    it('source parser finds every state-changing ABI function', () => {
      assert.deepStrictEqual(pack.crossCheck(), []);
    });

    it('parser reads modifiers across returns clauses and multi-line headers', () => {
      const fns = pack.parseFunctions(`
        contract X {
          function a(uint256 x) external onlyOwner returns (uint256) { return x; }
          function b(
            uint256 x,
            address y
          ) external payable nonReentrant returns (bool ok) { return true; }
          function c() external view returns (uint256) { return 1; }
          function d() internal { }
        }
        interface I { function e() external; }`);
      const byName = Object.fromEntries(fns.map(f => [f.name, f]));
      assert.deepStrictEqual(Object.keys(byName).sort(), ['a', 'b', 'c']);
      assert.deepStrictEqual(byName.a.mods, ['onlyOwner']);
      assert.deepStrictEqual(byName.b.mods, ['nonReentrant']);
      assert.strictEqual(byName.b.payable, true);
      assert.strictEqual(byName.c.mutates, false);
    });

    it('createAgreementWithRWA stays owner-only and the open functions are the reviewed set', () => {
      const src = fs.readFileSync(path.join(root, 'contracts', 'RelicPay.sol'), 'utf8');
      const fns = pack.parseFunctions(src).filter(f => f.mutates);
      const create = fns.find(f => f.name === 'createAgreementWithRWA');
      assert.deepStrictEqual(create.mods, ['onlyOwner']);
      const open = fns.filter(f => !f.mods.some(m => m !== 'nonReentrant') && !f.inline).map(f => f.name).sort();
      assert.deepStrictEqual(open, ['processOverduePayments', 'processPayment']);
    });

    it('prep doc and surface file contain no em dashes and point at real files', () => {
      for (const f of ['docs/AUDIT_PREP.md', 'docs/audit/SURFACE.md']) {
        const t = fs.readFileSync(path.join(root, f), 'utf8');
        assert.ok(!t.includes('—'), f + ' has an em dash');
      }
      const prep = fs.readFileSync(path.join(root, 'docs', 'AUDIT_PREP.md'), 'utf8');
      for (const ref of ['docs/audit/SURFACE.md', 'docs/RELICPAY_SPEC.md', 'docs/ADR-009-collateral-valuation.md', 'docs/ADR-010-yield-backed-draws.md', 'test/fuzz.test.js', 'test/yield-backing.test.js']) {
        assert.ok(prep.includes(ref), 'prep doc should reference ' + ref);
        assert.ok(fs.existsSync(path.join(root, ref)), ref + ' missing');
      }
    });
  });
}
