#!/usr/bin/env node
// IBG Collection pilot: validate pilot/relics.json, build ERC721 metadata, mint through RelicRegistry.
//
//   node tools/pilot.js check                  validate the manifest (offline)
//   node tools/pilot.js build                  write pilot/metadata/<physicalId>.json (+ index.json with sha256)
//   node tools/pilot.js mint                   dry run on a fresh local ganache (default)
//   node tools/pilot.js mint --network base-sepolia   (ADR-011 rehearsal target; sepolia also works)
//                                              needs RPC_URL, PRIVATE_KEY (issuer), REGISTRY_ADDRESS
//                                              (or deployments/<network>.txt) and a non-empty baseURI in the
//                                              manifest, i.e. metadata already pinned. Optional TO_ADDRESS.
//                                              RPC_URL must be on the named network's chain id.
//
// Minting is idempotent: a physicalId already in the registry is skipped, never re-minted.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ethers } = require('ethers');
const { resolveNetwork, readDeployments, assertChain, networkArg } = require('./networks');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'pilot', 'relics.json');
const META_DIR = path.join(ROOT, 'pilot', 'metadata');
const MOTIFS = ['triangle', 'circle', 'square'];
const COUNT = 3;

function loadManifest(file = MANIFEST) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Returns a list of problems; empty means valid.
function validate(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['manifest is not an object'];
  if (typeof m.collection !== 'string' || !m.collection) errs.push('collection missing');
  if (typeof m.baseURI !== 'string') errs.push('baseURI must be a string (empty until pinned)');
  else if (m.baseURI && !/^(ipfs|ar|https):\/\/.+\/$/.test(m.baseURI)) errs.push('baseURI must be ipfs://, ar:// or https:// and end with /');
  if (!Array.isArray(m.relics)) return errs.concat('relics must be an array');
  if (m.relics.length !== COUNT) errs.push(`pilot is exactly ${COUNT} relics, found ${m.relics.length}`);
  const seen = new Set();
  for (const [i, r] of m.relics.entries()) {
    const at = `relics[${i}]`;
    if (typeof r.physicalId !== 'string' || !/^[A-Z0-9][A-Z0-9-]{3,63}$/.test(r.physicalId)) errs.push(`${at}.physicalId invalid`);
    else if (seen.has(r.physicalId)) errs.push(`${at}.physicalId duplicate ${r.physicalId}`);
    else seen.add(r.physicalId);
    for (const k of ['name', 'description', 'image']) if (typeof r[k] !== 'string' || !r[k]) errs.push(`${at}.${k} missing`);
    if (!MOTIFS.includes(r.motif)) errs.push(`${at}.motif must be one of ${MOTIFS.join(', ')}`);
    if (typeof r.image === 'string' && (/^[a-z]+:/i.test(r.image) || r.image.includes('..') || r.image.startsWith('/'))) errs.push(`${at}.image must be a relative path`);
  }
  return errs;
}

function metadataFor(m, r) {
  const image = m.baseURI ? m.baseURI + r.image : r.image;
  return {
    name: r.name,
    description: r.description,
    image,
    attributes: [
      { trait_type: 'Collection', value: m.collection },
      { trait_type: 'Physical ID', value: r.physicalId },
      { trait_type: 'Motif', value: r.motif },
    ],
  };
}

function canonical(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

function build(m, outDir = META_DIR) {
  fs.mkdirSync(outDir, { recursive: true });
  const index = {};
  for (const r of m.relics) {
    const text = canonical(metadataFor(m, r));
    fs.writeFileSync(path.join(outDir, r.physicalId + '.json'), text);
    index[r.physicalId] = crypto.createHash('sha256').update(text).digest('hex');
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), canonical(index));
  return index;
}

