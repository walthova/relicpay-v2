// Tests for the extension bundling step (tools/bundle-extension.js), part c2c of the browser
// extension revival. docs/ADR-008-extension-bundling.md is the spec this suite checks.
//
// v2 only. Builds into a temp directory so the suite never depends on, or leaves behind, a
// generated extension/dist. The point is that what ships is checked: every bad dist is built by
// mutating a good one, and each mutation must be refused by name.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { IMPL } = require('./helpers');
const { ENTRIES, STATIC, buildAll, bundle, verifyDist, referencedFiles } = require('../tools/bundle-extension');

const ROOT = path.join(__dirname, '..');
const codes = (res) => res.problems.map((p) => p.code);

(IMPL === 'v2' ? describe : describe.skip)('extension bundling (ADR-008)', function () {
  this.timeout(60000);
  let dist;
  let fresh;

  before(async () => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'relicpay-dist-'));
    await bundle(dist);
    fresh = await buildAll();
  });
  after(() => fs.rmSync(dist, { recursive: true, force: true }));

  // Each case works on its own copy so mutations never leak.
  function copyDist() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'relicpay-dist-copy-'));
    for (const f of fs.readdirSync(dist)) fs.copyFileSync(path.join(dist, f), path.join(d, f));
    return d;
  }
  function withMutation(mutate, fn) {
    const d = copyDist();
    try {
      mutate(d);
      return fn(d);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  }

  it('builds exactly the entries and static files the manifest names', () => {
    assert.deepStrictEqual(fs.readdirSync(dist).sort(), [...Object.values(ENTRIES), ...STATIC].sort());
  });

  it('a fresh build passes verification, including the rebuild comparison', () => {
    assert.deepStrictEqual(verifyDist(dist, fresh), { ok: true, problems: [] });
  });

  it('the build is deterministic', async () => {
    const again = await buildAll();
    for (const [name, buf] of Object.entries(fresh)) assert.ok(again[name].equals(buf), name);
  });

  it('every file the manifest and popup.html reference is in dist', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
    const { refs, scripts } = referencedFiles(manifest, fs.readFileSync(path.join(dist, 'popup.html'), 'utf8'));
    assert.deepStrictEqual(refs, ['background.js', 'content.js', 'popup.bundle.js', 'popup.html']);
    assert.deepStrictEqual(scripts, ['popup.bundle.js']);
    for (const r of refs) assert.ok(fs.existsSync(path.join(dist, r)), r);
  });

  it('dist/manifest.json is byte-identical to the validated extension/manifest.json', () => {
    assert.ok(fs.readFileSync(path.join(dist, 'manifest.json')).equals(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'))));
  });

  it('each bundle is self-contained and carries the code the entries import', () => {
    const bg = fs.readFileSync(path.join(dist, 'background.js'), 'utf8');
    const content = fs.readFileSync(path.join(dist, 'content.js'), 'utf8');
    const popup = fs.readFileSync(path.join(dist, 'popup.bundle.js'), 'utf8');
    for (const t of [bg, content, popup]) {
      assert.ok(t.startsWith('"use strict";\n(() => {') || t.includes('(() => {'), 'iife');
      assert.ok(!/\brequire\(["']/.test(t));
    }
    // The worker side holds the quoter and the reader; the popup holds the controller and wire codec.
    assert.ok(bg.includes('createRelicPayReader'));
    assert.ok(bg.includes('createOfferQuoter'));
    assert.ok(popup.includes('createPopupController'));
    assert.ok(content.includes('createContent'));
    // The content script runs inside a seller page and must not drag in the chain stack.
    assert.ok(!content.includes('createPublicClient'));
    assert.ok(content.length < 100 * 1024, `content.js is ${content.length} bytes`);
  });

  it('the placeholder deployment address still refuses to run (config is bundled, not bypassed)', () => {
    const bg = fs.readFileSync(path.join(dist, 'background.js'), 'utf8');
    assert.ok(bg.includes('0x0000000000000000000000000000000000000000'));
  });

  it('refuses a dist with no manifest', () => {
    withMutation((d) => fs.rmSync(path.join(d, 'manifest.json')), (d) => {
      assert.deepStrictEqual(codes(verifyDist(d)), ['MISSING_MANIFEST']);
    });
  });

  it('refuses a missing referenced file', () => {
    for (const f of ['background.js', 'content.js', 'popup.bundle.js', 'popup.html']) {
      withMutation((d) => fs.rmSync(path.join(d, f)), (d) => {
        assert.ok(codes(verifyDist(d)).includes('MISSING_FILE'), f);
      });
    }
  });

  it('refuses a dist manifest that drifted from the source manifest', () => {
    withMutation((d) => {
      const p = path.join(d, 'manifest.json');
      const m = JSON.parse(fs.readFileSync(p, 'utf8'));
      m.name = 'RelicPay (edited)';
      fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
    }, (d) => assert.ok(codes(verifyDist(d)).includes('MANIFEST_DRIFT')));
  });

  it('refuses a dist manifest that widens the permission budget, by the ADR-005 code', () => {
    withMutation((d) => {
      const p = path.join(d, 'manifest.json');
      const m = JSON.parse(fs.readFileSync(p, 'utf8'));
      m.permissions.push('tabs');
      fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
    }, (d) => {
      const c = codes(verifyDist(d));
      assert.ok(c.some((x) => x.startsWith('BUDGET_')), c.join(','));
      assert.ok(c.includes('MANIFEST_DRIFT'));
    });
  });

  it('refuses a bundle that still has a require, an import or a node: specifier', () => {
    const cases = [
      ['REQUIRE_LEFT', 'const x = require("viem");\n'],
      ['STATIC_IMPORT', 'import { http } from "viem";\n'],
      ['STATIC_EXPORT', 'export default function () {}\n'],
      ['NODE_SPECIFIER', 'const m = "node:crypto";\n'],
    ];
    for (const [code, line] of cases) {
      withMutation((d) => fs.appendFileSync(path.join(d, 'background.js'), line), (d) => {
        assert.ok(codes(verifyDist(d)).includes(code), code);
      });
    }
  });

  it('refuses a bundle that can evaluate or fetch code at runtime', () => {
    const cases = [
      ['EVAL', 'eval("1+1");\n'],
      ['NEW_FUNCTION', 'new Function("return 1");\n'],
      ['IMPORT_SCRIPTS', 'importScripts("https://x.example/a.js");\n'],
      ['DYNAMIC_IMPORT', 'import("https://x.example/a.js");\n'],
      ['REMOTE_SCRIPT', 'document.createElement("script");\n'],
    ];
    for (const [code, line] of cases) {
      withMutation((d) => fs.appendFileSync(path.join(d, 'popup.bundle.js'), line), (d) => {
        assert.ok(codes(verifyDist(d)).includes(code), code);
      });
    }
  });

  it('refuses popup.html changes that break the script-src self policy', () => {
    const cases = [
      ['INLINE_SCRIPT', (h) => h.replace('</body>', '<script>1</script></body>')],
      ['REMOTE_SCRIPT_TAG', (h) => h.replace('</body>', '<script src="https://x.example/a.js"></script></body>')],
      ['INLINE_HANDLER', (h) => h.replace('<body>', '<body onload="x()">')],
    ];
    for (const [code, edit] of cases) {
      withMutation((d) => {
        const p = path.join(d, 'popup.html');
        fs.writeFileSync(p, edit(fs.readFileSync(p, 'utf8')));
      }, (d) => assert.ok(codes(verifyDist(d)).includes(code), code));
    }
  });

  it('refuses an empty bundle and an unreferenced stray file', () => {
    withMutation((d) => fs.writeFileSync(path.join(d, 'content.js'), ''), (d) => {
      assert.ok(codes(verifyDist(d)).includes('EMPTY_BUNDLE'));
    });
    withMutation((d) => fs.writeFileSync(path.join(d, 'stray.js'), '1;'), (d) => {
      assert.ok(codes(verifyDist(d)).includes('UNREFERENCED_FILE'));
    });
  });

  it('refuses a stale or hand-edited bundle by comparing with a fresh build', () => {
    withMutation((d) => fs.appendFileSync(path.join(d, 'background.js'), '// edited\n'), (d) => {
      assert.ok(codes(verifyDist(d, fresh)).includes('STALE_BUNDLE'));
      assert.ok(!codes(verifyDist(d)).includes('STALE_BUNDLE'), 'no rebuild comparison without a fresh set');
    });
  });
});
