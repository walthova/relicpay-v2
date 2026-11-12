
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

    struct BnplAgreement {
        address seller;
        address buyer;
        uint256 totalPrice;
        uint256 installmentCount;
        uint256 installmentAmount;
        uint256 dueIntervalSeconds;
        uint256 collateralAmount;
        uint256 startTime;
        uint256 paidInstallments;
        BnplState state;
        uint256 gracePeriodSeconds;
    }

    // Agreement ID => Agreement details
    mapping(bytes32 => BnplAgreement) public agreements;
    
    // Agreement ID => Collateral deposited
    mapping(bytes32 => uint256) public collateralDeposited;
    
    // Agreement ID => Total installments paid
    mapping(bytes32 => uint256) public totalPaid;

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
        require(seller != address(0), "Invalid seller address");
        require(buyer != address(0), "Invalid buyer address");
        require(totalPrice > 0, "Total price must be greater than 0");
        require(installmentCount > 0, "Installment count must be greater than 0");
        require(dueIntervalSeconds > 0, "Due interval must be greater than 0");
        require(collateralAmount > 0, "Collateral amount must be greater than 0");

        uint256 installmentAmount = totalPrice / installmentCount;
        require(installmentAmount > 0, "Installment amount must be greater than 0");

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
            installmentCount: installmentCount,
            installmentAmount: installmentAmount,
            dueIntervalSeconds: dueIntervalSeconds,
            collateralAmount: collateralAmount,
            startTime: block.timestamp,
            paidInstallments: 0,
            state: BnplState.Active,
            gracePeriodSeconds: gracePeriodSeconds
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
        if (installmentNumber <= agreement.paidInstallments) revert InvalidAgreement();

        // Check if payment is due
        uint256 dueTime = agreement.startTime + (installmentNumber - 1) * agreement.dueIntervalSeconds;
        if (block.timestamp < dueTime) revert PaymentNotDue();

        if (msg.value != agreement.installmentAmount) revert InsufficientPayment();

        agreement.paidInstallments = installmentNumber;
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
            payable(agreement.seller).transfer(collateralClaimed);
        }
        if (installmentsClaimed > 0) {
            payable(agreement.seller).transfer(installmentsClaimed);
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

        payable(agreement.seller).transfer(amount);
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

        payable(agreement.buyer).transfer(amount);
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
