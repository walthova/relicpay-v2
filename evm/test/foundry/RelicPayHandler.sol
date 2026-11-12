// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/RelicPay.sol";
import "../../mocks/Mocks.sol";

/// @notice Fuzzer-facing driver for the RelicPay invariant suite. Every public function is one
/// protocol action; the invariant runner calls them in random order with random arguments. Actions
/// bound their inputs into the reachable range and swallow expected reverts (try/catch), so the
/// run explores deep sequences instead of dying on the first illegal call. Ghost state records
/// what the handler itself did so invariants can be checked against an independent ledger.
///
/// The handler is the RelicPay owner (the invariant test transfers ownership), because
/// createAgreementWithRWA is onlyOwner. ETH only: the oracle and ERC20 paths are covered by the
/// mocha suite and add actors without adding new ledger shapes here.
contract RelicPayHandler is Test {
    RelicPay public immutable relicPay;
    MockNFT public immutable nft;

    address[] public buyers;
    address[] public sellers;
    bytes32[] public agreementIds;
    uint256[] public nftIds;

    // ghost ledger
    uint256 public ghostCreated;
    uint256 public ghostCompleted;
    uint256 public ghostDefaulted;
    uint256 public ghostEthIn;
    uint256 public ghostEthOut;

    constructor(RelicPay _relicPay, MockNFT _nft) {
        relicPay = _relicPay;
        nft = _nft;
        for (uint256 i = 0; i < 3; i++) {
            address b = address(uint160(0xB0B0 + i));
            address s = address(uint160(0x5E11 + i));
            buyers.push(b);
            sellers.push(s);
            vm.deal(b, 1_000 ether);
        }
        nft.setApprovalForAll(address(_relicPay), true);
    }

    receive() external payable {}

    function buyersLength() external view returns (uint256) { return buyers.length; }
    function sellersLength() external view returns (uint256) { return sellers.length; }
    function agreementCount() external view returns (uint256) { return agreementIds.length; }

    function depositCollateral(uint256 buyerSeed, uint256 amount, bool stake) external {
        address buyer = buyers[buyerSeed % buyers.length];
        amount = bound(amount, 1 ether, 50 ether);
        vm.prank(buyer);
        try relicPay.depositETHCollateral{value: amount}(stake) {
            ghostEthIn += amount;
        } catch {}
    }

    function withdrawCollateral(uint256 buyerSeed, uint256 posSeed, uint256 amount) external {
        address buyer = buyers[buyerSeed % buyers.length];
        bytes32[] memory ids = relicPay.getUserCollateralPositionIds(buyer);
        if (ids.length == 0) return;
        bytes32 id = ids[posSeed % ids.length];
        amount = bound(amount, 1, 50 ether);
        vm.prank(buyer);
        try relicPay.withdrawCollateral(id, amount) {
            ghostEthOut += amount;
        } catch {}
    }

    function createAgreement(
        uint256 buyerSeed,
        uint256 sellerSeed,
        uint256 price,
        uint256 count,
        uint256 interval,
        bool collateralMethod
    ) external {
        address buyer = buyers[buyerSeed % buyers.length];
        address seller = sellers[sellerSeed % sellers.length];
        price = bound(price, 1 ether, 20 ether) + bound(price >> 128, 0, 999_999);
        count = bound(count, 1, 12);
        interval = bound(interval, 1 days, 30 days);

        uint256 tokenId = nft.mint(address(this));
        RelicPay.RWAAsset memory asset = RelicPay.RWAAsset({
            physicalId: "FUZZ",
            nftContract: address(nft),
            tokenId: tokenId,
            metadataURI: "",
            ownershipTransferred: false,
            currentOwner: address(this)
        });
        try relicPay.createAgreementWithRWA(
            seller,
            buyer,
            price,
            count,
            interval,
            3 days,
            collateralMethod ? RelicPay.PaymentMethod.Collateral : RelicPay.PaymentMethod.Manual,
            asset
        ) returns (bytes32 id) {
            agreementIds.push(id);
            nftIds.push(tokenId);
            ghostCreated++;
        } catch {}
    }

    function pay(uint256 agreementSeed, bool early) external {
        if (agreementIds.length == 0) return;
        bytes32 id = agreementIds[agreementSeed % agreementIds.length];
        RelicPay.BnplAgreement memory a = relicPay.getAgreement(id);
        if (a.state != RelicPay.BnplState.Active) return;
        uint256 n = uint256(a.paidInstallments) + 1;
        if (n > a.installmentCount) return;
        RelicPay.PaymentSchedule[] memory sched = relicPay.getPaymentSchedule(id);
        if (!early && block.timestamp < sched[n - 1].dueDate) vm.warp(sched[n - 1].dueDate);
        uint256 amt = sched[n - 1].amount;
        bool manual = a.paymentMethod == RelicPay.PaymentMethod.Manual;
        if (manual) vm.deal(a.buyer, a.buyer.balance + amt);
        vm.prank(a.buyer);
        try relicPay.processPayment{value: manual ? amt : 0}(id, n) {
            if (manual) ghostEthIn += amt;
            if (n == a.installmentCount) ghostCompleted++;
        } catch {}
    }

    function defaultAgreement(uint256 agreementSeed) external {
        if (agreementIds.length == 0) return;
        bytes32 id = agreementIds[agreementSeed % agreementIds.length];
        RelicPay.BnplAgreement memory a = relicPay.getAgreement(id);
        if (a.state != RelicPay.BnplState.Active) return;
        RelicPay.PaymentSchedule[] memory sched = relicPay.getPaymentSchedule(id);
        uint256 expiry = sched[a.paidInstallments].dueDate + a.gracePeriodSeconds;
        if (block.timestamp < expiry) vm.warp(expiry);
        vm.prank(a.seller);
        try relicPay.triggerDefault(id) {
            ghostDefaulted++;
        } catch {}
    }

    function sellerWithdraw(uint256 sellerSeed) external {
        address seller = sellers[sellerSeed % sellers.length];
        uint256 bal = relicPay.sellerBalances(seller);
        vm.prank(seller);
        try relicPay.withdrawSellerBalance() {
            ghostEthOut += bal;
        } catch {}
    }

    function fundAuto(uint256 buyerSeed, uint256 amount) external {
        address buyer = buyers[buyerSeed % buyers.length];
        amount = bound(amount, 0.1 ether, 10 ether);
        vm.prank(buyer);
        try relicPay.depositAutoPaymentFunds{value: amount}() {
            ghostEthIn += amount;
        } catch {}
    }

    function defundAuto(uint256 buyerSeed, uint256 amount) external {
        address buyer = buyers[buyerSeed % buyers.length];
        amount = bound(amount, 1, 10 ether);
        vm.prank(buyer);
        try relicPay.withdrawAutoPaymentFunds(amount) {
            ghostEthOut += amount;
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 hours, 90 days));
    }
}
