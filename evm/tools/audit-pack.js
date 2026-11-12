#!/usr/bin/env node
// Audit pack surface generator. Produces docs/audit/SURFACE.md: for every v2 contract, the
// state-changing external entry points, who may call each, whether it takes ETH, and every raw
// ETH send site. An auditor starts here to size the attack surface; the file is generated so it
// cannot drift from the code.
//
// Source is parsed (modifiers and bodies are not in the ABI); the ABI is used as a cross-check so
// a function the parser misses fails the build instead of silently vanishing from the pack.
//
// Run: npm run audit:pack    regenerates docs/audit/SURFACE.md
//      npm run audit:check   exits non-zero if the committed file is stale
// Requires `npm run compile` (build/v2) for the ABI cross-check.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONTRACTS = path.join(ROOT, 'contracts');
const BUILD = path.join(ROOT, 'build', 'v2');
const OUT = path.join(ROOT, 'docs', 'audit', 'SURFACE.md');

// Contracts in scope, in review order (core first).
const SCOPE = [
  'RelicPay', 'RelicPayGovernance', 'Governable', 'RelicRegistry',
  'PriceOracle', 'ChainlinkPriceAdapter', 'DeFiIntegration',
];
// Present in contracts/ but excluded from the audit: v1 lineage kept for ABI parity only.
const OUT_OF_SCOPE = ['Bnpl', 'EnhancedBnpl'];

// Entry points a scoped contract inherits from OpenZeppelin or Governable rather than declares.
// Listed from the ABI so an inherited external function cannot hide from the review.
const INHERITED = {
  transferOwnership: 'onlyOwner', renounceOwnership: 'onlyOwner', setGovernor: 'onlyOwner',
  onERC721Received: 'open', approve: 'open', setApprovalForAll: 'open',
  transferFrom: 'open', safeTransferFrom: 'open',
};
const KNOWN_MODIFIERS = ['onlyOwner', 'onlyGovernance', 'nonReentrant'];

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
}

