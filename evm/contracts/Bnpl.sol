
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Bnpl
 * @dev A minimal Buy Now Pay Later (BNPL) contract for Real World Assets (RWAs)
 * @notice This contract allows buyers to purchase assets by paying installments while locking collateral
 */
contract Bnpl is Ownable, ReentrancyGuard {
    enum BnplState {
        Active,
        Completed,
        Defaulted
    }

    // Field order below is chosen for storage packing: the six small fields
    // (installmentCount, dueIntervalSeconds, startTime, paidInstallments,
    // gracePeriodSeconds, state) fit in a single 32-byte slot instead of six,
    // cutting createAgreement's storage writes roughly in half. totalPrice,
    // installmentAmount, and collateralAmount stay full uint256 since they are
    // wei amounts with no safe bound to truncate to.
    struct BnplAgreement {
        address seller;
        address buyer;
        uint256 totalPrice;
        uint256 installmentAmount;
        uint256 collateralAmount;
        uint32 installmentCount;
        uint32 dueIntervalSeconds;
        uint40 startTime;
        uint32 paidInstallments;
        uint32 gracePeriodSeconds;
        BnplState state;
    }

    // Agreement ID => Agreement details
    mapping(bytes32 => BnplAgreement) public agreements;
    
    // Agreement ID => Collateral deposited
    mapping(bytes32 => uint256) public collateralDeposited;
    
    // Agreement ID => Total installments paid
    mapping(bytes32 => uint256) public totalPaid;

    // Agreement ID => discount the seller has authorized for early payoff (V1-BUG-1 fix)
    mapping(bytes32 => uint256) public sellerApprovedDiscount;

    // Events
    event AgreementCreated(
        bytes32 indexed agreementId,
        address indexed seller,
        address indexed buyer,
        uint256 totalPrice,
        uint256 installmentCount,
        uint256 installmentAmount,
        uint256 dueIntervalSeconds,
        uint256 collateralAmount,
        uint256 startTime
    );

    event CollateralDeposited(
        bytes32 indexed agreementId,
        address indexed buyer,
        uint256 amount
    );

    event InstallmentPaid(
        bytes32 indexed agreementId,
        address indexed buyer,
        uint256 installmentNumber,
        uint256 amount
    );

    event OwnershipTransferred(
        bytes32 indexed agreementId,
        address indexed buyer,
        uint256 totalPaid
    );

    event AgreementDefaulted(
        bytes32 indexed agreementId,
        address indexed seller,
        uint256 collateralClaimed,
        uint256 installmentsClaimed
    );

    event DiscountApproved(
        bytes32 indexed agreementId,
        uint256 amount
    );

    event EarlyPayoff(
        bytes32 indexed agreementId,
        address indexed buyer,
        uint256 totalPaid,
        uint256 discount
    );

    // Errors
    error AgreementNotFound();
    error InvalidAgreement();
    error InsufficientPayment();
    error AgreementNotActive();
    error AgreementAlreadyCompleted();
    error AgreementAlreadyDefaulted();
    error PaymentNotDue();
    error GracePeriodNotExpired();
    error InsufficientCollateral();
    error UnauthorizedCaller();
    error ZeroAddress();
    error ZeroAmount();
    error ValueTooLarge();
    error DiscountNotApproved();
    error TransferFailed();

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Create a new BNPL agreement
     * @param seller The address of the seller
     * @param buyer The address of the buyer
     * @param totalPrice Total price of the asset
     * @param installmentCount Number of installments
     * @param dueIntervalSeconds Time between installments in seconds
     * @param collateralAmount Amount of collateral required
     * @param gracePeriodSeconds Grace period for late payments
     */
    function createAgreement(
        address seller,
        address buyer,
        uint256 totalPrice,
        uint256 installmentCount,
        uint256 dueIntervalSeconds,
        uint256 collateralAmount,
        uint256 gracePeriodSeconds
    ) external onlyOwner returns (bytes32) {
        if (seller == address(0)) revert ZeroAddress();
        if (buyer == address(0)) revert ZeroAddress();
        if (totalPrice == 0) revert ZeroAmount();
        if (installmentCount == 0) revert ZeroAmount();
        if (dueIntervalSeconds == 0) revert ZeroAmount();
        if (collateralAmount == 0) revert ZeroAmount();
        // these fields are packed into a single storage slot below; bound them
        // so the narrowing cast can never silently truncate
        if (installmentCount > type(uint32).max || dueIntervalSeconds > type(uint32).max || gracePeriodSeconds > type(uint32).max) {
            revert ValueTooLarge();
        }

        uint256 installmentAmount = totalPrice / installmentCount;
        if (installmentAmount == 0) revert ZeroAmount();

        bytes32 agreementId = keccak256(
            abi.encodePacked(
                seller,
                buyer,
                totalPrice,
                installmentCount,
                dueIntervalSeconds,
                collateralAmount,
                block.timestamp
            )
        );

        agreements[agreementId] = BnplAgreement({
            seller: seller,
            buyer: buyer,
            totalPrice: totalPrice,
            installmentAmount: installmentAmount,
            collateralAmount: collateralAmount,
            installmentCount: uint32(installmentCount),
            dueIntervalSeconds: uint32(dueIntervalSeconds),
            startTime: uint40(block.timestamp),
            paidInstallments: 0,
            gracePeriodSeconds: uint32(gracePeriodSeconds),
            state: BnplState.Active
        });

        emit AgreementCreated(
            agreementId,
            seller,
            buyer,
            totalPrice,
            installmentCount,
            installmentAmount,
            dueIntervalSeconds,
            collateralAmount,
            block.timestamp
        );

        return agreementId;
    }

    /**
     * @dev Deposit collateral for an agreement
     * @param agreementId The ID of the agreement
     */
    function depositCollateral(bytes32 agreementId) external payable nonReentrant {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Active) revert AgreementNotActive();
        if (msg.sender != agreement.buyer) revert UnauthorizedCaller();
        if (msg.value != agreement.collateralAmount) revert InsufficientCollateral();

        collateralDeposited[agreementId] = msg.value;

        emit CollateralDeposited(agreementId, msg.sender, msg.value);
    }

    /**
     * @dev Pay an installment
     * @param agreementId The ID of the agreement
     * @param installmentNumber The installment number (1-based)
     */
    function payInstallment(bytes32 agreementId, uint256 installmentNumber) external payable nonReentrant {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Active) revert AgreementNotActive();
        if (msg.sender != agreement.buyer) revert UnauthorizedCaller();
        if (installmentNumber == 0 || installmentNumber > agreement.installmentCount) revert InvalidAgreement();
        // strict sequence; prepayment before the due date is allowed in v2
        if (installmentNumber != uint256(agreement.paidInstallments) + 1) revert InvalidAgreement();

        if (msg.value != agreement.installmentAmount) revert InsufficientPayment();

        agreement.paidInstallments = uint32(installmentNumber);
        totalPaid[agreementId] += msg.value;

        emit InstallmentPaid(agreementId, msg.sender, installmentNumber, msg.value);

        // Check if all installments are paid
        if (installmentNumber == agreement.installmentCount) {
            agreement.state = BnplState.Completed;
            emit OwnershipTransferred(agreementId, msg.sender, totalPaid[agreementId]);
        }
    }

    /**
     * @dev Pay off the remaining balance early (with optional discount)
     * @param agreementId The ID of the agreement
     * @param discountAmount Amount to discount from remaining balance
     */
    function earlyPayoff(bytes32 agreementId, uint256 discountAmount) external payable nonReentrant {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Active) revert AgreementNotActive();
        if (msg.sender != agreement.buyer) revert UnauthorizedCaller();

        if (discountAmount > sellerApprovedDiscount[agreementId]) revert DiscountNotApproved();

        uint256 remainingBalance = agreement.totalPrice - totalPaid[agreementId];
        uint256 finalPayment = remainingBalance - discountAmount;
        
        if (msg.value != finalPayment) revert InsufficientPayment();

        agreement.paidInstallments = agreement.installmentCount;
        totalPaid[agreementId] += msg.value;
        agreement.state = BnplState.Completed;

        emit EarlyPayoff(agreementId, msg.sender, totalPaid[agreementId], discountAmount);
        emit OwnershipTransferred(agreementId, msg.sender, totalPaid[agreementId]);
    }

    /**
     * @dev Trigger default for an agreement after grace period
     * @param agreementId The ID of the agreement
     */
    function triggerDefault(bytes32 agreementId) external nonReentrant {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Active) revert AgreementNotActive();
        if (msg.sender != agreement.seller) revert UnauthorizedCaller();

        // Check if grace period has expired for the next due installment
        uint256 nextInstallment = agreement.paidInstallments + 1;
        if (nextInstallment > agreement.installmentCount) revert AgreementAlreadyCompleted();

        uint256 dueTime = agreement.startTime + (nextInstallment - 1) * agreement.dueIntervalSeconds;
        uint256 graceExpiry = dueTime + agreement.gracePeriodSeconds;
        
        if (block.timestamp < graceExpiry) revert GracePeriodNotExpired();

        agreement.state = BnplState.Defaulted;

        uint256 collateralClaimed = collateralDeposited[agreementId];
        uint256 installmentsClaimed = totalPaid[agreementId];

        // Transfer collateral and installments to seller
        if (collateralClaimed > 0) {
            collateralDeposited[agreementId] = 0;
            _send(agreement.seller, collateralClaimed);
        }
        if (installmentsClaimed > 0) {
            totalPaid[agreementId] = 0;
            _send(agreement.seller, installmentsClaimed);
        }

        emit AgreementDefaulted(agreementId, agreement.seller, collateralClaimed, installmentsClaimed);
    }

    /**
     * @dev Withdraw funds for completed agreement (seller)
     * @param agreementId The ID of the agreement
     */
    function withdrawFunds(bytes32 agreementId) external nonReentrant {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Completed) revert AgreementNotActive();
        if (msg.sender != agreement.seller) revert UnauthorizedCaller();

        uint256 amount = totalPaid[agreementId];
        totalPaid[agreementId] = 0; // Prevent reentrancy

        _send(agreement.seller, amount);
    }

    /**
     * @dev Withdraw collateral for completed agreement (buyer)
     * @param agreementId The ID of the agreement
     */
    function withdrawCollateral(bytes32 agreementId) external nonReentrant {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Completed) revert AgreementNotActive();
        if (msg.sender != agreement.buyer) revert UnauthorizedCaller();

        uint256 amount = collateralDeposited[agreementId];
        collateralDeposited[agreementId] = 0; // Prevent reentrancy

        _send(agreement.buyer, amount);
    }

    /**
     * @dev Seller authorizes a maximum early-payoff discount
     */
    function approveDiscount(bytes32 agreementId, uint256 amount) external {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Active) revert AgreementNotActive();
        if (msg.sender != agreement.seller) revert UnauthorizedCaller();
        sellerApprovedDiscount[agreementId] = amount;
        emit DiscountApproved(agreementId, amount);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /**
     * @dev Get agreement details
     * @param agreementId The ID of the agreement
     */
    function getAgreement(bytes32 agreementId) external view returns (BnplAgreement memory) {
        if (agreements[agreementId].seller == address(0)) revert AgreementNotFound();
        return agreements[agreementId];
    }

    /**
     * @dev Check if an installment is due
     * @param agreementId The ID of the agreement
     * @param installmentNumber The installment number
     */
    function isInstallmentDue(bytes32 agreementId, uint256 installmentNumber) external view returns (bool) {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        
        uint256 dueTime = agreement.startTime + (installmentNumber - 1) * agreement.dueIntervalSeconds;
        return block.timestamp >= dueTime;
    }

    /**
     * @dev Check if grace period has expired for an installment
     * @param agreementId The ID of the agreement
     * @param installmentNumber The installment number
     */
    function isGracePeriodExpired(bytes32 agreementId, uint256 installmentNumber) external view returns (bool) {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        
        uint256 dueTime = agreement.startTime + (installmentNumber - 1) * agreement.dueIntervalSeconds;
        uint256 graceExpiry = dueTime + agreement.gracePeriodSeconds;
        return block.timestamp >= graceExpiry;
    }
}
