// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title EnhancedBnpl
 * @dev Enhanced Buy Now Pay Later (BNPL) contract with yield-bearing collateral and credit lines
 * @notice This contract allows buyers to use yield-bearing collateral to create credit lines for purchases
 */
contract EnhancedBnpl is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum BnplState {
        Active,
        Completed,
        Defaulted
    }

    enum CollateralType {
        ETH,        // Native ETH
        ERC20,      // ERC20 token
        StakedETH   // Staked ETH (e.g., stETH from Lido)
    }

    enum PaymentMethod {
        Manual,     // Buyer pays manually
        Auto,       // Auto-deduct from wallet
        Collateral  // Auto-withdraw from collateral
    }

    struct CollateralPosition {
        CollateralType collateralType;
        address tokenAddress;      // For ERC20/staked tokens
        uint256 amount;           // Amount deposited
        uint256 yieldAccrued;     // Yield earned
        uint256 lastUpdateTime;   // Last yield calculation
        bool autoReinvest;        // Auto-reinvest yield
    }

    struct CreditLine {
        uint256 collateralValue;   // Total collateral value in ETH
        uint256 creditLimit;       // Maximum credit available (e.g., 80% of collateral)
        uint256 availableCredit;   // Available credit remaining
        uint256 usedCredit;        // Credit currently used
        uint256 creditUtilization; // Percentage of credit used
    }

    struct BnplAgreement {
        address seller;
        address buyer;
        uint256 totalPrice;
        uint256 installmentCount;
        uint256 installmentAmount;
        uint256 dueIntervalSeconds;
        uint256 startTime;
        uint256 paidInstallments;
        BnplState state;
        uint256 gracePeriodSeconds;
        PaymentMethod paymentMethod;
        bytes32 collateralPositionId; // Reference to buyer's collateral position
    }

    // Global state
    uint256 public constant CREDIT_LIMIT_RATIO = 80; // 80% of collateral value
    uint256 public constant YIELD_UPDATE_INTERVAL = 1 days;
    
    // Mappings
    mapping(bytes32 => BnplAgreement) public agreements;
    mapping(address => mapping(bytes32 => CollateralPosition)) public collateralPositions; // user => positionId => position
    mapping(address => bytes32[]) public userCollateralPositionIds; // user => array of position IDs
    mapping(address => CreditLine) public creditLines;
    mapping(bytes32 => uint256) public totalPaid;
    
    // Yield strategies (simplified for demo)
    mapping(address => uint256) public yieldRates; // APY in basis points (100 = 1%)
    
    // Settlement system
    mapping(address => uint256) public sellerBalances; // ETH balances for sellers
    mapping(address => mapping(address => uint256)) public sellerTokenBalances; // ERC20 balances for sellers

    // Events
    event CollateralDeposited(
        address indexed user,
        CollateralType collateralType,
        address tokenAddress,
        uint256 amount,
        uint256 creditLimit
    );

    event YieldAccrued(
        address indexed user,
        uint256 yieldAmount,
        uint256 totalYield
    );

    event CreditLineUpdated(
        address indexed user,
        uint256 creditLimit,
        uint256 availableCredit,
        uint256 usedCredit
    );

    event AgreementCreated(
        bytes32 indexed agreementId,
        address indexed seller,
        address indexed buyer,
        uint256 totalPrice,
        uint256 installmentCount,
        uint256 installmentAmount,
        uint256 dueIntervalSeconds,
        PaymentMethod paymentMethod,
        uint256 startTime
    );

    event InstallmentPaid(
        bytes32 indexed agreementId,
        address indexed buyer,
        uint256 installmentNumber,
        uint256 amount,
        PaymentMethod paymentMethod
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

    event SellerBalanceUpdated(
        address indexed seller,
        uint256 ethBalance,
        uint256 totalBalance
    );

    event SellerWithdrawal(
        address indexed seller,
        uint256 amount,
        bool isETH
    );

    // Errors
    error InsufficientCollateral();
    error InsufficientCredit();
    error InvalidCollateralType();
    error AgreementNotFound();
    error InvalidAgreement();
    error InsufficientPayment();
    error AgreementNotActive();
    error AgreementAlreadyCompleted();
    error AgreementAlreadyDefaulted();
    error PaymentNotDue();
    error GracePeriodNotExpired();
    error UnauthorizedCaller();
    error InvalidPaymentMethod();

    constructor() Ownable(msg.sender) {
        // Set default yield rates (in basis points: 100 = 1%)
        yieldRates[address(0)] = 500; // 5% APY for ETH
    }

    /**
     * @dev Deposit ETH as collateral
     */
    function depositETHCollateral() external payable nonReentrant {
        require(msg.value > 0, "Amount must be greater than 0");
        
        bytes32 positionId = keccak256(abi.encodePacked(msg.sender, address(0), "eth"));
        
        _updateYield(msg.sender, positionId);
        
        CollateralPosition storage position = collateralPositions[msg.sender][positionId];
        
        // If this is a new position, add it to the user's position list
        if (position.amount == 0) {
            userCollateralPositionIds[msg.sender].push(positionId);
        }
        
        position.collateralType = CollateralType.ETH;
        position.tokenAddress = address(0);
        position.amount += msg.value;
        position.lastUpdateTime = block.timestamp;
        position.autoReinvest = true; // Default to auto-reinvest
        
        _updateCreditLine(msg.sender);
        
        emit CollateralDeposited(
            msg.sender,
            CollateralType.ETH,
            address(0),
            msg.value,
            creditLines[msg.sender].creditLimit
        );
    }

    /**
     * @dev Deposit ERC20 token as collateral
     */
    function depositERC20Collateral(address tokenAddress, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(tokenAddress != address(0), "Invalid token address");
        
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        
        bytes32 positionId = keccak256(abi.encodePacked(msg.sender, tokenAddress, "erc20"));
        
        _updateYield(msg.sender, positionId);
        
        CollateralPosition storage position = collateralPositions[msg.sender][positionId];
        
        // If this is a new position, add it to the user's position list
        if (position.amount == 0) {
            userCollateralPositionIds[msg.sender].push(positionId);
        }
        
        position.collateralType = CollateralType.ERC20;
        position.tokenAddress = tokenAddress;
        position.amount += amount;
        position.lastUpdateTime = block.timestamp;
        position.autoReinvest = true;
        
        _updateCreditLine(msg.sender);
        
        emit CollateralDeposited(
            msg.sender,
            CollateralType.ERC20,
            tokenAddress,
            amount,
            creditLines[msg.sender].creditLimit
        );
    }

    /**
     * @dev Create a new BNPL agreement using credit line
     */
    function createAgreementWithCredit(
        address seller,
        address buyer,
        uint256 totalPrice,
        uint256 installmentCount,
        uint256 dueIntervalSeconds,
        uint256 gracePeriodSeconds,
        PaymentMethod paymentMethod
    ) external onlyOwner returns (bytes32) {
        require(seller != address(0), "Invalid seller address");
        require(buyer != address(0), "Invalid buyer address");
        require(totalPrice > 0, "Total price must be greater than 0");
        require(installmentCount > 0, "Installment count must be greater than 0");
        require(dueIntervalSeconds > 0, "Due interval must be greater than 0");

        uint256 installmentAmount = totalPrice / installmentCount;
        require(installmentAmount > 0, "Installment amount must be greater than 0");

        // Check if buyer has sufficient credit
        _updateAllYields(buyer);
        _updateCreditLine(buyer);
        
        CreditLine storage creditLine = creditLines[buyer];
        if (creditLine.availableCredit < totalPrice) revert InsufficientCredit();

        bytes32 agreementId = keccak256(
            abi.encodePacked(
                seller,
                buyer,
                totalPrice,
                installmentCount,
                dueIntervalSeconds,
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
            startTime: block.timestamp,
            paidInstallments: 0,
            state: BnplState.Active,
            gracePeriodSeconds: gracePeriodSeconds,
            paymentMethod: paymentMethod,
            collateralPositionId: keccak256(abi.encodePacked(buyer))
        });

        // Update credit line usage
        creditLine.usedCredit += totalPrice;
        creditLine.availableCredit -= totalPrice;
        creditLine.creditUtilization = (creditLine.usedCredit * 100) / creditLine.creditLimit;

        emit AgreementCreated(
            agreementId,
            seller,
            buyer,
            totalPrice,
            installmentCount,
            installmentAmount,
            dueIntervalSeconds,
            paymentMethod,
            block.timestamp
        );

        return agreementId;
    }

    /**
     * @dev Pay an installment using the specified payment method
     */
    function payInstallment(bytes32 agreementId, uint256 installmentNumber) external payable nonReentrant {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Active) revert AgreementNotActive();
        if (msg.sender != agreement.buyer) revert UnauthorizedCaller();
        if (installmentNumber == 0 || installmentNumber > agreement.installmentCount) revert InvalidAgreement();
        if (installmentNumber <= agreement.paidInstallments) revert InvalidAgreement();

        // Check if payment is due
        uint256 dueTime = agreement.startTime + (installmentNumber * agreement.dueIntervalSeconds);
        if (block.timestamp < dueTime) revert PaymentNotDue();

        uint256 paymentAmount = agreement.installmentAmount;
        
        // Process payment based on method
        if (agreement.paymentMethod == PaymentMethod.Manual) {
            if (msg.value != paymentAmount) revert InsufficientPayment();
            // Credit seller with ETH payment
            sellerBalances[agreement.seller] += paymentAmount;
        } else if (agreement.paymentMethod == PaymentMethod.Collateral) {
            _withdrawFromCollateral(agreement.buyer, paymentAmount, agreement.seller);
        } else {
            revert InvalidPaymentMethod();
        }

        agreement.paidInstallments = installmentNumber;
        totalPaid[agreementId] += paymentAmount;

        emit InstallmentPaid(agreementId, msg.sender, installmentNumber, paymentAmount, agreement.paymentMethod);

        // Check if all installments are paid
        if (installmentNumber == agreement.installmentCount) {
            agreement.state = BnplState.Completed;
            _releaseCredit(agreement.buyer, agreement.totalPrice);
            emit OwnershipTransferred(agreementId, msg.sender, totalPaid[agreementId]);
        }
    }

    /**
     * @dev Update yield for a user's collateral position
     */
    function _updateYield(address user, bytes32 positionId) internal {
        CollateralPosition storage position = collateralPositions[user][positionId];
        if (position.amount == 0) return;

        uint256 timeElapsed = block.timestamp - position.lastUpdateTime;
        if (timeElapsed < YIELD_UPDATE_INTERVAL) return;

        uint256 yieldRate = yieldRates[position.tokenAddress];
        uint256 yieldAmount = (position.amount * yieldRate * timeElapsed) / (365 days * 10000);
        
        position.yieldAccrued += yieldAmount;
        position.lastUpdateTime = block.timestamp;

        if (position.autoReinvest) {
            position.amount += yieldAmount;
            position.yieldAccrued = 0;
        }

        emit YieldAccrued(user, yieldAmount, position.yieldAccrued);
    }

    /**
     * @dev Update yield for all user positions
     */
    function _updateAllYields(address user) internal {
        bytes32[] memory positionIds = userCollateralPositionIds[user];
        for (uint256 i = 0; i < positionIds.length; i++) {
            _updateYield(user, positionIds[i]);
        }
    }

    /**
     * @dev Update credit line based on collateral value
     */
    function _updateCreditLine(address user) internal {
        _updateAllYields(user);
        
        CreditLine storage creditLine = creditLines[user];
        uint256 totalCollateralValue = _getTotalCollateralValue(user);
        uint256 newCreditLimit = (totalCollateralValue * CREDIT_LIMIT_RATIO) / 100;
        
        creditLine.collateralValue = totalCollateralValue;
        creditLine.creditLimit = newCreditLimit;
        
        // Ensure no underflow
        if (newCreditLimit >= creditLine.usedCredit) {
            creditLine.availableCredit = newCreditLimit - creditLine.usedCredit;
        } else {
            creditLine.availableCredit = 0;
        }
        
        creditLine.creditUtilization = creditLine.usedCredit > 0 && newCreditLimit > 0 ? 
            (creditLine.usedCredit * 100) / newCreditLimit : 0;

        emit CreditLineUpdated(
            user,
            creditLine.creditLimit,
            creditLine.availableCredit,
            creditLine.usedCredit
        );
    }

    /**
     * @dev Get collateral value in ETH
     */
    function _getCollateralValue(CollateralPosition memory position) internal pure returns (uint256) {
        // Simplified: assume 1:1 ratio for demo
        // In production, you'd use price oracles
        return position.amount;
    }

    /**
     * @dev Get total collateral value for all user positions
     */
    function _getTotalCollateralValue(address user) internal view returns (uint256) {
        bytes32[] memory positionIds = userCollateralPositionIds[user];
        uint256 totalValue = 0;
        
        for (uint256 i = 0; i < positionIds.length; i++) {
            CollateralPosition memory position = collateralPositions[user][positionIds[i]];
            totalValue += _getCollateralValue(position);
        }
        
        return totalValue;
    }

    /**
     * @dev Withdraw from collateral position and credit seller
     */
    function _withdrawFromCollateral(address user, uint256 amount, address seller) internal {
        bytes32[] memory positionIds = userCollateralPositionIds[user];
        uint256 remainingAmount = amount;
        
        // Withdraw from positions in order (first ETH, then ERC20)
        for (uint256 i = 0; i < positionIds.length && remainingAmount > 0; i++) {
            CollateralPosition storage position = collateralPositions[user][positionIds[i]];
            
            if (position.amount > 0) {
                uint256 withdrawAmount = remainingAmount > position.amount ? position.amount : remainingAmount;
                position.amount -= withdrawAmount;
                remainingAmount -= withdrawAmount;
                
                // Credit seller based on collateral type
                if (position.collateralType == CollateralType.ETH || position.collateralType == CollateralType.StakedETH) {
                    sellerBalances[seller] += withdrawAmount;
                } else if (position.collateralType == CollateralType.ERC20) {
                    sellerTokenBalances[seller][position.tokenAddress] += withdrawAmount;
                }
            }
        }
        
        require(remainingAmount == 0, "Insufficient collateral");
        _updateCreditLine(user);
        
        emit SellerBalanceUpdated(seller, sellerBalances[seller], sellerBalances[seller]);
    }

    /**
     * @dev Release credit when agreement is completed
     */
    function _releaseCredit(address user, uint256 amount) internal {
        CreditLine storage creditLine = creditLines[user];
        creditLine.usedCredit -= amount;
        creditLine.availableCredit += amount;
        creditLine.creditUtilization = creditLine.usedCredit > 0 ? (creditLine.usedCredit * 100) / creditLine.creditLimit : 0;
    }

    /**
     * @dev Set yield rate for a token
     */
    function setYieldRate(address tokenAddress, uint256 rateBasisPoints) external onlyOwner {
        yieldRates[tokenAddress] = rateBasisPoints;
    }

    /**
     * @dev Get user's collateral position
     */
    function getCollateralPosition(address user, bytes32 positionId) external view returns (CollateralPosition memory) {
        return collateralPositions[user][positionId];
    }

    function getUserCollateralPositionIds(address user) external view returns (bytes32[] memory) {
        return userCollateralPositionIds[user];
    }

    function getTotalCollateralValue(address user) external view returns (uint256) {
        return _getTotalCollateralValue(user);
    }

    /**
     * @dev Get user's credit line
     */
    function getCreditLine(address user) external view returns (CreditLine memory) {
        return creditLines[user];
    }

    /**
     * @dev Get agreement details
     */
    function getAgreement(bytes32 agreementId) external view returns (BnplAgreement memory) {
        if (agreements[agreementId].seller == address(0)) revert AgreementNotFound();
        return agreements[agreementId];
    }

    /**
     * @dev Withdraw collateral from a specific position (only when no active agreements)
     */
    function withdrawCollateral(bytes32 positionId, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        CollateralPosition storage position = collateralPositions[msg.sender][positionId];
        require(position.amount >= amount, "Insufficient collateral");
        
        // Check if user has any active agreements
        // This would require additional logic to track active agreements per user
        
        position.amount -= amount;
        _updateCreditLine(msg.sender);
        
        if (position.collateralType == CollateralType.ETH) {
            payable(msg.sender).transfer(amount);
        } else {
            IERC20(position.tokenAddress).safeTransfer(msg.sender, amount);
        }
    }

    /**
     * @dev Withdraw ETH balance for seller
     */
    function withdrawSellerBalance() external nonReentrant {
        uint256 balance = sellerBalances[msg.sender];
        require(balance > 0, "No balance to withdraw");
        
        sellerBalances[msg.sender] = 0;
        payable(msg.sender).transfer(balance);
        
        emit SellerWithdrawal(msg.sender, balance, true);
    }

    /**
     * @dev Withdraw ERC20 token balance for seller
     */
    function withdrawSellerTokenBalance(address tokenAddress) external nonReentrant {
        uint256 balance = sellerTokenBalances[msg.sender][tokenAddress];
        require(balance > 0, "No token balance to withdraw");
        
        sellerTokenBalances[msg.sender][tokenAddress] = 0;
        IERC20(tokenAddress).safeTransfer(msg.sender, balance);
        
        emit SellerWithdrawal(msg.sender, balance, false);
    }

    function getSellerBalance(address seller) external view returns (uint256) {
        return sellerBalances[seller];
    }

    function getSellerTokenBalance(address seller, address tokenAddress) external view returns (uint256) {
        return sellerTokenBalances[seller][tokenAddress];
    }
}
