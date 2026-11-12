// Tests for the route contract (dashboard/lib/routes.js) and for the structural rules the Next.js
// app under dashboard/app has to hold to.
//
// v2 only, same reasoning as the other dashboard tests: the dashboard is a v2 artifact and legacy/
// is the frozen spec, so the legacy run stays at exactly 51.
//
// Two halves, and the second one needs justifying. The app itself is React and cannot be rendered
// by this suite, which installs solc, ganache and mocha and deliberately not next. But the rules
// the app has to obey are not rendering rules, they are import rules: server-only code must not be
// reachable from a client component, the RPC endpoint must not be named with a NEXT_PUBLIC_ prefix,
// wagmi must not appear in a server page, and the app's dependencies must not leak into the root
// manifest the offline toolchain installs. Every one of those is a property of the source text, so
// it is checkable here, and each of them is a real mistake that ships a working page: nothing in a
// browser goes red when an RPC key ends up in the bundle.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPublicClient, custom } = require('viem');

const { setup, deploy, findEvent, E, IMPL, ethers } = require('./helpers');
const {
  PARAMS,
  RouteError,
  blockNumberOf,
  dashboardPath,
  describeReason,
  otherRolePath,
  parseAddress,
  parseBlock,
  parseDashboardParams,
  routeMatchesAddress,
  single,
} = require('../dashboard/lib/routes');
const { loadDashboard } = require('../dashboard/lib/client');

const APP = path.join(__dirname, '..', 'dashboard', 'app');
const DAY = 86400n;

