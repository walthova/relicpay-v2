const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { IMPL } = require('./helpers');
const nets = require('../tools/networks');
const pilot = require('../tools/pilot');
const demo = require('../tools/demo');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// A stand-in provider that answers getNetwork like ethers does.
const providerOn = id => ({ getNetwork: async () => ({ chainId: BigInt(id) }) });

(IMPL === 'v2' ? describe : describe.skip)(`network targeting [${IMPL}]`, function () {
  it('knows sepolia and base-sepolia with their chain ids and rejects anything else', () => {
    assert.strictEqual(nets.resolveNetwork('sepolia').chainId, 11155111n);
    assert.strictEqual(nets.resolveNetwork('base-sepolia').chainId, 84532n);
    for (const bad of ['mainnet', 'base', '', '../sepolia', 'constructor', '__proto__']) {
      assert.throws(() => nets.resolveNetwork(bad), /unknown network/, bad);
    }
    assert.throws(() => nets.deploymentsPath('../../etc/passwd'), /unknown network/);
  });

  it('each network has its own deployments file', () => {
    assert.ok(nets.deploymentsPath('sepolia').endsWith(path.join('deployments', 'sepolia.txt')));
    assert.ok(nets.deploymentsPath('base-sepolia').endsWith(path.join('deployments', 'base-sepolia.txt')));
  });

  it('assertChain accepts the matching chain id and names both ids on a mismatch', async () => {
    await nets.assertChain(providerOn(84532), 'base-sepolia');
    await assert.rejects(nets.assertChain(providerOn(11155111), 'base-sepolia'), /chain 11155111 .* expects 84532/);
    await assert.rejects(nets.assertChain(providerOn(84532), 'sepolia'), /chain 84532 .* expects 11155111/);
  });

  it('networkArg reads the flag value or null', () => {
    assert.strictEqual(nets.networkArg(['mint', '--network', 'base-sepolia']), 'base-sepolia');
    assert.strictEqual(nets.networkArg(['mint']), null);
    assert.strictEqual(nets.networkArg(['mint', '--network']), null);
  });

  it('DeployAll checks the same names and chain ids as tools/networks.js', () => {
    const src = read('script/DeployAll.s.sol');
    for (const [name, n] of Object.entries(nets.NETWORKS)) {
      assert.ok(src.includes(`keccak256("${name}")`), 'DeployAll missing ' + name);
      assert.ok(src.includes(`block.chainid == ${n.chainId}`), 'DeployAll missing chain id for ' + name);
    }
    assert.ok(src.includes('"deployments/", network, ".txt"'), 'DeployAll output path is not per network');
    assert.ok(!src.includes('"deployments/sepolia.txt"'), 'DeployAll still hardcodes sepolia.txt');
  });

  it('foundry.toml has the Base Sepolia endpoint and scoped write access for deployments', () => {
    const toml = read('foundry.toml');
    assert.ok(/^base_sepolia\s*=/m.test(toml));
    assert.ok(/^base-sepolia\s*=.*chain = 84532/m.test(toml));
    assert.ok(/fs_permissions\s*=\s*\[\{ access = "read-write", path = "\.\/deployments" \}\]/.test(toml));
  });

  it('DeployChainlinkAdapter wires the sequencer feed before it registers or pushes any feed', () => {
    const src = read('script/DeployChainlinkAdapter.s.sol');
    const seq = src.indexOf('adapter.setSequencerUptimeFeed(');
    assert.ok(seq > 0, 'sequencer wiring missing');
    assert.ok(seq < src.indexOf('_maybeSetFeed(adapter, ETH_ASSET'), 'sequencer must be set before feeds');
    assert.ok(seq < src.indexOf('adapter.pushAll()'), 'sequencer must be set before the first push');
    assert.ok(src.includes('CHAINLINK_ADAPTER='), 'adapter address is not written to the deployments file');
  });

  describe('pilot and demo refuse the wrong chain', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; });

    it('pilot liveRegistry rejects an unknown network before touching the RPC', async () => {
      process.env.RPC_URL = 'http://127.0.0.1:1'; process.env.PRIVATE_KEY = '0x' + '11'.repeat(32);
      await assert.rejects(pilot.liveRegistry('mainnet'), /unknown network/);
    });

    it('pilot liveRegistry needs RPC_URL and PRIVATE_KEY', async () => {
      delete process.env.RPC_URL; delete process.env.PRIVATE_KEY;
      await assert.rejects(pilot.liveRegistry('base-sepolia'), /RPC_URL and PRIVATE_KEY .* base-sepolia/);
    });

    it('demo setupLive rejects an unknown network before reading anything', async () => {
      process.env.RPC_URL = 'http://127.0.0.1:1'; process.env.PRIVATE_KEY = '0x' + '11'.repeat(32);
      await assert.rejects(demo.setupLive('mainnet'), /unknown network/);
    });
  });

  it('the pilot part b item and docs name Base Sepolia, with no em dash', () => {
    const road = read('ROADMAP.md');
    assert.ok(/IBG Collection pilot, part b[\s\S]*?base-sepolia/.test(road));
    for (const f of ['README.md', 'docs/ADR-011-l2-deployment.md', 'docs/MONITORING.md', 'tools/networks.js']) {
      assert.ok(!read(f).includes('—'), 'em dash in ' + f);
    }
    assert.ok(read('README.md').includes('DEPLOY_NETWORK=base-sepolia'));
  });
});
