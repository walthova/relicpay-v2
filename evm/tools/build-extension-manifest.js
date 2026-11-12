#!/usr/bin/env node
// Generate extension/manifest.json from extension/config.json through extension/lib/manifest.js.
//
// The manifest is generated rather than hand edited so the permission budget in ADR-005 is enforced
// at the one place a widening could enter: every write goes through buildManifest, which refuses to
// return something validateManifest rejects. `--check` (npm run extension:check) proves the
// checked-in manifest.json is exactly what the config produces, so a hand edit that adds a
// permission fails the suite instead of shipping.

const fs = require('fs');
const path = require('path');
const { buildManifest, validateManifest } = require('../extension/lib/manifest');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'extension', 'config.json');
const OUT = path.join(ROOT, 'extension', 'manifest.json');

function render() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  return JSON.stringify(buildManifest(cfg), null, 2) + '\n';
}

if (require.main === module) {
  const text = render();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    const problems = validateManifest(JSON.parse(current || '{}')).problems;
    if (current !== text || problems.length) {
      console.error('extension/manifest.json is out of date or over budget. Run: npm run extension:manifest');
      problems.forEach((p) => console.error(`  ${p.code}: ${p.message}`));
      process.exit(1);
    }
    console.log('extension/manifest.json matches config and is within the permission budget.');
  } else {
    fs.writeFileSync(OUT, text);
    console.log('wrote extension/manifest.json');
  }
}

module.exports = { render };
