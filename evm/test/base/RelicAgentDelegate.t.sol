// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./BaseSetup.sol";

contract RelicAgentDelegateTest is BaseSetup {
    address owner;
    uint256 ownerKey;
    address agent = makeAddr("agent");
    address api = makeAddr("apiPayTo");
    MockSpendPermissionManager spm;

    function setUp() public override {
        super.setUp();
        (owner, ownerKey) = makeAddrAndKey("owner");
        _fund(owner, 10_000 * USDC1);
        vm.prank(lender);
        credit.supplyLiquidity(100_000 * USDC1);
        _gov(address(credit), abi.encodeCall(RelicCreditLine.setCreditEnabled, (true)));
        vm.prank(owner);
        credit.depositCollateral(owner, 2_000 * USDC1); // $1,600 of credit
    }

    function _limits() internal view returns (RelicAgentDelegate.Limits memory l) {
        address[] memory allow = new address[](2);
        allow[0] = merchant;
        allow[1] = api;
        l = RelicAgentDelegate.Limits({
            perTxCap: uint128(200 * USDC1),
            periodCap: uint128(500 * USDC1),
            periodSeconds: 1 days,
            maxTxPerPeriod: 3,
            approvalThreshold: uint128(100 * USDC1),
            validFrom: 0,
            expiresAt: 0,
            windowStart: 0,
            windowEnd: 0,
            minIntervalSeconds: 7 days,
            maxInstallments: 4,
            allowedMerchants: allow
        });
    }

    function _mandate() internal returns (bytes32 id) {
        vm.prank(owner);
        id = delegate.createMandate(agent, _limits());
    }

    function _charge(address payee, uint256 amount, bytes32 ref) internal {
        vm.prank(agent);
        delegate.charge(owner, payee, amount, ref, 0, "");
    }

    function _sign(bytes32 id, address m, uint256 amount, bytes32 ref, uint64 deadline) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, delegate.approvalDigest(id, m, amount, ref, deadline));
        return abi.encodePacked(r, s, v);
    }

    // ───────── mandate lifecycle ─────────

    function test_createRejectsEmptyAllowlistAndBadLimits() public {
        RelicAgentDelegate.Limits memory l = _limits();
        l.allowedMerchants = new address[](0);
        vm.prank(owner);
        vm.expectRevert(RelicAgentDelegate.InvalidMandate.selector); // audit C-3: empty never means "any"
        delegate.createMandate(agent, l);

        l = _limits();
        l.periodCap = l.perTxCap - 1;
        vm.prank(owner);
        vm.expectRevert(RelicAgentDelegate.InvalidMandate.selector);
        delegate.createMandate(agent, l);

        l = _limits();
        l.allowedMerchants = new address[](9);
        vm.prank(owner);
        vm.expectRevert(RelicAgentDelegate.InvalidMandate.selector);
        delegate.createMandate(agent, l);

        l = _limits();
        l.minIntervalSeconds = 0;
        vm.prank(owner);
        vm.expectRevert(RelicAgentDelegate.InvalidMandate.selector);
        delegate.createMandate(agent, l);

        l = _limits();
        l.maxInstallments = 13;
        vm.prank(owner);
        vm.expectRevert(RelicAgentDelegate.InvalidMandate.selector);
        delegate.createMandate(agent, l);

        l = _limits();
        l.windowEnd = 86_400;
        vm.prank(owner);
        vm.expectRevert(RelicAgentDelegate.InvalidMandate.selector);
        delegate.createMandate(agent, l);
    }

    function test_revokeIsOneCallAndTerminal_closeAllowsFreshMandate() public {
        _mandate();
        vm.prank(owner);
        delegate.revokeMandate(agent);
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.MandateRevokedErr.selector);
        delegate.charge(owner, merchant, 1, bytes32("r"), 0, "");

        vm.prank(owner);
        vm.expectRevert(RelicAgentDelegate.MandateRevokedErr.selector);
        delegate.updateMandate(agent, _limits());

        vm.prank(owner);
        vm.expectRevert(RelicAgentDelegate.MandateExists.selector);
        delegate.createMandate(agent, _limits());

        vm.prank(owner);
        delegate.closeMandate(agent);
        _mandate(); // audit C-14: a revoked agent can be re-enabled with a fresh mandate
        _charge(merchant, 1, bytes32("r2"));
    }

    function test_closeRequiresRevoke() public {
        _mandate();
        vm.prank(owner);
        vm.expectRevert(RelicAgentDelegate.MandateNotRevoked.selector);
        delegate.closeMandate(agent);
    }

    function test_onlyTheBoundAgentKeyCanSpend() public {
        _mandate();
        vm.prank(stranger);
        vm.expectRevert(RelicAgentDelegate.MandateNotFound.selector);
        delegate.charge(owner, merchant, 1, bytes32("x"), 0, "");
    }

    // ───────── charge (x402 path) ─────────

    function test_chargeDrawsOnOwnersLineToPayee() public {
        _mandate();
        _charge(api, 50 * USDC1, keccak256("402-challenge-1"));
        assertEq(usdc.balanceOf(api), 50 * USDC1);
        assertEq(credit.debtOf(owner), 50 * USDC1);
        assertEq(usdc.balanceOf(agent), 0, "agent never holds funds");
        RelicAgentDelegate.Mandate memory m = delegate.getMandate(owner, agent);
        assertEq(m.periodSpent, 50 * USDC1);
        assertEq(m.totalTx, 1);
    }

    function test_chargeRefIsSingleUse() public {
        _mandate();
        bytes32 ref = keccak256("402-challenge-2");
        _charge(api, 10 * USDC1, ref);
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.RefAlreadyUsed.selector);
        delegate.charge(owner, api, 10 * USDC1, ref, 0, "");
    }

    function test_merchantAllowlistEnforced() public {
        _mandate();
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.MerchantNotApproved.selector);
        delegate.charge(owner, agent, 10 * USDC1, bytes32("self"), 0, ""); // agent naming itself
    }

    function test_capsAndCounts() public {
        _mandate();
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.PerTxCapExceeded.selector);
        delegate.charge(owner, api, 200 * USDC1 + 1, bytes32("big"), 0, "");

        _charge(api, 90 * USDC1, bytes32("a"));
        _charge(api, 90 * USDC1, bytes32("b"));
        _charge(api, 90 * USDC1, bytes32("c"));
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.PurchaseLimitReached.selector);
        delegate.charge(owner, api, 1, bytes32("d"), 0, "");

        vm.warp(vm.getBlockTimestamp() + 1 days); // new period
        _charge(api, 90 * USDC1, bytes32("e"));
    }

    function test_periodCap() public {
        RelicAgentDelegate.Limits memory l = _limits();
        l.maxTxPerPeriod = 10;
        l.approvalThreshold = 0;
        vm.prank(owner);
        delegate.createMandate(agent, l);
        _charge(api, 200 * USDC1, bytes32("1"));
        _charge(api, 200 * USDC1, bytes32("2"));
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.PeriodCapExceeded.selector);
        delegate.charge(owner, api, 100 * USDC1 + 1, bytes32("3"), 0, "");
    }

    function test_approvalThresholdNeedsOwnerSignature() public {
        bytes32 id = _mandate();
        bytes32 ref = bytes32("bigbuy");
        uint256 amount = 150 * USDC1;
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.OwnerApprovalRequired.selector);
        delegate.charge(owner, merchant, amount, ref, 0, "");

        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = _sign(id, merchant, amount, ref, deadline);

        // A signature for a different amount or payee does not transfer.
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.OwnerApprovalRequired.selector);
        delegate.charge(owner, merchant, amount + 1, ref, deadline, sig);
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.OwnerApprovalRequired.selector);
        delegate.charge(owner, api, amount, ref, deadline, sig);

        vm.prank(agent);
        delegate.charge(owner, merchant, amount, ref, deadline, sig);
        assertEq(usdc.balanceOf(merchant), amount);
    }

    function test_ownerApprovalExpires() public {
        bytes32 id = _mandate();
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes memory sig = _sign(id, merchant, 150 * USDC1, bytes32("late"), deadline);
        vm.warp(deadline + 1);
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.ApprovalExpired.selector);
        delegate.charge(owner, merchant, 150 * USDC1, bytes32("late"), deadline, sig);
    }

    function test_validityAndExpiry() public {
        RelicAgentDelegate.Limits memory l = _limits();
        l.validFrom = uint64(vm.getBlockTimestamp() + 1 hours);
        l.expiresAt = uint64(vm.getBlockTimestamp() + 2 hours);
        vm.prank(owner);
        delegate.createMandate(agent, l);
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.MandateNotYetValid.selector);
        delegate.charge(owner, api, 1, bytes32("early"), 0, "");
        vm.warp(l.validFrom);
        _charge(api, 1, bytes32("ok"));
        vm.warp(l.expiresAt);
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.MandateExpired.selector);
        delegate.charge(owner, api, 1, bytes32("late"), 0, "");
    }

    function test_dailyTimeWindow_includingWrapPastMidnight() public {
        RelicAgentDelegate.Limits memory l = _limits();
        l.windowStart = 22 hours;
        l.windowEnd = 6 hours; // 22:00 to 06:00 UTC
        vm.prank(owner);
        delegate.createMandate(agent, l);
        uint256 midnight = (vm.getBlockTimestamp() / 1 days + 1) * 1 days;

        vm.warp(midnight + 12 hours);
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.OutsideTimeWindow.selector);
        delegate.charge(owner, api, 1, bytes32("noon"), 0, "");

        vm.warp(midnight + 23 hours);
        _charge(api, 1, bytes32("late-night"));
        vm.warp(midnight + 1 days + 5 hours);
        _charge(api, 1, bytes32("early-morning"));
        vm.warp(midnight + 1 days + 6 hours);
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.OutsideTimeWindow.selector);
        delegate.charge(owner, api, 1, bytes32("six"), 0, "");
    }

    function test_chargeBoundedByCreditLine() public {
        RelicAgentDelegate.Limits memory l = _limits();
        l.perTxCap = uint128(5_000 * USDC1);
        l.periodCap = uint128(5_000 * USDC1);
        l.approvalThreshold = 0;
        vm.prank(owner);
        delegate.createMandate(agent, l);
        vm.prank(agent);
        vm.expectRevert(RelicCreditLine.LtvExceeded.selector);
        delegate.charge(owner, api, 1_600 * USDC1 + 1, bytes32("ltv"), 0, "");
    }

    // ───────── purchase (BNPL via escrow) ─────────

    function _purchase(string memory productId, uint8 count, uint64 interval) internal returns (bytes32) {
        RelicAgentDelegate.Purchase memory p = RelicAgentDelegate.Purchase({
            owner: owner,
            merchant: merchant,
            totalPrice: uint128(80 * USDC1),
            installmentCount: count,
            intervalSeconds: interval,
            productId: productId,
            merchantName: "IBG Collection"
        });
        SpendPermission memory none;
        vm.prank(agent);
        return delegate.purchase(p, 0, "", false, none);
    }

    function test_purchaseOpensAgreementWithOwnerAsBuyer() public {
        _mandate();
        uint256 o0 = usdc.balanceOf(owner);
        bytes32 id = _purchase("agent-relic", 4, 7 days);
        RelicEscrow.Agreement memory a = escrow.getAgreement(id);
        assertEq(a.buyer, owner);
        assertEq(a.merchant, merchant);
        assertEq(o0 - usdc.balanceOf(owner), 20 * USDC1);
        assertEq(usdc.balanceOf(address(delegate)), 0);

        // The owner, not the agent, services the agreement afterwards.
        vm.warp(escrow.nextDueTime(id));
        vm.prank(owner);
        escrow.payInstallment(id);
    }

    function test_purchaseTermsBoundedByOwner() public {
        _mandate();
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.TermsOutOfBounds.selector); // audit C-6: 1-second interval
        this.purchaseAs("fast", 2, 1);
        vm.expectRevert(RelicAgentDelegate.TermsOutOfBounds.selector);
        this.purchaseAs("long", 12, 7 days);
    }

    function purchaseAs(string memory productId, uint8 count, uint64 interval) external {
        _purchase(productId, count, interval);
    }

    function test_purchaseViaSpendPermission() public {
        spm = new MockSpendPermissionManager();
        _gov(address(delegate), abi.encodeCall(RelicAgentDelegate.setSpendPermissionManager, (ISpendPermissionManager(address(spm)))));
        _mandate();
        vm.prank(owner);
        usdc.approve(address(spm), type(uint256).max); // stands in for the smart wallet owner hook
        vm.prank(owner);
        usdc.approve(address(delegate), 0); // no plain allowance: the permission is the only path

        SpendPermission memory perm = SpendPermission({
            account: owner,
            spender: address(delegate),
            token: address(usdc),
            allowance: uint160(100 * USDC1),
            period: 1 days,
            start: uint48(vm.getBlockTimestamp()),
            end: uint48(vm.getBlockTimestamp() + 30 days),
            salt: 1,
            extraData: ""
        });
        RelicAgentDelegate.Purchase memory p = RelicAgentDelegate.Purchase(owner, merchant, uint128(80 * USDC1), 4, 7 days, "sp", "m");
        vm.prank(agent);
        bytes32 id = delegate.purchase(p, 0, "", true, perm);
        assertEq(escrow.getAgreement(id).escrowDeposited, 20 * USDC1);

        SpendPermission memory wrong = SpendPermission(owner, stranger, address(usdc), perm.allowance, perm.period, perm.start, perm.end, 1, "");
        p.productId = "sp2";
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.SpendPermissionMismatch.selector);
        delegate.purchase(p, 0, "", true, wrong);

        // Owner revokes the permission directly in the manager: the next pull fails.
        vm.prank(owner);
        spm.revoke(perm);
        p.productId = "sp3";
        vm.prank(agent);
        vm.expectRevert(bytes("revoked"));
        delegate.purchase(p, 0, "", true, perm);
    }

    function test_purchaseProductIdIsSingleUse() public {
        _mandate();
        _purchase("once", 2, 7 days);
        vm.prank(agent);
        vm.expectRevert(RelicAgentDelegate.RefAlreadyUsed.selector);
        this.purchaseAs("once", 2, 7 days);
    }

    // ───────── ERC-8004 identity ─────────

    function test_bindAgentIdentityChecksRegisteredWallet() public {
        MockIdentity ident = new MockIdentity();
        ident.set(7, owner, agent);
        ident.set(8, owner, stranger);
        _gov(address(delegate), abi.encodeCall(RelicAgentDelegate.setIdentityRegistry, (IERC8004Identity(address(ident)))));
        _mandate();
        vm.prank(owner);
        vm.expectRevert(RelicAgentDelegate.AgentIdentityMismatch.selector);
        delegate.bindAgentIdentity(agent, 8);
        vm.prank(owner);
        delegate.bindAgentIdentity(agent, 7);
        assertEq(delegate.getMandate(owner, agent).agentId, 7);
    }

    // ───────── compromised agent key: worst case is bounded ─────────

    function testFuzz_compromisedKeyBoundedByPeriodCap(uint96[6] memory amounts) public {
        RelicAgentDelegate.Limits memory l = _limits();
        l.maxTxPerPeriod = 6;
        l.approvalThreshold = 0;
        vm.prank(owner);
        delegate.createMandate(agent, l);
        uint256 spent;
        for (uint256 i; i < 6; i++) {
            uint256 a = bound(amounts[i], 1, 300 * USDC1);
            vm.prank(agent);
            try delegate.charge(owner, api, a, bytes32(i), 0, "") {
                spent += a;
            } catch {}
        }
        assertLe(spent, 500 * USDC1);
        assertEq(usdc.balanceOf(api), spent);
    }
}
