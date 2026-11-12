// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./BaseSetup.sol";

contract RelicEscrowTest is BaseSetup {
    uint64 constant INTERVAL = 30 days;
    uint128 constant PRICE = 1_000_000_001; // $1,000.000001, so the last installment carries a remainder

    function _create(string memory productId) internal returns (bytes32 id) {
        vm.prank(buyer);
        id = escrow.createAgreement(merchant, PRICE, 4, INTERVAL, productId, "IBG Collection");
    }

    function _payAll(bytes32 id) internal {
        RelicEscrow.Agreement memory a = escrow.getAgreement(id);
        for (uint8 n = a.paidInstallments + 1; n <= a.installmentCount; n++) {
            vm.warp(escrow.nextDueTime(id));
            vm.prank(buyer);
            escrow.payInstallment(id);
        }
    }

    // ───────── create_agreement ─────────

    function test_create_escrowsFirstInstallment() public {
        uint256 before = usdc.balanceOf(buyer);
        bytes32 id = _create("relic-1");
        RelicEscrow.Agreement memory a = escrow.getAgreement(id);
        assertEq(uint8(a.state), uint8(RelicEscrow.State.Active));
        assertEq(a.buyer, buyer);
        assertEq(a.merchant, merchant);
        assertEq(a.installmentAmount, PRICE / 4);
        assertEq(a.paidInstallments, 1);
        assertEq(a.escrowDeposited, PRICE / 4);
        assertEq(a.yieldRateBps, 300);
        assertEq(a.yieldSource, 0);
        assertEq(before - usdc.balanceOf(buyer), PRICE / 4);
        assertEq(escrow.currentTvl(), PRICE / 4);
        assertEq(id, escrow.agreementId(buyer, "relic-1"));
    }

    function test_create_rejectsBadInputs() public {
        vm.startPrank(buyer);
        vm.expectRevert(RelicEscrow.InvalidAmount.selector);
        escrow.createAgreement(merchant, 0, 4, INTERVAL, "a", "m");
        vm.expectRevert(RelicEscrow.InvalidInstallments.selector);
        escrow.createAgreement(merchant, PRICE, 1, INTERVAL, "a", "m");
        vm.expectRevert(RelicEscrow.InvalidInstallments.selector);
        escrow.createAgreement(merchant, PRICE, 13, INTERVAL, "a", "m");
        vm.expectRevert(RelicEscrow.InvalidInterval.selector);
        escrow.createAgreement(merchant, PRICE, 4, 0, "a", "m");
        vm.expectRevert(RelicEscrow.InvalidProductId.selector);
        escrow.createAgreement(merchant, PRICE, 4, INTERVAL, string(new bytes(65)), "m");
        vm.expectRevert(RelicEscrow.InvalidMerchantName.selector);
        escrow.createAgreement(merchant, PRICE, 4, INTERVAL, "a", string(new bytes(65)));
        vm.expectRevert(RelicEscrow.InvalidMerchant.selector);
        escrow.createAgreement(address(0), PRICE, 4, INTERVAL, "a", "m");
        vm.stopPrank();
    }

    function test_create_rejectsDuplicateProductForSameBuyer() public {
        _create("dup");
        vm.prank(buyer);
        vm.expectRevert(RelicEscrow.AgreementExists.selector);
        escrow.createAgreement(merchant, PRICE, 4, INTERVAL, "dup", "m");
    }

    function test_create_respectsPerAgreementAndTvlCaps() public {
        _gov(address(escrow), abi.encodeCall(RelicEscrow.setRiskLimits, (500 * USDC1, 300 * USDC1)));
        vm.startPrank(buyer);
        vm.expectRevert(RelicEscrow.DepositCapExceeded.selector);
        escrow.createAgreement(merchant, uint128(501 * USDC1), 2, INTERVAL, "big", "m");
        escrow.createAgreement(merchant, uint128(500 * USDC1), 2, INTERVAL, "ok", "m"); // 250 escrowed
        vm.expectRevert(RelicEscrow.TvlCapExceeded.selector);
        escrow.createAgreement(merchant, uint128(200 * USDC1), 2, INTERVAL, "over", "m"); // +100 > 300
        vm.stopPrank();
    }

    function test_create_blockedWhilePaused() public {
        vm.prank(guardian);
        escrow.setPaused(true);
        vm.prank(buyer);
        vm.expectRevert(RelicEscrow.ProtocolPaused.selector);
        escrow.createAgreement(merchant, PRICE, 4, INTERVAL, "p", "m");
    }

    // ───────── pay_installment ─────────

    function test_pay_onlyWhenDue_onlyBuyer() public {
        bytes32 id = _create("due");
        vm.warp(escrow.nextDueTime(id) - 1);
        vm.prank(buyer);
        vm.expectRevert(RelicEscrow.PaymentNotDue.selector);
        escrow.payInstallment(id);

        vm.warp(escrow.nextDueTime(id));
        vm.prank(stranger);
        vm.expectRevert(RelicEscrow.NotBuyer.selector);
        escrow.payInstallment(id);
    }

    function test_pay_fullLifecycle_lastInstallmentCarriesRemainder() public {
        bytes32 id = _create("life");
        _payAll(id);
        RelicEscrow.Agreement memory a = escrow.getAgreement(id);
        assertEq(uint8(a.state), uint8(RelicEscrow.State.Completed));
        assertEq(a.paidInstallments, 4);
        assertEq(a.escrowDeposited, PRICE);
        assertEq(usdc.balanceOf(address(escrow)), PRICE);
        assertEq(escrow.currentTvl(), PRICE);

        vm.prank(buyer);
        vm.expectRevert(RelicEscrow.AgreementNotActive.selector);
        escrow.payInstallment(id);
    }

    function test_pay_accruesSimulatedYieldLikeSolana() public {
        vm.prank(buyer);
        bytes32 id = escrow.createAgreement(merchant, uint128(200 * USDC1), 2, INTERVAL, "y", "m");
        vm.warp(escrow.nextDueTime(id)); // 60 days later, escrow = $100
        vm.prank(buyer);
        escrow.payInstallment(id);
        // 100e6 * 300 * 60 days / (10_000 * 31_536_000), same floor math as math.rs
        uint256 expected = (100 * USDC1 * 300 * 60 days) / (10_000 * 31_536_000);
        assertEq(escrow.getAgreement(id).yieldAccrued, expected);
    }

    function test_pay_blockedWhilePaused() public {
        bytes32 id = _create("pp");
        vm.prank(guardian);
        escrow.setPaused(true);
        vm.warp(escrow.nextDueTime(id));
        vm.prank(buyer);
        vm.expectRevert(RelicEscrow.ProtocolPaused.selector);
        escrow.payInstallment(id);
    }

    // ───────── merchant_withdraw ─────────

    function test_merchantWithdraw_onCompletion_once() public {
        bytes32 id = _create("mw");
        vm.prank(merchant);
        vm.expectRevert(RelicEscrow.AgreementNotComplete.selector);
        escrow.merchantWithdraw(id);

        _payAll(id);
        vm.prank(stranger);
        vm.expectRevert(RelicEscrow.NotMerchant.selector);
        escrow.merchantWithdraw(id);

        vm.prank(merchant);
        escrow.merchantWithdraw(id);
        assertEq(usdc.balanceOf(merchant), PRICE);
        assertEq(escrow.currentTvl(), 0);
        assertTrue(escrow.getAgreement(id).merchantWithdrawn);

        vm.prank(merchant);
        vm.expectRevert(RelicEscrow.AlreadyWithdrawn.selector);
        escrow.merchantWithdraw(id);
    }

    // ───────── claim_yield ─────────

    function test_claimYield_paysFromReserveOnly() public {
        vm.prank(buyer);
        bytes32 id = escrow.createAgreement(merchant, uint128(200 * USDC1), 2, INTERVAL, "cy", "m");
        _payAll(id);
        uint256 owed = escrow.getAgreement(id).yieldAccrued;
        assertGt(owed, 0);

        vm.prank(buyer);
        vm.expectRevert(RelicEscrow.YieldReserveEmpty.selector);
        escrow.claimYield(id);

        // Reserve covers half: partial payout, the rest stays owed, escrow untouched.
        vm.prank(lender);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(lender);
        escrow.fundYieldReserve(owed / 2);
        uint256 b0 = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.claimYield(id);
        assertEq(usdc.balanceOf(buyer) - b0, owed / 2);
        assertEq(escrow.getAgreement(id).yieldAccrued, owed - owed / 2);
        assertEq(escrow.getAgreement(id).escrowDeposited, 200 * USDC1);

        vm.prank(stranger);
        vm.expectRevert(RelicEscrow.NotBuyer.selector);
        escrow.claimYield(id);
    }

    // ───────── cancel_agreement ─────────

    function test_cancel_tenPercentFeeToMerchant() public {
        bytes32 id = _create("c");
        uint256 escrowed = PRICE / 4;
        uint256 b0 = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.cancelAgreement(id);
        uint256 fee = escrowed / 10;
        assertEq(usdc.balanceOf(merchant), fee);
        assertEq(usdc.balanceOf(buyer) - b0, escrowed - fee);
        assertEq(uint8(escrow.getAgreement(id).state), uint8(RelicEscrow.State.Cancelled));
        assertEq(escrow.currentTvl(), 0);
    }

    function test_cancel_onlyBuyer_onlyActive() public {
        bytes32 id = _create("c2");
        vm.prank(merchant);
        vm.expectRevert(RelicEscrow.NotBuyer.selector);
        escrow.cancelAgreement(id);
        _payAll(id);
        vm.prank(buyer);
        vm.expectRevert(RelicEscrow.AgreementNotActive.selector);
        escrow.cancelAgreement(id);
    }

    // ───────── trigger_default: 7-day grace ─────────

    function test_default_afterGrace_byAnyone_paysRecordedMerchant() public {
        bytes32 id = _create("d");
        uint256 due = escrow.nextDueTime(id);
        vm.warp(due + 7 days);
        vm.expectRevert(RelicEscrow.GracePeriodNotExpired.selector);
        escrow.triggerDefault(id);

        vm.warp(due + 7 days + 1);
        (bool ok, uint8 next, uint256 expiry) = escrow.getDefaultStatus(id);
        assertTrue(ok);
        assertEq(next, 2);
        assertEq(expiry, due + 7 days);

        vm.prank(stranger);
        escrow.triggerDefault(id);
        assertEq(usdc.balanceOf(merchant), PRICE / 4);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(uint8(escrow.getAgreement(id).state), uint8(RelicEscrow.State.Defaulted));

        vm.expectRevert(RelicEscrow.AgreementNotActive.selector);
        escrow.triggerDefault(id);
    }

    function test_default_blockedWhilePaused_andFreshGraceAfterUnpause() public {
        bytes32 id = _create("pd");
        uint256 due = escrow.nextDueTime(id);
        vm.prank(guardian);
        escrow.setPaused(true);
        vm.warp(due + 30 days); // long pause, buyer could not pay
        vm.expectRevert(RelicEscrow.ProtocolPaused.selector);
        escrow.triggerDefault(id);
        (bool ok,,) = escrow.getDefaultStatus(id);
        assertFalse(ok);

        _gov(address(escrow), abi.encodeCall(RelicEscrow.setPaused, (false)));
        uint256 unpausedAt = escrow.lastUnpausedAt();
        vm.warp(unpausedAt + 7 days);
        vm.expectRevert(RelicEscrow.GracePeriodNotExpired.selector);
        escrow.triggerDefault(id);

        // Buyer can still cure within the fresh window.
        vm.prank(buyer);
        escrow.payInstallment(id);
        assertEq(escrow.getAgreement(id).paidInstallments, 2);
    }

    // ───────── close_agreement ─────────

    function test_close_onlySettled_thenProductIdReusable() public {
        bytes32 id = _create("cl");
        vm.prank(buyer);
        vm.expectRevert(RelicEscrow.AgreementNotSettled.selector);
        escrow.closeAgreement(id);

        _payAll(id);
        vm.prank(buyer);
        vm.expectRevert(RelicEscrow.AgreementNotSettled.selector); // merchant has not withdrawn
        escrow.closeAgreement(id);

        vm.prank(merchant);
        escrow.merchantWithdraw(id);
        vm.prank(stranger);
        vm.expectRevert(RelicEscrow.NotBuyer.selector);
        escrow.closeAgreement(id);

        vm.prank(buyer);
        escrow.closeAgreement(id);
        assertEq(uint8(escrow.getAgreement(id).state), uint8(RelicEscrow.State.None));
        _create("cl"); // id free again, as a closed PDA is on Solana
    }

    function test_close_afterCancelAndDefault() public {
        bytes32 a = _create("x1");
        vm.prank(buyer);
        escrow.cancelAgreement(a);
        vm.prank(buyer);
        escrow.closeAgreement(a);

        bytes32 b = _create("x2");
        vm.warp(escrow.nextDueTime(b) + 7 days + 1);
        escrow.triggerDefault(b);
        vm.prank(buyer);
        escrow.closeAgreement(b);
    }

    // ───────── yield_source: live vault (Morpho ERC-4626) ─────────

    function _withVault() internal returns (MockVault v) {
        v = new MockVault(usdc);
        _gov(address(escrow), abi.encodeCall(RelicEscrow.setYieldVault, (IERC4626(address(v)))));
    }

    function test_live_requiresVault() public {
        vm.prank(buyer);
        vm.expectRevert(RelicEscrow.YieldVaultUnavailable.selector);
        escrow.createAgreementLive(merchant, PRICE, 4, INTERVAL, "lv", "m");
    }

    function test_live_merchantGetsPrice_buyerGetsSurplus() public {
        MockVault v = _withVault();
        vm.prank(buyer);
        bytes32 id = escrow.createAgreementLive(merchant, uint128(400 * USDC1), 2, INTERVAL, "lv", "m");
        assertEq(escrow.getAgreement(id).yieldSource, 1);
        assertGt(escrow.getAgreement(id).vaultShares, 0);
        _payAll(id);
        v.harvest(12 * USDC1);

        uint256 b0 = usdc.balanceOf(buyer);
        vm.prank(merchant);
        escrow.merchantWithdraw(id);
        assertEq(usdc.balanceOf(merchant), 400 * USDC1);
        assertApproxEqAbs(usdc.balanceOf(buyer) - b0, 12 * USDC1, 2);
        assertEq(escrow.totalVaultShares(), 0);
        vm.prank(buyer);
        escrow.closeAgreement(id); // nothing stranded
    }

    function test_live_cancelReturnsYieldToBuyer() public {
        MockVault v = _withVault();
        vm.prank(buyer);
        bytes32 id = escrow.createAgreementLive(merchant, uint128(400 * USDC1), 2, INTERVAL, "lc", "m");
        v.harvest(10 * USDC1);
        uint256 b0 = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.cancelAgreement(id);
        assertEq(usdc.balanceOf(merchant), 20 * USDC1); // 10% of 200 principal
        assertApproxEqAbs(usdc.balanceOf(buyer) - b0, 190 * USDC1, 2);
    }

    function test_live_lossOnDefaultGoesToMerchantAsRecovered() public {
        MockVault v = _withVault();
        vm.prank(buyer);
        bytes32 id = escrow.createAgreementLive(merchant, uint128(400 * USDC1), 2, INTERVAL, "ll", "m");
        v.slash(50 * USDC1, stranger);
        vm.warp(escrow.nextDueTime(id) + 7 days + 1);
        escrow.triggerDefault(id);
        assertApproxEqAbs(usdc.balanceOf(merchant), 150 * USDC1, 2);
        assertEq(escrow.currentTvl(), 0);
    }

    function test_live_vaultCannotChangeWhileHoldingEscrow() public {
        _withVault();
        vm.prank(buyer);
        escrow.createAgreementLive(merchant, uint128(400 * USDC1), 2, INTERVAL, "lk", "m");
        MockVault other = new MockVault(usdc);
        bytes memory data = abi.encodeCall(RelicEscrow.setYieldVault, (IERC4626(address(other))));
        bytes32 s = bytes32(++salt);
        vm.prank(proposer);
        timelock.schedule(address(escrow), 0, data, bytes32(0), s, 2 days);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.expectRevert(); // TimelockController bubbles YieldVaultInUse
        timelock.execute(address(escrow), 0, data, bytes32(0), s);
    }

    function test_live_rejectsVaultForWrongAsset() public {
        MockUSDC fake = new MockUSDC();
        MockVault wrong = new MockVault(fake);
        vm.prank(address(timelock));
        vm.expectRevert(RelicEscrow.YieldVaultUnavailable.selector);
        escrow.setYieldVault(IERC4626(address(wrong)));
    }

    // ───────── mint pinning (audit C-4) ─────────

    function test_onlyPinnedUsdcEverMoves() public {
        MockUSDC fake = new MockUSDC();
        fake.mint(buyer, 1_000 * USDC1);
        vm.prank(buyer);
        fake.approve(address(escrow), type(uint256).max);
        _create("pin");
        assertEq(fake.balanceOf(address(escrow)), 0);
        assertEq(address(escrow.usdc()), address(usdc));
    }

    // ───────── agent entry point gating ─────────

    function test_agentCreateAgreement_onlyDelegate() public {
        vm.prank(stranger);
        vm.expectRevert(RelicGoverned.Unauthorized.selector);
        escrow.agentCreateAgreement(buyer, merchant, PRICE, 4, INTERVAL, "ag", "m");
    }
}
