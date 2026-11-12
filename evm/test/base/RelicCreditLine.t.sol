// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./BaseSetup.sol";

contract RelicCreditLineTest is BaseSetup {
    address borrower = makeAddr("borrower");
    address keeper = makeAddr("keeper");
    MockReputation rep;
    MockIdentity ident;

    function setUp() public override {
        super.setUp();
        _fund(borrower, 10_000 * USDC1);
        vm.prank(lender);
        credit.supplyLiquidity(100_000 * USDC1);
    }

    function _enable() internal {
        _gov(address(credit), abi.encodeCall(RelicCreditLine.setCreditEnabled, (true)));
    }

    function _open(uint256 collateral) internal {
        _enable();
        vm.prank(borrower);
        credit.depositCollateral(borrower, collateral);
    }

    function test_featureFlagOffBlocksNewCredit() public {
        assertFalse(credit.creditEnabled());
        vm.prank(borrower);
        vm.expectRevert(RelicCreditLine.CreditDisabled.selector);
        credit.depositCollateral(borrower, 100 * USDC1);
        vm.prank(borrower);
        vm.expectRevert(RelicCreditLine.CreditDisabled.selector);
        credit.draw(merchant, 1);
    }

    function test_drawUpToEightyPercentLtv_paidStraightToPayee() public {
        _open(1_000 * USDC1);
        vm.prank(borrower);
        vm.expectRevert(RelicCreditLine.LtvExceeded.selector);
        credit.draw(merchant, 800 * USDC1 + 1);
        vm.prank(borrower);
        credit.draw(merchant, 800 * USDC1);
        assertEq(usdc.balanceOf(merchant), 800 * USDC1);
        assertEq(credit.debtOf(borrower), 800 * USDC1);
        assertEq(credit.ltvBps(borrower), 8_000);
        assertEq(credit.availableToDraw(borrower), 0);
    }

    function test_drawRejectsBadPayeeAndZero() public {
        _open(1_000 * USDC1);
        vm.startPrank(borrower);
        vm.expectRevert(RelicCreditLine.InvalidPayee.selector);
        credit.draw(address(0), 1);
        vm.expectRevert(RelicCreditLine.InvalidPayee.selector);
        credit.draw(address(credit), 1);
        vm.expectRevert(RelicCreditLine.InvalidAmount.selector);
        credit.draw(merchant, 0);
        vm.stopPrank();
    }

    function test_drawLimitedByPoolLiquidity() public {
        _open(10_000 * USDC1);
        vm.prank(lender);
        credit.withdrawLiquidity(99_000 * USDC1);
        vm.prank(borrower);
        vm.expectRevert(RelicCreditLine.InsufficientLiquidity.selector);
        credit.draw(merchant, 1_000 * USDC1 + 1);
    }

    function test_withdrawCollateralKeepsLtvBound() public {
        _open(1_000 * USDC1);
        vm.prank(borrower);
        credit.draw(merchant, 400 * USDC1);
        vm.prank(borrower);
        vm.expectRevert(RelicCreditLine.LtvExceeded.selector);
        credit.withdrawCollateral(500 * USDC1 + 1);
        vm.prank(borrower);
        credit.withdrawCollateral(500 * USDC1);
        assertEq(credit.ltvBps(borrower), 8_000);
    }

    function test_repayInterestFirstThenPrincipal() public {
        _open(1_000 * USDC1);
        vm.prank(borrower);
        credit.draw(merchant, 500 * USDC1);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        assertEq(credit.debtOf(borrower), 540 * USDC1); // 8% APR simple interest
        vm.prank(borrower);
        credit.repay(borrower, 40 * USDC1);
        assertEq(credit.protocolRevenue(), 40 * USDC1);
        assertEq(credit.debtOf(borrower), 500 * USDC1);
        vm.prank(borrower);
        uint256 paid = credit.repay(borrower, 10_000 * USDC1); // overpay is capped
        assertEq(paid, 500 * USDC1);
        assertEq(credit.debtOf(borrower), 0);
        assertEq(credit.availableLiquidity(), 100_000 * USDC1);
        vm.prank(borrower);
        vm.expectRevert(RelicCreditLine.NothingToRepay.selector);
        credit.repay(borrower, 1);
    }

    function test_topUpByThirdPartyRestoresHealth() public {
        _open(1_000 * USDC1);
        vm.prank(borrower);
        credit.draw(merchant, 800 * USDC1);
        vm.warp(vm.getBlockTimestamp() + 2 * 365 days); // debt 928 > 900
        assertTrue(credit.isLiquidatable(borrower));
        vm.prank(lender);
        credit.depositCollateral(borrower, 200 * USDC1);
        assertFalse(credit.isLiquidatable(borrower));
    }

    function test_liquidationAboveNinetyPercent() public {
        _open(1_000 * USDC1);
        vm.prank(borrower);
        credit.draw(merchant, 800 * USDC1);
        vm.prank(keeper);
        vm.expectRevert(RelicCreditLine.NotLiquidatable.selector);
        credit.liquidate(borrower);

        vm.warp(vm.getBlockTimestamp() + 2 * 365 days); // 800 + 128 interest = 928
        uint256 debt = credit.debtOf(borrower);
        assertEq(debt, 928 * USDC1);
        vm.prank(keeper);
        credit.liquidate(borrower);

        uint256 penalty = (debt * 500) / 10_000; // 46.4
        // seized = min(1000, 928 + 46.4) = 974.4; keeper gets half the penalty
        assertEq(usdc.balanceOf(keeper), penalty / 2);
        RelicCreditLine.Line memory l = credit.getLine(borrower);
        assertEq(l.collateral, 1_000 * USDC1 - (debt + penalty));
        assertEq(l.principal, 0);
        assertEq(l.liquidations, 1);
        assertEq(l.trustScore, 0);
        assertEq(credit.badDebt(), 0);
        assertEq(credit.totalPrincipalOut(), 0);
        assertEq(credit.availableLiquidity(), 100_000 * USDC1);
    }

    function test_liquidationRecordsBadDebtWhenCollateralShort() public {
        _open(1_000 * USDC1);
        vm.prank(borrower);
        credit.draw(merchant, 800 * USDC1);
        _gov(address(credit), abi.encodeCall(RelicCreditLine.setCreditRate, (3_000)));
        vm.warp(vm.getBlockTimestamp() + 2 * 365 days); // 800 + 30% x 2y x 800 = 1280 > collateral
        vm.prank(keeper);
        credit.liquidate(borrower);
        assertEq(credit.getLine(borrower).collateral, 0);
        assertEq(usdc.balanceOf(keeper), 0); // nothing left for the penalty
        assertGt(credit.badDebt(), 0);
        assertEq(credit.totalPrincipalOut(), 0);
    }

    function test_trustScore_agedRepaymentOnly_cappedPerEpoch() public {
        _open(10_000 * USDC1);
        _fund(borrower, 10_000 * USDC1); // repayment money, separate from the collateral
        _gov(address(credit), abi.encodeCall(RelicCreditLine.setCreditRate, (0))); // no interest, so points are exact
        // Wash cycle: draw and repay in the same block earns nothing.
        vm.startPrank(borrower);
        credit.draw(merchant, 1_000 * USDC1);
        credit.repay(borrower, 1_000 * USDC1);
        assertEq(credit.getLine(borrower).trustScore, 0);

        credit.draw(merchant, 5_000 * USDC1);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        credit.repay(borrower, 50 * USDC1); // 50 points
        assertEq(credit.getLine(borrower).trustScore, 50);
        credit.repay(borrower, 4_000 * USDC1); // capped at 100 per epoch
        assertEq(credit.getLine(borrower).trustScore, 100);
        vm.warp(vm.getBlockTimestamp() + 30 days);
        credit.repay(borrower, 500 * USDC1);
        vm.stopPrank();
        assertEq(credit.getLine(borrower).trustScore, 200);
    }

    function test_flagOffStillLetsUsersExit() public {
        _open(1_000 * USDC1);
        vm.prank(borrower);
        credit.draw(merchant, 100 * USDC1);
        vm.prank(guardian);
        credit.disableCredit();
        vm.startPrank(borrower);
        credit.repay(borrower, 100 * USDC1);
        credit.withdrawCollateral(1_000 * USDC1);
        vm.stopPrank();
        assertEq(credit.getLine(borrower).collateral, 0);
    }

    function test_drawForOnlyAgentDelegate() public {
        _open(1_000 * USDC1);
        vm.prank(stranger);
        vm.expectRevert(RelicGoverned.Unauthorized.selector);
        credit.drawFor(borrower, stranger, 1);
    }

    function test_rateCap() public {
        vm.prank(address(timelock));
        vm.expectRevert(RelicCreditLine.RateTooHigh.selector);
        credit.setCreditRate(3_001);
    }

    function test_erc8004FeedbackOnRepayAndLiquidation_neverBlocks() public {
        rep = new MockReputation();
        ident = new MockIdentity();
        ident.set(42, borrower, makeAddr("agentKey"));
        _gov(address(credit), abi.encodeCall(RelicCreditLine.setRegistries, (IERC8004Identity(address(ident)), IERC8004Reputation(address(rep)))));
        _open(1_000 * USDC1);

        vm.prank(stranger);
        vm.expectRevert(RelicCreditLine.NotAgentOwner.selector);
        credit.bindAgentIdentity(42);
        vm.prank(borrower);
        credit.bindAgentIdentity(42);

        vm.prank(borrower);
        credit.draw(merchant, 800 * USDC1);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.prank(borrower);
        credit.repay(borrower, 10 * USDC1);
        assertEq(rep.calls(), 1);
        assertEq(rep.lastAgentId(), 42);
        assertEq(rep.lastValue(), 9); // one day of interest is paid first, so 9.82 USDC of principal = 9 points

        rep.setRevert(true); // a broken registry must not block repayment or liquidation
        vm.prank(borrower);
        credit.repay(borrower, 10 * USDC1);
        vm.warp(vm.getBlockTimestamp() + 3 * 365 days);
        vm.prank(keeper);
        credit.liquidate(borrower);
        rep.setRevert(false);
        assertEq(rep.calls(), 1);
    }

    function test_lenderCannotWithdrawLentOutFunds() public {
        _open(1_000 * USDC1);
        vm.prank(borrower);
        credit.draw(merchant, 500 * USDC1);
        vm.prank(lender);
        vm.expectRevert(RelicCreditLine.InsufficientLiquidity.selector);
        credit.withdrawLiquidity(100_000 * USDC1);
        vm.prank(lender);
        credit.withdrawLiquidity(99_500 * USDC1);
        vm.prank(stranger);
        vm.expectRevert(RelicCreditLine.InvalidAmount.selector);
        credit.withdrawLiquidity(1);
    }

    function test_revenueWithdrawOnlyGovernance() public {
        vm.prank(stranger);
        vm.expectRevert(RelicGoverned.Unauthorized.selector);
        credit.withdrawRevenue(stranger, 0);
    }
}
