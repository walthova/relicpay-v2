#!/usr/bin/env node
// Bundle the extension into extension/dist, the directory that is loaded into Chrome and shipped.
//
// Part c2c of the "Browser extension revival" roadmap item. The extension sources are CommonJS
// (they are shared with the offline mocha suite, and with dashboard/lib), and an MV3 service worker,
// a content script and a popup page cannot require() anything. This step is the bridge, and the
// rule it enforces is the one ADR-005 sets for the manifest: what ships is checked, not assumed.
//
//   npm run extension:bundle   build extension/dist
//   npm run extension:verify   prove extension/dist is exactly what the sources and manifest produce
//
// The verification is static, because the suite cannot run a browser: every file the manifest
// names exists in dist, dist/manifest.json is byte-identical to the validated extension/manifest.json,
// each entry is a self-contained script (no require, no import, no node: or bare specifiers left),
// nothing in a bundle can fetch or evaluate code at runtime (CSP is script-src 'self'), and a
// fresh build is byte-identical to the one on disk, so a stale or hand-edited bundle fails.

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { validateManifest } = require('../extension/lib/manifest');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const DIST = path.join(EXT, 'dist');

// Entry source -> output name. The names are the ones manifest.json and popup.html already use.
const ENTRIES = {
  'background.js': 'background.js',
  'content.js': 'content.js',
  'popup-main.js': 'popup.bundle.js',
};
// Files copied verbatim.
const STATIC = ['manifest.json', 'popup.html'];