// Returns [{ name, sig, mods, payable, mutates, guard, line }] for each external/public function
// declared in a contract or abstract contract (interfaces are skipped).
function parseFunctions(src) {
  const clean = stripComments(src);
  const out = [];
  // Drop interface blocks so their declarations are not mistaken for implementations.
  let body = clean;
  const ifaceRe = /\binterface\s+\w+[^{]*\{/g;
  let m;
  while ((m = ifaceRe.exec(body))) {
    let depth = 1, i = m.index + m[0].length;
    while (i < body.length && depth) { if (body[i] === '{') depth++; else if (body[i] === '}') depth--; i++; }
    body = body.slice(0, m.index) + body.slice(m.index, i).replace(/[^\n]/g, ' ') + body.slice(i);
    ifaceRe.lastIndex = m.index + 1;
  }
  const fnRe = /\bfunction\s+(\w+)\s*\(/g;
  while ((m = fnRe.exec(body))) {
    const start = m.index;
    let i = body.indexOf('(', start), depth = 0;
    for (; i < body.length; i++) { if (body[i] === '(') depth++; else if (body[i] === ')') { depth--; if (!depth) break; } }
    let j = i + 1;
    while (j < body.length && body[j] !== '{' && body[j] !== ';') j++;
    const header = body.slice(start, j).replace(/\s+/g, ' ');
    if (body[j] !== '{') continue; // abstract declaration
    let d = 1, k = j + 1;
    while (k < body.length && d) { if (body[k] === '{') d++; else if (body[k] === '}') d--; k++; }
    const fnBody = body.slice(j, k);
    // Drop the returns(...) clause first: its closing paren would otherwise hide the modifiers.
    const afterParams = header.slice(header.indexOf('(')).replace(/\breturns\s*\([^)]*\)/g, '');
    const tail = afterParams.slice(afterParams.lastIndexOf(')') + 1);
    // visibility is declared after the parameter list; returns(...) may hold parens, so test words.
    const vis = /\b(external|public)\b/.exec(tail);
    if (!vis) continue;
    const mutates = !/\b(view|pure)\b/.test(tail);
    const mods = KNOWN_MODIFIERS.filter(x => new RegExp(`\\b${x}\\b`).test(tail));
    const inline = /msg\.sender\s*(==|!=)|\[\s*msg\.sender\s*\]|NotIssuer|UnauthorizedCaller|Unauthorized/.test(fnBody);
    const line = body.slice(0, start).split('\n').length;
    out.push({
      name: m[1], sig: header.replace(/\s*\{?$/, ''), mods, payable: /\bpayable\b/.test(tail),
      mutates, inline, line,
    });
  }
  return out;
}

function ethSendSites(src) {
  const lines = stripComments(src).split('\n');
  const hits = [];
  lines.forEach((l, i) => { if (/\.call\{\s*value\s*:/.test(l) || /\.transfer\(|\.send\(/.test(l) && /payable/.test(l)) hits.push(i + 1); });
  return hits;
}

function guardLabel(f) {
  const g = f.mods.filter(x => x !== 'nonReentrant');
  if (g.length) return g.join(' + ');
  if (f.inline) return 'caller-scoped';
  return 'open';
}

function inheritedOf(name, declared) {
  const art = path.join(BUILD, name + '.json');
  if (!fs.existsSync(art)) return [];
  const have = new Set(declared.map(f => f.name));
  const seen = new Map();
  for (const e of JSON.parse(fs.readFileSync(art, 'utf8')).abi) {
    if (e.type !== 'function' || e.stateMutability === 'view' || e.stateMutability === 'pure') continue;
    if (!have.has(e.name) && INHERITED[e.name]) seen.set(e.name, INHERITED[e.name]);
  }
  return [...seen].sort();
}

function build() {
  const parts = [];
  parts.push('# RelicPay v2 attack surface (generated)\n');
  parts.push('Generated by `npm run audit:pack`. Do not edit by hand. Source of truth is `contracts/`.\n');
  parts.push('Guard column: `onlyOwner` and `onlyGovernance` (owner or the single governor) are modifiers; ' +
    '"caller-scoped" means the body reads msg.sender, either as a role check (seller, issuer, authorized oracle) or as the account whose own state is touched (a deposit); the parser cannot tell the two apart, so review each by hand; ' +
    '"open" means anyone may call and the function must be safe under any caller and any input.\n');
  const totals = { fns: 0, open: 0, payable: 0, sends: 0 };
  const summary = [];
  const sections = [];
  for (const name of SCOPE) {
    const file = path.join(CONTRACTS, name + '.sol');
    const src = fs.readFileSync(file, 'utf8');
    const loc = src.split('\n').length;
    const fns = parseFunctions(src).filter(f => f.mutates);
    const sends = ethSendSites(src);
    const open = fns.filter(f => guardLabel(f) === 'open');
    totals.fns += fns.length; totals.open += open.length;
    totals.payable += fns.filter(f => f.payable).length; totals.sends += sends.length;
    summary.push(`| ${name} | ${loc} | ${fns.length} | ${open.length} | ${fns.filter(f => f.payable).length} | ${sends.length} |`);
    let s = `## ${name}\n\n`;
    if (!fns.length) s += 'No state-changing external functions (abstract or library-like).\n\n';
    else {
      s += '| Function | Guard | Reentrancy guard | Payable |\n|---|---|---|---|\n';
      for (const f of fns) s += `| \`${f.name}\` | ${guardLabel(f)} | ${f.mods.includes('nonReentrant') ? 'yes' : 'no'} | ${f.payable ? 'yes' : 'no'} |\n`;
      s += '\n';
    }
    const inh = inheritedOf(name, fns);
    if (inh.length) s += `Inherited entry points: ${inh.map(([n, g]) => `\`${n}\` (${g})`).join(', ')}.\n\n`;
    s += sends.length ? `Raw ETH send sites (\`call{value:}\`): ${sends.length}.\n\n` : 'Raw ETH send sites: none.\n\n';
    sections.push(s);
  }
  parts.push('## Summary\n');
  parts.push('| Contract | Lines | State-changing external fns | Open (any caller) | Payable | ETH send sites |\n|---|---|---|---|---|---|');
  parts.push(...summary);
  parts.push(`| **Total** | | **${totals.fns}** | **${totals.open}** | **${totals.payable}** | **${totals.sends}** |\n`);
  parts.push(...sections);
  parts.push('## Out of scope\n');
  parts.push(`${OUT_OF_SCOPE.map(n => '`' + n + '`').join(', ')}: v1 lineage kept for ABI parity with the characterization suite. Not deployed by DeployAll.\n`);
  return parts.join('\n');
}

// ABI cross-check: every non-view ABI function must be found by the source parser.
function crossCheck() {
  const problems = [];
  for (const name of SCOPE) {
    const art = path.join(BUILD, name + '.json');
    if (!fs.existsSync(art)) continue; // abstract Governable has no artifact worth checking
    const abi = JSON.parse(fs.readFileSync(art, 'utf8')).abi;
    const parsed = new Set(parseFunctions(fs.readFileSync(path.join(CONTRACTS, name + '.sol'), 'utf8'))
      .filter(f => f.mutates).map(f => f.name));
    for (const e of abi) {
      if (e.type !== 'function' || e.stateMutability === 'view' || e.stateMutability === 'pure') continue;
      if (!parsed.has(e.name) && !INHERITED[e.name]) problems.push(`${name}.${e.name} is in the ABI but was not parsed from source`);
    }
  }
  return problems;
}

module.exports = { build, parseFunctions, crossCheck, SCOPE, OUT };

if (require.main === module) {
  const problems = fs.existsSync(BUILD) ? crossCheck() : [];
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  const text = build();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) { console.error('docs/audit/SURFACE.md is stale; run npm run audit:pack'); process.exit(1); }
    console.log('audit surface up to date');
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    console.log('wrote ' + path.relative(ROOT, OUT));
  }
}
