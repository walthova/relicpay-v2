#!/usr/bin/env node
// Export the v2 contract ABIs from build/v2 into dashboard/lib/abis.js (+ abis.d.ts).
//
// Why a generated file at all, rather than having the dashboard read build/v2/*.json directly:
// build/ is a compile artifact that is not checked in, and a Next.js bundle cannot read it at
// runtime anyway. The dashboard needs the ABIs as importable module source. Regenerating is one
// command (`npm run abi:export`) and abis.js is checked in so the app builds without a solc run.
//
// Two outputs on purpose:
//   abis.js    CommonJS, the runtime source of truth. The repo is CJS (mocha, tools/), so the
//              characterization suite can require() the exact same object the app imports. Next.js
//              imports CJS fine, so this does not need an ESM twin.
//   abis.d.ts  the same ABIs re-declared with `as const`. viem infers argument and return types
//              from an ABI only when it is a literal readonly tuple, which a .js file can never
//              be. Without this, every readContract in the TS app degrades to `any` and the type
//              safety that is the reason the roadmap says viem at all is gone. It duplicates the
//              ABI text, which is acceptable precisely because both halves are generated from the
//              same artifact in the same pass and neither is ever hand edited.
//
// Libraries are skipped. solc emits an artifact for every contract-like thing it compiled,
// including OpenZeppelin's internal libraries, and shipping Math/Strings/SafeERC20 ABIs to a
// browser bundle is noise the dashboard has no call for.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build', 'v2');
const OUT_DIR = path.join(ROOT, 'dashboard', 'lib');

// The protocol surface, named explicitly rather than filtered by heuristic. An allowlist means a
// new contract has to be added here deliberately; a denylist would silently start shipping
// whatever the next `npm run compile` happens to drop in build/v2.
const CONTRACTS = [
  'RelicPay',
  'RelicRegistry',
  'PriceOracle',
  'ChainlinkPriceAdapter',
  'DeFiIntegration',
  'RelicPayGovernance',
  'Bnpl',
  'EnhancedBnpl',
];

// abis.js exports camelCase names (relicPayAbi) because that is the viem/wagmi convention and the
// app reads better for it.
function exportName(contractName) {
  return contractName.charAt(0).toLowerCase() + contractName.slice(1) + 'Abi';
}

function loadAbi(name) {
  const p = path.join(BUILD, name + '.json');
  if (!fs.existsSync(p)) {
    throw new Error(`Missing ${p}. Run "npm run compile" first.`);
  }
  const artifact = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(artifact.abi)) throw new Error(`${name}.json has no abi array`);
  return artifact.abi;
}

function banner() {
  return [
    '// GENERATED FILE. Do not edit.',
    '// Regenerate with: npm run abi:export  (after npm run compile)',
    '// Source: build/v2/*.json, produced by tools/compile.js from contracts/*.sol',
    '',
  ].join('\n');
}

function renderJs(abis) {
  const parts = [banner()];
  for (const [name, abi] of abis) {
    parts.push(`const ${exportName(name)} = ${JSON.stringify(abi, null, 2)};\n`);
  }
  parts.push('module.exports = {');
  for (const [name] of abis) parts.push(`  ${exportName(name)},`);
  parts.push('};');
  parts.push('');
  return parts.join('\n');
}

// Render a JSON value as a TypeScript *type*, deeply readonly.
//
// `as const` is an expression assertion and is not legal in a declaration, so `declare const x:
// [...] as const` does not compile. The equivalent in type position is a readonly tuple whose
// members are readonly too, which is what viem's Abi inference actually wants: it reads the literal
// string types off `name`, `type` and `stateMutability` to type arguments and return values, and a
// mutable array widens them all back to `string` and the inference is gone.
function toReadonlyType(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (!value.length) return 'readonly []';
    const items = value.map((v) => padIn + toReadonlyType(v, indent + 1));
    return 'readonly [\n' + items.join(',\n') + '\n' + pad + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    const items = keys.map(
      (k) => `${padIn}readonly ${JSON.stringify(k)}: ${toReadonlyType(value[k], indent + 1)}`
    );
    return '{\n' + items.join(';\n') + ';\n' + pad + '}';
  }
  return JSON.stringify(value);
}

function renderDts(abis) {
  const parts = [banner()];
  for (const [name, abi] of abis) {
    parts.push(`export declare const ${exportName(name)}: ${toReadonlyType(abi)};\n`);
  }
  return parts.join('\n');
}

function render() {
  const abis = CONTRACTS.map((name) => [name, loadAbi(name)]);
  return { abis, js: renderJs(abis), dts: renderDts(abis) };
}

function main() {
  const { abis, js, dts } = render();
  const jsPath = path.join(OUT_DIR, 'abis.js');
  const dtsPath = path.join(OUT_DIR, 'abis.d.ts');

  if (process.argv.includes('--check')) {
    // Proves the checked-in abis.js still matches the compiled contracts, so a contract change
    // that nobody re-exported fails the suite instead of shipping a stale ABI to the dashboard.
    const stale = [];
    for (const [p, want] of [[jsPath, js], [dtsPath, dts]]) {
      const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
      if (have !== want) stale.push(path.relative(ROOT, p));
    }
    if (stale.length) {
      console.error('stale ABI export: ' + stale.join(', ') + '\nRun: npm run abi:export');
      process.exitCode = 1;
      return;
    }
    console.log('ABI export up to date');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(jsPath, js);
  fs.writeFileSync(dtsPath, dts);

  let total = 0;
  for (const [name, abi] of abis) {
    const fns = abi.filter((e) => e.type === 'function').length;
    const evs = abi.filter((e) => e.type === 'event').length;
    total += abi.length;
    console.log(`  ${name.padEnd(22)} ${String(fns).padStart(3)} fn  ${String(evs).padStart(3)} ev`);
  }
  console.log(`exported ${abis.length} ABIs (${total} entries) -> ${path.relative(ROOT, OUT_DIR)}/abis.js + abis.d.ts`);
}

module.exports = { CONTRACTS, exportName, loadAbi, render, renderJs, renderDts, toReadonlyType, OUT_DIR };

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