// A real checksummed address and its lowercase form, used throughout.
const ADDR = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const LOWER = ADDR.toLowerCase();

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function sourceFiles() {
  return walk(APP).filter((f) => /\.(jsx?|mjs)$/.test(f));
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function isClientComponent(text) {
  return /^\s*(['"])use client\1/m.test(text.split('\n').slice(0, 5).join('\n'));
}

if (IMPL === 'v2') {

describe('Dashboard route contract [v2]', function () {
  it('accepts a lowercase address and returns it checksummed', () => {
    const parsed = parseDashboardParams({ address: LOWER }, { role: 'buyer' });
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.address, ADDR, 'the route is a thing a person reads, so checksum it');
  });

  it('rejects a mixed-case address whose checksum does not hold, and says what it should be', () => {
    // One character changed from the real checksum. This is what a hand-retyped address looks like,
    // and lowercasing it away would throw out the only signal that it is wrong.
    const typo = `0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD`;
    const parsed = parseDashboardParams({ address: typo }, { role: 'buyer' });
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.reason, 'checksum');
    assert.strictEqual(parsed.suggestion, ADDR);
    assert.match(describeReason(parsed), /Did you mean 0x5aAeb6/);
  });

  it('accepts an all-uppercase address, which carries no checksum claim to break', () => {
    const upper = `0x${ADDR.slice(2).toUpperCase()}`;
    const parsed = parseDashboardParams({ address: upper }, { role: 'seller' });
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.address, ADDR);
  });

  it('a missing address is a first visit, not an error', () => {
    const parsed = parseDashboardParams({}, { role: 'buyer' });
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.reason, 'missing');
    assert.match(describeReason(parsed), /Connect a wallet/);
  });

  it('refuses two different addresses rather than picking one', () => {
    // ?address=a&address=b. Picking the first silently resolves a conflict between two different
    // people's finances.
    const parsed = parseDashboardParams({ address: [LOWER, '0x' + '11'.repeat(20)] }, { role: 'buyer' });
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.reason, 'ambiguous');
  });

  it('but tolerates the same address repeated, which is only a clumsy link', () => {
    const parsed = parseDashboardParams({ address: [LOWER, ADDR] }, { role: 'buyer' });
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.address, ADDR);
  });

  it('rejects anything that is not 20 bytes of hex, without throwing', () => {
    for (const bad of ['', '0x', 'not-an-address', '0x1234', `${ADDR}00`, '0xZZ' + '0'.repeat(38)]) {
      const parsed = parseDashboardParams({ address: bad }, { role: 'buyer' });
      assert.strictEqual(parsed.ok, false, `${bad} should not parse`);
      assert.ok(['missing', 'malformed'].includes(parsed.reason), `${bad} gave ${parsed.reason}`);
    }
  });

  it('never throws on user input, because a throw here is a 500 on a page about money', () => {
    const inputs = [undefined, null, {}, { address: 42 }, { address: {} }, { address: [] }, { [PARAMS.block]: 'x' }];
    for (const sp of inputs) {
      assert.doesNotThrow(() => parseDashboardParams(sp, { role: 'buyer' }), `threw on ${JSON.stringify(sp)}`);
    }
  });

  it('does throw on a bad role, because that one comes from the code', () => {
    assert.throws(() => parseDashboardParams({ address: ADDR }, { role: 'admin' }), RouteError);
    assert.throws(() => dashboardPath({ role: 'admin', address: ADDR }), RouteError);
  });

  it('parses the history pin and hands it back as a BigInt only at the last moment', () => {
    const parsed = parseDashboardParams({ address: ADDR, at: '0042' }, { role: 'buyer' });
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.block, '42', 'a string across the render boundary, never a BigInt');
    assert.strictEqual(blockNumberOf(parsed), 42n, 'and a BigInt where viem wants one');
    assert.strictEqual(blockNumberOf({ block: null }), undefined, 'no pin means latest');
  });

  it('rejects a block that is not a whole number but still reports the address', () => {
    const parsed = parseDashboardParams({ address: ADDR, at: '12.5' }, { role: 'buyer' });
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.reason, 'block');
    assert.strictEqual(parsed.address, ADDR);
    assert.strictEqual(parseBlock('-1').ok, false);
    assert.strictEqual(parseBlock('1e5').ok, false);
  });

  it('reports the address problem first when both the address and the block are unreadable', () => {
    const parsed = parseDashboardParams({ address: 'nope', at: 'also-nope' }, { role: 'buyer' });
    assert.strictEqual(parsed.reason, 'malformed', 'the address is the one worth fixing first');
  });

  it('builds paths the parser accepts, which is what makes the island and the pages agree', () => {
    const p = dashboardPath({ role: 'buyer', address: LOWER, block: 99n });
    assert.strictEqual(p, `/buyer?address=${ADDR}&at=99`);
    const sp = Object.fromEntries(new URLSearchParams(p.split('?')[1]));
    const round = parseDashboardParams(sp, { role: 'buyer' });
    assert.strictEqual(round.ok, true);
    assert.strictEqual(round.address, ADDR);
    assert.strictEqual(round.block, '99');
    assert.strictEqual(dashboardPath({ role: 'seller' }), '/seller');
  });

  it('refuses to build a path for an address it would not accept back', () => {
    assert.throws(() => dashboardPath({ role: 'buyer', address: '0x123' }), RouteError);
    assert.throws(() => dashboardPath({ role: 'buyer', address: ADDR, block: 'x' }), RouteError);
  });

  it('switches role while keeping the address and the pin', () => {
    const parsed = parseDashboardParams({ address: LOWER, at: '7' }, { role: 'buyer' });
    assert.strictEqual(otherRolePath(parsed), `/seller?address=${ADDR}&at=7`);
    assert.strictEqual(otherRolePath({ role: 'seller', address: null, block: null }), '/buyer');
  });

  it('compares route to wallet case-insensitively, which is what stops a navigation loop', () => {
    // wagmi reports a checksummed address; a hand-typed URL is usually lowercase. A strict === here
    // means the island calls router.replace on every render forever.
    const parsed = parseDashboardParams({ address: LOWER }, { role: 'buyer' });
    assert.strictEqual(routeMatchesAddress(parsed, ADDR), true);
    assert.strictEqual(routeMatchesAddress(parsed, LOWER), true);
    assert.strictEqual(routeMatchesAddress(parsed, '0x' + '11'.repeat(20)), false);
    assert.strictEqual(routeMatchesAddress(parsed, 'garbage'), false);
    assert.strictEqual(routeMatchesAddress(null, ADDR), false);
    assert.strictEqual(routeMatchesAddress({ address: null }, ADDR), false);
  });

  it('single() handles every shape Next.js searchParams can produce', () => {
    assert.deepStrictEqual(single(undefined), { missing: true });
    assert.deepStrictEqual(single('  '), { missing: true });
    assert.deepStrictEqual(single([]), { missing: true });
    assert.deepStrictEqual(single(' a '), { value: 'a' });
    assert.deepStrictEqual(single(['a']), { value: 'a' });
    assert.strictEqual(single(['a', 'b']).ambiguous, true);
    assert.deepStrictEqual(single(7), { malformed: true });
  });
});

