// Characterization tests for the dashboard data layer (dashboard/lib).
//
// v2 only. legacy/ has no RelicPay, no RelicRegistry and no settlement token registry, so there is
// nothing here to compare against; the legacy suite stays frozen at 51.
//
// These drive the real viem client against the real contracts on ganache, not a mock. The whole
// argument for a framework-free read layer is that it can be proved this way, so mocking the chain
// here would throw away the only reason the layer is shaped like this.

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { createPublicClient, custom } = require('viem');

const { setup, deploy, warp, findEvent, E, IMPL, ethers } = require('./helpers');
const {
  parseDeployments,
  resolveAddresses,
  AddressError,
  checksum,
  isAddress,
} = require('../dashboard/lib/addresses');
const {
  BNPL_STATE,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  COLLATERAL_TYPE,
  decodeBnplState,
  decodePaymentStatus,
  paymentMethodTraits,
  EnumError,
} = require('../dashboard/lib/enums');
const { createRelicPayReader, ReaderError } = require('../dashboard/lib/reader');
const { relicPayAbi } = require('../dashboard/lib/abis');
const exportAbis = require('../tools/export-abis');

const DAY = 86400n;
const ZERO = '0x0000000000000000000000000000000000000000';

// v2 only, whole file. The dashboard is a v2 artifact and legacy/ is the frozen spec: the legacy
// run stays at exactly 51 so a change to its count still means what it has always meant. Everything
// below therefore lives behind this gate, including the tests that need no chain at all.
if (IMPL === 'v2') {

// Pure tests: no chain, no deployment. These guard the generated ABI and the enum ordering, which
// is where a silent contract drift would land.
describe('Dashboard lib, pure [v2]', function () {
  it('generated ABI export is in sync with the compiled contracts', () => {
    const { js, dts } = exportAbis.render();
    const dir = exportAbis.OUT_DIR;
    assert.strictEqual(
      fs.readFileSync(path.join(dir, 'abis.js'), 'utf8'),
      js,
      'dashboard/lib/abis.js is stale, run: npm run abi:export'
    );
    assert.strictEqual(
      fs.readFileSync(path.join(dir, 'abis.d.ts'), 'utf8'),
      dts,
      'dashboard/lib/abis.d.ts is stale, run: npm run abi:export'
    );
  });

  it('generated abis.d.ts compiles and still gives viem live type inference', function () {
    // Skipped rather than failed when typescript is not installed: the rest of this suite is a
    // fully offline solc + ganache toolchain and must not start requiring a TS compiler to run.
    let tsc;
    try {
      tsc = require.resolve('typescript/bin/tsc');
    } catch (_) {
      this.skip();
      return;
    }
    this.timeout(180000);
    const root = path.join(__dirname, '..');
    const r = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'dashboard', 'tsconfig.json')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.strictEqual(
      r.status,
      0,
      'dashboard/lib type-check failed:\n' + (r.stdout || '') + (r.stderr || '')
    );
  });

  it('exported ABI excludes libraries and keeps the protocol contracts', () => {
    assert.ok(!exportAbis.CONTRACTS.includes('SafeERC20'));
    assert.ok(!exportAbis.CONTRACTS.includes('Math'));
    for (const c of ['RelicPay', 'RelicRegistry', 'PriceOracle']) {
      assert.ok(exportAbis.CONTRACTS.includes(c), `${c} missing from export allowlist`);
    }
    assert.ok(relicPayAbi.some((e) => e.type === 'function' && e.name === 'getAgreement'));
    assert.ok(relicPayAbi.some((e) => e.type === 'event' && e.name === 'AgreementCreated'));
  });

  it('enum label order matches the compiled contract, so a reorder fails here not in the UI', () => {
    // Anchored against the ABI's internalType strings, which carry the enum name solc resolved.
    // If BnplState ever grows or reorders, the decoder tables below have to move with it.
    const agreement = relicPayAbi.find((e) => e.name === 'getAgreement');
    const fields = agreement.outputs[0].components;
    const byName = Object.fromEntries(fields.map((f) => [f.name, f.internalType]));
    assert.strictEqual(byName.state, 'enum RelicPay.BnplState');
    assert.strictEqual(byName.paymentMethod, 'enum RelicPay.PaymentMethod');
    assert.deepStrictEqual(BNPL_STATE, ['Active', 'Completed', 'Defaulted']);
    assert.deepStrictEqual(PAYMENT_METHOD, ['Manual', 'Auto', 'Collateral', 'AutoWithCollateral']);
    assert.deepStrictEqual(PAYMENT_STATUS, ['Pending', 'Paid', 'Overdue', 'Defaulted']);
    assert.deepStrictEqual(COLLATERAL_TYPE, ['ETH', 'ERC20', 'StakedETH', 'LiquidStakingToken']);
  });

  it('an unknown enum variant throws instead of rendering a plausible page', () => {
    assert.strictEqual(decodeBnplState(2), 'Defaulted');
    assert.throws(() => decodeBnplState(3), EnumError);
    assert.throws(() => decodePaymentStatus(9), EnumError);
  });

  it('payment method traits separate buyer-signed from pool-funded settlement', () => {
    assert.deepStrictEqual(paymentMethodTraits('Manual'), {
      label: 'Manual',
      usesAutoBalance: false,
      usesCollateral: false,
      requiresBuyerTransaction: true,
    });
    const awc = paymentMethodTraits('AutoWithCollateral');
    assert.ok(awc.usesAutoBalance && awc.usesCollateral && !awc.requiresBuyerTransaction);
    assert.ok(paymentMethodTraits('Collateral').usesCollateral);
    assert.ok(!paymentMethodTraits('Collateral').usesAutoBalance);
  });

  it('parses the deployments file DeployAll.s.sol actually writes', () => {
    const out = parseDeployments(
      [
        '# written by DeployAll.s.sol',
        'RELIC_REGISTRY=0x1111111111111111111111111111111111111111',
        'RELIC_PAY=0x2222222222222222222222222222222222222222',
        'PRICE_ORACLE=0x3333333333333333333333333333333333333333',
        'DEFI_INTEGRATION=0x4444444444444444444444444444444444444444',
        'GOVERNANCE=0x0000000000000000000000000000000000000000',
        'DEPLOYER=0x5555555555555555555555555555555555555555',
        '',
      ].join('\n')
    );
    assert.strictEqual(out.relicPay, '0x2222222222222222222222222222222222222222');
    assert.strictEqual(out.governance, ZERO);
    assert.ok(!('deployer' in out), 'unknown keys are informational, not addresses');
  });

  it('a malformed deployments line is an error, not a silent skip', () => {
    assert.throws(() => parseDeployments('RELIC_PAY 0x2222'), AddressError);
    assert.throws(
      () => parseDeployments('RELIC_PAY=not-an-address'),
      AddressError,
      'a truncated address must not resolve'
    );
  });

  it('resolves addresses override > env > file, and drops the zero address', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-deploy-'));
    fs.mkdirSync(path.join(root, 'deployments'));
    fs.writeFileSync(
      path.join(root, 'deployments', 'sepolia.txt'),
      'RELIC_PAY=0x1111111111111111111111111111111111111111\n' +
        'PRICE_ORACLE=0x3333333333333333333333333333333333333333\n' +
        'GOVERNANCE=0x0000000000000000000000000000000000000000\n'
    );

    const fileOnly = resolveAddresses({ root, env: {} });
    assert.strictEqual(fileOnly.relicPay, '0x1111111111111111111111111111111111111111');
    assert.ok(!('governance' in fileOnly), 'an ungoverned deploy is absent, never a callable zero');

    const withEnv = resolveAddresses({
      root,
      env: { NEXT_PUBLIC_RELICPAY_ADDRESS: '0x2222222222222222222222222222222222222222' },
    });
    assert.strictEqual(withEnv.relicPay, '0x2222222222222222222222222222222222222222');
    assert.strictEqual(withEnv.priceOracle, '0x3333333333333333333333333333333333333333');

    const withOverride = resolveAddresses({
      root,
      env: { NEXT_PUBLIC_RELICPAY_ADDRESS: '0x2222222222222222222222222222222222222222' },
      overrides: { relicPay: '0x4444444444444444444444444444444444444444' },
    });
    assert.strictEqual(withOverride.relicPay, '0x4444444444444444444444444444444444444444');

    assert.throws(
      () => resolveAddresses({ root, env: {}, require: ['relicPay', 'relicRegistry'] }),
      /relicRegistry/,
      'a required contract with no address must name itself, not fail later as a zero-address call'
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('checksums addresses so viem does not reject a lowercase deployments file', () => {
    const keccak = (hex) => ethers.keccak256(ethers.toUtf8Bytes(hex));
    const mixed = checksum('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'.toLowerCase(), keccak);
    assert.strictEqual(mixed, ethers.getAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'));
    assert.ok(isAddress(mixed));
  });
});

describe('Dashboard reader against a live chain [v2]', function () {
    this.timeout(180000);

    let s, owner, seller, buyer, other, rp, registry, nft, usd, publicClient, reader;

    // viem talks to the same ganache instance the ethers helpers drive, through its EIP-1193
    // interface. One chain, two clients: the fixtures are built with the existing ethers helpers so
    // this test cannot drift from the rest of the suite, and every assertion reads back through the
    // viem path the browser will use.
    async function makeViemClient(provider) {
      const chainId = Number(await provider.send('eth_chainId', []));
      return createPublicClient({
        // cacheTime 0 is required here, not a nicety. viem caches getBlockNumber for its polling
        // interval (4s by default), and these tests jump months with evm_increaseTime and then read
        // immediately, so a cached block number pins every read to before the warp and the
        // assertions describe the past. A browser client should keep the cache; a test that
        // controls the clock cannot.
        cacheTime: 0,
        pollingInterval: 0,
        chain: {
          id: chainId,
          name: 'ganache',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [] } },
        },
        transport: custom({
          request: ({ method, params }) => provider.send(method, params ?? []),
        }),
      });
    }

    beforeEach(async () => {
      s = await setup();
      [owner, seller, buyer, other] = s.signers;
      rp = await deploy('RelicPay', [], owner);
      registry = await deploy('RelicRegistry', [], owner);
      nft = await deploy('MockNFT', [], owner);
      usd = await deploy('MockERC20', [], owner);
      await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
      await (await rp.authorizeNFT(await registry.getAddress(), true)).wait();
      publicClient = await makeViemClient(s.provider);
      reader = createRelicPayReader({
        publicClient,
        addresses: { relicPay: ethers.getAddress(await rp.getAddress()) },
      });
    });

    // createAgreementWithRWA draws against the buyer's credit line, so a buyer with no collateral
    // cannot be a party to an agreement at all. Fixtures that only care about agreement shape fund
    // generously and do not assert on the resulting collateral; the tests that do assert on
    // collateral or credit deposit their own exact amounts instead of calling this.
    async function giveCredit(who, amount) {
      await (await rp.connect(who).depositETHCollateral(false, { value: amount })).wait();
    }

    async function mintToSeller() {
      const rc = await (await nft.connect(seller).mint(seller.address)).wait();
      const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
      await (await nft.connect(seller).approve(await rp.getAddress(), tokenId)).wait();
      return tokenId;
    }

    function rwa(tokenId, physicalId = 'IBG-OPTIC-001') {
      return {
        physicalId,
        nftContract: nft.target,
        tokenId,
        metadataURI: 'ipfs://relic/1',
        ownershipTransferred: false,
        currentOwner: seller.address,
      };
    }

    async function createAgreement(total, method, over = {}) {
      const tokenId = await mintToSeller();
      const p = Object.assign({ count: 3n, interval: 30n * DAY, grace: 7n * DAY }, over);
      const tx = await rp.createAgreementWithRWA(
        over.seller || seller.address,
        over.buyer || buyer.address,
        total,
        p.count,
        p.interval,
        p.grace,
        method,
        rwa(tokenId, over.physicalId)
      );
      return findEvent(await tx.wait(), rp, 'AgreementCreated').agreementId;
    }

    it('finds a buyer\'s agreements by event and hydrates them from chain state', async () => {
      await giveCredit(buyer, E('10'));
      const id = await createAgreement(E('3'), 0);
      const ids = await reader.getAgreementIds(ethers.getAddress(buyer.address), { role: 'buyer' });
      assert.deepStrictEqual(ids, [id]);

      const a = await reader.getAgreement(id);
      assert.strictEqual(a.state, 'Active');
      assert.strictEqual(a.paymentMethod.label, 'Manual');
      assert.ok(a.paymentMethod.requiresBuyerTransaction);
      assert.strictEqual(a.totalPrice, E('3'));
      assert.strictEqual(a.installmentCount, 3);
      assert.strictEqual(a.paidInstallments, 0);
      assert.strictEqual(a.outstanding, E('3'));
      assert.strictEqual(a.schedule.length, 3);
      assert.strictEqual(a.next.installmentNumber, 1n);
      assert.strictEqual(a.relic.physicalId, 'IBG-OPTIC-001');
      assert.strictEqual(a.relic.ownershipTransferred, false);
    });

    it('does not return an agreement the user is not a party to', async () => {
      await giveCredit(buyer, E('10'));
      await createAgreement(E('3'), 0);
      const ids = await reader.getAgreementIds(ethers.getAddress(other.address), { role: 'any' });
      assert.deepStrictEqual(ids, []);
    });

    it('separates the buyer and seller roles, and role "any" returns both', async () => {
      await giveCredit(buyer, E('20'));
      await giveCredit(seller, E('20'));
      const asSeller = await createAgreement(E('2'), 0);
      // Same address on the other side of a second agreement.
      const asBuyer = await createAgreement(E('4'), 0, {
        seller: buyer.address,
        buyer: seller.address,
        physicalId: 'IBG-OPTIC-002',
      });
      const user = ethers.getAddress(seller.address);
      assert.deepStrictEqual(await reader.getAgreementIds(user, { role: 'seller' }), [asSeller]);
      assert.deepStrictEqual(await reader.getAgreementIds(user, { role: 'buyer' }), [asBuyer]);
      const both = await reader.getAgreementIds(user, { role: 'any' });
      assert.strictEqual(both.length, 2);
      assert.ok(both.includes(asSeller) && both.includes(asBuyer));
    });

    it('hydrates from chain state, not from the creation log', async () => {
      await giveCredit(buyer, E('10'));
      const id = await createAgreement(E('3'), 0);
      await (await rp.connect(buyer).processPayment(id, 1, { value: E('1') })).wait();
      const a = await reader.getAgreement(id);
      // The AgreementCreated log still says 0 paid; only a live call knows otherwise.
      assert.strictEqual(a.paidInstallments, 1);
      assert.strictEqual(a.totalPaid, E('1'));
      assert.strictEqual(a.outstanding, E('2'));
      assert.strictEqual(a.progress.ratio, 1 / 3);
      assert.strictEqual(a.schedule[0].storedStatus, 'Paid');
      assert.strictEqual(a.schedule[0].isOverdue, false);
      assert.strictEqual(a.next.installmentNumber, 2n);
    });

    it('derives overdue from the due date, not from the stale stored status', async () => {
      await giveCredit(buyer, E('10'));
      const id = await createAgreement(E('3'), 0);
      await warp(40n * DAY); // past installment 1's due date, inside the 7 day grace
      const a = await reader.getAgreement(id);
      // The contract has not been asked to advance the record, so storage still says Pending.
      assert.strictEqual(a.schedule[0].storedStatus, 'Pending');
      // The dashboard must not repeat that to the buyer.
      assert.strictEqual(a.schedule[0].isOverdue, true);
      assert.strictEqual(a.next.isOverdue, true);
      assert.strictEqual(a.overdueCount, 1);
      assert.ok(a.schedule[0].secondsUntilDue < 0n);
    });

    it('flags defaultable only once the grace period has actually expired', async () => {
      await giveCredit(buyer, E('10'));
      const id = await createAgreement(E('3'), 0);
      await warp(31n * DAY); // overdue, grace still running
      let a = await reader.getAgreement(id);
      assert.strictEqual(a.next.isOverdue, true);
      assert.strictEqual(a.defaultable, false);
      assert.ok(a.next.secondsUntilGraceExpiry > 0n);

      await warp(8n * DAY); // grace expired
      a = await reader.getAgreement(id);
      assert.strictEqual(a.defaultable, true);
      assert.ok(a.next.secondsUntilGraceExpiry <= 0n);
    });

    it('a defaulted agreement still reports what is owed', async () => {
      await giveCredit(buyer, E('10'));
      const id = await createAgreement(E('3'), 0);
      await (await rp.connect(buyer).processPayment(id, 1, { value: E('1') })).wait();
      await warp(70n * DAY);
      await (await rp.connect(seller).triggerDefault(id)).wait();

      const a = await reader.getAgreement(id);
      assert.strictEqual(a.state, 'Defaulted');
      // getDefaultStatus zeroes out for non-Active agreements. Taking outstanding from it would
      // render 2 ETH of unpaid debt as a settled agreement.
      assert.strictEqual(a.outstanding, E('2'));
      assert.strictEqual(a.totalPaid, E('1'));
      assert.ok(a.defaultedAt !== null && a.defaultedAt > 0n);
      assert.strictEqual(a.next, null);
      assert.strictEqual(a.settlement, null, 'no settlement terms once the agreement is closed');
    });

    it('a completed agreement reports the relic moved and stops asking for money', async () => {
      await giveCredit(buyer, E('10'));
      const id = await createAgreement(E('3'), 0);
      for (const n of [1, 2, 3]) {
        await (await rp.connect(buyer).processPayment(id, n, { value: E('1') })).wait();
      }
      const a = await reader.getAgreement(id);
      assert.strictEqual(a.state, 'Completed');
      assert.strictEqual(a.outstanding, 0n);
      assert.strictEqual(a.progress.ratio, 1);
      assert.strictEqual(a.next, null);
      assert.strictEqual(a.settlement, null);
      assert.strictEqual(a.relic.ownershipTransferred, true);
      assert.strictEqual(
        (await nft.ownerOf(a.relic.tokenId)).toLowerCase(),
        buyer.address.toLowerCase()
      );
    });

    it('settlement readiness distinguishes a funded pool from an empty one', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const id = await createAgreement(E('3'), 1); // Auto
      let a = await reader.getAgreement(id);
      assert.strictEqual(a.paymentMethod.label, 'Auto');
      assert.strictEqual(a.settlement.ready, false, 'auto pool is empty at creation');
      assert.strictEqual(a.settlement.required, E('1'));
      assert.strictEqual(a.settlement.token, null, 'null means native ETH, never the zero address');

      await (await rp.connect(buyer).depositAutoPaymentFunds({ value: E('1') })).wait();
      a = await reader.getAgreement(id);
      assert.strictEqual(a.settlement.ready, true);
      assert.strictEqual(a.settlement.autoBalance, E('1'));
    });

    it('surfaces the ERC20 allowance requirement before the buyer hits a revert', async () => {
      await giveCredit(buyer, E('10'));
      const usdAddr = await usd.getAddress();
      await (await rp.authorizeSettlementToken(usdAddr, true)).wait();
      await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
      const id = await createAgreement(E('3'), 0); // Manual, snapshotted to settle in USD

      const a = await reader.getAgreement(id);
      assert.strictEqual(a.settlement.tokenAddress.toLowerCase(), usdAddr.toLowerCase());
      assert.strictEqual(a.settlement.token.toLowerCase(), usdAddr.toLowerCase());
      // A Manual agreement settling in an ERC20 needs an allowance first. The UI has to know
      // before it renders a Pay button, not after the revert.
      assert.strictEqual(a.settlement.requiresApproval, true);
      assert.strictEqual(a.settlement.required, E('1'));
    });

    it('reports the credit line and its clamp honestly', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('10') })).wait();
      const credit = await reader.getCreditLine(ethers.getAddress(buyer.address));
      assert.strictEqual(credit.collateralValue, E('10'));
      assert.ok(credit.creditLimit > 0n);
      assert.strictEqual(credit.usedCredit, 0n);
      assert.strictEqual(credit.isClamped, false);
      assert.strictEqual(credit.isOverLimit, false);
      assert.strictEqual(credit.trueUtilizationBps, 0n);
      assert.strictEqual(credit.totalCollateralValue, E('10'));
    });

    it('lists collateral positions with ETH rendered as native, not as token 0x0', async () => {
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('5') })).wait();
      const usdAddr = await usd.getAddress();
      await (await rp.authorizeToken(usdAddr, true)).wait();
      await (await usd.mint(buyer.address, 1000n * 10n ** 18n)).wait();
      await (await usd.connect(buyer).approve(await rp.getAddress(), 1000n * 10n ** 18n)).wait();
      await (await rp.connect(buyer).depositERC20Collateral(usdAddr, 1000n * 10n ** 18n)).wait();

      const positions = await reader.getCollateralPositions(ethers.getAddress(buyer.address));
      assert.strictEqual(positions.length, 2);
      const eth = positions.find((p) => p.collateralType === 'ETH');
      const erc = positions.find((p) => p.collateralType === 'ERC20');
      assert.strictEqual(eth.token, null);
      assert.strictEqual(eth.amount, E('5'));
      assert.strictEqual(eth.isStaked, false);
      assert.strictEqual(erc.token.toLowerCase(), usdAddr.toLowerCase());
      assert.strictEqual(erc.amount, 1000n * 10n ** 18n);
    });

    it('marks a staked position as staked', async () => {
      await (await rp.connect(buyer).depositETHCollateral(true, { value: E('4') })).wait();
      const [p] = await reader.getCollateralPositions(ethers.getAddress(buyer.address));
      assert.strictEqual(p.collateralType, 'StakedETH');
      assert.strictEqual(p.isStaked, true);
    });

    it('buyer dashboard assembles credit, collateral, pools and agreements at one block', async () => {
      // 20 ETH of collateral at the default 80% ratio is a 16 ETH credit limit, enough for both
      // agreements below; the credit line is what gates agreement creation.
      await (await rp.connect(buyer).depositETHCollateral(false, { value: E('20') })).wait();
      await (await rp.connect(buyer).depositAutoPaymentFunds({ value: E('2') })).wait();
      await (await rp.connect(buyer).setAutoPayment(true)).wait();
      const a1 = await createAgreement(E('3'), 1); // Auto, funded
      const a2 = await createAgreement(E('9'), 1, { physicalId: 'IBG-OPTIC-002' }); // Auto, 3 each, funded too

      const d = await reader.getBuyerDashboard(ethers.getAddress(buyer.address));
      assert.strictEqual(d.agreements.length, 2);
      assert.strictEqual(d.summary.active, 2);
      assert.strictEqual(d.summary.outstanding, E('12'));
      assert.strictEqual(d.autoPayment.enabled, true);
      assert.strictEqual(d.autoPayment.ethBalance, E('2'));
      assert.strictEqual(d.totalCollateral, E('20'));
      assert.ok(d.credit.creditLimit > 0n);
      // Every read in the dashboard came from the same block, so a UI cannot render a credit line
      // from one block beside a schedule from another.
      assert.ok(d.at.blockNumber > 0n);
      for (const a of d.agreements) assert.strictEqual(a.at.blockNumber, d.at.blockNumber);
      assert.strictEqual(d.credit.at.blockNumber, d.at.blockNumber);
      // a1 needs 1 ETH and the pool holds 2, a2 needs 3 and it does not.
      assert.deepStrictEqual(
        d.summary.underfunded.map((a) => a.id),
        [a2]
      );
      assert.ok(d.agreements.find((a) => a.id === a1).settlement.ready);
    });

    it('buyer dashboard counts overdue and at-risk agreements separately', async () => {
      await giveCredit(buyer, E('10'));
      const id = await createAgreement(E('3'), 0);
      await warp(31n * DAY);
      let d = await reader.getBuyerDashboard(ethers.getAddress(buyer.address));
      assert.strictEqual(d.summary.overdue.length, 1);
      assert.strictEqual(d.summary.atRisk.length, 0, 'overdue is not yet defaultable');

      await warp(8n * DAY);
      d = await reader.getBuyerDashboard(ethers.getAddress(buyer.address));
      assert.strictEqual(d.summary.overdue.length, 1);
      assert.deepStrictEqual(
        d.summary.atRisk.map((a) => a.id),
        [id]
      );
    });

    it('seller dashboard shows receivables, withdrawable balance and default actions', async () => {
      await giveCredit(buyer, E('10'));
      const id = await createAgreement(E('3'), 0);
      await (await rp.connect(buyer).processPayment(id, 1, { value: E('1') })).wait();

      let d = await reader.getSellerDashboard(ethers.getAddress(seller.address));
      assert.strictEqual(d.agreements.length, 1);
      assert.strictEqual(d.settlementPreference, null, 'null means this seller takes ETH');
      assert.strictEqual(d.balances.eth, E('1'));
      assert.strictEqual(d.withdrawable.eth, true);
      assert.strictEqual(d.summary.receivable, E('2'));
      assert.strictEqual(d.summary.defaultable.length, 0);
      assert.strictEqual(d.summary.staleSchedules.length, 0);

      await warp(70n * DAY);
      d = await reader.getSellerDashboard(ethers.getAddress(seller.address));
      assert.deepStrictEqual(
        d.summary.defaultable.map((a) => a.id),
        [id]
      );
      // The seller is the one who would pay to advance the stored schedule, so the gap between
      // derived-overdue and stored-Pending is surfaced to them and to nobody else.
      assert.deepStrictEqual(
        d.summary.staleSchedules.map((a) => a.id),
        [id]
      );

      await (await rp.connect(seller).withdrawSellerBalance()).wait();
      d = await reader.getSellerDashboard(ethers.getAddress(seller.address));
      assert.strictEqual(d.balances.eth, 0n);
      assert.strictEqual(d.withdrawable.eth, false);
    });

    it('seller dashboard reports a stablecoin preference and token balances', async () => {
      const usdAddr = ethers.getAddress(await usd.getAddress());
      await (await rp.authorizeSettlementToken(usdAddr, true)).wait();
      await (await rp.connect(seller).setSettlementPreference(usdAddr)).wait();
      const d = await reader.getSellerDashboard(ethers.getAddress(seller.address));
      assert.strictEqual(d.settlementPreference, usdAddr);
      assert.strictEqual(d.balances.tokens[usdAddr], 0n);
      assert.deepStrictEqual(d.withdrawable.tokens, []);
    });

    it('reading at an older block returns that block\'s state, not the latest', async () => {
      await giveCredit(buyer, E('10'));
      const id = await createAgreement(E('3'), 0);
      const before = await publicClient.getBlockNumber();
      await (await rp.connect(buyer).processPayment(id, 1, { value: E('1') })).wait();

      const now = await reader.getAgreement(id);
      assert.strictEqual(now.paidInstallments, 1);

      const at = await reader.pin(before);
      const then = await reader.getAgreement(id, { at });
      assert.strictEqual(then.paidInstallments, 0);
      assert.strictEqual(then.totalPaid, 0n);
    });

    it('protocol info exposes governance params and an ungoverned deploy as null', async () => {
      const info = await reader.getProtocolInfo();
      assert.strictEqual(info.owner.toLowerCase(), owner.address.toLowerCase());
      assert.strictEqual(info.governor, null, 'ungoverned is null, never a callable zero address');
      assert.ok(info.params.creditLimitRatioBps > 0n);
      assert.ok(info.params.defaultGracePeriod > 0n);
    });

    it('an unknown agreement id is an error, not an empty-looking agreement', async () => {
      const bogus = '0x' + '11'.repeat(32);
      await assert.rejects(() => reader.getAgreement(bogus));
    });

    it('rejects a malformed address instead of querying the wrong thing', async () => {
      assert.throws(() => createRelicPayReader({ publicClient, addresses: {} }), ReaderError);
      await assert.rejects(() => reader.getBuyerDashboard('not-an-address'), ReaderError);
    });

    it('chunked log scanning finds every agreement regardless of chunk size', async () => {
      await giveCredit(buyer, E('20'));
      const ids = [];
      for (const n of ['A', 'B', 'C']) {
        ids.push(await createAgreement(E('3'), 0, { physicalId: 'IBG-OPTIC-' + n }));
      }
      const chunked = createRelicPayReader({
        publicClient,
        addresses: { relicPay: ethers.getAddress(await rp.getAddress()) },
        logChunkSize: 1n, // one block per eth_getLogs request
      });
      const found = await chunked.getAgreementIds(ethers.getAddress(buyer.address), { role: 'buyer' });
      assert.deepStrictEqual(found, ids, 'chunk boundaries must not drop or reorder agreements');
    });
  });
}