// Token URI for a relic. Before pinning there is no real URI, so the dry run uses a clearly fake one.
function uriFor(m, r, dry) {
  if (m.baseURI) return m.baseURI + r.physicalId + '.json';
  if (dry) return `ipfs://dry-run/${r.physicalId}.json`;
  throw new Error('baseURI is empty: pin pilot/metadata first and set baseURI in pilot/relics.json');
}

// Mints every relic not already registered. Returns [{physicalId, tokenId, status}].
async function mintAll(registry, m, { to, dry = false } = {}) {
  const errs = validate(m);
  if (errs.length) throw new Error('manifest invalid: ' + errs.join('; '));
  const out = [];
  for (const r of m.relics) {
    const pid = ethers.keccak256(ethers.toUtf8Bytes(r.physicalId));
    const existing = await registry.tokenByPhysicalId(pid);
    if (existing !== 0n) {
      out.push({ physicalId: r.physicalId, tokenId: existing, status: 'skipped' });
      continue;
    }
    const tx = await registry.mintRelic(to, r.physicalId, uriFor(m, r, dry));
    await tx.wait();
    out.push({ physicalId: r.physicalId, tokenId: await registry.tokenByPhysicalId(pid), status: 'minted' });
  }
  return out;
}

function artifact(name) {
  const p = path.join(ROOT, 'build', 'v2', name + '.json');
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}. Run "npm run compile" first.`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function localRegistry() {
  const ganache = require('ganache');
  const g = ganache.provider({
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 3, defaultBalance: 100 },
    miner: { blockGasLimit: 30_000_000 },
    chain: { hardfork: 'shanghai' },
  });
  const provider = new ethers.BrowserProvider(g);
  provider.estimateGas = async () => 15000000n;
  const [owner, gallery] = await Promise.all((await provider.send('eth_accounts', [])).slice(0, 2).map(a => provider.getSigner(a)));
  const a = artifact('RelicRegistry');
  const registry = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy();
  await registry.waitForDeployment();
  await (await registry.setIssuer(gallery.address, true)).wait();
  return { registry: registry.connect(gallery), to: gallery.address, provider };
}

async function liveRegistry(network) {
  const net = resolveNetwork(network);
  const { RPC_URL, PRIVATE_KEY } = process.env;
  if (!RPC_URL || !PRIVATE_KEY) throw new Error(`RPC_URL and PRIVATE_KEY env vars are required for --network ${net.name}`);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  await assertChain(provider, net.name);
  let addr = process.env.REGISTRY_ADDRESS;
  if (!addr) {
    const dep = readDeployments(net.name);
    addr = dep && dep.RELIC_REGISTRY;
  }
  if (!addr) throw new Error(`REGISTRY_ADDRESS not set and deployments/${net.name}.txt has no RELIC_REGISTRY`);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  return { registry: new ethers.Contract(addr, artifact('RelicRegistry').abi, wallet), to: process.env.TO_ADDRESS || wallet.address };
}

async function main(argv) {
  const cmd = argv[0];
  const m = loadManifest();
  if (cmd === 'check') {
    const errs = validate(m);
    if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
    console.log(`manifest ok: ${m.relics.length} relics, baseURI ${m.baseURI || '(not pinned yet)'}`);
  } else if (cmd === 'build') {
    const errs = validate(m);
    if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
    console.log(build(m));
  } else if (cmd === 'mint') {
    const network = networkArg(argv);
    if (argv.includes('--network') && !network) throw new Error('--network needs a value');
    const live = network !== null;
    const ctx = live ? await liveRegistry(network) : await localRegistry();
    const res = await mintAll(ctx.registry, m, { to: ctx.to, dry: !live });
    for (const r of res) console.log(`${r.status.padEnd(8)} ${r.physicalId} token ${r.tokenId}`);
  } else {
    console.error('usage: pilot.js check | build | mint [--network sepolia|base-sepolia]');
    process.exit(2);
  }
}

module.exports = { liveRegistry, loadManifest, validate, metadataFor, canonical, build, uriFor, mintAll };

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
