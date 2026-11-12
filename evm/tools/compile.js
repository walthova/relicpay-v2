// Compile all .sol files in a source dir with solc-js, resolving OpenZeppelin imports.
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const srcDir = process.argv[2];
const outDir = process.argv[3];
if (!srcDir || !outDir) { console.error('usage: node compile.js <srcDir> <outDir>'); process.exit(1); }

const NM = path.join(__dirname, '..', 'node_modules');

function findImports(p) {
  const candidates = [
    path.join(NM, p),
    path.join(srcDir, p),
    path.join(__dirname, '..', p),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { contents: fs.readFileSync(c, 'utf8') };
  }
  return { error: 'not found: ' + p };
}

const sources = {};
for (const f of fs.readdirSync(srcDir)) {
  if (f.endsWith('.sol')) sources[f] = { content: fs.readFileSync(path.join(srcDir, f), 'utf8') };
}

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
let fatal = false;
for (const e of out.errors || []) {
  if (e.severity === 'error') { fatal = true; console.error(e.formattedMessage); }
}
if (fatal) process.exit(1);

fs.mkdirSync(outDir, { recursive: true });
for (const file of Object.keys(out.contracts || {})) {
  for (const name of Object.keys(out.contracts[file])) {
    const c = out.contracts[file][name];
    if (!c.evm.bytecode.object) continue;
    fs.writeFileSync(path.join(outDir, name + '.json'),
      JSON.stringify({ contractName: name, abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }));
  }
}
console.log('compiled', Object.keys(sources).length, 'files ->', outDir);
