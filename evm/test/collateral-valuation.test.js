const assert = require('assert');
const { setup, deploy, warp, expectRevert, expectCustomError, findEvent, E, IMPL, ethers } = require('./helpers');

const DAY = 86400n;
const ETH = ethers.ZeroAddress;
const USD = (n) => BigInt(n) * 10n ** 8n; // oracle price scale

// ADR-009: collateral valuation across mixed decimals. Part a pinned the raw-sum behaviour; part b
// is the fix, so the former BUG assertions are flipped in the "oracle wired" block and the "no
// oracle" block proves a bare deploy still behaves exactly as before.
if (IMPL === 'v2') {
  describe('RelicPay collateral valuation, mixed decimals [v2]', function () {
    this.timeout(120000);
    let owner, seller, buyer, rp, usdc, dai, nft, oracle;
    const pid = (who, t) => ethers.solidityPackedKeccak256(['address', 'address', 'string'], [who, t, 'erc20']);
    const ethPid = (who) => ethers.solidityPackedKeccak256(['address', 'address', 'string'], [who, ETH, 'eth']);
    const usdc6 = (n) => BigInt(Math.round(n * 1e6));

    beforeEach(async () => {
      const s = await setup();
      [owner, seller, buyer] = s.signers;
      rp = await deploy('RelicPay', [], owner);
      usdc = await deploy('MockStablecoin', ['USD Coin', 'USDC', 6], owner);
      dai = await deploy('MockERC20', [], owner);
      nft = await deploy('MockNFT', [], owner);
      await (await rp.authorizeNFT(await nft.getAddress(), true)).wait();
      for (const t of [usdc, dai]) {
        await (await rp.authorizeToken(await t.getAddress(), true)).wait();
        await (await t.mint(buyer.address, E('1000000'))).wait();
        await (await t.connect(buyer).approve(await rp.getAddress(), ethers.MaxUint256)).wait();
      }
    });

    async function wireOracle() {
      oracle = await deploy('PriceOracle', [], owner);
      await (await oracle.addAsset(await usdc.getAddress(), 'USDC', 6, 10n ** 9n)).wait();
      await (await oracle.addAsset(await dai.getAddress(), 'DAI', 18, 10n ** 9n)).wait();
      await (await oracle.updatePrice(await usdc.getAddress(), USD(1), 99n)).wait();
      await (await oracle.updatePrice(await dai.getAddress(), USD(1), 99n)).wait();
      await (await rp.setPriceOracle(await oracle.getAddress())).wait();
    }
    // ETH ages out after 300s in a fresh PriceOracle, so anything that warps has to re-post it.
    const refreshEth = async (price = USD(2000)) => (await oracle.updatePrice(ETH, price, 95n)).wait();

    async function mintRelic() {
      const rc = await (await nft.connect(seller).mint(seller.address)).wait();
      const tokenId = findEvent(rc, nft, 'Transfer').tokenId;
      await (await nft.connect(seller).approve(await rp.getAddress(), tokenId)).wait();
      return tokenId;
    }
    async function agreement(total, method, over = {}) {
      const tokenId = await mintRelic();
      const rwa = {
        physicalId: 'IBG-OPTIC-001', nftContract: nft.target, tokenId,
        metadataURI: 'ipfs://relic/1', ownershipTransferred: false, currentOwner: seller.address,
      };
      const p = Object.assign({ count: 3n, interval: 30n * DAY, grace: 7n * DAY }, over);
      const tx = await rp.createAgreementWithRWA(seller.address, buyer.address, total, p.count, p.interval, p.grace, method, rwa);
      return findEvent(await tx.wait(), rp, 'AgreementCreated').agreementId;
    }

    describe('no oracle wired: legacy raw-amount behaviour is unchanged', () => {
      it('priceOracle defaults to zero', async () => {
        assert.equal(await rp.priceOracle(), ETH);
      });

      it('collateral value is the raw amount sum, whatever the decimals', async () => {
        await (await rp.connect(buyer).depositETHCollateral(false, { value: E('1') })).wait();
        await (await rp.connect(buyer).depositERC20Collateral(await usdc.getAddress(), E('1'))).wait();
        assert.equal(await rp.getTotalCollateralValue(buyer.address), E('2'));
        assert.equal((await rp.getCreditLine(buyer.address)).creditLimit, E('1.6'));
      });

      it('the raw 1e18 minimum still applies to a 6-decimal token', async () => {
        await expectRevert(rp.connect(buyer).depositERC20Collateral(await usdc.getAddress(), usdc6(1000)), 'Insufficient collateral');
        await (await rp.connect(buyer).depositERC20Collateral(await usdc.getAddress(), 10n ** 18n)).wait();
      });

      it('the 18-decimal ERC20 case is valued 1:1 with ETH', async () => {
        await (await rp.connect(buyer).depositERC20Collateral(await dai.getAddress(), E('10'))).wait();
        assert.equal(await rp.getTotalCollateralValue(buyer.address), E('10'));
      });
    });

    describe('setPriceOracle', () => {
      it('is governance gated, emits, and can be unwired', async () => {
        oracle = await deploy('PriceOracle', [], owner);
        const addr = await oracle.getAddress();
        await expectCustomError(rp.connect(buyer).setPriceOracle.staticCall(addr), 'UnauthorizedGovernance');
        const rc = await (await rp.setPriceOracle(addr)).wait();
        const ev = findEvent(rc, rp, 'PriceOracleUpdated');
        assert.equal(ev.previousOracle, ETH);
        assert.equal(ev.newOracle, addr);
        assert.equal(await rp.priceOracle(), addr);
        await (await rp.setPriceOracle(ETH)).wait();
        assert.equal(await rp.priceOracle(), ETH);
      });

      it('refuses an address that cannot answer an ETH price, or a stale oracle', async () => {
        await expectRevert(rp.setPriceOracle(await usdc.getAddress()));
        oracle = await deploy('PriceOracle', [], owner);
        await warp(400);
        await expectCustomError(rp.setPriceOracle.staticCall(await oracle.getAddress()), 'StalePrice');
      });

      it('an appointed governor may wire it too', async () => {
        await wireOracle();
        await (await rp.setGovernor(buyer.address)).wait();
        await (await rp.connect(buyer).setPriceOracle(ETH)).wait();
        assert.equal(await rp.priceOracle(), ETH);
      });
    });

    describe('oracle wired (ETH = $2000, stablecoins = $1)', () => {
      beforeEach(wireOracle);

      it('values positions in ETH wei: 1 ETH + 2000 USDC reads as 2 ETH', async () => {
        await (await rp.connect(buyer).depositETHCollateral(false, { value: E('1') })).wait();
        await (await rp.connect(buyer).depositERC20Collateral(await usdc.getAddress(), usdc6(2000))).wait();
        assert.equal(await rp.getTotalCollateralValue(buyer.address), E('2'));
        const cl = await rp.getCreditLine(buyer.address);
        assert.equal(cl.collateralValue, E('2'));
        assert.equal(cl.creditLimit, E('1.6'));
      });

      it('a 6-decimal and an 18-decimal deposit of the same dollar value earn the same credit', async () => {
        await (await rp.connect(buyer).depositERC20Collateral(await usdc.getAddress(), usdc6(4000))).wait();
        const viaUsdc = (await rp.getCreditLine(buyer.address)).creditLimit;
        await (await rp.connect(buyer).depositERC20Collateral(await dai.getAddress(), E('4000'))).wait();
        assert.equal(viaUsdc, E('1.6'));
        assert.equal((await rp.getCreditLine(buyer.address)).creditLimit - viaUsdc, viaUsdc);
      });

      it('the minimum means at least 1 ETH worth, so 1,000 USDC is refused and 2,000 USDC is not', async () => {
        const u = await usdc.getAddress();
        await expectCustomError(rp.connect(buyer).depositERC20Collateral.staticCall(u, usdc6(1000)), 'Insufficient collateral');
        await expectCustomError(rp.connect(buyer).depositERC20Collateral.staticCall(u, usdc6(1999.999999)), 'Insufficient collateral');
        await (await rp.connect(buyer).depositERC20Collateral(u, usdc6(2000))).wait();
        assert.equal((await rp.getCollateralPosition(buyer.address, pid(buyer.address, u))).amount, usdc6(2000));
      });

      it('follows the ETH price: the same USDC is worth less ETH when ETH rises', async () => {
        await (await rp.connect(buyer).depositERC20Collateral(await usdc.getAddress(), usdc6(2000))).wait();
        assert.equal(await rp.getTotalCollateralValue(buyer.address), E('1'));
        await refreshEth(USD(4000));
        assert.equal(await rp.getTotalCollateralValue(buyer.address), E('0.5'));
      });

      it('rounds against the buyer: a value is never above the exact quotient', async () => {
        await refreshEth(USD(3));
        const raw = usdc6(7) + 1n; // 7.000001 USDC at $1 against a $3 ETH
        await (await rp.setMinCollateralAmount(1n)).wait();
        await (await rp.connect(buyer).depositERC20Collateral(await usdc.getAddress(), raw)).wait();
        const exactNumerator = raw * USD(1) * 10n ** 18n; // raw * price * 1e18
        const v = await rp.getTotalCollateralValue(buyer.address);
        // exact = raw/1e6 * 1e8 * 1e18 / (3 * 1e8) ; compare without division
        assert.ok(v * USD(3) * 10n ** 6n <= exactNumerator);
        assert.ok((v + 1n) * USD(3) * 10n ** 6n > exactNumerator);
      });

      it('staking rewards are added after normalization, not priced', async () => {
        await (await rp.connect(buyer).depositETHCollateral(true, { value: E('10') })).wait();
        const before = await rp.getTotalCollateralValue(buyer.address);
        await (await rp.connect(buyer).depositERC20Collateral(await usdc.getAddress(), usdc6(2000))).wait();
        assert.equal(await rp.getTotalCollateralValue(buyer.address) - before, E('1'));
      });

      it('a stale ETH price reverts the operations that need a value, and refreshing fixes it', async () => {
        const u = await usdc.getAddress();
        await warp(400);
        await expectCustomError(rp.connect(buyer).depositERC20Collateral.staticCall(u, usdc6(2000)), 'StalePrice');
        await refreshEth();
        await (await rp.connect(buyer).depositERC20Collateral(u, usdc6(2000))).wait();
        await warp(400);
        const p = pid(buyer.address, u);
        await expectCustomError(rp.connect(buyer).withdrawCollateral.staticCall(p, 1n), 'StalePrice');
        // With no open credit the headroom is just principal and needs no price, so the view still answers.
        assert.equal(await rp.getWithdrawableCollateral(buyer.address, p), usdc6(2000));
        await refreshEth();
        assert.equal(await rp.getWithdrawableCollateral(buyer.address, p), usdc6(2000));
      });

      it('withdrawal headroom is converted back to the position unit, and the edge is exact', async () => {
        const u = await usdc.getAddress();
        await (await rp.connect(buyer).depositETHCollateral(false, { value: E('1') })).wait();
        await (await rp.connect(buyer).depositERC20Collateral(u, usdc6(4000))).wait();
        // value 3 ETH, limit 2.4. Using 1.6 needs 2 ETH behind it, so 1 ETH of value is spare.
        await agreement(E('1.6'), 0);
        const up = pid(buyer.address, u);
        assert.equal(await rp.getWithdrawableCollateral(buyer.address, ethPid(buyer.address)), E('1'));
        assert.equal(await rp.getWithdrawableCollateral(buyer.address, up), usdc6(2000));

        await expectCustomError(rp.connect(buyer).withdrawCollateral.staticCall(up, usdc6(2000) + 1n), 'CollateralBacksOpenCredit');
        await (await rp.connect(buyer).withdrawCollateral(up, usdc6(2000))).wait();
        const cl = await rp.getCreditLine(buyer.address);
        assert.equal(cl.creditLimit, E('1.6'));
        assert.equal(cl.availableCredit, 0n);
        assert.equal(await rp.getWithdrawableCollateral(buyer.address, up), 0n);
      });

      it('with no open credit the headroom is just the principal', async () => {
        const u = await usdc.getAddress();
        await (await rp.connect(buyer).depositERC20Collateral(u, usdc6(2500))).wait();
        assert.equal(await rp.getWithdrawableCollateral(buyer.address, pid(buyer.address, u)), usdc6(2500));
      });

      it('a collateral-method payment draws the installment in wei-equivalent token units', async () => {
        const u = await usdc.getAddress();
        await (await rp.connect(buyer).depositERC20Collateral(u, usdc6(4000))).wait(); // 2 ETH, limit 1.6
        const id = await agreement(E('1.2'), 2); // 3 x 0.4 ETH
        await (await rp.connect(buyer).processPayment(id, 1n)).wait();
        // 0.4 ETH at $2000 is $800
        assert.equal(await rp.getSellerTokenBalance(seller.address, u), usdc6(800));
        assert.equal((await rp.getCollateralPosition(buyer.address, pid(buyer.address, u))).amount, usdc6(3200));
        assert.equal(await rp.getTotalCollateralValue(buyer.address), E('1.6'));
      });

      it('a collateral draw spans an ETH position and a token position in the right units', async () => {
        const u = await usdc.getAddress();
        await (await rp.connect(buyer).depositETHCollateral(false, { value: E('1') })).wait();
        await (await rp.setYieldRate(ETH, 0)).wait();
        await (await rp.connect(buyer).depositERC20Collateral(u, usdc6(2000))).wait(); // 1 ETH more
        const id = await agreement(E('1.5'), 2, { count: 1n }); // one 1.5 ETH installment
        await (await rp.connect(buyer).processPayment(id, 1n)).wait();
        // ETH position first: all 1 ETH, then the remaining 0.5 ETH is $1000 of USDC
        assert.equal(await rp.getSellerBalance(seller.address), E('1'));
        assert.equal(await rp.getSellerTokenBalance(seller.address, u), usdc6(1000));
        assert.equal((await rp.getCollateralPosition(buyer.address, pid(buyer.address, u))).amount, usdc6(1000));
      });

      it('getSettlementCollateral reports ETH wei on the ETH path and token units on a token path', async () => {
        const u = await usdc.getAddress();
        await (await rp.connect(buyer).depositETHCollateral(false, { value: E('1') })).wait();
        await (await rp.connect(buyer).depositERC20Collateral(u, usdc6(2000))).wait();
        assert.equal(await rp.getSettlementCollateral(buyer.address, ETH), E('2'));
        assert.equal(await rp.getSettlementCollateral(buyer.address, u), usdc6(2000));
      });

      it('default seizure on an ETH-settled agreement takes the outstanding wei value in tokens', async () => {
        const u = await usdc.getAddress();
        await (await rp.connect(buyer).depositERC20Collateral(u, usdc6(4000))).wait();
        const id = await agreement(E('1.2'), 0); // manual, nothing paid
        await warp(40n * DAY);
        await refreshEth();
        await (await rp.connect(seller).triggerDefault(id)).wait();
        // 1.2 ETH outstanding = $2400
        assert.equal(await rp.getSellerTokenBalance(seller.address, u), usdc6(2400));
        assert.equal(await rp.collateralSeized(id), E('1.2'));
        assert.equal((await rp.getCollateralPosition(buyer.address, pid(buyer.address, u))).amount, usdc6(1600));
      });

      it('a token-settled default falls back to other collateral converted into the settlement token', async () => {
        const u = await usdc.getAddress();
        await (await rp.authorizeSettlementToken(u, true)).wait();
        await (await rp.connect(seller).setSettlementPreference(u)).wait();
        await (await rp.connect(buyer).depositETHCollateral(false, { value: E('1') })).wait();
        await (await rp.setYieldRate(ETH, 0)).wait();
        await (await rp.connect(buyer).depositERC20Collateral(await dai.getAddress(), E('2000'))).wait();
        // Agreement is denominated in USDC units: 1,800 USDC outstanding, no USDC collateral.
        const id = await agreement(usdc6(1800), 0);
        await warp(40n * DAY);
        await refreshEth();
        await (await rp.connect(seller).triggerDefault(id)).wait();
        // ETH (1 ETH = $2000) covers it first, so 0.9 ETH is taken and credited as ETH wei
        assert.equal(await rp.collateralSeized(id), usdc6(1800));
        assert.equal(await rp.getSellerBalance(seller.address), E('0.9'));
      });
    });
  });
}
