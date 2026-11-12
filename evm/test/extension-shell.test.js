// Tests for the extension shell's data layer (extension/lib/manifest.js, extension/lib/confirm.js
// and the generated extension/manifest.json), part c1 of the browser extension revival.
// docs/ADR-005-extension-shell.md is the spec this suite checks.
//
// v2 only, like the other extension suites: legacy/ is the frozen spec and stays at exactly 51.
// Pure: a manifest and a confirmation are data, so nothing here needs a chain or a browser.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { IMPL } = require('./helpers');
const {
  ManifestError,
  ALLOWED_PERMISSIONS,
  REFUSED_PERMISSIONS,
  buildManifest,
  validateManifest,
} = require('../extension/lib/manifest');
const { ConfirmError, buildConfirmation, duration } = require('../extension/lib/confirm');
const { render } = require('../tools/build-extension-manifest');

const ROOT = path.join(__dirname, '..');
const cfg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'config.json'), 'utf8'));
const good = () => buildManifest(cfg());
const codes = (m) => validateManifest(m).problems.map((p) => p.code);

(IMPL === 'v2' ? describe : describe.skip)('extension shell: manifest (ADR-005)', () => {
  it('builds a manifest that passes its own budget', () => {
    const m = good();
    assert.strictEqual(m.manifest_version, 3);
    assert.deepStrictEqual(validateManifest(m), { ok: true, problems: [] });
  });

  it('holds only the storage permission and names every refused one', () => {
    assert.deepStrictEqual(good().permissions, ['storage']);
    assert.deepStrictEqual(ALLOWED_PERMISSIONS, ['storage']);
    for (const p of ['tabs', 'scripting', 'activeTab']) assert.ok(REFUSED_PERMISSIONS[p], p);
  });

  it('scopes the content script to exactly the seller origins', () => {
    const m = buildManifest({ ...cfg(), sellerOrigins: ['https://a.example.com', 'https://b.example.org'] });
    assert.deepStrictEqual(m.content_scripts[0].matches, ['https://a.example.com/*', 'https://b.example.org/*']);
  });

  it('host permissions are sellers plus rpc plus operator, deduplicated', () => {
    const m = buildManifest({
      ...cfg(),
      sellerOrigins: ['https://a.example.com'],
      rpcOrigins: ['https://rpc.example.com'],
      operatorOrigins: ['https://a.example.com'],
      walletOrigins: ['https://rpc.example.com'],
    });
    assert.deepStrictEqual(m.host_permissions, ['https://a.example.com/*', 'https://rpc.example.com/*']);
  });

  it('refuses each way of widening the config', () => {
    for (const bad of ['*', '<all_urls>', 'https://*', 'https://*.example.com', 'http://example.com', 'https://example.com/path', 'example.com', 'https://localhost']) {
      assert.throws(() => buildManifest({ ...cfg(), sellerOrigins: [bad] }), ManifestError, bad);
    }
    assert.throws(() => buildManifest({ ...cfg(), sellerOrigins: [] }), ManifestError);
    assert.throws(() => buildManifest({ ...cfg(), rpcOrigins: undefined }), ManifestError);
    assert.throws(() => buildManifest({ ...cfg(), version: 'two' }), ManifestError);
  });

  it('v1 style permissions are all refused, each with its own code', () => {
    const m = good();
    m.permissions = ['storage', 'tabs', 'scripting', 'activeTab', 'bookmarks'];
    m.host_permissions = ['https://*/*'];
    m.content_scripts[0].matches = ['<all_urls>'];
    const found = codes(m);
    assert.strictEqual(found.filter((c) => c === 'PERMISSION_REFUSED').length, 3);
    assert.ok(found.includes('PERMISSION_NOT_ALLOWED'));
    assert.ok(found.includes('HOST_NOT_EXACT'));
    assert.ok(found.includes('MATCH_NOT_EXACT'));
  });

  it('reports every problem, not just the first', () => {
    const m = good();
    m.permissions = ['tabs', 'scripting'];
    m.externally_connectable = { matches: ['https://*/*'] };
    m.web_accessible_resources = [{ resources: ['x.js'], matches: ['<all_urls>'] }];
    assert.ok(validateManifest(m).problems.length >= 4);
  });

  it('refuses a content script that matches without a host permission', () => {
    const m = good();
    m.content_scripts[0].matches.push('https://other.example.com/*');
    assert.deepStrictEqual(codes(m), ['MATCH_WITHOUT_HOST']);
  });

  it('refuses all_frames, MAIN world and match fallbacks', () => {
    for (const [k, v, code] of [
      ['all_frames', true, 'ALL_FRAMES'],
      ['world', 'MAIN', 'MAIN_WORLD'],
      ['match_about_blank', true, 'MATCH_FALLBACK'],
      ['match_origin_as_fallback', true, 'MATCH_FALLBACK'],
    ]) {
      const m = good();
      m.content_scripts[0][k] = v;
      assert.deepStrictEqual(codes(m), [code], k);
    }
  });

  it('refuses optional host permissions, page-messageable service worker, exposed resources', () => {
    let m = good();
    m.optional_host_permissions = ['https://*/*'];
    assert.deepStrictEqual(codes(m), ['OPTIONAL_HOSTS']);
    m = good();
    m.externally_connectable = { matches: ['https://position.gallery/*'] };
    assert.deepStrictEqual(codes(m), ['EXTERNALLY_CONNECTABLE']);
    m = good();
    m.web_accessible_resources = [{ resources: ['popup.html'], matches: ['https://position.gallery/*'] }];
    assert.deepStrictEqual(codes(m), ['WEB_ACCESSIBLE_RESOURCES']);
  });

  it('refuses a loose or missing CSP', () => {
    for (const csp of ["script-src 'self' 'unsafe-eval'", "script-src 'self' https://cdn.example.com", "script-src *"]) {
      const m = good();
      m.content_security_policy.extension_pages = csp;
      assert.deepStrictEqual(codes(m), ['CSP_LOOSE'], csp);
    }
    const m = good();
    delete m.content_security_policy;
    assert.deepStrictEqual(codes(m), ['CSP_MISSING']);
  });

  it('requires the service worker, popup and content script the ADRs put work in', () => {
    const m = good();
    delete m.background;
    delete m.action;
    m.content_scripts = [];
    assert.deepStrictEqual(codes(m).sort(), ['NO_CONTENT_SCRIPT', 'NO_POPUP', 'NO_SERVICE_WORKER']);
    assert.deepStrictEqual(codes(null), ['NOT_AN_OBJECT']);
    assert.ok(codes({ ...good(), manifest_version: 2 }).includes('MANIFEST_VERSION'));
  });

  it('the checked-in extension/manifest.json is exactly what config.json generates', () => {
    const onDisk = fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8');
    assert.strictEqual(onDisk, render());
    assert.ok(validateManifest(JSON.parse(onDisk)).ok);
  });

  it('the shell modules stay chrome free, React free and out of dashboard/app', () => {
    for (const f of ['manifest.js', 'confirm.js']) {
      const code = fs.readFileSync(path.join(ROOT, 'extension', 'lib', f), 'utf8').replace(/\/\/.*$/gm, '');
      assert.ok(!/\bchrome\./.test(code), `${f} must stay chrome-free`);
      assert.ok(!/require\(['"](react|next)/.test(code));
      assert.ok(!/dashboard\/app/.test(code));
    }
  });
});

const BUYER = '0x1111111111111111111111111111111111111111';
const SELLER = '0x2222222222222222222222222222222222222222';
const NFT = '0x3333333333333333333333333333333333333333';
const UNIT = { symbol: 'RPC', decimals: 18 };
const E18 = 10n ** 18n;

function message(over = {}) {
  return {
    buyer: BUYER,
    seller: SELLER,
    nftContract: NFT,
    tokenId: 7n,
    totalPrice: 300n * E18,
    installmentCount: 3,
    dueIntervalSeconds: 30 * 86400,
    gracePeriodSeconds: 3 * 86400,
    paymentMethod: 0,
    requestId: '0x' + '11'.repeat(32),
    expiry: 2000n,
    ...over,
  };
}
function quoteFor(m, over = {}) {
  return {
    ok: true,
    unconfirmed: false,
    buyer: m.buyer,
    totalPrice: m.totalPrice,
    installmentCount: m.installmentCount,
    dueIntervalSeconds: BigInt(m.dueIntervalSeconds),
    gracePeriodSeconds: BigInt(m.gracePeriodSeconds),
    listing: { seller: m.seller, nftContract: m.nftContract, tokenId: m.tokenId, physicalId: 'PAGE-CLAIM' },
    price: { amount: 1n, decimals: 2, currency: 'USD' },
    warnings: [],
    ...over,
  };
}

(IMPL === 'v2' ? describe : describe.skip)('extension shell: confirmation (ADR-005)', () => {
  it('renders exactly the signed amount, from BigInt with no rounding', () => {
    const c = buildConfirmation({ message: message(), unit: UNIT });
    assert.strictEqual(c.total, '300 RPC');
    assert.strictEqual(c.installments.count, 3);
    assert.strictEqual(c.installments.each, '100 RPC');
    assert.strictEqual(c.installments.last, null);
    const big = buildConfirmation({ message: message({ totalPrice: 123456789012345678901n }), unit: UNIT });
    assert.strictEqual(big.total, '123.456789012345678901 RPC');
  });

  it('says so when the last payment absorbs a remainder, and the parts sum to the total', () => {
    const c = buildConfirmation({ message: message({ totalPrice: 10n * E18, installmentCount: 3 }), unit: UNIT });
    assert.strictEqual(c.installments.each, '3.333333333333333333 RPC');
    assert.strictEqual(c.installments.last, '3.333333333333333334 RPC');
  });

  it('honors the operator unit decimals rather than assuming 18', () => {
    const c = buildConfirmation({ message: message({ totalPrice: 1_500_000n, installmentCount: 1 }), unit: { symbol: 'USDC', decimals: 6 } });
    assert.strictEqual(c.total, '1.5 USDC');
  });

  it('is derived from the message, so nothing the listing claims can reach it', () => {
    const m = message();
    const c = buildConfirmation({ message: m, unit: UNIT, quote: quoteFor(m) });
    const text = JSON.stringify(c, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    assert.ok(!text.includes('PAGE-CLAIM'), 'physicalId is a page claim');
    assert.ok(!text.includes('USD'), 'the listed currency is a page claim');
  });

  it('refuses a quote that disagrees with the message on any field, naming it', () => {
    const m = message();
    for (const [k, v] of [
      ['totalPrice', m.totalPrice + 1n],
      ['installmentCount', 4],
      ['dueIntervalSeconds', 1n],
      ['gracePeriodSeconds', 9n],
      ['buyer', SELLER],
    ]) {
      assert.throws(
        () => buildConfirmation({ message: m, unit: UNIT, quote: quoteFor(m, { [k]: v }) }),
        (e) => e instanceof ConfirmError && e.message.includes(k),
        k,
      );
    }
    assert.throws(() => buildConfirmation({ message: m, unit: UNIT, quote: { ok: false } }), ConfirmError);
  });

  it('carries the quote warnings and the unconfirmed flag, in the extension own words', () => {
    const m = message();
    const q = quoteFor(m, { unconfirmed: true, warnings: [{ code: 'EXCEEDS_POLICY_DURATION', message: 'long', totalDuration: 1n }] });
    const c = buildConfirmation({ message: m, unit: UNIT, quote: q });
    assert.strictEqual(c.unconfirmed, true);
    assert.deepStrictEqual(c.warnings, [{ code: 'EXCEEDS_POLICY_DURATION', message: 'long' }]);
    assert.strictEqual(buildConfirmation({ message: m, unit: UNIT }).unconfirmed, false);
  });

  it('checksums addresses so casing cannot make two views differ', () => {
    const c = buildConfirmation({ message: message({ seller: SELLER.toUpperCase().replace('0X', '0x') }), unit: UNIT });
    assert.strictEqual(c.seller, c.seller.replace(/^0x/, '0x'));
    assert.match(c.relic.nftContract, /^0x[0-9a-fA-F]{40}$/);
    assert.strictEqual(c.relic.tokenId, '7');
  });

  it('blocks signing once the request has expired', () => {
    assert.strictEqual(buildConfirmation({ message: message(), unit: UNIT, now: 1999n }).canSign, true);
    const c = buildConfirmation({ message: message(), unit: UNIT, now: 2000n });
    assert.strictEqual(c.canSign, false);
    assert.strictEqual(c.expires.expired, true);
  });

  it('decodes the payment method and formats durations', () => {
    assert.strictEqual(buildConfirmation({ message: message({ paymentMethod: 3 }), unit: UNIT }).paymentMethod, 'AutoWithCollateral');
    assert.strictEqual(duration(86400).text, '1 day');
    assert.strictEqual(duration(30 * 86400).text, '30 days');
    assert.strictEqual(duration(7200).text, '2 hours');
    assert.strictEqual(duration(90).text, '90 seconds');
    assert.strictEqual(duration(0).text, 'none');
    assert.throws(() => buildConfirmation({ message: message({ paymentMethod: 9 }), unit: UNIT }));
  });

  it('refuses a unit that is not operator shaped', () => {
    for (const unit of [undefined, { symbol: 'US D', decimals: 6 }, { symbol: 'X', decimals: -1 }, { symbol: 'X', decimals: 1.5 }, { symbol: '<b>', decimals: 6 }]) {
      assert.throws(() => buildConfirmation({ message: message(), unit }), ConfirmError);
    }
    assert.throws(() => buildConfirmation({ message: message({ installmentCount: 0 }), unit: UNIT }), ConfirmError);
    assert.throws(() => buildConfirmation({ unit: UNIT }), ConfirmError);
  });
});
