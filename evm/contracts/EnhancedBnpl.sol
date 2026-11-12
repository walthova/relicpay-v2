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

    // Field order chosen for storage packing: collateralType + tokenAddress + autoReinvest +
    // lastUpdateTime (27 bytes) share a single slot instead of four, cutting collateral writes
    // roughly in half. amount and yieldAccrued stay full uint256 since they are wei amounts.
    struct CollateralPosition {
        CollateralType collateralType;
        address tokenAddress;      // For ERC20/staked tokens
        bool autoReinvest;         // Auto-reinvest yield
        uint40 lastUpdateTime;     // Last yield calculation
        uint256 amount;           // Amount deposited
        uint256 yieldAccrued;     // Yield earned
    }

    // creditUtilization is hard capped at MAX_CREDIT_UTILIZATION but deliberately left uint256.
    // Unlike RelicPay's CreditLine there is no second small field here to share a slot with, so
    // narrowing it would still occupy one full slot and only add mask/shift work on every read and
    // write. The other four fields are wei amounts with no safe bound to truncate to.
    struct CreditLine {
        uint256 collateralValue;   // Total collateral value in ETH
        uint256 creditLimit;       // Maximum credit available (e.g., 80% of collateral)
        uint256 availableCredit;   // Available credit remaining
        uint256 usedCredit;        // Credit currently used
        uint256 creditUtilization; // Percent of credit used, capped at 100
    }

    // Field order chosen for storage packing: installmentCount, dueIntervalSeconds, startTime,
    // paidInstallments, gracePeriodSeconds, state, and paymentMethod (23 bytes) fit in a single
    // slot instead of seven, cutting createAgreementWithCredit's storage writes accordingly.
    // totalPrice and installmentAmount stay full uint256 since they are wei amounts.
    struct BnplAgreement {
        address seller;
        address buyer;
        uint256 totalPrice;
        uint256 installmentAmount;
        uint32 installmentCount;
        uint32 dueIntervalSeconds;
        uint40 startTime;
        uint32 paidInstallments;
        uint32 gracePeriodSeconds;
        BnplState state;
        PaymentMethod paymentMethod;
        bytes32 collateralPositionId; // Reference to buyer's collateral position
    }

    // Global state
    uint256 public constant CREDIT_LIMIT_RATIO = 80; // 80% of collateral value
    uint256 public constant YIELD_UPDATE_INTERVAL = 1 days;
    // Hard cap on CreditLine.creditUtilization. This contract reports utilization as a percent
    // (not basis points like RelicPay), keeping the legacy ABI semantics. Utilization exceeds 100
    // whenever collateral value falls while credit is outstanding, so it clamps rather than
    // reverting: a read of 100 means "at or over the limit", and callers needing the exact
    // over-limit ratio should compute it from usedCredit and creditLimit.
    uint256 public constant MAX_CREDIT_UTILIZATION = 100; // percent
    
    // Mappings
    mapping(bytes32 => BnplAgreement) public agreements;
    mapping(address => mapping(bytes32 => CollateralPosition)) public collateralPositions; // user => positionId => position
    mapping(address => bytes32[]) public userCollateralPositionIds; // user => array of position IDs

    // Whether a positionId is already present in userCollateralPositionIds[user]. The push this
    // guards was conditioned on `position.amount == 0`, which reads as "new position" but means
    // "empty position", and an emptied position is still in the array. A position drained to zero
    // (withdrawCollateral, or a payment draw) and then refunded was pushed a second time, after
    // which every consumer that walks the array counted the same storage twice and the credit limit
    // doubled against collateral that never doubled. Found while adding the matching withdrawal
    // path to RelicPay, which has the identical bug; fixed in both.
    mapping(address => mapping(bytes32 => bool)) private _positionListed;

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
    error ValueTooLarge();

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
        
        _listPosition(msg.sender, positionId);

        position.collateralType = CollateralType.ETH;
        position.tokenAddress = address(0);
        position.amount += msg.value;
        position.lastUpdateTime = uint40(block.timestamp);
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
        
        _listPosition(msg.sender, positionId);

        position.collateralType = CollateralType.ERC20;
        position.tokenAddress = tokenAddress;
        position.amount += amount;
        position.lastUpdateTime = uint40(block.timestamp);
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
        // these fields are packed into a single storage slot below; bound them so the
        // narrowing cast can never silently truncate
        if (installmentCount > type(uint32).max || dueIntervalSeconds > type(uint32).max || gracePeriodSeconds > type(uint32).max) {
            revert ValueTooLarge();
        }

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
            installmentAmount: installmentAmount,
            installmentCount: uint32(installmentCount),
            dueIntervalSeconds: uint32(dueIntervalSeconds),
            startTime: uint40(block.timestamp),
            paidInstallments: 0,
            gracePeriodSeconds: uint32(gracePeriodSeconds),
            state: BnplState.Active,
            paymentMethod: paymentMethod,
            collateralPositionId: keccak256(abi.encodePacked(buyer))
        });

        // Update credit line usage
        creditLine.usedCredit += totalPrice;
        creditLine.availableCredit -= totalPrice;
        creditLine.creditUtilization = _utilizationPercent(creditLine.usedCredit, creditLine.creditLimit);

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
        // strict sequence; prepayment before the due date is allowed in v2
        if (installmentNumber != agreement.paidInstallments + 1) revert InvalidAgreement();

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

        agreement.paidInstallments = uint32(installmentNumber);
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
    /**
     * @dev Record a positionId in the user's position list exactly once, ever.
     * See the _positionListed declaration for what the old `amount == 0` guard got wrong.
     */
    function _listPosition(address user, bytes32 positionId) internal {
        if (_positionListed[user][positionId]) return;
        _positionListed[user][positionId] = true;
        userCollateralPositionIds[user].push(positionId);
    }

    function _updateYield(address user, bytes32 positionId) internal {
        CollateralPosition storage position = collateralPositions[user][positionId];
        if (position.amount == 0) return;

        uint256 timeElapsed = block.timestamp - position.lastUpdateTime;
        if (timeElapsed < YIELD_UPDATE_INTERVAL) return;

        uint256 yieldRate = yieldRates[position.tokenAddress];
        uint256 yieldAmount = (position.amount * yieldRate * timeElapsed) / (365 days * 10000);
        
        position.yieldAccrued += yieldAmount;
        position.lastUpdateTime = uint40(block.timestamp);

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
        
        creditLine.creditUtilization = _utilizationPercent(creditLine.usedCredit, newCreditLimit);

        emit CreditLineUpdated(
            user,
            creditLine.creditLimit,
            creditLine.availableCredit,
            creditLine.usedCredit
        );
    }

    /**
     * @dev Credit utilization as a percent, clamped to MAX_CREDIT_UTILIZATION.
     * Returns 0 when there is no outstanding credit or no credit limit to measure against.
     */
    function _utilizationPercent(uint256 used, uint256 limit) internal pure returns (uint256) {
        if (used == 0 || limit == 0) return 0;
        uint256 pct = (used * 100) / limit;
        return pct > MAX_CREDIT_UTILIZATION ? MAX_CREDIT_UTILIZATION : pct;
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
        creditLines[user].usedCredit -= amount;
        _updateCreditLine(user); // recompute limit and availability from live collateral
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

        position.amount -= amount;
        _updateCreditLine(msg.sender);

        // remaining collateral must keep the used credit fully backed (V1-BUG-2 fix)
        require(
            creditLines[msg.sender].creditLimit >= creditLines[msg.sender].usedCredit,
            "Collateral backs open credit"
        );

        if (position.collateralType == CollateralType.ETH) {
            _send(msg.sender, amount);
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
        _send(msg.sender, balance);

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


    function _send(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    function getSellerBalance(address seller) external view returns (uint256) {
        return sellerBalances[seller];
    }

    function getSellerTokenBalance(address seller, address tokenAddress) external view returns (uint256) {
        return sellerTokenBalances[seller][tokenAddress];
    }
}