describe('Dashboard routes against a live chain [v2]', function () {
  this.timeout(180000);

  // The point of this half: the route contract and loadDashboard have to actually fit together. A
  // parse that returns a shape loadDashboard rejects is a page that 500s in production while every
  // unit test above stays green.
  let s, owner, seller, buyer, rp, nft, transport, publicClient;

  beforeEach(async () => {
    s = await setup();
    [owner, seller, buyer] = s.signers;
    rp = await deploy('RelicPay', [], owner);
    nft = await deploy('MockNFT', [], owner);
    await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
    const chainId = Number(await s.provider.send('eth_chainId', []));
    transport = custom({ request: ({ method, params }) => s.provider.send(method, params ?? []) });
    publicClient = createPublicClient({
      cacheTime: 0,
      pollingInterval: 0,
      chain: {
        id: chainId,
        name: 'ganache',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [] } },
      },
      transport,
    });
  });

  async function createAgreement() {
    await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
    const rc = await (await nft.connect(seller).mint(seller.address)).wait();
    const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
    await (await nft.connect(seller).approve(await rp.getAddress(), tokenId)).wait();
    const tx = await rp.createAgreementWithRWA(
      seller.address,
      buyer.address,
      E('3'),
      3n,
      30n * DAY,
      7n * DAY,
      0,
      {
        physicalId: 'IBG-OPTIC-001',
        nftContract: nft.target,
        tokenId,
        metadataURI: 'ipfs://relic/1',
        ownershipTransferred: false,
        currentOwner: seller.address,
      }
    );
    return findEvent(await tx.wait(), rp, 'AgreementCreated').agreementId;
  }

  function envFor() {
    return { RPC_URL: 'http://unused.invalid', RELICPAY_ADDRESS: ethers.getAddress(rp.target) };
  }

  async function loadParsed(parsed) {
    return loadDashboard(parsed.address, {
      role: parsed.role,
      blockNumber: blockNumberOf(parsed),
      network: 'local',
      transport,
      env: envFor(),
    });
  }

  it('a parsed route loads a real dashboard for both roles', async () => {
    await createAgreement();

    const asBuyer = parseDashboardParams({ address: buyer.address.toLowerCase() }, { role: 'buyer' });
    assert.strictEqual(asBuyer.ok, true);
    const buyerView = await loadParsed(asBuyer);
    assert.strictEqual(buyerView.role, 'buyer');
    assert.strictEqual(buyerView.summary.total, 1);

    const asSeller = parseDashboardParams({ address: seller.address.toLowerCase() }, { role: 'seller' });
    const sellerView = await loadParsed(asSeller);
    assert.strictEqual(sellerView.role, 'seller');
    assert.strictEqual(sellerView.summary.total, 1);
  });

  it('the checksummed address the route produces is the one the reader matches on', async () => {
    // The route checksums, the contract's event topics are raw 20-byte words, and the log filter is
    // built from whatever the page passes down. If checksumming broke discovery this would return
    // an empty dashboard, which looks exactly like an address with no agreements.
    await createAgreement();
    const parsed = parseDashboardParams({ address: buyer.address.toUpperCase().replace('0X', '0x') }, { role: 'buyer' });
    assert.strictEqual(parsed.ok, true);
    assert.notStrictEqual(parsed.address, buyer.address.toLowerCase(), 'checksummed, not lowercased');
    const view = await loadParsed(parsed);
    assert.strictEqual(view.summary.total, 1, 'the checksummed form still finds the agreement');
  });

  it('the ?at= pin reaches the reader, so a history link renders the past', async () => {
    const id = await createAgreement();
    const before = Number(await s.provider.send('eth_blockNumber', []));

    await (await rp.connect(buyer).processPayment(id, 1, { value: E('1') })).wait();

    const latest = parseDashboardParams({ address: buyer.address }, { role: 'buyer' });
    const now = await loadParsed(latest);
    assert.strictEqual(now.agreements[0].paidInstallments, 1);

    const pinned = parseDashboardParams({ address: buyer.address, at: String(before) }, { role: 'buyer' });
    const then = await loadParsed(pinned);
    assert.strictEqual(then.agreements[0].paidInstallments, 0, 'the pinned block predates the payment');
    assert.strictEqual(then.at.blockNumber, String(before));
  });

  it('an address with nothing on it renders empty rather than failing', async () => {
    // The ordinary case of a valid address that has never used the protocol. It must not look like
    // an error, and it must not throw inside the log scan.
    const parsed = parseDashboardParams({ address: ADDR }, { role: 'buyer' });
    const view = await loadParsed(parsed);
    assert.strictEqual(view.summary.total, 0);
    assert.deepStrictEqual(view.agreements, []);
    assert.strictEqual(JSON.parse(JSON.stringify(view)).role, 'buyer', 'still serializable');
  });
});

