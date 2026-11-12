const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { setup, deploy, IMPL } = require('./helpers');
const pilot = require('../tools/pilot');

(IMPL === 'v2' ? describe : describe.skip)(`IBG pilot [${IMPL}]`, function () {
  this.timeout(120000);
  const clone = o => JSON.parse(JSON.stringify(o));
  let m;
  beforeEach(() => { m = pilot.loadManifest(); });

  it('shipped manifest is valid: three relics, one per motif', () => {
    assert.deepEqual(pilot.validate(m), []);
    assert.deepEqual(m.relics.map(r => r.motif).sort(), ['circle', 'square', 'triangle']);
  });

  it('validation refuses bad manifests', () => {
    const cases = [
      x => { x.relics.pop(); },
      x => { x.relics[1].physicalId = x.relics[0].physicalId; },
      x => { x.relics[0].physicalId = 'x'; },
      x => { x.relics[0].motif = 'hexagon'; },
      x => { x.relics[0].image = 'https://evil.example/a.jpg'; },
      x => { x.relics[0].image = '../../etc/passwd'; },
      x => { x.baseURI = 'http://insecure/'; },
      x => { x.baseURI = 'ipfs://cid'; },
      x => { delete x.relics[2].name; },
    ];
    for (const mutate of cases) {
      const x = clone(m);
      mutate(x);
      assert.notDeepEqual(pilot.validate(x), [], mutate.toString());
    }
  });

  it('build writes deterministic metadata and a matching sha256 index', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-'));
    const a = pilot.build(m, dir);
    const b = pilot.build(m, dir);
    assert.deepEqual(a, b);
    for (const r of m.relics) {
      const text = fs.readFileSync(path.join(dir, r.physicalId + '.json'), 'utf8');
      assert.equal(crypto.createHash('sha256').update(text).digest('hex'), a[r.physicalId]);
      const j = JSON.parse(text);
      assert.equal(j.attributes.find(t => t.trait_type === 'Motif').value, r.motif);
    }
  });

  it('metadata image resolves under baseURI once pinned', () => {
    const x = clone(m);
    x.baseURI = 'ipfs://bafyexample/';
    assert.equal(pilot.metadataFor(x, x.relics[0]).image, 'ipfs://bafyexample/media/0001.jpg');
    assert.equal(pilot.uriFor(x, x.relics[0], false), 'ipfs://bafyexample/IBG-OPTIC-0001.json');
  });

  it('live mint refuses while baseURI is empty, dry run does not', () => {
    assert.throws(() => pilot.uriFor(m, m.relics[0], false), /baseURI is empty/);
    assert.match(pilot.uriFor(m, m.relics[0], true), /^ipfs:\/\/dry-run\//);
  });

  it('mints all three on a real registry, then a second run skips everything', async () => {
    const s = await setup();
    const [owner, gallery] = s.signers;
    const registry = await deploy('RelicRegistry', [], owner);
    await (await registry.setIssuer(gallery.address, true)).wait();
    const asGallery = registry.connect(gallery);

    const first = await pilot.mintAll(asGallery, m, { to: gallery.address, dry: true });
    assert.deepEqual(first.map(r => r.status), ['minted', 'minted', 'minted']);
    assert.deepEqual(first.map(r => r.tokenId), [1n, 2n, 3n]);
    for (const r of first) {
      const rel = await registry.getRelic(r.tokenId);
      assert.equal(rel.physicalId, r.physicalId);
      assert.equal(rel.issuer, gallery.address);
      assert.equal(await registry.ownerOf(r.tokenId), gallery.address);
    }

    const second = await pilot.mintAll(asGallery, m, { to: gallery.address, dry: true });
    assert.deepEqual(second.map(r => r.status), ['skipped', 'skipped', 'skipped']);
    assert.equal(await registry.nextId(), 4n);
  });

  it('resumes after a partial run and refuses a non-issuer', async () => {
    const s = await setup();
    const [owner, gallery, stranger] = s.signers;
    const registry = await deploy('RelicRegistry', [], owner);
    await (await registry.setIssuer(gallery.address, true)).wait();
    await (await registry.connect(gallery).mintRelic(gallery.address, m.relics[0].physicalId, 'ipfs://x')).wait();
    const res = await pilot.mintAll(registry.connect(gallery), m, { to: gallery.address, dry: true });
    assert.deepEqual(res.map(r => r.status), ['skipped', 'minted', 'minted']);
    const fresh = await deploy('RelicRegistry', [], owner);
    await assert.rejects(pilot.mintAll(fresh.connect(stranger), m, { to: stranger.address, dry: true }));
  });
});