// Constructs that load or evaluate code at runtime. MV3 forbids remote code and the extension_pages
// CSP forbids eval, so a bundle containing one is either broken or reaching for something it
// must not. Patterns are matched against bundle text.
const RUNTIME_CODE_PATTERNS = [
  { code: 'EVAL', re: /(^|[^\w$.])eval\s*\(/ },
  { code: 'NEW_FUNCTION', re: /new\s+Function\s*\(/ },
  { code: 'IMPORT_SCRIPTS', re: /\bimportScripts\s*\(/ },
  { code: 'DYNAMIC_IMPORT', re: /(^|[^\w$.])import\s*\(/ },
  { code: 'REMOTE_SCRIPT', re: /createElement\(\s*["']script["']\s*\)/ },
];
// What a script that was not fully bundled looks like.
const UNBUNDLED_PATTERNS = [
  { code: 'REQUIRE_LEFT', re: /(^|[^\w$.])require\s*\(\s*["'`]/ },
  { code: 'STATIC_IMPORT', re: /^\s*import\s+[\w{*"']/m },
  { code: 'STATIC_EXPORT', re: /^\s*export\s+(default|const|function|\{|\*)/m },
  { code: 'NODE_SPECIFIER', re: /["']node:[a-z_/]+["']/ },
];

function buildOptions(entry) {
  return {
    entryPoints: [path.join(EXT, entry)],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'chrome110',
    minify: false,
    legalComments: 'none',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    // Node builtins have no meaning in a browser context: fail the build rather than polyfill.
    external: [],
  };
}

/** Build every output in memory. Returns { name: Buffer }. Deterministic for fixed sources. */
async function buildAll() {
  const out = {};
  for (const [entry, name] of Object.entries(ENTRIES)) {
    const result = await esbuild.build(buildOptions(entry));
    if (result.outputFiles.length !== 1) throw new Error(`${entry} produced ${result.outputFiles.length} outputs`);
    out[name] = Buffer.from(result.outputFiles[0].contents);
  }
  for (const f of STATIC) out[f] = fs.readFileSync(path.join(EXT, f));
  return out;
}

async function bundle(dist = DIST) {
  const files = await buildAll();
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(dist, name), buf);
  return Object.keys(files).sort();
}

/** Files the manifest and popup.html say will be loaded, relative to the extension root. */
function referencedFiles(manifest, popupHtml) {
  const refs = new Set();
  if (manifest.background && manifest.background.service_worker) refs.add(manifest.background.service_worker);
  for (const cs of manifest.content_scripts || []) {
    for (const f of cs.js || []) refs.add(f);
    for (const f of cs.css || []) refs.add(f);
  }
  if (manifest.action && manifest.action.default_popup) refs.add(manifest.action.default_popup);
  const scripts = [...String(popupHtml).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  for (const s of scripts) refs.add(s);
  return { refs: [...refs].sort(), scripts };
}

/**
 * Static verification of a dist directory. Returns { ok, problems: [{code, message}] }.
 * `fresh` is an optional { name: Buffer } to compare against (a rebuild from sources).
 */
function verifyDist(dist = DIST, fresh = null) {
  const problems = [];
  const add = (code, message) => problems.push({ code, message });
  const read = (n) => {
    const p = path.join(dist, n);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  };

  const manifestBuf = read('manifest.json');
  if (!manifestBuf) {
    add('MISSING_MANIFEST', 'dist/manifest.json does not exist. Run: npm run extension:bundle');
    return { ok: false, problems };
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBuf.toString('utf8'));
  } catch (e) {
    add('BAD_MANIFEST', `dist/manifest.json is not JSON: ${e.message}`);
    return { ok: false, problems };
  }

  for (const p of validateManifest(manifest).problems) add(`BUDGET_${p.code}`, p.message);

  const source = fs.readFileSync(path.join(EXT, 'manifest.json'));
  if (!manifestBuf.equals(source)) add('MANIFEST_DRIFT', 'dist/manifest.json differs from extension/manifest.json');

  const popupBuf = read('popup.html');
  const { refs, scripts } = referencedFiles(manifest, popupBuf ? popupBuf.toString('utf8') : '');
  for (const r of refs) if (!read(r)) add('MISSING_FILE', `${r} is referenced by the manifest or popup.html but is not in dist`);
  if (popupBuf) {
    const html = popupBuf.toString('utf8');
    if (/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html)) add('INLINE_SCRIPT', 'popup.html has an inline script; the CSP is script-src \'self\'');
    if (/<script\b[^>]*\bsrc="https?:/i.test(html)) add('REMOTE_SCRIPT_TAG', 'popup.html loads a remote script');
    if (/\son[a-z]+\s*=/i.test(html)) add('INLINE_HANDLER', 'popup.html has an inline event handler');
  }

  // Every script that will run must be a self-contained bundle.
  const scriptFiles = new Set(scripts);
  if (manifest.background) scriptFiles.add(manifest.background.service_worker);
  for (const cs of manifest.content_scripts || []) for (const f of cs.js || []) scriptFiles.add(f);
  for (const f of scriptFiles) {
    const buf = read(f);
    if (!buf) continue;
    const text = buf.toString('utf8');
    if (text.trim().length === 0) add('EMPTY_BUNDLE', `${f} is empty`);
    for (const { code, re } of UNBUNDLED_PATTERNS) if (re.test(text)) add(code, `${f} is not self-contained (${code})`);
    for (const { code, re } of RUNTIME_CODE_PATTERNS) if (re.test(text)) add(code, `${f} can load or evaluate code at runtime (${code})`);
  }

  // Nothing in dist that the manifest does not account for.
  const known = new Set([...refs, 'manifest.json', 'popup.html']);
  for (const f of fs.readdirSync(dist)) if (!known.has(f)) add('UNREFERENCED_FILE', `${f} is in dist but nothing references it`);

  if (fresh) {
    for (const [name, buf] of Object.entries(fresh)) {
      const cur = read(name);
      if (!cur) add('STALE_MISSING', `${name} is not in dist`);
      else if (!cur.equals(buf)) add('STALE_BUNDLE', `${name} does not match a fresh build of the sources. Run: npm run extension:bundle`);
    }
  }
  return { ok: problems.length === 0, problems };
}

async function main() {
  if (process.argv.includes('--check')) {
    const res = verifyDist(DIST, await buildAll());
    if (!res.ok) {
      console.error('extension/dist is missing, stale or not shippable:');
      res.problems.forEach((p) => console.error(`  ${p.code}: ${p.message}`));
      process.exit(1);
    }
    console.log('extension/dist matches a fresh build and is within the manifest budget.');
  } else {
    const names = await bundle();
    console.log(`wrote extension/dist: ${names.join(', ')}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { ENTRIES, STATIC, DIST, buildAll, bundle, verifyDist, referencedFiles };
