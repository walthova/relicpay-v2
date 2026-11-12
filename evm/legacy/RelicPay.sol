// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

/**
 * @title RelicPay
 * @dev Complete DeFi-integrated BNPL system with RWA support, flexible payments, and governance
 * @notice This contract enables yield-bearing collateral, credit lines, RWA ownership, and auto-payments
 */
contract RelicPay is Ownable, ReentrancyGuard, ERC721Holder {
    using SafeERC20 for IERC20;

    enum BnplState {
        Active,
        Completed,
        Defaulted
    }

    enum CollateralType {
        ETH,
        ERC20,
        StakedETH,
        LiquidStakingToken
    }

    enum PaymentMethod {
        Manual,
        Auto,
        Collateral,
        AutoWithCollateral
    }

    enum PaymentStatus {
        Pending,
        Paid,
        Overdue,
        Defaulted
    }

    struct CollateralPosition {
        CollateralType collateralType;
        address tokenAddress;
        uint256 amount;
        uint256 yieldAccrued;
        uint256 lastUpdateTime;
        bool autoReinvest;
        uint256 stakingRewards; // For staked assets
    }

    struct CreditLine {
        uint256 collateralValue;
        uint256 creditLimit;
        uint256 availableCredit;
        uint256 usedCredit;
        uint256 creditUtilization;
        uint256 lastUpdateTime;
    }

    struct PaymentSchedule {
        uint256 installmentNumber;
        uint256 amount;
        uint256 dueDate;
        PaymentStatus status;
        uint256 paidAmount;
        uint256 paidAt;
    }

    struct RWAAsset {
        string physicalId;
        address nftContract;
        uint256 tokenId;
        string metadataURI;
        bool ownershipTransferred;
        address currentOwner;
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
        bytes32 collateralPositionId;
        RWAAsset rwaAsset;
        bool autoPaymentEnabled;
        uint256 lastPaymentTime;
    }

    struct GovernanceParams {
        uint256 creditLimitRatio; // Basis points (8000 = 80%)
        uint256 defaultGracePeriod; // Seconds
        uint256 minCollateralAmount; // Minimum collateral required
        uint256 maxAgreementDuration; // Maximum agreement duration
        bool autoPaymentEnabled; // Global auto-payment toggle
    }

    // State variables
    GovernanceParams public governanceParams;
    
    // Mappings
    mapping(bytes32 => BnplAgreement) public agreements;
    mapping(address => mapping(bytes32 => CollateralPosition)) public collateralPositions; // user => positionId => position
    mapping(address => bytes32[]) public userCollateralPositionIds; // user => array of position IDs
    mapping(address => CreditLine) public creditLines;
    mapping(bytes32 => PaymentSchedule[]) public paymentSchedules;
    mapping(bytes32 => uint256) public totalPaid;
    mapping(address => uint256) public yieldRates; // APY in basis points
    mapping(address => bool) public authorizedTokens;
    mapping(address => bool) public authorizedNFTs;
    mapping(address => uint256) public userNonces; // For replay protection
    
    // Auto-payment system
    mapping(address => bool) public autoPaymentEnabled;
    mapping(address => uint256) public autoPaymentBalance;
    
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
        PaymentMethod paymentMethod,
        RWAAsset rwaAsset
    );

    event PaymentScheduled(
        bytes32 indexed agreementId,
        uint256 installmentNumber,
        uint256 amount,
        uint256 dueDate
    );

    event PaymentProcessed(
        bytes32 indexed agreementId,
        uint256 installmentNumber,
        uint256 amount,
        PaymentMethod paymentMethod,
        bool autoProcessed
    );

    event OwnershipTransferred(
        bytes32 indexed agreementId,
        address indexed buyer,
        address indexed nftContract,
        uint256 tokenId
    );

    event AutoPaymentEnabled(
        address indexed user,
        bool enabled
    );

    event GovernanceUpdated(
        uint256 creditLimitRatio,
        uint256 defaultGracePeriod,
        uint256 minCollateralAmount
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
    error InsufficientAutoPaymentBalance();
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
    error PaymentAlreadyProcessed();
    error InvalidToken();
    error InvalidNFT();
    error OwnershipTransferFailed();

    constructor() Ownable(msg.sender) {
        // Initialize governance parameters
        governanceParams = GovernanceParams({
            creditLimitRatio: 8000, // 80%
            defaultGracePeriod: 7 days,
            minCollateralAmount: 1 ether,
            maxAgreementDuration: 365 days,
            autoPaymentEnabled: true
        });
        
        // Set default yield rates
        yieldRates[address(0)] = 500; // 5% APY for ETH
    }

    /**
     * @dev Deposit ETH as collateral with optional staking
     */
    function depositETHCollateral(bool stakeForYield) external payable nonReentrant {
        require(msg.value >= governanceParams.minCollateralAmount, "Insufficient collateral amount");
        
        bytes32 positionId = keccak256(abi.encodePacked(msg.sender, address(0), stakeForYield ? "staked" : "eth"));
        
        _updateYield(msg.sender, positionId);
        
        CollateralPosition storage position = collateralPositions[msg.sender][positionId];
        
        // If this is a new position, add it to the user's position list
        if (position.amount == 0) {
            userCollateralPositionIds[msg.sender].push(positionId);
        }
        
        position.collateralType = stakeForYield ? CollateralType.StakedETH : CollateralType.ETH;
        position.tokenAddress = address(0);
        position.amount += msg.value;
        position.lastUpdateTime = block.timestamp;
        position.autoReinvest = true;
        
        if (stakeForYield) {
            // In a real implementation, this would stake with Lido or similar
            position.stakingRewards += (msg.value * 5) / 1000; // Simulate staking rewards
        }
        
        _updateCreditLine(msg.sender);
        
        emit CollateralDeposited(
            msg.sender,
            position.collateralType,
            address(0),
            msg.value,
            creditLines[msg.sender].creditLimit
        );
    }

    /**
     * @dev Deposit ERC20 token as collateral
     */
    function depositERC20Collateral(address tokenAddress, uint256 amount) external nonReentrant {
        require(amount >= governanceParams.minCollateralAmount, "Insufficient collateral amount");
        require(authorizedTokens[tokenAddress], "Token not authorized");
        
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
     * @dev Create a new BNPL agreement with RWA support
     */
    function createAgreementWithRWA(
        address seller,
        address buyer,
        uint256 totalPrice,
        uint256 installmentCount,
        uint256 dueIntervalSeconds,
        uint256 gracePeriodSeconds,
        PaymentMethod paymentMethod,
        RWAAsset memory rwaAsset
    ) external onlyOwner returns (bytes32) {
        require(seller != address(0), "Invalid seller address");
        require(buyer != address(0), "Invalid buyer address");
        require(totalPrice > 0, "Total price must be greater than 0");
        require(installmentCount > 0, "Installment count must be greater than 0");
        require(dueIntervalSeconds > 0, "Due interval must be greater than 0");
        require(authorizedNFTs[rwaAsset.nftContract], "NFT contract not authorized");

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
                block.timestamp,
                userNonces[buyer]++
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
            collateralPositionId: keccak256(abi.encodePacked(buyer)),
            rwaAsset: rwaAsset,
            autoPaymentEnabled: autoPaymentEnabled[buyer],
            lastPaymentTime: 0
        });

        // Create payment schedule
        _createPaymentSchedule(agreementId, installmentCount, installmentAmount, dueIntervalSeconds);

        // Update credit line usage
        creditLine.usedCredit += totalPrice;
        creditLine.availableCredit -= totalPrice;
        creditLine.creditUtilization = (creditLine.usedCredit * 10000) / creditLine.creditLimit;

        emit AgreementCreated(
            agreementId,
            seller,
            buyer,
            totalPrice,
            installmentCount,
            paymentMethod,
            rwaAsset
        );

        return agreementId;
    }

    /**
     * @dev Process payment with automatic handling
     */
    function processPayment(bytes32 agreementId, uint256 installmentNumber) external payable nonReentrant {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Active) revert AgreementNotActive();
        if (installmentNumber == 0 || installmentNumber > agreement.installmentCount) revert InvalidAgreement();
        if (installmentNumber <= agreement.paidInstallments) revert PaymentAlreadyProcessed();

        PaymentSchedule storage schedule = paymentSchedules[agreementId][installmentNumber - 1];
        if (schedule.status == PaymentStatus.Paid) revert PaymentAlreadyProcessed();

        // Check if payment is due
        if (block.timestamp < schedule.dueDate) revert PaymentNotDue();

        uint256 paymentAmount = schedule.amount;
        bool autoProcessed = false;

        // Process payment based on method
        if (agreement.paymentMethod == PaymentMethod.Manual) {
            if (msg.value != paymentAmount) revert InsufficientPayment();
            // Credit seller with ETH payment
            sellerBalances[agreement.seller] += paymentAmount;
        } else if (agreement.paymentMethod == PaymentMethod.Collateral) {
            _withdrawFromCollateral(agreement.buyer, paymentAmount, agreement.seller);
        } else if (agreement.paymentMethod == PaymentMethod.Auto) {
            if (autoPaymentBalance[agreement.buyer] < paymentAmount) revert InsufficientAutoPaymentBalance();
            autoPaymentBalance[agreement.buyer] -= paymentAmount;
            // Credit seller with ETH payment
            sellerBalances[agreement.seller] += paymentAmount;
            autoProcessed = true;
        } else if (agreement.paymentMethod == PaymentMethod.AutoWithCollateral) {
            if (autoPaymentBalance[agreement.buyer] >= paymentAmount) {
                autoPaymentBalance[agreement.buyer] -= paymentAmount;
                // Credit seller with ETH payment
                sellerBalances[agreement.seller] += paymentAmount;
                autoProcessed = true;
            } else {
                _withdrawFromCollateral(agreement.buyer, paymentAmount, agreement.seller);
            }
        }

        // Update payment status
        schedule.status = PaymentStatus.Paid;
        schedule.paidAmount = paymentAmount;
        schedule.paidAt = block.timestamp;
        agreement.paidInstallments = installmentNumber;
        agreement.lastPaymentTime = block.timestamp;
        totalPaid[agreementId] += paymentAmount;

        emit PaymentProcessed(agreementId, installmentNumber, paymentAmount, agreement.paymentMethod, autoProcessed);

        // Check if all installments are paid
        if (installmentNumber == agreement.installmentCount) {
            agreement.state = BnplState.Completed;
            _transferRWAAsset(agreementId);
            _releaseCredit(agreement.buyer, agreement.totalPrice);
        }
    }

    /**
     * @dev Enable/disable auto-payment for user
     */
    function setAutoPayment(bool enabled) external {
        autoPaymentEnabled[msg.sender] = enabled;
        emit AutoPaymentEnabled(msg.sender, enabled);
    }

    /**
     * @dev Deposit funds for auto-payment
     */
    function depositAutoPaymentFunds() external payable {
        autoPaymentBalance[msg.sender] += msg.value;
    }

    /**
     * @dev Withdraw auto-payment funds
     */
    function withdrawAutoPaymentFunds(uint256 amount) external nonReentrant {
        require(autoPaymentBalance[msg.sender] >= amount, "Insufficient balance");
        autoPaymentBalance[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }

    /**
     * @dev Process overdue payments automatically
     */
    function processOverduePayments(bytes32 agreementId) external {
        BnplAgreement storage agreement = agreements[agreementId];
        require(agreement.state == BnplState.Active, "Agreement not active");

        for (uint256 i = agreement.paidInstallments; i < agreement.installmentCount; i++) {
            PaymentSchedule storage schedule = paymentSchedules[agreementId][i];
            
            if (schedule.status == PaymentStatus.Pending && 
                block.timestamp > schedule.dueDate + agreement.gracePeriodSeconds) {
                
                // Process payment from collateral
                _withdrawFromCollateral(agreement.buyer, schedule.amount, agreement.seller);
                
                schedule.status = PaymentStatus.Paid;
                schedule.paidAmount = schedule.amount;
                schedule.paidAt = block.timestamp;
                agreement.paidInstallments = i + 1;
                totalPaid[agreementId] += schedule.amount;
                
                emit PaymentProcessed(agreementId, i + 1, schedule.amount, agreement.paymentMethod, true);
            }
        }

        // Check if agreement is now complete
        if (agreement.paidInstallments == agreement.installmentCount) {
            agreement.state = BnplState.Completed;
            _transferRWAAsset(agreementId);
            _releaseCredit(agreement.buyer, agreement.totalPrice);
        }
    }

    /**
     * @dev Transfer RWA asset ownership
     */
    function _transferRWAAsset(bytes32 agreementId) internal {
        BnplAgreement storage agreement = agreements[agreementId];
        RWAAsset storage rwaAsset = agreement.rwaAsset;
        
        if (rwaAsset.nftContract != address(0) && !rwaAsset.ownershipTransferred) {
            try IERC721(rwaAsset.nftContract).transferFrom(
                rwaAsset.currentOwner,
                agreement.buyer,
                rwaAsset.tokenId
            ) {
                rwaAsset.ownershipTransferred = true;
                rwaAsset.currentOwner = agreement.buyer;
                
                emit OwnershipTransferred(
                    agreementId,
                    agreement.buyer,
                    rwaAsset.nftContract,
                    rwaAsset.tokenId
                );
            } catch {
                revert OwnershipTransferFailed();
            }
        }
    }

    /**
     * @dev Create payment schedule for agreement
     */
    function _createPaymentSchedule(
        bytes32 agreementId,
        uint256 installmentCount,
        uint256 installmentAmount,
        uint256 dueIntervalSeconds
    ) internal {
        BnplAgreement storage agreement = agreements[agreementId];
        uint256 startTime = agreement.startTime;
        
        for (uint256 i = 0; i < installmentCount; i++) {
            uint256 dueDate = startTime + ((i + 1) * dueIntervalSeconds);
            paymentSchedules[agreementId].push(PaymentSchedule({
                installmentNumber: i + 1,
                amount: installmentAmount,
                dueDate: dueDate,
                status: PaymentStatus.Pending,
                paidAmount: 0,
                paidAt: 0
            }));
            
            emit PaymentScheduled(
                agreementId,
                i + 1,
                installmentAmount,
                dueDate
            );
        }
    }

    /**
     * @dev Update yield for collateral position
     */
    function _updateYield(address user, bytes32 positionId) internal {
        CollateralPosition storage position = collateralPositions[user][positionId];
        if (position.amount == 0) return;

        uint256 timeElapsed = block.timestamp - position.lastUpdateTime;
        if (timeElapsed < 1 days) return;

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
        uint256 newCreditLimit = (totalCollateralValue * governanceParams.creditLimitRatio) / 10000;
        
        creditLine.collateralValue = totalCollateralValue;
        creditLine.creditLimit = newCreditLimit;
        creditLine.lastUpdateTime = block.timestamp;
        
        if (newCreditLimit >= creditLine.usedCredit) {
            creditLine.availableCredit = newCreditLimit - creditLine.usedCredit;
        } else {
            creditLine.availableCredit = 0;
        }
        
        creditLine.creditUtilization = creditLine.usedCredit > 0 && newCreditLimit > 0 ? 
            (creditLine.usedCredit * 10000) / newCreditLimit : 0;

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
        return position.amount + position.stakingRewards;
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
        creditLine.creditUtilization = creditLine.usedCredit > 0 ? 
            (creditLine.usedCredit * 10000) / creditLine.creditLimit : 0;
    }

    // Governance functions
    function updateGovernanceParams(
        uint256 _creditLimitRatio,
        uint256 _defaultGracePeriod,
        uint256 _minCollateralAmount
    ) external onlyOwner {
        governanceParams.creditLimitRatio = _creditLimitRatio;
        governanceParams.defaultGracePeriod = _defaultGracePeriod;
        governanceParams.minCollateralAmount = _minCollateralAmount;
        
        emit GovernanceUpdated(_creditLimitRatio, _defaultGracePeriod, _minCollateralAmount);
    }

    function setYieldRate(address tokenAddress, uint256 rateBasisPoints) external onlyOwner {
        yieldRates[tokenAddress] = rateBasisPoints;
    }

    function authorizeToken(address tokenAddress, bool authorized) external onlyOwner {
        authorizedTokens[tokenAddress] = authorized;
    }

    function authorizeNFT(address nftAddress, bool authorized) external onlyOwner {
        authorizedNFTs[nftAddress] = authorized;
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

    // View functions
    function getCollateralPosition(address user, bytes32 positionId) external view returns (CollateralPosition memory) {
        return collateralPositions[user][positionId];
    }

    function getUserCollateralPositionIds(address user) external view returns (bytes32[] memory) {
        return userCollateralPositionIds[user];
    }

    function getTotalCollateralValue(address user) external view returns (uint256) {
        return _getTotalCollateralValue(user);
    }

    function getCreditLine(address user) external view returns (CreditLine memory) {
        return creditLines[user];
    }

    function getAgreement(bytes32 agreementId) external view returns (BnplAgreement memory) {
        if (agreements[agreementId].seller == address(0)) revert AgreementNotFound();
        return agreements[agreementId];
    }

    function getPaymentSchedule(bytes32 agreementId) external view returns (PaymentSchedule[] memory) {
        return paymentSchedules[agreementId];
    }

    function getGovernanceParams() external view returns (GovernanceParams memory) {
        return governanceParams;
    }

    function getSellerBalance(address seller) external view returns (uint256) {
        return sellerBalances[seller];
    }

    function getSellerTokenBalance(address seller, address tokenAddress) external view returns (uint256) {
        return sellerTokenBalances[seller][tokenAddress];
    }
}
