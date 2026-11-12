// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./BaseSetup.sol";

contract RelicStakePoolTest is BaseSetup {
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        _fund(alice, 10_000 * USDC1);
        _fund(bob, 10_000 * USDC1);
    }

    function test_tiersMatchSolanaThresholds() public {
        vm.startPrank(alice);
        pool.stake(9_999_999);
        assertEq(pool.tierOf(alice), 0);
        pool.stake(1); // $10
        assertEq(pool.tierOf(alice), 1);
        pool.stake(40 * USDC1); // $50
        assertEq(pool.tierOf(alice), 2);
        pool.stake(150 * USDC1); // $200
        assertEq(pool.tierOf(alice), 3);
        pool.stake(300 * USDC1); // $500
        assertEq(pool.tierOf(alice), 4);
        pool.unstake(0);
        assertEq(pool.tierOf(alice), 0);
        vm.stopPrank();
        assertEq(pool.totalStaked(), 0);
    }

    function test_stakeRejectsZero() public {
        vm.prank(alice);
        vm.expectRevert(RelicStakePool.InvalidAmount.selector);
        pool.stake(0);
    }

    function test_partialUnstakePaysPrincipalOnly() public {
        vm.prank(lender);
        pool.fundYieldReserve(100 * USDC1);
        vm.prank(alice);
        pool.stake(100 * USDC1);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        uint256 b0 = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.unstake(40 * USDC1);
        assertEq(usdc.balanceOf(alice) - b0, 40 * USDC1);
        (uint128 staked, uint128 owed,,,) = pool.stakes(alice);
        assertEq(staked, 60 * USDC1);
        assertEq(owed, 3 * USDC1); // 3% of $100 for a year, settled
    }

    /// Audit C-1: with an empty reserve, stakers still get every unit of principal back, and no
    /// staker's yield is ever paid out of another staker's deposit.
    function test_principalAlwaysWithdrawable_yieldOnlyFromReserve() public {
        vm.prank(alice);
        pool.stake(1_000 * USDC1);
        vm.prank(bob);
        pool.stake(1_000 * USDC1);
        vm.warp(vm.getBlockTimestamp() + 365 days);

        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.unstake(0);
        assertEq(usdc.balanceOf(alice) - a0, 1_000 * USDC1, "alice gets principal, no yield from bob");
        assertTrue(pool.isSolvent());

        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(bob);
        pool.unstake(0);
        assertEq(usdc.balanceOf(bob) - b0, 1_000 * USDC1, "bob, last out, is whole");
        assertEq(usdc.balanceOf(address(pool)), 0);

        // Yield stays owed and is collectable once the reserve is funded.
        (, uint128 owed,,,) = pool.stakes(alice);
        assertEq(owed, 30 * USDC1);
        vm.prank(lender);
        pool.fundYieldReserve(30 * USDC1);
        vm.prank(alice);
        pool.unstake(0);
        assertEq(usdc.balanceOf(alice) - a0, 1_030 * USDC1);
    }

    function test_unstakeWithNothingReverts() public {
        vm.prank(alice);
        vm.expectRevert(RelicStakePool.NothingToWithdraw.selector);
        pool.unstake(0);
    }

    function test_rateCapTwentyPercent() public {
        vm.prank(address(timelock));
        vm.expectRevert(RelicStakePool.RateTooHigh.selector);
        pool.updatePoolRate(2_001);
        _gov(address(pool), abi.encodeCall(RelicStakePool.updatePoolRate, (2_000)));
        assertEq(pool.yieldRateBps(), 2_000);
    }

    /// A rate change applies from the moment it lands, never to time already elapsed.
    function test_rateChangeIsNotRetroactive() public {
        vm.prank(alice);
        pool.stake(1_000 * USDC1);
        vm.warp(vm.getBlockTimestamp() + 365 days - 2 days); // _gov adds 2 days
        _gov(address(pool), abi.encodeCall(RelicStakePool.updatePoolRate, (2_000)));
        assertApproxEqAbs(pool.pendingYield(alice), 30 * USDC1, 1);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        assertApproxEqAbs(pool.pendingYield(alice), 230 * USDC1, 1);
    }

    function test_fundReserveRejectsZero() public {
        vm.expectRevert(RelicStakePool.InvalidAmount.selector);
        pool.fundYieldReserve(0);
    }

    function testFuzz_solvencyAcrossStakeUnstake(uint96 a, uint96 b, uint32 dt, uint96 reserve) public {
        uint256 sa = bound(a, 1, 5_000 * USDC1);
        uint256 sb = bound(b, 1, 5_000 * USDC1);
        uint256 r = bound(reserve, 0, 50 * USDC1);
        if (r > 0) {
            vm.prank(lender);
            pool.fundYieldReserve(r);
        }
        vm.prank(alice);
        pool.stake(sa);
        vm.prank(bob);
        pool.stake(sb);
        vm.warp(vm.getBlockTimestamp() + bound(dt, 0, 3 * 365 days));
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.unstake(0);
        assertGe(usdc.balanceOf(alice) - a0, sa);
        assertTrue(pool.isSolvent());
        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(bob);
        pool.unstake(0);
        assertGe(usdc.balanceOf(bob) - b0, sb);
        assertTrue(pool.isSolvent());
    }
}
