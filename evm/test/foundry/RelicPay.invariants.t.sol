// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/RelicPay.sol";
import "../../mocks/Mocks.sol";
import "./RelicPayHandler.sol";

/// @notice Invariant suite for RelicPay (ETH paths). Run with `npm run invariant` (needs forge).
/// The mocha suite proves specific scenarios; this proves properties that must hold after ANY
/// sequence of the handler's actions: solvency, credit accounting, and agreement state coherence.
contract RelicPayInvariantTest is Test {
    RelicPay relicPay;
    MockNFT nft;
    RelicPayHandler handler;

    /// Simulated yield is on by default in the shipped contract; the finding contract below flips it.
    function _yieldRate() internal pure virtual returns (uint256) { return 0; }

    function setUp() public virtual {
        relicPay = new RelicPay();
        relicPay.setYieldRate(address(0), _yieldRate());
        nft = new MockNFT();
        handler = new RelicPayHandler(relicPay, nft);
        relicPay.authorizeNFT(address(nft), true);
        relicPay.transferOwnership(address(handler));

        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](9);
        sel[0] = RelicPayHandler.depositCollateral.selector;
        sel[1] = RelicPayHandler.withdrawCollateral.selector;
        sel[2] = RelicPayHandler.createAgreement.selector;
        sel[3] = RelicPayHandler.pay.selector;
        sel[4] = RelicPayHandler.defaultAgreement.selector;
        sel[5] = RelicPayHandler.sellerWithdraw.selector;
        sel[6] = RelicPayHandler.fundAuto.selector;
        sel[7] = RelicPayHandler.defundAuto.selector;
        sel[8] = RelicPayHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    /// The contract can always pay what it owes: ETH held covers every seller balance, every
    /// auto-payment balance and every ETH position's real principal.
    function invariant_ethSolvency() public view {
        uint256 owed;
        for (uint256 i = 0; i < handler.sellersLength(); i++) {
            owed += relicPay.sellerBalances(handler.sellers(i));
        }
        for (uint256 i = 0; i < handler.buyersLength(); i++) {
            address b = handler.buyers(i);
            owed += relicPay.autoPaymentBalance(b);
            bytes32[] memory ids = relicPay.getUserCollateralPositionIds(b);
            for (uint256 j = 0; j < ids.length; j++) {
                RelicPay.CollateralPosition memory p = relicPay.getCollateralPosition(b, ids[j]);
                if (p.collateralType != RelicPay.CollateralType.ERC20) {
                    owed += relicPay.collateralPrincipal(b, ids[j]);
                }
            }
        }
        assertGe(address(relicPay).balance, owed, "ETH held < ETH owed");
    }

    /// Nothing leaves the contract that did not come in through the handler's own ledger.
    function invariant_noEthCreatedFromNothing() public view {
        assertEq(address(relicPay).balance, handler.ghostEthIn() - handler.ghostEthOut() - _drawn(), "balance != in - out - drawn");
    }

    /// usedCredit is exactly the sum of totalPrice over the buyer's Active agreements; terminal
    /// states (Completed, Defaulted) must have released their reservation.
    function invariant_usedCreditMatchesActiveAgreements() public view {
        for (uint256 i = 0; i < handler.buyersLength(); i++) {
            address b = handler.buyers(i);
            uint256 expected;
            for (uint256 k = 0; k < handler.agreementCount(); k++) {
                RelicPay.BnplAgreement memory a = relicPay.getAgreement(handler.agreementIds(k));
                if (a.buyer == b && a.state == RelicPay.BnplState.Active) expected += a.totalPrice;
            }
            assertEq(relicPay.getCreditLine(b).usedCredit, expected, "usedCredit != sum of active totalPrice");
        }
    }

    /// Credit line arithmetic: available never exceeds limit, and utilization is capped.
    function invariant_creditLineBounds() public view {
        for (uint256 i = 0; i < handler.buyersLength(); i++) {
            RelicPay.CreditLine memory c = relicPay.getCreditLine(handler.buyers(i));
            assertLe(c.availableCredit, c.creditLimit, "available > limit");
            assertLe(c.creditUtilization, relicPay.MAX_CREDIT_UTILIZATION(), "utilization over cap");
        }
    }

    /// Agreement state is coherent with the payment schedule and totals.
    function invariant_agreementCoherence() public view {
        for (uint256 k = 0; k < handler.agreementCount(); k++) {
            bytes32 id = handler.agreementIds(k);
            RelicPay.BnplAgreement memory a = relicPay.getAgreement(id);
            RelicPay.PaymentSchedule[] memory s = relicPay.getPaymentSchedule(id);
            assertEq(s.length, a.installmentCount, "schedule length");
            assertLe(a.paidInstallments, a.installmentCount, "paid > count");

            uint256 paid;
            uint256 paidCount;
            for (uint256 j = 0; j < s.length; j++) {
                if (s[j].status == RelicPay.PaymentStatus.Paid) {
                    paid += s[j].paidAmount;
                    paidCount++;
                    assertLt(j, a.paidInstallments, "paid slot beyond paidInstallments");
                }
            }
            assertEq(paidCount, a.paidInstallments, "paid slots != paidInstallments");
            assertEq(relicPay.totalPaid(id), paid, "totalPaid != sum of paid slots");

            if (a.state == RelicPay.BnplState.Completed) {
                assertEq(a.paidInstallments, a.installmentCount, "completed but unpaid");
                assertEq(nft.ownerOf(handler.nftIds(k)), a.buyer, "completed but NFT not with buyer");
            } else {
                assertLt(a.paidInstallments, a.installmentCount, "all paid but not completed");
                assertEq(nft.ownerOf(handler.nftIds(k)), address(handler), "NFT left before completion");
            }
            if (a.state == RelicPay.BnplState.Defaulted) {
                assertLe(relicPay.collateralSeized(id), a.totalPrice - relicPay.totalPaid(id), "seized > outstanding");
            }
        }
    }

    /// The reported withdrawable ceiling never exceeds real principal or the reported amount.
    function invariant_withdrawableWithinPrincipal() public view {
        for (uint256 i = 0; i < handler.buyersLength(); i++) {
            address b = handler.buyers(i);
            bytes32[] memory ids = relicPay.getUserCollateralPositionIds(b);
            for (uint256 j = 0; j < ids.length; j++) {
                uint256 w = relicPay.getWithdrawableCollateral(b, ids[j]);
                assertLe(w, relicPay.collateralPrincipal(b, ids[j]), "withdrawable > principal");
                assertLe(w, relicPay.getCollateralPosition(b, ids[j]).amount, "withdrawable > amount");
            }
        }
    }

    /// ETH drawn out of buyer collateral/auto balances into seller balances is internal; it never
    /// changes the contract balance. Kept as a hook returning 0 so the ledger invariant states the
    /// real rule (balance == in - out) without a fudge term.
    function _drawn() internal pure returns (uint256) { return 0; }
}

/// @notice FINDING-1: with the default 5% simulated ETH yield on, the solvency invariant FAILS.
/// A default seizure (and a collateral-method payment draw) takes position.amount, which includes
/// simulated yield backed by no ETH, and credits it to sellerBalances, so sellers can be owed more
/// ETH than the contract holds; the shortfall comes out of other users' deposits. Kept as its own
/// contract so `npm run invariant` stays green while the finding is open; run it with
/// `npm run invariant:finding` and expect a red result until the roadmap item is fixed.
contract RelicPayFindingYieldSolvencyTest is RelicPayInvariantTest {
    function _yieldRate() internal pure override returns (uint256) { return 500; }
}
