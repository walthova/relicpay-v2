// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "./Governable.sol";

/**
 * @title RelicPay
 * @dev Complete DeFi-integrated BNPL system with RWA support, flexible payments, and governance
 * @notice This contract enables yield-bearing collateral, credit lines, RWA ownership, and auto-payments
 */
/// @dev The two PriceOracle calls RelicPay needs. getUSDValue is USD scaled 1e8 and already divides
/// by the asset's decimals; getPrice(address(0)) is the ETH price in the same scale.
interface IRelicPayPriceOracle {
    function getPrice(address asset) external view returns (uint256);
    function getUSDValue(address asset, uint256 amount) external view returns (uint256);
}

contract RelicPay is Ownable, ReentrancyGuard, ERC721Holder, Governable {
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

    // Field order chosen for storage packing: collateralType + tokenAddress + autoReinvest +
    // lastUpdateTime (27 bytes) share a single slot instead of four, cutting collateral writes
    // roughly in half. amount, yieldAccrued and stakingRewards stay full uint256 since they are
    // wei amounts with no safe bound to truncate to.
    struct CollateralPosition {
        CollateralType collateralType;
        address tokenAddress;
        bool autoReinvest;
        uint40 lastUpdateTime;
        uint256 amount;
        uint256 yieldAccrued;
        uint256 stakingRewards; // For staked assets
    }

    // Field order chosen for storage packing: creditUtilization (uint16, hard capped at
    // MAX_CREDIT_UTILIZATION = 10000 bps) and lastUpdateTime (uint40) share one slot instead of
    // two, taking the struct from 6 slots to 5. collateralValue, creditLimit, availableCredit and
    // usedCredit stay full uint256 since they are wei amounts with no safe bound to truncate to.
    struct CreditLine {
        uint256 collateralValue;
        uint256 creditLimit;
        uint256 availableCredit;
        uint256 usedCredit;
        uint16 creditUtilization;
        uint40 lastUpdateTime;
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

    // Field order chosen for storage packing: installmentCount, dueIntervalSeconds, startTime,
    // paidInstallments, gracePeriodSeconds, state, paymentMethod, autoPaymentEnabled, and
    // lastPaymentTime (29 bytes) fit in a single slot instead of nine, cutting
    // createAgreementWithRWA's storage writes accordingly. totalPrice and installmentAmount stay
    // full uint256 since they are wei amounts; rwaAsset is unpacked (nested struct always starts
    // its own slot regardless of position).
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
        bool autoPaymentEnabled;
        uint40 lastPaymentTime;
        bytes32 collateralPositionId;
        RWAAsset rwaAsset;
    }

    struct GovernanceParams {
        uint256 creditLimitRatio; // Basis points (8000 = 80%)
        uint256 defaultGracePeriod; // Seconds
        uint256 minCollateralAmount; // Minimum collateral required
        uint256 maxAgreementDuration; // Maximum agreement duration
        bool autoPaymentEnabled; // Global auto-payment toggle
    }

    // Hard cap on CreditLine.creditUtilization, in basis points. Utilization is usedCredit
    // relative to creditLimit, so it exceeds 100% whenever collateral value falls while credit is
    // outstanding. It is a reporting field, not a settlement input, so it clamps here rather than
    // reverting: a read of 10000 means "at or over the limit", and callers that need the exact
    // over-limit ratio should compute it from usedCredit and creditLimit, which stay uint256.
    uint256 public constant MAX_CREDIT_UTILIZATION = 10000; // 10000 bps = 100%

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

    // Token-denominated auto-payment pool, one balance per buyer per token. Kept separate from
    // autoPaymentBalance rather than folding ETH in under address(0): the ETH pool is funded by
    // msg.value and paid out with a raw call, the token pool by transferFrom and safeTransfer, and
    // merging them would put a branch on every read of the pre-existing ETH pool for no gain.
    mapping(address => mapping(address => uint256)) public autoPaymentTokenBalance;

    // Settlement system
    mapping(address => uint256) public sellerBalances; // ETH balances for sellers
    mapping(address => mapping(address => uint256)) public sellerTokenBalances; // ERC20 balances for sellers

    // Default accounting: per agreement, how much buyer collateral the seller claimed on default,
    // and when the default was recorded. Both stay zero for agreements that never defaulted.
    mapping(bytes32 => uint256) public collateralSeized;
    mapping(bytes32 => uint256) public defaultedAt;

    // Stablecoin settlement. Deliberately a separate registry from `authorizedTokens`: that one
    // gates what the protocol is willing to hold as collateral and value into a credit line, this
    // one gates what a seller may be paid in. A volatile token can be reasonable collateral and a
    // terrible settlement currency, and a stablecoin the protocol will settle in is not
    // automatically something it wants to lend against.
    mapping(address => bool) public settlementTokens;

    // Seller's chosen settlement currency. address(0), the default, means ETH and preserves the
    // pre-existing behaviour for every seller who never opts in.
    mapping(address => address) public sellerSettlementToken;

    // Settlement currency snapshotted onto the agreement at creation. Held in its own mapping
    // rather than as a BnplAgreement field so the agreements()/getAgreement() tuple keeps its
    // shape; it also cannot pack into the existing 29-byte slot, so the storage cost is identical
    // either way. Snapshotting is the point: a seller must not be able to change what the buyer
    // owes mid-agreement by flipping their preference.
    mapping(bytes32 => address) public agreementSettlementToken;

    // Real, still-held deposit principal per collateral position, in the position's own asset.
    // Kept in its own mapping rather than as a CollateralPosition field so the
    // collateralPositions()/getCollateralPosition() tuple keeps its shape, the same reason
    // agreementSettlementToken lives outside BnplAgreement.
    //
    // Why it has to exist at all, and why withdrawCollateral is what forced it: position.amount is
    // NOT principal. _updateYield credits simulated yield and, with autoReinvest on (the default on
    // every deposit), folds it straight into position.amount, so amount drifts above what anyone
    // actually paid in at roughly the yield rate. Nothing in this contract stakes anything or earns
    // a real return, so that drift is backed by nothing. Before this item the drift could only
    // reach a seller through a settlement draw or a seizure; a direct withdrawal path would let a
    // buyer take it out as ETH from a pool that is other users' deposits. principal is therefore
    // the withdrawal bound: incremented only by a real deposit, decremented by every outflow, never
    // by yield. Invariant: collateralPrincipal <= position.amount, always.
    //
    // Settlement draws and seizures are bounded by this too as of ADR-010 (FINDING-1): yield above
    // principal is never paid to a seller, because nothing backs it.
    mapping(address => mapping(bytes32 => uint256)) public collateralPrincipal;

    // Whether a positionId is already present in userCollateralPositionIds[user].
    //
    // The push it guards used to be conditioned on `position.amount == 0`, which reads as "new
    // position" but actually means "empty position", and an emptied position is still in the array.
    // So a position drained to zero and then refunded was pushed a second time, and every consumer
    // that walks the array (_getTotalCollateralValue, _settlementCollateral, _seizeCollateral)
    // counted the same storage twice. Doubled collateral value means a doubled credit limit against
    // collateral that was never doubled. Reachable today through a full settlement draw or seizure
    // followed by a redeposit; withdrawCollateral would have made it a two-transaction exploit, so
    // it is fixed here rather than left for the item that trips over it.
    mapping(address => mapping(bytes32 => bool)) private _positionListed;

    // ADR-009: optional oracle used to express every collateral position in ETH wei. Zero keeps
    // the legacy raw-amount behaviour, so a bare deploy and every pre-existing test are unchanged
    // until the owner or governor wires one in.
    IRelicPayPriceOracle public priceOracle;
    event PriceOracleUpdated(address indexed previousOracle, address indexed newOracle);

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

    event MaxAgreementDurationUpdated(uint256 oldValue, uint256 newValue);

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

    event AgreementDefaulted(
        bytes32 indexed agreementId,
        address indexed seller,
        address indexed buyer,
        uint256 missedInstallment,
        uint256 outstanding,
        uint256 collateralSeized
    );

    event CollateralSeized(
        address indexed buyer,
        address indexed seller,
        address tokenAddress,
        uint256 amount
    );

    event SettlementTokenAuthorized(
        address indexed token,
        bool authorized
    );

    event SettlementPreferenceUpdated(
        address indexed seller,
        address token
    );

    event SettlementCredited(
        bytes32 indexed agreementId,
        address indexed seller,
        address indexed token,
        uint256 amount
    );

    event AutoPaymentTokensDeposited(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 newBalance
    );

    event AutoPaymentTokensWithdrawn(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 newBalance
    );

    event CollateralWithdrawn(
        address indexed user,
        bytes32 indexed positionId,
        address tokenAddress,
        uint256 amount,
        uint256 creditLimit
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
    error ValueTooLarge();
    error InvalidSettlementToken();
    // Retained in the ABI although nothing reverts with it any more: part b landed the three
    // payment methods that part a rejected. Kept so a consumer built against the part a ABI still
    // decodes; remove only on a deliberate ABI break.
    error UnsupportedSettlementMethod();
    error UnexpectedETHPayment();
    error InsufficientSettlementCollateral();
    // Withdrawal would leave the buyer's outstanding credit unbacked. This is the V1-BUG-2 fix:
    // EnhancedBnpl v1 let collateral backing an open agreement walk out of the contract.
    error CollateralBacksOpenCredit();
    // Asked for more than the position's real, still-held deposit principal. Distinct from
    // InsufficientCollateral, which is about a position's reported amount: this one fires when the
    // amount is there but is partly simulated yield, which is not withdrawable.
    error ExceedsWithdrawablePrincipal();
    // Schedule length (installmentCount * dueIntervalSeconds) is past governanceParams.maxAgreementDuration.
    error AgreementTooLong();
    error InvalidMaxAgreementDuration();

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

        _listPosition(msg.sender, positionId);

        position.collateralType = stakeForYield ? CollateralType.StakedETH : CollateralType.ETH;
        position.tokenAddress = address(0);
        position.amount += msg.value;
        collateralPrincipal[msg.sender][positionId] += msg.value;
        position.lastUpdateTime = uint40(block.timestamp);
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
        require(authorizedTokens[tokenAddress], "Token not authorized");
        // Enforced on the ETH-wei value (ADR-009), so "minimum" means the same thing for every asset.
        require(_toWei(tokenAddress, amount) >= governanceParams.minCollateralAmount, "Insufficient collateral amount");
        
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        
        bytes32 positionId = keccak256(abi.encodePacked(msg.sender, tokenAddress, "erc20"));
        
        _updateYield(msg.sender, positionId);
        
        CollateralPosition storage position = collateralPositions[msg.sender][positionId];

        _listPosition(msg.sender, positionId);

        position.collateralType = CollateralType.ERC20;
        position.tokenAddress = tokenAddress;
        position.amount += amount;
        collateralPrincipal[msg.sender][positionId] += amount;
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
        // these fields are packed into a single storage slot below; bound them so the
        // narrowing cast can never silently truncate
        if (installmentCount > type(uint32).max || dueIntervalSeconds > type(uint32).max || gracePeriodSeconds > type(uint32).max) {
            revert ValueTooLarge();
        }

        _checkDuration(installmentCount, dueIntervalSeconds);

        uint256 installmentAmount = totalPrice / installmentCount;
        require(installmentAmount > 0, "Installment amount must be greater than 0");

        // Check if buyer has sufficient credit
        _updateAllYields(buyer);
        _updateCreditLine(buyer);
        
        if (creditLines[buyer].availableCredit < totalPrice) revert InsufficientCredit();

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
            installmentAmount: installmentAmount,
            installmentCount: uint32(installmentCount),
            dueIntervalSeconds: uint32(dueIntervalSeconds),
            startTime: uint40(block.timestamp),
            paidInstallments: 0,
            gracePeriodSeconds: uint32(gracePeriodSeconds),
            state: BnplState.Active,
            paymentMethod: paymentMethod,
            autoPaymentEnabled: autoPaymentEnabled[buyer],
            lastPaymentTime: 0,
            collateralPositionId: keccak256(abi.encodePacked(buyer)),
            rwaAsset: rwaAsset
        });

        // Snapshot the seller's settlement currency onto the agreement before anything else can
        // move, so the buyer's obligation is fixed at creation.
        _snapshotSettlement(agreementId, seller, paymentMethod);

        // Create payment schedule
        _createPaymentSchedule(agreementId, installmentCount, installmentAmount, dueIntervalSeconds);

        // Update credit line usage
        _consumeCredit(buyer, totalPrice);

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
        // strict sequence; prepayment before the due date is allowed in v2
        if (installmentNumber != agreement.paidInstallments + 1) revert InvalidAgreement();

        PaymentSchedule storage schedule = paymentSchedules[agreementId][installmentNumber - 1];
        if (schedule.status == PaymentStatus.Paid) revert PaymentAlreadyProcessed();

        uint256 paymentAmount = schedule.amount;

        // Process payment based on method. Dispatch lives in its own frame: this function is
        // already close to the viaIR stack limit (see _consumeCredit) and the settlement-currency
        // branches each need a token address live alongside buyer and seller.
        bool autoProcessed = _settlePayment(agreementId, paymentAmount);

        // Update payment status
        schedule.status = PaymentStatus.Paid;
        schedule.paidAmount = paymentAmount;
        schedule.paidAt = block.timestamp;
        agreement.paidInstallments = uint32(installmentNumber);
        agreement.lastPaymentTime = uint40(block.timestamp);
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
        _send(msg.sender, amount);
    }

    /**
     * @dev Process overdue payments automatically
     */
    function processOverduePayments(bytes32 agreementId) external {
        BnplAgreement storage agreement = agreements[agreementId];
        require(agreement.state == BnplState.Active, "Agreement not active");

        address settlementToken = agreementSettlementToken[agreementId];

        for (uint256 i = agreement.paidInstallments; i < agreement.installmentCount; i++) {
            PaymentSchedule storage schedule = paymentSchedules[agreementId][i];

            if (schedule.status == PaymentStatus.Pending &&
                block.timestamp > schedule.dueDate + agreement.gracePeriodSeconds) {

                // Process payment from collateral, in the agreement's settlement currency. The
                // keeper sweep is a collateral draw whatever the agreement's payment method, so it
                // gets the same settlement-asset treatment as the Collateral method itself.
                _drawForSettlement(
                    agreementId,
                    agreement.buyer,
                    schedule.amount,
                    agreement.seller,
                    settlementToken
                );

                schedule.status = PaymentStatus.Paid;
                schedule.paidAmount = schedule.amount;
                schedule.paidAt = block.timestamp;
                agreement.paidInstallments = uint32(i + 1);
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
     * @dev Seller-triggered default, once the grace period on the next unpaid installment has
     * expired. Closes V1-QUIRK-3: in v1 a RelicPay agreement could never leave the Active state,
     * so a buyer who simply stopped paying left the seller's credit reserved and the relic in
     * limbo forever with no on-chain record of the failure.
     *
     * Settlement on default:
     *  - every still-unpaid installment is marked PaymentStatus.Defaulted
     *  - the buyer's remaining collateral is seized up to the outstanding balance and credited to
     *    the seller's pull-payment balance (V1-BUG-5: no push transfer here either)
     *  - the buyer's reserved credit is released so the line is not locked by a dead agreement
     *  - the RWA asset is NOT transferred; the relic stays with its current owner, which is the
     *    seller for every agreement created through createAgreementWithRWA
     *
     * Installments already paid stay with the seller: RelicPay credits sellerBalances at payment
     * time, so unlike legacy Bnpl there is nothing held in escrow to sweep here.
     */
    function triggerDefault(bytes32 agreementId) external nonReentrant {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state == BnplState.Completed) revert AgreementAlreadyCompleted();
        if (agreement.state == BnplState.Defaulted) revert AgreementAlreadyDefaulted();
        if (agreement.state != BnplState.Active) revert AgreementNotActive();
        if (msg.sender != agreement.seller) revert UnauthorizedCaller();

        uint256 nextInstallment = agreement.paidInstallments + 1;
        if (nextInstallment > agreement.installmentCount) revert AgreementAlreadyCompleted();

        // Grace runs from the schedule's own due date rather than a recomputed one, so a default
        // can never be triggered against a different date than the one the buyer was shown.
        uint256 graceExpiry =
            paymentSchedules[agreementId][nextInstallment - 1].dueDate + agreement.gracePeriodSeconds;
        if (block.timestamp < graceExpiry) revert GracePeriodNotExpired();

        agreement.state = BnplState.Defaulted;
        defaultedAt[agreementId] = block.timestamp;

        _markRemainingDefaulted(agreementId, agreement.paidInstallments, agreement.installmentCount);

        // Settle accrued yield into the positions before measuring them, so the seizure sees the
        // buyer's true balance rather than a stale one. Yield earned on posted collateral is part
        // of that collateral and is fair game for the seller's claim.
        _updateAllYields(agreement.buyer);

        uint256 outstanding = agreement.totalPrice - totalPaid[agreementId];
        uint256 seized = _seizeCollateral(
            agreement.buyer,
            outstanding,
            agreement.seller,
            agreementSettlementToken[agreementId]
        );
        collateralSeized[agreementId] = seized;

        // Release the full reservation, not just the seized part. usedCredit was incremented by
        // totalPrice at creation and this is the agreement's terminal state, so anything left
        // reserved would be permanently stranded.
        _releaseCredit(agreement.buyer, agreement.totalPrice);

        emit AgreementDefaulted(
            agreementId,
            agreement.seller,
            agreement.buyer,
            nextInstallment,
            outstanding,
            seized
        );
    }

    /**
     * @dev Mark every unpaid installment on a defaulted agreement. Split out of triggerDefault to
     * keep that function's frame small enough for the viaIR stack limit.
     */
    function _markRemainingDefaulted(bytes32 agreementId, uint256 from, uint256 to) internal {
        for (uint256 i = from; i < to; i++) {
            PaymentSchedule storage schedule = paymentSchedules[agreementId][i];
            if (schedule.status != PaymentStatus.Paid) {
                schedule.status = PaymentStatus.Defaulted;
            }
        }
    }

    /**
     * @dev Drain up to maxAmount of a buyer's collateral to the seller's pull-payment balance and
     * return what was actually taken. Unlike _withdrawFromCollateral this does not require the
     * full amount to be available: a defaulting buyer is under-collateralised by definition, and
     * reverting there would mean the seller could never close the agreement at all. The seller
     * eats any shortfall, which is the same economic outcome as legacy Bnpl claiming a collateral
     * deposit that no longer covers the balance.
     *
     * Settlement-asset-first, with a fallback. On a token-settled agreement the first pass takes
     * only collateral denominated in the settlement token, so the seller is made whole in the
     * currency they chose as far as the buyer's collateral allows, and the second pass mops up
     * whatever else is there. The fallback is right here and wrong on the scheduled-payment path
     * (see _drawForSettlement): a live agreement can wait for the buyer to post the right asset,
     * a defaulted one cannot, and a mixed-asset recovery beats no recovery.
     *
     * For an ETH-settled agreement the first pass is skipped entirely, so the loop is exactly the
     * single unordered pass it was before part b.
     */
    function _seizeCollateral(address user, uint256 maxAmount, address seller, address settlementToken)
        internal
        returns (uint256 seizedTotal)
    {
        if (maxAmount == 0) return 0;

        bytes32[] memory positionIds = userCollateralPositionIds[user];
        uint256 remaining = maxAmount;

        for (uint256 pass = settlementToken == address(0) ? 1 : 0; pass < 2 && remaining > 0; pass++) {
            for (uint256 i = 0; i < positionIds.length && remaining > 0; i++) {
                CollateralPosition storage position = collateralPositions[user][positionIds[i]];

                bool isSettlementAsset =
                    position.collateralType == CollateralType.ERC20 &&
                    position.tokenAddress == settlementToken;
                // pass 0 takes only the settlement asset, pass 1 only what pass 0 left behind
                if (pass == 0 ? !isSettlementAsset : isSettlementAsset) continue;

                // ADR-010: only recorded principal is real. Yield above it is backed by nothing.
                uint256 drawable = collateralPrincipal[user][positionIds[i]];
                if (drawable == 0) continue;

                // `remaining` is in the settlement currency; the position may hold something else
                // (ADR-009). Same asset or no oracle: both conversions are the identity.
                address asset = _positionAsset(position);
                uint256 available = _convertUnits(asset, settlementToken, drawable);
                uint256 takeSettle = remaining > available ? available : remaining;
                uint256 take = takeSettle == available
                    ? drawable
                    : _convertUnits(settlementToken, asset, takeSettle);
                if (take == 0) continue;
                position.amount -= take;
                _reducePrincipal(user, positionIds[i], take);
                remaining -= takeSettle;
                seizedTotal += takeSettle;

                if (position.collateralType == CollateralType.ERC20) {
                    sellerTokenBalances[seller][position.tokenAddress] += take;
                } else {
                    sellerBalances[seller] += take;
                }

                emit CollateralSeized(user, seller, position.tokenAddress, take);
            }
        }

        if (seizedTotal > 0) {
            emit SellerBalanceUpdated(seller, sellerBalances[seller], sellerBalances[seller]);
        }
    }

    /**
     * @dev Owner-gated registry of currencies the protocol will settle sellers in. Separate from
     * authorizeToken, which governs collateral. De-authorizing a token does not disturb agreements
     * already snapshotted against it: those keep settling and the seller keeps their withdrawable
     * balance. It only stops new agreements being opened against that currency.
     */
    function authorizeSettlementToken(address tokenAddress, bool authorized) external onlyOwner {
        if (tokenAddress == address(0)) revert InvalidSettlementToken();
        settlementTokens[tokenAddress] = authorized;
        emit SettlementTokenAuthorized(tokenAddress, authorized);
    }

    /**
     * @dev Seller opts into being paid in a stablecoin instead of ETH. Pass address(0) to go back
     * to ETH. Applies to agreements created after this call; existing agreements keep the currency
     * they were opened with.
     */
    function setSettlementPreference(address tokenAddress) external {
        if (tokenAddress != address(0) && !settlementTokens[tokenAddress]) revert InvalidSettlementToken();
        sellerSettlementToken[msg.sender] = tokenAddress;
        emit SettlementPreferenceUpdated(msg.sender, tokenAddress);
    }

    /**
     * @dev Fix the agreement's settlement currency at creation from the seller's current
     * preference. Split into its own frame because createAgreementWithRWA is already at the viaIR
     * stack limit (see _consumeCredit for the same reason).
     *
     * All four payment methods are supported as of part b. Part a accepted Manual only, because
     * the other three draw on an ETH-denominated pool or on collateral positions whose asset the
     * seller does not choose, and a silent mis-credit in the wrong asset was worse than a refusal.
     * Part b gave each of them a settlement-currency path: a token-denominated auto-payment pool,
     * and a settlement-asset draw on collateral. The paymentMethod argument is retained because
     * this is where any future per-method settlement rule belongs.
     */
    function _snapshotSettlement(bytes32 agreementId, address seller, PaymentMethod) internal {
        address token = sellerSettlementToken[seller];
        if (token == address(0)) return;
        if (!settlementTokens[token]) revert InvalidSettlementToken();
        agreementSettlementToken[agreementId] = token;
    }

    /**
     * @dev Credit a Manual installment to the seller in the agreement's settlement currency.
     * ETH-settled agreements behave exactly as before. Token-settled agreements pull from
     * msg.sender rather than agreement.buyer, preserving the existing property that a third party
     * may pay on the buyer's behalf, and reject any attached ETH instead of trapping it in the
     * contract.
     *
     * SettlementCredited is emitted on the token path only. The ETH path is deliberately left at
     * exactly the writes and logs it had before this feature, minus nothing and plus nothing but
     * the one settlement-currency lookup, so opting into stablecoins costs the sellers who did not
     * opt in as close to nothing as the lookup allows. PaymentProcessed already covers the ETH
     * case, and the currency of any agreement is readable from getSettlementToken regardless.
     */
    function _settleManual(bytes32 agreementId, address seller, uint256 amount) internal {
        address token = agreementSettlementToken[agreementId];

        if (token == address(0)) {
            if (msg.value != amount) revert InsufficientPayment();
            sellerBalances[seller] += amount;
        } else {
            if (msg.value != 0) revert UnexpectedETHPayment();
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            sellerTokenBalances[seller][token] += amount;
            emit SettlementCredited(agreementId, seller, token, amount);
        }
    }

    /**
     * @dev Route one installment to the seller in the agreement's settlement currency, whatever
     * the payment method. Returns whether the installment was covered by the auto-payment pool.
     *
     * ETH-settled agreements (agreementSettlementToken == address(0), which is every agreement
     * whose seller never opted in) take exactly the code paths they took before stablecoin
     * settlement existed: the ETH auto pool, and the unordered all-positions collateral draw.
     */
    function _settlePayment(bytes32 agreementId, uint256 amount) internal returns (bool autoProcessed) {
        BnplAgreement storage agreement = agreements[agreementId];
        PaymentMethod method = agreement.paymentMethod;
        address seller = agreement.seller;
        address buyer = agreement.buyer;
        address token = agreementSettlementToken[agreementId];

        if (method == PaymentMethod.Manual) {
            _settleManual(agreementId, seller, amount);
        } else if (method == PaymentMethod.Collateral) {
            _drawForSettlement(agreementId, buyer, amount, seller, token);
        } else if (method == PaymentMethod.Auto) {
            if (_autoBalanceOf(buyer, token) < amount) revert InsufficientAutoPaymentBalance();
            _debitAutoBalance(agreementId, buyer, seller, amount, token);
            autoProcessed = true;
        } else {
            // AutoWithCollateral: pool first, collateral as the fallback.
            if (_autoBalanceOf(buyer, token) >= amount) {
                _debitAutoBalance(agreementId, buyer, seller, amount, token);
                autoProcessed = true;
            } else {
                _drawForSettlement(agreementId, buyer, amount, seller, token);
            }
        }
    }

    /**
     * @dev The buyer's auto-payment pool in the given settlement currency.
     */
    function _autoBalanceOf(address buyer, address token) internal view returns (uint256) {
        return token == address(0) ? autoPaymentBalance[buyer] : autoPaymentTokenBalance[buyer][token];
    }

    /**
     * @dev Move an installment from the buyer's auto-payment pool to the seller's pull-payment
     * balance, in the settlement currency. Callers check the balance first, so a short pool is an
     * InsufficientAutoPaymentBalance from the caller rather than an arithmetic underflow here.
     */
    function _debitAutoBalance(
        bytes32 agreementId,
        address buyer,
        address seller,
        uint256 amount,
        address token
    ) internal {
        if (token == address(0)) {
            autoPaymentBalance[buyer] -= amount;
            sellerBalances[seller] += amount;
        } else {
            autoPaymentTokenBalance[buyer][token] -= amount;
            sellerTokenBalances[seller][token] += amount;
            emit SettlementCredited(agreementId, seller, token, amount);
        }
    }

    /**
     * @dev Take one installment out of the buyer's collateral and credit the seller.
     *
     * ETH-settled agreements keep the pre-existing behaviour exactly: draw from every position in
     * order and credit the seller in whatever asset each position happens to hold.
     *
     * Token-settled agreements draw ONLY from collateral denominated in the settlement token, and
     * revert with InsufficientSettlementCollateral if that is not enough. This is deliberately
     * strict rather than "settlement asset first, then anything": falling through to the buyer's
     * ETH collateral would credit the seller in exactly the asset they opted out of, which is the
     * failure this whole feature exists to prevent. A seller left unpaid is not stuck, they have
     * triggerDefault, and that path IS settlement-asset-first with a fallback because a defaulted
     * agreement is already terminal and taking a mixed bag beats taking nothing.
     *
     * The consequence worth knowing: a token-settled Collateral or AutoWithCollateral agreement
     * needs the buyer to hold that token as collateral. getSettlementReadiness reports whether it
     * does, before the call rather than after the revert.
     */
    function _drawForSettlement(
        bytes32 agreementId,
        address buyer,
        uint256 amount,
        address seller,
        address token
    ) internal {
        if (token == address(0)) {
            _withdrawFromCollateral(buyer, amount, seller);
            return;
        }

        uint256 drawn = _drawCollateralInToken(buyer, amount, seller, token);
        if (drawn < amount) revert InsufficientSettlementCollateral();

        _updateCreditLine(buyer);
        emit SettlementCredited(agreementId, seller, token, amount);
    }

    /**
     * @dev Drain up to maxAmount from the buyer's ERC20 collateral positions denominated in
     * `token`, crediting the seller's token balance, and return what was actually taken. Does not
     * recompute the credit line; callers do that once after they are done drawing.
     */
    function _drawCollateralInToken(address user, uint256 maxAmount, address seller, address token)
        internal
        returns (uint256 drawn)
    {
        bytes32[] memory positionIds = userCollateralPositionIds[user];
        uint256 remaining = maxAmount;

        for (uint256 i = 0; i < positionIds.length && remaining > 0; i++) {
            CollateralPosition storage position = collateralPositions[user][positionIds[i]];
            if (position.collateralType != CollateralType.ERC20) continue;
            if (position.tokenAddress != token) continue;

            // ADR-010: draw against recorded principal only, never simulated yield.
            uint256 available = collateralPrincipal[user][positionIds[i]];
            if (available == 0) continue;

            uint256 take = remaining > available ? available : remaining;
            position.amount = available - take;
            _reducePrincipal(user, positionIds[i], take);
            remaining -= take;
            drawn += take;

            sellerTokenBalances[seller][token] += take;
        }
    }

    /**
     * @dev Fund the token-denominated auto-payment pool. Not gated on the settlementTokens
     * registry: these are the buyer's own funds, always withdrawable, and only ever payable to the
     * seller named by an agreement the buyer already entered. Gating deposits would let an owner
     * de-authorization strand a buyer who needs to top up mid-agreement, which is the same trap
     * part a avoided on the settlement side.
     */
    function depositAutoPaymentTokens(address tokenAddress, uint256 amount) external nonReentrant {
        if (tokenAddress == address(0)) revert InvalidSettlementToken();
        require(amount > 0, "Amount must be greater than 0");

        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        uint256 newBalance = autoPaymentTokenBalance[msg.sender][tokenAddress] + amount;
        autoPaymentTokenBalance[msg.sender][tokenAddress] = newBalance;

        emit AutoPaymentTokensDeposited(msg.sender, tokenAddress, amount, newBalance);
    }

    /**
     * @dev Withdraw from the token-denominated auto-payment pool. Always available, mirroring
     * withdrawAutoPaymentFunds on the ETH pool.
     */
    function withdrawAutoPaymentTokens(address tokenAddress, uint256 amount) external nonReentrant {
        uint256 balance = autoPaymentTokenBalance[msg.sender][tokenAddress];
        require(balance >= amount, "Insufficient balance");

        uint256 newBalance = balance - amount;
        autoPaymentTokenBalance[msg.sender][tokenAddress] = newBalance;
        IERC20(tokenAddress).safeTransfer(msg.sender, amount);

        emit AutoPaymentTokensWithdrawn(msg.sender, tokenAddress, amount, newBalance);
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
            uint256 amount_ = installmentAmount;
            if (i == installmentCount - 1) {
                // final installment absorbs the integer-division remainder
                amount_ = agreement.totalPrice - (installmentAmount * (installmentCount - 1));
            }
            paymentSchedules[agreementId].push(PaymentSchedule({
                installmentNumber: i + 1,
                amount: amount_,
                dueDate: dueDate,
                status: PaymentStatus.Pending,
                paidAmount: 0,
                paidAt: 0
            }));
            
            emit PaymentScheduled(
                agreementId,
                i + 1,
                amount_,
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
        uint256 newCreditLimit = (totalCollateralValue * governanceParams.creditLimitRatio) / 10000;
        
        creditLine.collateralValue = totalCollateralValue;
        creditLine.creditLimit = newCreditLimit;
        creditLine.lastUpdateTime = uint40(block.timestamp);
        
        if (newCreditLimit >= creditLine.usedCredit) {
            creditLine.availableCredit = newCreditLimit - creditLine.usedCredit;
        } else {
            creditLine.availableCredit = 0;
        }
        
        creditLine.creditUtilization = _utilizationBps(creditLine.usedCredit, newCreditLimit);

        emit CreditLineUpdated(
            user,
            creditLine.creditLimit,
            creditLine.availableCredit,
            creditLine.usedCredit
        );
    }

    /**
     * @dev Reserve credit against a buyer's line when an agreement is opened.
     * Split out of createAgreementWithRWA rather than written inline: that function was already
     * at the viaIR stack limit, and adding the clamped-utilization call to it pushed the Yul
     * optimizer over ("variable is 1 too deep in the stack"). Moving these three writes into
     * their own frame also drops the CreditLine storage pointer that createAgreementWithRWA was
     * otherwise holding live across its whole body.
     */
    function _consumeCredit(address buyer, uint256 amount) internal {
        CreditLine storage creditLine = creditLines[buyer];
        creditLine.usedCredit += amount;
        creditLine.availableCredit -= amount;
        creditLine.creditUtilization = _utilizationBps(creditLine.usedCredit, creditLine.creditLimit);
    }

    /**
     * @dev Credit utilization in basis points, clamped to MAX_CREDIT_UTILIZATION.
     * Returns 0 when there is no outstanding credit or no credit limit to measure against.
     * The clamp is what makes the uint16 field on CreditLine safe: without it, a collateral value
     * drop while credit is outstanding pushes the raw ratio above 10000 and, once packed, would
     * overflow the narrowing cast.
     */
    function _utilizationBps(uint256 used, uint256 limit) internal pure returns (uint16) {
        if (used == 0 || limit == 0) return 0;
        uint256 bps = (used * 10000) / limit;
        return uint16(bps > MAX_CREDIT_UTILIZATION ? MAX_CREDIT_UTILIZATION : bps);
    }

    /**
     * @dev Credit-bearing collateral value in ETH wei (ADR-012). Counts recorded deposit principal
     * only. Simulated yield folded into position.amount and simulated stakingRewards are backed by
     * nothing and cannot be paid out (ADR-010), so lending against them would extend credit that
     * no real asset can settle. Principal is the same figure draws, seizures and withdrawals use,
     * which makes the credit line and the settlement path agree. Capped at position.amount as a
     * belt and braces guard for the collateralPrincipal <= amount invariant. Only plain ERC20
     * positions go through the oracle (ADR-009).
     */
    function _getCollateralValue(address user, bytes32 positionId) internal view returns (uint256) {
        CollateralPosition storage position = collateralPositions[user][positionId];
        uint256 backed = collateralPrincipal[user][positionId];
        if (backed > position.amount) backed = position.amount;
        return position.collateralType == CollateralType.ERC20
            ? _toWei(position.tokenAddress, backed)
            : backed;
    }

    /**
     * @dev Value of `amount` of `token` in ETH wei. Identity for ETH (address(0)) and whenever no
     * oracle is wired. Rounds down, so a position is never over-valued. A stale or unsupported
     * price reverts on purpose: falling back to raw units would reintroduce the bug exactly when
     * the oracle is unhealthy.
     */
    function _toWei(address token, uint256 amount) internal view returns (uint256) {
        IRelicPayPriceOracle oracle = priceOracle;
        if (address(oracle) == address(0) || token == address(0) || amount == 0) return amount;
        return (oracle.getUSDValue(token, amount) * 1e18) / oracle.getPrice(address(0));
    }

    /**
     * @dev Inverse of _toWei: how many raw units of `token` are worth `weiAmount`, rounded down.
     * Uses getUSDValue on a 1e18 probe instead of reading decimals, so it needs nothing from the
     * oracle beyond the two calls in IRelicPayPriceOracle.
     */
    function _fromWei(address token, uint256 weiAmount) internal view returns (uint256) {
        IRelicPayPriceOracle oracle = priceOracle;
        if (address(oracle) == address(0) || token == address(0) || weiAmount == 0) return weiAmount;
        uint256 usd = (weiAmount * oracle.getPrice(address(0))) / 1e18;
        return (usd * 1e18) / oracle.getUSDValue(token, 1e18);
    }

    /// @dev Convert `amount` of `from` into units of `to` through ETH wei. Identity when both are the same asset.
    function _convertUnits(address from, address to, uint256 amount) internal view returns (uint256) {
        if (from == to) return amount;
        return _fromWei(to, _toWei(from, amount));
    }

    /// @dev The asset a position is denominated in: its token for ERC20, address(0) (ETH wei) otherwise.
    function _positionAsset(CollateralPosition storage position) internal view returns (address) {
        return position.collateralType == CollateralType.ERC20 ? position.tokenAddress : address(0);
    }

    /**
     * @dev Get total collateral value for all user positions
     */
    function _getTotalCollateralValue(address user) internal view returns (uint256) {
        bytes32[] memory positionIds = userCollateralPositionIds[user];
        uint256 totalValue = 0;
        
        for (uint256 i = 0; i < positionIds.length; i++) {
            totalValue += _getCollateralValue(user, positionIds[i]);
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
            
            // ADR-010: only recorded principal is drawable, simulated yield is not.
            uint256 drawable = collateralPrincipal[user][positionIds[i]];
            if (drawable > 0) {
                // remainingAmount is ETH wei; the position may be in another unit (ADR-009).
                address asset = _positionAsset(position);
                uint256 availableWei = _toWei(asset, drawable);
                uint256 takeWei = remainingAmount > availableWei ? availableWei : remainingAmount;
                uint256 withdrawAmount = takeWei == availableWei ? drawable : _fromWei(asset, takeWei);
                if (withdrawAmount == 0) continue;
                position.amount -= withdrawAmount;
                _reducePrincipal(user, positionIds[i], withdrawAmount);
                remainingAmount -= takeWei;
                
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
     * @dev Record a positionId in the user's position list exactly once, ever.
     * See the _positionListed declaration for what the old `amount == 0` guard got wrong.
     */
    function _listPosition(address user, bytes32 positionId) internal {
        if (_positionListed[user][positionId]) return;
        _positionListed[user][positionId] = true;
        userCollateralPositionIds[user].push(positionId);
    }

    /**
     * @dev Draw `amount` off a position's recorded principal, flooring at zero.
     *
     * The floor is not defensive padding, it is the yield case: an outflow is bounded by
     * position.amount, which includes reinvested simulated yield, so a draw can legitimately
     * exceed principal. Saturating there keeps the collateralPrincipal <= position.amount
     * invariant, which is what makes principal safe to use as the withdrawal bound.
     */
    function _reducePrincipal(address user, bytes32 positionId, uint256 amount) internal {
        uint256 current = collateralPrincipal[user][positionId];
        collateralPrincipal[user][positionId] = amount >= current ? 0 : current - amount;
    }

    /**
     * @dev Release credit when agreement is completed
     */
    function _releaseCredit(address user, uint256 amount) internal {
        creditLines[user].usedCredit -= amount;
        _updateCreditLine(user); // recompute limit and availability from live collateral
    }

    // Governance functions
    //
    // These four are onlyGovernance rather than onlyOwner: the owner keeps every right it had and
    // an appointed governor (in practice RelicPayGovernance) gains the same rights on this subset.
    // Widening, never narrowing, so nothing built against the old access rules breaks.
    //
    // authorizeSettlementToken deliberately stays onlyOwner. Adding a settlement currency is a
    // treasury decision with counterparty risk attached, not a protocol parameter, and it is not
    // in the governed ParameterType set.
    function updateGovernanceParams(
        uint256 _creditLimitRatio,
        uint256 _defaultGracePeriod,
        uint256 _minCollateralAmount
    ) external onlyGovernance {
        governanceParams.creditLimitRatio = _creditLimitRatio;
        governanceParams.defaultGracePeriod = _defaultGracePeriod;
        governanceParams.minCollateralAmount = _minCollateralAmount;

        emit GovernanceUpdated(_creditLimitRatio, _defaultGracePeriod, _minCollateralAmount);
    }

    // The three single-parameter setters below exist because governance addresses one parameter at
    // a time. ParameterType.CreditLimitRatio names one value, but updateGovernanceParams takes all
    // three, so routing a proposal through it would force governance to read the other two and
    // write them back. That read-modify-write is a race: two proposals queued against the same
    // snapshot would each silently revert the other's parameter on execution, with nothing on
    // chain to show it happened. A setter per parameter makes the proposal say exactly what it
    // changes, and leaves the rest untouched by construction.
    //
    // Each still emits GovernanceUpdated with the full triple, so an indexer following that one
    // event keeps a complete picture of governanceParams regardless of which path wrote it.

    function setCreditLimitRatio(uint256 _creditLimitRatio) external onlyGovernance {
        governanceParams.creditLimitRatio = _creditLimitRatio;
        emit GovernanceUpdated(
            _creditLimitRatio,
            governanceParams.defaultGracePeriod,
            governanceParams.minCollateralAmount
        );
    }

    function setDefaultGracePeriod(uint256 _defaultGracePeriod) external onlyGovernance {
        governanceParams.defaultGracePeriod = _defaultGracePeriod;
        emit GovernanceUpdated(
            governanceParams.creditLimitRatio,
            _defaultGracePeriod,
            governanceParams.minCollateralAmount
        );
    }

    function setMinCollateralAmount(uint256 _minCollateralAmount) external onlyGovernance {
        governanceParams.minCollateralAmount = _minCollateralAmount;
        emit GovernanceUpdated(
            governanceParams.creditLimitRatio,
            governanceParams.defaultGracePeriod,
            _minCollateralAmount
        );
    }

    /**
     * @dev Wire (or, with address(0), unwire) the oracle that normalizes collateral to ETH wei.
     * A non-zero oracle must answer an ETH price right now, so a dead or stale oracle cannot be
     * installed by accident. Not a governed ParameterType: that enum is part of the governance ABI.
     */
    function setPriceOracle(address oracle) external onlyGovernance {
        if (oracle != address(0)) IRelicPayPriceOracle(oracle).getPrice(address(0));
        emit PriceOracleUpdated(address(priceOracle), oracle);
        priceOracle = IRelicPayPriceOracle(oracle);
    }

    /**
     * @dev Set the longest schedule createAgreementWithRWA accepts, in seconds. Zero is refused:
     * it would make every agreement unmakeable, which is a pause switch by accident. Not a governed
     * ParameterType (that enum is the governance ABI); like setPriceOracle it is reachable by the
     * governor and the owner path only. Applies to new agreements only; existing ones are untouched.
     */
    function setMaxAgreementDuration(uint256 _maxAgreementDuration) external onlyGovernance {
        if (_maxAgreementDuration == 0) revert InvalidMaxAgreementDuration();
        emit MaxAgreementDurationUpdated(governanceParams.maxAgreementDuration, _maxAgreementDuration);
        governanceParams.maxAgreementDuration = _maxAgreementDuration;
    }

    /// @dev Total schedule length is count * interval. Both are bounded by uint32 before this runs,
    /// so the product cannot overflow a uint256. Own frame: createAgreementWithRWA is at the viaIR limit.
    function _checkDuration(uint256 installmentCount, uint256 dueIntervalSeconds) private view {
        if (installmentCount * dueIntervalSeconds > governanceParams.maxAgreementDuration) revert AgreementTooLong();
    }

    function setYieldRate(address tokenAddress, uint256 rateBasisPoints) external onlyGovernance {
        yieldRates[tokenAddress] = rateBasisPoints;
    }

    function authorizeToken(address tokenAddress, bool authorized) external onlyGovernance {
        authorizedTokens[tokenAddress] = authorized;
    }

    function authorizeNFT(address nftAddress, bool authorized) external onlyGovernance {
        authorizedNFTs[nftAddress] = authorized;
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


    /**
     * @dev Take collateral back out of a position. The counterpart depositETHCollateral and
     * depositERC20Collateral never had: before this, collateral left the contract only through a
     * payment draw or a default seizure, so an over-collateralised buyer with no open agreement had
     * no way to recover the remainder. Signature mirrors EnhancedBnpl.withdrawCollateral so the two
     * read the same to a caller.
     *
     * Three gates, in the order they can fire:
     *
     * 1. Principal. Bounded by collateralPrincipal, not by position.amount. Simulated yield inflates
     *    amount and is backed by nothing, so paying it out here would be paying it out of other
     *    users' deposits. See the collateralPrincipal declaration.
     *
     * 2. Backing (the V1-BUG-2 fix). The credit line is recomputed from what is left and the
     *    withdrawal is refused if the remaining collateral no longer covers usedCredit. v1's
     *    EnhancedBnpl.withdrawCollateral checked nothing, so a buyer could open an agreement against
     *    collateral and then walk the collateral out from under it. Checked after the decrement
     *    rather than before, so the question asked is the one that matters: not "is there credit
     *    outstanding" but "would this specific withdrawal leave it unbacked". A buyer 3 ETH in on a
     *    1 ETH agreement can still take the spare 2 out, which is the whole point of the function.
     *
     * 3. Solvency of the send itself, via the ETH/ERC20 transfer reverting if the contract somehow
     *    cannot cover it.
     *
     * Reverts rather than clamping to the withdrawable maximum: a silent partial withdrawal of
     * collateral is the kind of surprise that is worth a failed transaction. getWithdrawableCollateral
     * reports the exact ceiling beforehand.
     */
    function withdrawCollateral(bytes32 positionId, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");

        // Settle yield and recompute the line before measuring anything, so the checks below run
        // against the same numbers a reader would see, not against a stale snapshot.
        _updateYield(msg.sender, positionId);

        CollateralPosition storage position = collateralPositions[msg.sender][positionId];
        if (position.amount < amount) revert InsufficientCollateral();
        if (collateralPrincipal[msg.sender][positionId] < amount) revert ExceedsWithdrawablePrincipal();

        position.amount -= amount;
        _reducePrincipal(msg.sender, positionId, amount);
        position.lastUpdateTime = uint40(block.timestamp);

        _updateCreditLine(msg.sender);

        CreditLine storage creditLine = creditLines[msg.sender];
        if (creditLine.creditLimit < creditLine.usedCredit) revert CollateralBacksOpenCredit();

        address tokenAddress = position.tokenAddress;
        if (position.collateralType == CollateralType.ERC20) {
            IERC20(tokenAddress).safeTransfer(msg.sender, amount);
        } else {
            _send(msg.sender, amount);
        }

        emit CollateralWithdrawn(msg.sender, positionId, tokenAddress, amount, creditLine.creditLimit);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    // View functions

    /**
     * @dev The largest amount withdrawCollateral would accept for this position right now, in the
     * position's own asset. Accounts for all three gates: withdrawable principal, and how far the
     * credit line can fall before it stops covering usedCredit.
     *
     * Does not settle pending yield first (it is a view), so a position whose yield is due will
     * report the pre-accrual figure. Yield only ever raises position.amount and never principal, so
     * the number here is a floor, never an over-promise.
     */
    function getWithdrawableCollateral(address user, bytes32 positionId) external view returns (uint256) {
        CollateralPosition storage position = collateralPositions[user][positionId];

        uint256 ceiling = collateralPrincipal[user][positionId];
        if (position.amount < ceiling) ceiling = position.amount;
        if (ceiling == 0) return 0;

        uint256 used = creditLines[user].usedCredit;
        if (used == 0) return ceiling;

        // Credit limit is creditLimitRatio of total collateral value, and withdrawing `x` drops
        // that value by exactly `x`, so the line stays covered while
        // (value - x) * ratio / 10000 >= used.
        uint256 ratio = governanceParams.creditLimitRatio;
        if (ratio == 0) return 0;

        uint256 value = _getTotalCollateralValue(user);
        uint256 required = (used * 10000 + ratio - 1) / ratio; // round up, the check is >=
        if (value <= required) return 0;

        // Headroom is ETH wei; the ceiling and the answer are in the position's own units (ADR-009).
        uint256 headroom = _fromWei(_positionAsset(position), value - required);
        return headroom < ceiling ? headroom : ceiling;
    }
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

    /**
     * @dev Everything a seller, keeper or dashboard needs to decide whether to call
     * triggerDefault, without simulating the call. Returns zeroed fields for an agreement that is
     * not Active, so a defaulted or completed agreement reports defaultable = false.
     */
    function getDefaultStatus(bytes32 agreementId)
        external
        view
        returns (
            bool defaultable,
            uint256 nextInstallment,
            uint256 graceExpiry,
            uint256 outstanding
        )
    {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Active) return (false, 0, 0, 0);

        nextInstallment = agreement.paidInstallments + 1;
        if (nextInstallment > agreement.installmentCount) return (false, 0, 0, 0);

        graceExpiry =
            paymentSchedules[agreementId][nextInstallment - 1].dueDate + agreement.gracePeriodSeconds;
        outstanding = agreement.totalPrice - totalPaid[agreementId];
        defaultable = block.timestamp >= graceExpiry;
    }

    function getCollateralSeized(bytes32 agreementId) external view returns (uint256) {
        return collateralSeized[agreementId];
    }

    /**
     * @dev Currency this agreement settles in. address(0) means ETH.
     */
    function getSettlementToken(bytes32 agreementId) external view returns (address) {
        if (agreements[agreementId].seller == address(0)) revert AgreementNotFound();
        return agreementSettlementToken[agreementId];
    }

    /**
     * @dev What a buyer needs to know before paying: the currency, the amount of the next unpaid
     * installment, and whether that amount is sent as ETH value or must be approved as an ERC20
     * allowance to this contract first. Returns zeroes once the agreement leaves Active.
     */
    function getSettlementTerms(bytes32 agreementId)
        external
        view
        returns (address token, uint256 nextInstallment, uint256 amount, bool requiresApproval)
    {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Active) return (address(0), 0, 0, false);

        nextInstallment = agreement.paidInstallments + 1;
        if (nextInstallment > agreement.installmentCount) return (address(0), 0, 0, false);

        token = agreementSettlementToken[agreementId];
        amount = paymentSchedules[agreementId][nextInstallment - 1].amount;
        requiresApproval = token != address(0) && agreement.paymentMethod == PaymentMethod.Manual;
    }

    /**
     * @dev The buyer's auto-payment pool for a given currency. address(0) reads the ETH pool, so a
     * caller holding a settlement token address does not need to branch.
     */
    function getAutoPaymentBalance(address user, address tokenAddress) external view returns (uint256) {
        return _autoBalanceOf(user, tokenAddress);
    }

    /**
     * @dev How much of a user's collateral a settlement draw in `tokenAddress` could actually take.
     * For a token this is the sum of ERC20 positions in that token; for address(0), the ETH path,
     * it is every position's drawable amount, since _withdrawFromCollateral will take any of them.
     *
     * Deliberately sums recorded principal (ADR-010) and not _getCollateralValue: stakingRewards counts toward
     * the credit line but is not withdrawable principal, so including it here would over-promise
     * exactly the number a caller uses to decide whether a payment will go through.
     */
    function getSettlementCollateral(address user, address tokenAddress) external view returns (uint256) {
        return _settlementCollateral(user, tokenAddress);
    }

    function _settlementCollateral(address user, address tokenAddress) internal view returns (uint256 total) {
        bytes32[] memory positionIds = userCollateralPositionIds[user];
        for (uint256 i = 0; i < positionIds.length; i++) {
            CollateralPosition storage position = collateralPositions[user][positionIds[i]];
            if (tokenAddress != address(0)) {
                if (position.collateralType != CollateralType.ERC20) continue;
                if (position.tokenAddress != tokenAddress) continue;
            }
            // ETH-path sums are ETH wei (ADR-009); a token path is one asset, already in its own units.
            uint256 drawable = collateralPrincipal[user][positionIds[i]]; // ADR-010: principal only
            total += tokenAddress == address(0) ? _toWei(_positionAsset(position), drawable) : drawable;
        }
    }

    /**
     * @dev Whether the next installment can actually be settled right now, and out of what. This
     * is the pre-flight for the strict token-settled collateral draw: a Collateral agreement whose
     * buyer holds no settlement-token collateral reverts at payment time, and a dashboard should be
     * able to say so before the buyer finds out from a failed transaction.
     *
     * `ready` is false for a Manual agreement, whose settlement depends on an allowance and a
     * caller balance this contract cannot see from the buyer alone; use getSettlementTerms for
     * that case. Returns zeroes once the agreement leaves Active.
     */
    function getSettlementReadiness(bytes32 agreementId)
        external
        view
        returns (
            address token,
            uint256 required,
            uint256 autoBalance,
            uint256 collateralAvailable,
            bool ready
        )
    {
        BnplAgreement storage agreement = agreements[agreementId];
        if (agreement.seller == address(0)) revert AgreementNotFound();
        if (agreement.state != BnplState.Active) return (address(0), 0, 0, 0, false);

        uint256 next = agreement.paidInstallments + 1;
        if (next > agreement.installmentCount) return (address(0), 0, 0, 0, false);

        token = agreementSettlementToken[agreementId];
        required = paymentSchedules[agreementId][next - 1].amount;
        autoBalance = _autoBalanceOf(agreement.buyer, token);
        collateralAvailable = _settlementCollateral(agreement.buyer, token);

        PaymentMethod method = agreement.paymentMethod;
        if (method == PaymentMethod.Auto) {
            ready = autoBalance >= required;
        } else if (method == PaymentMethod.Collateral) {
            ready = collateralAvailable >= required;
        } else if (method == PaymentMethod.AutoWithCollateral) {
            ready = autoBalance >= required || collateralAvailable >= required;
        }
    }
}
