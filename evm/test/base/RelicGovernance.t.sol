// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./BaseSetup.sol";

contract RelicGovernanceTest is BaseSetup {
    function test_constructorRejectsTimelockShorterThanTwoDays() public {
        address[] memory p = new address[](1);
        p[0] = proposer;
        TimelockController short = new TimelockController(2 days - 1, p, p, address(0));
        vm.expectRevert(abi.encodeWithSelector(RelicGoverned.GovernanceDelayTooShort.selector, 2 days - 1));
        new RelicEscrow(usdc, address(short), guardian);
    }

    function test_constructorRejectsEoaGovernance() public {
        vm.expectRevert(abi.encodeWithSelector(RelicGoverned.GovernanceDelayTooShort.selector, 0));
        new RelicStakePool(usdc, proposer, guardian);
    }

    function test_parameterChangesNeedTheTimelock() public {
        vm.prank(proposer);
        vm.expectRevert(RelicGoverned.Unauthorized.selector);
        escrow.setRiskLimits(1, 1);

        vm.prank(guardian);
        vm.expectRevert(RelicGoverned.Unauthorized.selector);
        pool.updatePoolRate(500);

        vm.prank(guardian);
        vm.expectRevert(RelicGoverned.Unauthorized.selector);
        credit.setCreditEnabled(true);
    }

    function test_timelockCannotExecuteBeforeTwoDays() public {
        bytes memory data = abi.encodeCall(RelicStakePool.updatePoolRate, (500));
        vm.prank(proposer);
        timelock.schedule(address(pool), 0, data, bytes32(0), bytes32(uint256(77)), 2 days);
        vm.warp(vm.getBlockTimestamp() + 2 days - 1);
        vm.expectRevert();
        timelock.execute(address(pool), 0, data, bytes32(0), bytes32(uint256(77)));
        vm.warp(vm.getBlockTimestamp() + 1);
        timelock.execute(address(pool), 0, data, bytes32(0), bytes32(uint256(77)));
        assertEq(pool.yieldRateBps(), 500);
    }

    function test_guardianPausesButCannotUnpause() public {
        vm.prank(guardian);
        escrow.setPaused(true);
        assertTrue(escrow.paused());
        vm.prank(guardian);
        vm.expectRevert(RelicGoverned.Unauthorized.selector);
        escrow.setPaused(false);
        vm.prank(stranger);
        vm.expectRevert(RelicGoverned.Unauthorized.selector);
        escrow.setPaused(true);
        _gov(address(escrow), abi.encodeCall(RelicEscrow.setPaused, (false)));
        assertFalse(escrow.paused());
        assertEq(escrow.lastUnpausedAt(), block.timestamp);
    }

    function test_setGovernanceRequiresAnotherTwoDayTimelock() public {
        address[] memory p = new address[](1);
        p[0] = proposer;
        TimelockController short = new TimelockController(1 days, p, p, address(0));
        vm.prank(address(timelock));
        vm.expectRevert(abi.encodeWithSelector(RelicGoverned.GovernanceDelayTooShort.selector, 1 days));
        escrow.setGovernance(address(short));

        TimelockController longer = new TimelockController(3 days, p, p, address(0));
        vm.prank(address(timelock));
        escrow.setGovernance(address(longer));
        assertEq(escrow.governance(), address(longer));
    }

    function test_setGuardianOnlyGovernance() public {
        vm.prank(guardian);
        vm.expectRevert(RelicGoverned.Unauthorized.selector);
        escrow.setGuardian(stranger);
        _gov(address(escrow), abi.encodeCall(RelicGoverned.setGuardian, (address(0))));
        vm.prank(guardian);
        vm.expectRevert(RelicGoverned.Unauthorized.selector);
        escrow.setPaused(true);
    }
}
