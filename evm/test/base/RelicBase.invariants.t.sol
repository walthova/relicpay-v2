// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./BaseSetup.sol";

/// Random sequences over escrow and credit. Properties: the contracts always hold at least what
/// they owe, and TVL bookkeeping equals the escrow actually held.
contract RelicBaseHandler is Test {
    RelicEscrow escrow;
    RelicCreditLine credit;
    MockUSDC usdc;
    address[3] buyers;
    address merchant = address(0xBEEF);
    bytes32[] public ids;
    uint256 nonce;

    constructor(RelicEscrow e, RelicCreditLine c, MockUSDC u) {
        escrow = e;
        credit = c;
        usdc = u;
        for (uint256 i; i < 3; i++) {
            buyers[i] = address(uint160(0x1000 + i));
            u.mint(buyers[i], 1e15);
            vm.startPrank(buyers[i]);
            u.approve(address(e), type(uint256).max);
            u.approve(address(c), type(uint256).max);
            vm.stopPrank();
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function create(uint256 who, uint128 price, uint8 count, uint64 interval) external {
        address b = buyers[who % 3];
        price = uint128(bound(price, 2, 1e12));
        count = uint8(bound(count, 2, 12));
        interval = uint64(bound(interval, 1, 60 days));
        vm.prank(b);
        try escrow.createAgreement(merchant, price, count, interval, vm.toString(++nonce), "m") returns (bytes32 id) {
            ids.push(id);
        } catch {}
    }

    function pay(uint256 i) external {
        if (ids.length == 0) return;
        bytes32 id = ids[i % ids.length];
        RelicEscrow.Agreement memory a = escrow.getAgreement(id);
        if (a.state != RelicEscrow.State.Active) return;
        uint256 due = escrow.nextDueTime(id);
        if (vm.getBlockTimestamp() < due) vm.warp(due);
        vm.prank(a.buyer);
        try escrow.payInstallment(id) {} catch {}
    }

    function cancel(uint256 i) external {
        if (ids.length == 0) return;
        bytes32 id = ids[i % ids.length];
        vm.prank(escrow.getAgreement(id).buyer);
        try escrow.cancelAgreement(id) {} catch {}
    }

    function withdraw(uint256 i) external {
        if (ids.length == 0) return;
        vm.prank(merchant);
        try escrow.merchantWithdraw(ids[i % ids.length]) {} catch {}
    }

    function defaultIt(uint256 i, uint32 dt) external {
        if (ids.length == 0) return;
        vm.warp(vm.getBlockTimestamp() + bound(dt, 0, 90 days));
        try escrow.triggerDefault(ids[i % ids.length]) {} catch {}
    }

    function claim(uint256 i) external {
        if (ids.length == 0) return;
        bytes32 id = ids[i % ids.length];
        vm.prank(escrow.getAgreement(id).buyer);
        try escrow.claimYield(id) {} catch {}
    }

    function fundReserve(uint96 amt) external {
        uint256 a = bound(amt, 1, 1e9);
        usdc.mint(address(this), a);
        usdc.approve(address(escrow), a);
        escrow.fundYieldReserve(a);
    }

    function creditCycle(uint256 who, uint96 coll, uint96 amt, uint32 dt, bool liquidate) external {
        address b = buyers[who % 3];
        vm.prank(b);
        try credit.depositCollateral(b, bound(coll, 1, 1e12)) {} catch {}
        vm.prank(b);
        try credit.draw(merchant, bound(amt, 1, 1e12)) {} catch {}
        vm.warp(vm.getBlockTimestamp() + bound(dt, 0, 400 days));
        if (liquidate) {
            try credit.liquidate(b) {} catch {}
        } else {
            vm.prank(b);
            try credit.repay(b, bound(amt, 1, 1e12)) {} catch {}
        }
    }
}

contract RelicBaseInvariantTest is BaseSetup {
    RelicBaseHandler handler;

    function setUp() public override {
        super.setUp();
        _gov(address(credit), abi.encodeCall(RelicCreditLine.setCreditEnabled, (true)));
        vm.prank(lender);
        credit.supplyLiquidity(500_000 * USDC1);
        handler = new RelicBaseHandler(escrow, credit, usdc);
        targetContract(address(handler));
    }

    function _heldEscrow() internal view returns (uint256 sum) {
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; i++) {
            sum += escrow.getAgreement(handler.ids(i)).escrowDeposited;
        }
    }

    function invariant_escrowSolvent() public view {
        assertGe(usdc.balanceOf(address(escrow)), _heldEscrow() + escrow.yieldReserve());
    }

    function invariant_tvlMatchesEscrow() public view {
        assertEq(escrow.currentTvl(), _heldEscrow());
    }

    function invariant_creditSolvent() public view {
        assertGe(
            usdc.balanceOf(address(credit)),
            credit.totalCollateral() + credit.availableLiquidity() + credit.protocolRevenue()
        );
    }
}
