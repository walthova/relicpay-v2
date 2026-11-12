// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./RelicConstants.sol";
import "./RelicGoverned.sol";
import "./interfaces/IExternal.sol";

/// @title RelicCreditLine
/// @notice Collateralized USDC credit line, behind a feature flag (`creditEnabled`, off at deploy).
///         Mirrors the Solana `credit_line.rs` instructions one to one.
///
///         - Collateral and debt are both USDC, so there is no price oracle and no depeg leg: LTV
///           only moves with interest, draws, repayments and top-ups.
///         - Draw up to 80% LTV. Above 90% anyone may liquidate: collateral covers the debt plus a
///           5% penalty, half of which pays the liquidator.
///         - Draws are paid out of a lender liquidity pool, straight to the payee (a merchant, or
///           an API's x402 payTo address). The borrower never needs to hold the funds.
///         - Trust score: points for repaid principal only when the debt was at least a day old,
///           capped per 30-day epoch, reset to zero on liquidation. Optional ERC-8004 feedback.
///
///         With the flag off, new collateral and new draws are blocked, but repay, withdraw and
///         liquidate still work, so nobody is ever trapped by turning the feature off.
contract RelicCreditLine is RelicGoverned, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Line {
        uint128 collateral;
        uint128 principal;
        uint128 interest;
        uint128 totalRepaid;
        uint64 lastAccrual;
        uint64 lastDrawAt;
        uint64 trustScore;
        uint64 epochStart;
        uint64 epochPoints;
        uint32 liquidations;
        uint256 agentId; // optional ERC-8004 agent identity bound by the owner, 0 = none
    }

    IERC20 public immutable usdc;
    bool public creditEnabled;
    uint16 public creditRateBps = RelicConstants.DEFAULT_CREDIT_RATE_BPS;

    uint256 public availableLiquidity; // lender USDC ready to draw
    uint256 public totalPrincipalOut; // drawn and not yet repaid
    uint256 public totalCollateral;
    uint256 public protocolRevenue; // interest and penalties
    uint256 public badDebt; // principal lost when collateral could not cover a liquidation

    address public agentDelegate;
    IERC8004Reputation public reputationRegistry;
    IERC8004Identity public identityRegistry;

    mapping(address => Line) internal _lines;
    mapping(address => uint256) public liquiditySupplied;

    event CreditEnabledUpdated(bool enabled);
    event CreditRateUpdated(uint16 oldRateBps, uint16 newRateBps);
    event LiquiditySupplied(address indexed supplier, uint256 amount);
    event LiquidityWithdrawn(address indexed supplier, uint256 amount);
    event CollateralDeposited(address indexed owner, address indexed from, uint256 amount, uint256 newCollateral);
    event CollateralWithdrawn(address indexed owner, uint256 amount, uint256 newCollateral);
    event CreditDrawn(address indexed owner, address indexed payee, address indexed via, uint256 amount, uint256 newDebt);
    event CreditRepaid(address indexed owner, address indexed payer, uint256 interestPaid, uint256 principalPaid, uint256 trustPoints);
    event Liquidated(address indexed owner, address indexed liquidator, uint256 debt, uint256 seized, uint256 liquidatorReward, uint256 badDebt);
    event AgentIdentityBound(address indexed owner, uint256 agentId);
    event ReputationFeedbackFailed(uint256 indexed agentId);

    error CreditDisabled();
    error InvalidAmount();
    error InvalidPayee();
    error LtvExceeded();
    error InsufficientLiquidity();
    error NotLiquidatable();
    error NothingToRepay();
    error RateTooHigh();
    error NotAgentOwner();

    constructor(IERC20 usdc_, address governance_, address guardian_) RelicGoverned(governance_, guardian_) {
        usdc = usdc_;
    }

    // ───────────────────────────── lenders ─────────────────────────────

    function supplyLiquidity(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        liquiditySupplied[msg.sender] += amount;
        availableLiquidity += amount;
        emit LiquiditySupplied(msg.sender, amount);
    }

    function withdrawLiquidity(uint256 amount) external nonReentrant {
        if (amount == 0 || amount > liquiditySupplied[msg.sender]) revert InvalidAmount();
        if (amount > availableLiquidity) revert InsufficientLiquidity();
        liquiditySupplied[msg.sender] -= amount;
        availableLiquidity -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit LiquidityWithdrawn(msg.sender, amount);
    }

    // ───────────────────────────── borrowers ─────────────────────────────

    /// @notice Deposit or top up collateral for `owner` (anyone can top up someone else's line).
    function depositCollateral(address owner, uint256 amount) external nonReentrant {
        if (!creditEnabled) revert CreditDisabled();
        if (amount == 0) revert InvalidAmount();
        Line storage l = _lines[owner];
        _accrue(l);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        l.collateral += uint128(amount);
        totalCollateral += amount;
        emit CollateralDeposited(owner, msg.sender, amount, l.collateral);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant {
        Line storage l = _lines[msg.sender];
        _accrue(l);
        if (amount == 0 || amount > l.collateral) revert InvalidAmount();
        uint256 remaining = l.collateral - amount;
        if (_debt(l) * RelicConstants.BPS > remaining * RelicConstants.MAX_LTV_BPS) revert LtvExceeded();
        l.collateral = uint128(remaining);
        totalCollateral -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount, remaining);
    }

    /// @notice Draw on your own line, paid straight to `payee`.
    function draw(address payee, uint256 amount) external nonReentrant {
        _draw(msg.sender, payee, amount);
    }

    /// @notice Draw on `owner`'s line on behalf of an agent. Only the agent delegate, which has
    ///         already enforced the owner's mandate (caps, allowlist, time window, approval).
    function drawFor(address owner, address payee, uint256 amount) external nonReentrant {
        if (msg.sender != agentDelegate || agentDelegate == address(0)) revert Unauthorized();
        _draw(owner, payee, amount);
    }

    /// @notice Repay `owner`'s line. Interest first, then principal. Anyone may repay.
    function repay(address owner, uint256 amount) external nonReentrant returns (uint256 paid) {
        Line storage l = _lines[owner];
        _accrue(l);
        uint256 debt = _debt(l);
        if (debt == 0) revert NothingToRepay();
        if (amount == 0) revert InvalidAmount();
        paid = amount > debt ? debt : amount;
        usdc.safeTransferFrom(msg.sender, address(this), paid);

        uint256 interestPaid = paid < l.interest ? paid : l.interest;
        uint256 principalPaid = paid - interestPaid;
        l.interest -= uint128(interestPaid);
        l.principal -= uint128(principalPaid);
        l.totalRepaid += uint128(paid);
        protocolRevenue += interestPaid;
        totalPrincipalOut -= principalPaid;
        availableLiquidity += principalPaid;

        uint256 points = _awardTrust(l, principalPaid);
        emit CreditRepaid(owner, msg.sender, interestPaid, principalPaid, points);
        if (points > 0) _feedback(l.agentId, int128(int256(points)), "repayment");
    }

    /// @notice Permissionless. Above 90% LTV the line is closed out against its collateral.
    function liquidate(address owner) external nonReentrant {
        Line storage l = _lines[owner];
        _accrue(l);
        uint256 debt = _debt(l);
        if (debt == 0 || debt * RelicConstants.BPS <= uint256(l.collateral) * RelicConstants.LIQUIDATION_LTV_BPS) {
            revert NotLiquidatable();
        }
        uint256 penalty = (debt * RelicConstants.LIQUIDATION_PENALTY_BPS) / RelicConstants.BPS;
        uint256 seized = debt + penalty;
        if (seized > l.collateral) seized = l.collateral;

        // Waterfall: interest, then principal, then penalty.
        uint256 left = seized;
        uint256 toInterest = left < l.interest ? left : l.interest;
        left -= toInterest;
        uint256 toPrincipal = left < l.principal ? left : l.principal;
        left -= toPrincipal;
        uint256 penaltyPaid = left;
        uint256 reward = penaltyPaid / 2;
        uint256 lost = uint256(l.principal) - toPrincipal;

        protocolRevenue += toInterest + (penaltyPaid - reward);
        availableLiquidity += toPrincipal;
        totalPrincipalOut -= l.principal;
        badDebt += lost;
        totalCollateral -= seized;

        l.collateral -= uint128(seized);
        l.principal = 0;
        l.interest = 0;
        l.liquidations += 1;
        l.trustScore = 0;
        l.epochPoints = 0;

        if (reward > 0) usdc.safeTransfer(msg.sender, reward);
        emit Liquidated(owner, msg.sender, debt, seized, reward, lost);
        _feedback(l.agentId, -100, "liquidation");
    }

    /// @notice Bind an ERC-8004 agent id to your line so repayments build that agent's reputation.
    function bindAgentIdentity(uint256 agentId) external {
        if (address(identityRegistry) != address(0) && agentId != 0) {
            if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        }
        _lines[msg.sender].agentId = agentId;
        emit AgentIdentityBound(msg.sender, agentId);
    }

    // ───────────────────────────── governance (2-day timelock) ─────────────────────────────

    function setCreditEnabled(bool enabled) external onlyGovernance {
        creditEnabled = enabled;
        emit CreditEnabledUpdated(enabled);
    }

    /// @notice Emergency off switch for the guardian. Turning credit back on waits out the timelock.
    function disableCredit() external onlyGuardianOrGovernance {
        creditEnabled = false;
        emit CreditEnabledUpdated(false);
    }

    function setCreditRate(uint16 newRateBps) external onlyGovernance {
        if (newRateBps > RelicConstants.MAX_CREDIT_RATE_BPS) revert RateTooHigh();
        emit CreditRateUpdated(creditRateBps, newRateBps);
        creditRateBps = newRateBps;
    }

    function setAgentDelegate(address delegate) external onlyGovernance {
        agentDelegate = delegate;
    }

    function setRegistries(IERC8004Identity identity, IERC8004Reputation reputation) external onlyGovernance {
        identityRegistry = identity;
        reputationRegistry = reputation;
    }

    function withdrawRevenue(address to, uint256 amount) external onlyGovernance {
        if (amount > protocolRevenue) revert InvalidAmount();
        protocolRevenue -= amount;
        usdc.safeTransfer(to, amount);
    }

    // ───────────────────────────── views ─────────────────────────────

    function getLine(address owner) external view returns (Line memory l) {
        l = _lines[owner];
        l.interest += uint128(_pendingInterest(l));
    }

    function debtOf(address owner) public view returns (uint256) {
        Line storage l = _lines[owner];
        return uint256(l.principal) + l.interest + _pendingInterest(l);
    }

    function ltvBps(address owner) external view returns (uint256) {
        uint256 c = _lines[owner].collateral;
        if (c == 0) return debtOf(owner) == 0 ? 0 : type(uint256).max;
        return (debtOf(owner) * RelicConstants.BPS) / c;
    }

    function availableToDraw(address owner) external view returns (uint256) {
        uint256 limit = (uint256(_lines[owner].collateral) * RelicConstants.MAX_LTV_BPS) / RelicConstants.BPS;
        uint256 debt = debtOf(owner);
        uint256 room = debt >= limit ? 0 : limit - debt;
        return room < availableLiquidity ? room : availableLiquidity;
    }

    function isLiquidatable(address owner) external view returns (bool) {
        uint256 debt = debtOf(owner);
        return debt > 0 && debt * RelicConstants.BPS > uint256(_lines[owner].collateral) * RelicConstants.LIQUIDATION_LTV_BPS;
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _draw(address owner, address payee, uint256 amount) internal {
        if (!creditEnabled) revert CreditDisabled();
        if (amount == 0) revert InvalidAmount();
        if (payee == address(0) || payee == address(this)) revert InvalidPayee();
        Line storage l = _lines[owner];
        _accrue(l);
        uint256 newDebt = _debt(l) + amount;
        if (newDebt * RelicConstants.BPS > uint256(l.collateral) * RelicConstants.MAX_LTV_BPS) revert LtvExceeded();
        if (amount > availableLiquidity) revert InsufficientLiquidity();

        l.principal += uint128(amount);
        l.lastDrawAt = uint64(block.timestamp);
        availableLiquidity -= amount;
        totalPrincipalOut += amount;
        usdc.safeTransfer(payee, amount);
        emit CreditDrawn(owner, payee, msg.sender, amount, newDebt);
    }

    function _debt(Line storage l) internal view returns (uint256) {
        return uint256(l.principal) + l.interest;
    }

    function _pendingInterest(Line memory l) internal view returns (uint256) {
        if (l.principal == 0 || l.lastAccrual == 0) return 0;
        return RelicConstants.calculateYield(l.principal, creditRateBps, block.timestamp - l.lastAccrual);
    }

    function _accrue(Line storage l) internal {
        l.interest += uint128(_pendingInterest(l));
        l.lastAccrual = uint64(block.timestamp);
    }

    function _awardTrust(Line storage l, uint256 principalPaid) internal returns (uint256 points) {
        if (principalPaid == 0) return 0;
        if (block.timestamp < uint256(l.lastDrawAt) + RelicConstants.TRUST_MIN_DEBT_AGE) return 0;
        if (block.timestamp >= uint256(l.epochStart) + RelicConstants.TRUST_EPOCH_SECONDS) {
            l.epochStart = uint64(block.timestamp);
            l.epochPoints = 0;
        }
        points = principalPaid / RelicConstants.TRUST_UNIT;
        uint256 room = RelicConstants.TRUST_POINTS_PER_EPOCH_CAP - l.epochPoints;
        if (points > room) points = room;
        l.epochPoints += uint64(points);
        l.trustScore += uint64(points);
    }

    function _feedback(uint256 agentId, int128 value, string memory tag) internal {
        if (agentId == 0 || address(reputationRegistry) == address(0)) return;
        try reputationRegistry.giveFeedback(agentId, value, 0, "relicpay-credit", tag, "", "", bytes32(0)) {}
        catch {
            emit ReputationFeedbackFailed(agentId);
        }
    }
}