describe('Dashboard app structure [v2]', function () {
  // See the file header: these are import rules, and an import rule broken here ships a page that
  // works and leaks.
  it('exists, with the pages and the island the roadmap item asked for', () => {
    for (const rel of [
      'package.json',
      'next.config.mjs',
      'app/layout.jsx',
      'app/page.jsx',
      'app/buyer/page.jsx',
      'app/seller/page.jsx',
      'app/providers.jsx',
      'app/wallet/ConnectButton.jsx',
      'app/data.js',
    ]) {
      assert.ok(fs.existsSync(path.join(APP, rel)), `dashboard/app/${rel} is missing`);
    }
  });

  it('keeps its dependencies out of the root manifest the offline suite installs', () => {
    const root = JSON.parse(read(path.join(__dirname, '..', 'package.json')));
    const app = JSON.parse(read(path.join(APP, 'package.json')));
    const rootDeps = { ...root.dependencies, ...root.devDependencies };
    for (const name of ['next', 'react', 'react-dom', 'wagmi', '@tanstack/react-query', 'server-only']) {
      assert.ok(!(name in rootDeps), `${name} leaked into the root manifest`);
      assert.ok(name in app.dependencies, `${name} should be an app dependency`);
    }
    assert.ok('viem' in root.dependencies, 'the data layer still needs viem at the root');
  });

  it('only app/data.js touches the data layer, and it is marked server-only', () => {
    const data = read(path.join(APP, 'app', 'data.js'));
    assert.match(data, /^import 'server-only';/m, 'the server-only marker is the enforcement, not a comment');

    for (const file of sourceFiles()) {
      const text = read(file);
      const rel = path.relative(APP, file);
      const touchesDataLayer = /require\(['"].*lib\/(client|reader|tokens|present|abis)/.test(text)
        || /from ['"][^'"]*lib\/(client|reader|tokens|present|abis)/.test(text);
      if (!touchesDataLayer) continue;
      assert.strictEqual(rel, path.join('app', 'data.js'), `${rel} imports the data layer directly`);
    }
  });

  it('no client component imports the reader, the client or server-only', () => {
    for (const file of sourceFiles()) {
      const text = read(file);
      if (!isClientComponent(text)) continue;
      const rel = path.relative(APP, file);
      // Match the import, not the word: these files talk about the rule in their comments.
      const importsServerOnly = /(?:^|\s)(?:import|require\()\s*\(?['"]server-only['"]/.test(text);
      assert.ok(!importsServerOnly, `${rel} is a client component importing server-only`);
      const readsChain = /(?:from|require\()\s*['"][^'"]*lib\/(client|reader|tokens|present)/.test(text);
      assert.ok(!readsChain, `${rel} is a client component reading chain state`);
      // routes.js is the one data-layer module a client component may import: it is pure, has no
      // endpoint in it, and the island needs dashboardPath to write the address into the route.
    }
  });

  it('no server page imports wagmi, which is the ADR in one assertion', () => {
    for (const rel of ['app/page.jsx', 'app/buyer/page.jsx', 'app/seller/page.jsx', 'app/layout.jsx', 'app/data.js']) {
      const text = read(path.join(APP, rel));
      assert.ok(!isClientComponent(text), `${rel} should be a server component`);
      assert.ok(!/from ['"]wagmi/.test(text), `${rel} imports wagmi`);
      assert.ok(!/useReadContract|useAccount|useConnect/.test(text), `${rel} uses a wagmi hook`);
    }
  });

  it('nowhere names the RPC endpoint with a NEXT_PUBLIC_ prefix', () => {
    // NEXT_PUBLIC_ is what inlines a value into the client bundle. An endpoint with a key in it
    // inlined there is handed to every visitor, and nothing about the page looks wrong.
    for (const file of [...sourceFiles(), path.join(APP, '.env.example'), path.join(APP, 'README.md')]) {
      if (!fs.existsSync(file)) continue;
      const text = read(file);
      const rel = path.relative(APP, file);
      const offending = text
        .split('\n')
        .filter((line) => /NEXT_PUBLIC_RPC_URL/.test(line) && !/refuses|must never|not\s+NEXT_PUBLIC|No NEXT_PUBLIC_/i.test(line));
      assert.deepStrictEqual(offending, [], `${rel} names NEXT_PUBLIC_RPC_URL outside a warning`);
    }
  });

  it('every route file opts out of static prerendering', () => {
    // Without this Next prerenders the routes at build time, against an RPC endpoint that is not
    // configured yet, and then serves a snapshot of someone's finances from whenever the build ran.
    for (const rel of ['app/layout.jsx', 'app/page.jsx', 'app/buyer/page.jsx', 'app/seller/page.jsx']) {
      assert.match(read(path.join(APP, rel)), /export const dynamic = 'force-dynamic'/, `${rel} is prerenderable`);
    }
  });

  it('every relative import into ../lib resolves to a file that exists', () => {
    // These cross the project root, which is the one thing next.config.mjs has to be configured for,
    // and a typo in the number of ../ segments is a build error nobody sees until they run next.
    let checked = 0;
    for (const file of sourceFiles()) {
      const text = read(file);
      for (const m of text.matchAll(/from ['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const target = path.resolve(path.dirname(file), m[1]);
        if (!/\/dashboard\/lib\//.test(target)) continue;
        assert.ok(fs.existsSync(target), `${path.relative(APP, file)} imports missing ${m[1]}`);
        checked += 1;
      }
    }
    assert.ok(checked >= 4, `expected the app to import the data layer, found ${checked} imports`);
  });
});

}
