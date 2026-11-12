// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./RelicConstants.sol";
import "./RelicGoverned.sol";

/// @title RelicEscrow
/// @notice Base port of the Solana `relicpay` program's BNPL escrow: create_agreement,
///         pay_installment, cancel_agreement, merchant_withdraw, claim_yield, trigger_default,
///         close_agreement, plus ProtocolConfig (pause, per-agreement cap, TVL cap, pinned USDC)
///         and the yield_source switch (0 simulated, 1 live ERC-4626 vault, Morpho on Base).
///
///         Escrow model: Solana keeps one escrow token account per agreement, owned by the
///         agreement PDA. Here every agreement's escrow lives in this contract and is tracked
///         per agreement (`escrowDeposited`, or `vaultShares` for live yield). Only the recorded
///         merchant and buyer can ever receive an agreement's escrow.
///
///         Agreement id = keccak256("agreement", buyer, productId), mirroring the PDA seeds
///         ["agreement", buyer, product_id].
contract RelicEscrow is RelicGoverned, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Active,
        Completed,
        Defaulted,
        Cancelled
    }

    uint8 public constant YIELD_SOURCE_SIMULATED = 0;
    uint8 public constant YIELD_SOURCE_VAULT = 1;

    struct Agreement {
        address buyer;
        uint64 startTime;
        uint8 installmentCount;
        uint8 paidInstallments;
        State state;
        uint8 yieldSource;
        bool merchantWithdrawn;
        uint16 yieldRateBps;
        address merchant;
        uint64 intervalSeconds;
        uint64 lastYieldUpdate;
        uint128 totalPrice;
        uint128 installmentAmount;
        uint128 escrowDeposited; // USDC principal escrowed for this agreement
        uint128 yieldAccrued; // simulated yield owed to the buyer
        uint256 vaultShares; // live yield: vault shares held for this agreement
        string productId;
        string merchantName;
    }

    /// @notice The only token the protocol accepts. Pinned at deploy (Solana: ProtocolConfig.accepted_mint).
    IERC20 public immutable usdc;

    // ── ProtocolConfig ──
    bool public paused;
    uint64 public lastUnpausedAt; // defaults get a fresh grace window after every unpause
    uint256 public maxAgreementDeposit; // vs total_price, 0 = unlimited
    uint256 public tvlCap; // protocol-wide escrow cap, 0 = unlimited
    uint256 public currentTvl; // USDC principal escrowed protocol wide

    // ── yield_source ──
    IERC4626 public yieldVault; // Morpho vault on Base; address(0) = live yield unavailable
    uint256 public totalVaultShares; // shares held for all live agreements
    uint256 public yieldReserve; // funds simulated-yield payouts, never escrow

    // ── agent layer ──
    address public agentDelegate; // RelicAgentDelegate, the only caller of agentCreateAgreement

    mapping(bytes32 => Agreement) internal _agreements;

    event AgreementCreated(
        bytes32 indexed id,
        address indexed buyer,
        address indexed merchant,
        uint256 totalPrice,
        uint8 installmentCount,
        uint256 installmentAmount,
        string productId,
        string merchantName,
        uint8 yieldSource
    );
    event InstallmentPaid(bytes32 indexed id, address indexed buyer, uint8 installmentNumber, uint256 amount, uint256 yieldAccruedSoFar);
    event AgreementCompleted(bytes32 indexed id, address indexed buyer, address indexed merchant, uint256 totalPaid, uint256 yieldEarnedByBuyer);
    event AgreementCancelled(bytes32 indexed id, address indexed buyer, address indexed merchant, uint256 refundToBuyer, uint256 feeToMerchant);
    event MerchantPaid(bytes32 indexed id, address indexed merchant, uint256 amount, uint256 surplusToBuyer);
    event YieldClaimed(bytes32 indexed id, address indexed buyer, uint256 amount);
    event AgreementDefaulted(bytes32 indexed id, address indexed buyer, uint8 paidInstallments, uint256 merchantRecovered);
    event AgreementClosed(bytes32 indexed id, address indexed buyer);
    event ProtocolPauseUpdated(bool paused);
    event RiskLimitsUpdated(uint256 maxAgreementDeposit, uint256 tvlCap);
    event YieldVaultUpdated(address indexed vault);
    event YieldReserveFunded(address indexed from, uint256 amount);
    event AgentDelegateUpdated(address indexed delegate);

    error InvalidAmount();
    error InvalidInstallments();
    error InvalidInterval();
    error InvalidProductId();
    error InvalidMerchantName();
    error InvalidMerchant();
    error AgreementExists();
    error AgreementNotActive();
    error AgreementNotComplete();
    error AlreadyCompleted();
    error PaymentNotDue();
    error GracePeriodNotExpired();
    error NothingToWithdraw();
    error AlreadyWithdrawn();
    error AgreementNotSettled();
    error ProtocolPaused();
    error DepositCapExceeded();
    error TvlCapExceeded();
    error YieldVaultUnavailable();
    error YieldVaultInUse();
    error YieldReserveEmpty();
    error NotBuyer();
    error NotMerchant();

    constructor(IERC20 usdc_, address governance_, address guardian_) RelicGoverned(governance_, guardian_) {
        if (address(usdc_) == address(0)) revert InvalidAmount();
        usdc = usdc_;
    }

    // ───────────────────────────── buyer entry points ─────────────────────────────

    /// @notice Solana: create_agreement. Escrows the first installment from the buyer.
    function createAgreement(
        address merchant,
        uint128 totalPrice,
        uint8 installmentCount,
        uint64 intervalSeconds,
        string calldata productId,
        string calldata merchantName
    ) external nonReentrant returns (bytes32 id) {
        id = _init(msg.sender, merchant, totalPrice, installmentCount, intervalSeconds, productId, merchantName, YIELD_SOURCE_SIMULATED);
        _pullAndEscrow(id, msg.sender, _agreements[id].installmentAmount);
    }

    /// @notice Solana: create_agreement_kamino. Same as createAgreement, escrow earns live vault yield.
    function createAgreementLive(
        address merchant,
        uint128 totalPrice,
        uint8 installmentCount,
        uint64 intervalSeconds,
        string calldata productId,
        string calldata merchantName
    ) external nonReentrant returns (bytes32 id) {
        if (address(yieldVault) == address(0)) revert YieldVaultUnavailable();
        id = _init(msg.sender, merchant, totalPrice, installmentCount, intervalSeconds, productId, merchantName, YIELD_SOURCE_VAULT);
        _pullAndEscrow(id, msg.sender, _agreements[id].installmentAmount);
    }

    /// @notice Solana: agent_create_agreement. Only the agent delegate may call it, after it has
    ///         checked the owner's mandate and pulled the first installment from the owner.
    ///         The agreement records buyer = owner, so repay, cancel and default work as usual.
    function agentCreateAgreement(
        address owner,
        address merchant,
        uint128 totalPrice,
        uint8 installmentCount,
        uint64 intervalSeconds,
        string calldata productId,
        string calldata merchantName
    ) external nonReentrant returns (bytes32 id) {
        if (msg.sender != agentDelegate || agentDelegate == address(0)) revert Unauthorized();
        id = _init(owner, merchant, totalPrice, installmentCount, intervalSeconds, productId, merchantName, YIELD_SOURCE_SIMULATED);
        _pullAndEscrow(id, msg.sender, _agreements[id].installmentAmount);
    }

    /// @notice Solana: pay_installment / pay_installment_kamino. Only the buyer, only once due.
    function payInstallment(bytes32 id) external nonReentrant {
        if (paused) revert ProtocolPaused();
        Agreement storage a = _agreements[id];
        if (a.state != State.Active) revert AgreementNotActive();
        if (msg.sender != a.buyer) revert NotBuyer();
        if (a.paidInstallments >= a.installmentCount) revert AlreadyCompleted();

        uint8 next = a.paidInstallments + 1;
        if (block.timestamp < _dueTime(a, next)) revert PaymentNotDue();

        if (a.yieldSource == YIELD_SOURCE_SIMULATED) {
            uint256 earned = RelicConstants.calculateYield(a.escrowDeposited, a.yieldRateBps, block.timestamp - a.lastYieldUpdate);
            a.yieldAccrued += uint128(earned);
        }
        a.lastYieldUpdate = uint64(block.timestamp);

        bool isLast = next == a.installmentCount;
        uint256 amountDue = isLast
            ? uint256(a.totalPrice) - uint256(a.installmentAmount) * (a.installmentCount - 1)
            : a.installmentAmount;

        _pullAndEscrow(id, msg.sender, amountDue);
        a.paidInstallments = next;
        emit InstallmentPaid(id, a.buyer, next, amountDue, a.yieldAccrued);

        if (isLast) {
            a.state = State.Completed;
            emit AgreementCompleted(id, a.buyer, a.merchant, a.totalPrice, a.yieldAccrued);
        }
    }

    /// @notice Solana: cancel_agreement / cancel_agreement_reconciled. Buyer exits an Active
    ///         agreement: 10% of escrowed principal to the merchant, the rest (plus any live
    ///         vault yield) back to the buyer.
    function cancelAgreement(bytes32 id) external nonReentrant {
        Agreement storage a = _agreements[id];
        if (a.state != State.Active) revert AgreementNotActive();
        if (msg.sender != a.buyer) revert NotBuyer();

        uint256 principal = a.escrowDeposited;
        uint256 available = _releaseEscrow(a);
        uint256 fee = (principal * RelicConstants.CANCEL_FEE_BPS) / RelicConstants.BPS;
        if (fee > available) fee = available;
        uint256 refund = available - fee;

        a.state = State.Cancelled;
        _decreaseTvl(principal);

        if (fee > 0) usdc.safeTransfer(a.merchant, fee);
        if (refund > 0) usdc.safeTransfer(a.buyer, refund);
        emit AgreementCancelled(id, a.buyer, a.merchant, refund, fee);
    }

    /// @notice Solana: merchant_withdraw / merchant_withdraw_reconciled. Merchant collects
    ///         total_price once Completed. Live vault surplus goes to the buyer in the same call,
    ///         so no collateral is ever stranded behind a terminal state (audit C-7).
    function merchantWithdraw(bytes32 id) external nonReentrant {
        Agreement storage a = _agreements[id];
        if (a.state != State.Completed) revert AgreementNotComplete();
        if (msg.sender != a.merchant) revert NotMerchant();
        if (a.merchantWithdrawn) revert AlreadyWithdrawn();

        uint256 principal = a.escrowDeposited;
        uint256 available = _releaseEscrow(a);
        if (available == 0) revert NothingToWithdraw();
        uint256 toMerchant = available < a.totalPrice ? available : a.totalPrice;
        uint256 surplus = available - toMerchant;

        a.merchantWithdrawn = true;
        _decreaseTvl(principal);

        usdc.safeTransfer(a.merchant, toMerchant);
        if (surplus > 0) usdc.safeTransfer(a.buyer, surplus);
        emit MerchantPaid(id, a.merchant, toMerchant, surplus);
    }

    /// @notice Solana: claim_yield_paid. Pays simulated yield from the yield reserve, never from
    ///         escrow. Partial payouts are allowed when the reserve is short; the rest stays owed.
    function claimYield(bytes32 id) external nonReentrant {
        Agreement storage a = _agreements[id];
        if (a.state != State.Completed) revert AgreementNotComplete();
        if (msg.sender != a.buyer) revert NotBuyer();
        uint256 owed = a.yieldAccrued;
        if (owed == 0) revert NothingToWithdraw();
        uint256 pay = owed < yieldReserve ? owed : yieldReserve;
        if (pay == 0) revert YieldReserveEmpty();

        a.yieldAccrued = uint128(owed - pay);
        yieldReserve -= pay;
        usdc.safeTransfer(a.buyer, pay);
        emit YieldClaimed(id, a.buyer, pay);
    }

    /// @notice Solana: trigger_default / trigger_default_reconciled. Permissionless crank: once the
    ///         next installment is more than 7 days late, all escrow goes to the recorded merchant.
    ///         Blocked while paused, and after an unpause every buyer gets a fresh 7-day window,
    ///         so a pause can never push a buyer into default (audit C-5).
    function triggerDefault(bytes32 id) external nonReentrant {
        if (paused) revert ProtocolPaused();
        Agreement storage a = _agreements[id];
        if (a.state != State.Active) revert AgreementNotActive();
        (bool defaultable,,) = _defaultStatus(a);
        if (!defaultable) revert GracePeriodNotExpired();

        uint256 principal = a.escrowDeposited;
        uint256 recovered = _releaseEscrow(a);
        a.state = State.Defaulted;
        _decreaseTvl(principal);

        if (recovered > 0) usdc.safeTransfer(a.merchant, recovered);
        emit AgreementDefaulted(id, a.buyer, a.paidInstallments, recovered);
    }

    /// @notice Solana: close_agreement. Buyer deletes a settled agreement so the product id can be
    ///         reused. Unclaimed simulated yield is forfeited by the buyer's own choice to close.
    function closeAgreement(bytes32 id) external {
        Agreement storage a = _agreements[id];
        if (a.state == State.None || a.state == State.Active) revert AgreementNotSettled();
        if (msg.sender != a.buyer) revert NotBuyer();
        if (a.escrowDeposited != 0 || a.vaultShares != 0) revert AgreementNotSettled();
        if (a.state == State.Completed && !a.merchantWithdrawn) revert AgreementNotSettled();
        address buyer = a.buyer;
        delete _agreements[id];
        emit AgreementClosed(id, buyer);
    }

    /// @notice Anyone may top up the reserve that pays simulated yield.
    function fundYieldReserve(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        yieldReserve += amount;
        emit YieldReserveFunded(msg.sender, amount);
    }

    // ───────────────────────────── governance (2-day timelock) ─────────────────────────────

    /// @notice Solana: set_protocol_paused. The guardian may pause immediately; only governance unpauses.
    function setPaused(bool paused_) external {
        if (paused_) {
            if (msg.sender != governance && (guardian == address(0) || msg.sender != guardian)) revert Unauthorized();
        } else {
            if (msg.sender != governance) revert Unauthorized();
            lastUnpausedAt = uint64(block.timestamp);
        }
        paused = paused_;
        emit ProtocolPauseUpdated(paused_);
    }

    /// @notice Solana: update_risk_limits.
    function setRiskLimits(uint256 maxAgreementDeposit_, uint256 tvlCap_) external onlyGovernance {
        maxAgreementDeposit = maxAgreementDeposit_;
        tvlCap = tvlCap_;
        emit RiskLimitsUpdated(maxAgreementDeposit_, tvlCap_);
    }

    /// @notice Solana: set_kamino_config. Can only change while no live agreement holds shares,
    ///         so a governance change can never redirect escrow that already sits in a vault (audit C-8).
    function setYieldVault(IERC4626 vault) external onlyGovernance {
        if (totalVaultShares != 0) revert YieldVaultInUse();
        if (address(vault) != address(0) && vault.asset() != address(usdc)) revert YieldVaultUnavailable();
        yieldVault = vault;
        emit YieldVaultUpdated(address(vault));
    }

    function setAgentDelegate(address delegate) external onlyGovernance {
        agentDelegate = delegate;
        emit AgentDelegateUpdated(delegate);
    }

    // ───────────────────────────── views ─────────────────────────────

    function agreementId(address buyer, string memory productId) public pure returns (bytes32) {
        return keccak256(abi.encode("agreement", buyer, productId));
    }

    function getAgreement(bytes32 id) external view returns (Agreement memory) {
        return _agreements[id];
    }

    /// @notice (defaultable, nextInstallment, graceExpiry) without simulating the transaction.
    function getDefaultStatus(bytes32 id) external view returns (bool defaultable, uint8 nextInstallment, uint256 graceExpiry) {
        Agreement storage a = _agreements[id];
        if (a.state != State.Active) return (false, 0, 0);
        (defaultable, nextInstallment, graceExpiry) = _defaultStatus(a);
        if (paused) defaultable = false;
    }

    function nextDueTime(bytes32 id) external view returns (uint256) {
        Agreement storage a = _agreements[id];
        return _dueTime(a, a.paidInstallments + 1);
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _init(
        address buyer,
        address merchant,
        uint128 totalPrice,
        uint8 installmentCount,
        uint64 intervalSeconds,
        string calldata productId,
        string calldata merchantName,
        uint8 yieldSource
    ) internal returns (bytes32 id) {
        if (paused) revert ProtocolPaused();
        if (totalPrice == 0) revert InvalidAmount();
        if (installmentCount < RelicConstants.MIN_INSTALLMENTS || installmentCount > RelicConstants.MAX_INSTALLMENTS) {
            revert InvalidInstallments();
        }
        if (intervalSeconds == 0) revert InvalidInterval();
        if (bytes(productId).length > RelicConstants.MAX_PRODUCT_ID_LEN) revert InvalidProductId();
        if (bytes(merchantName).length > RelicConstants.MAX_MERCHANT_NAME_LEN) revert InvalidMerchantName();
        if (merchant == address(0)) revert InvalidMerchant();
        if (maxAgreementDeposit > 0 && totalPrice > maxAgreementDeposit) revert DepositCapExceeded();

        id = agreementId(buyer, productId);
        Agreement storage a = _agreements[id];
        if (a.state != State.None) revert AgreementExists();

        a.buyer = buyer;
        a.merchant = merchant;
        a.totalPrice = totalPrice;
        a.installmentCount = installmentCount;
        a.installmentAmount = totalPrice / installmentCount;
        a.intervalSeconds = intervalSeconds;
        a.startTime = uint64(block.timestamp);
        a.lastYieldUpdate = uint64(block.timestamp);
        a.state = State.Active;
        a.yieldRateBps = RelicConstants.DEFAULT_YIELD_RATE_BPS;
        a.yieldSource = yieldSource;
        a.productId = productId;
        a.merchantName = merchantName;
        a.paidInstallments = 1;

        emit AgreementCreated(id, buyer, merchant, totalPrice, installmentCount, a.installmentAmount, productId, merchantName, yieldSource);
    }

    function _pullAndEscrow(bytes32 id, address from, uint256 amount) internal {
        Agreement storage a = _agreements[id];
        uint256 projected = currentTvl + amount;
        if (tvlCap > 0 && projected > tvlCap) revert TvlCapExceeded();
        currentTvl = projected;

        usdc.safeTransferFrom(from, address(this), amount);
        a.escrowDeposited += uint128(amount);

        if (a.yieldSource == YIELD_SOURCE_VAULT) {
            IERC4626 vault = yieldVault;
            if (address(vault) == address(0)) revert YieldVaultUnavailable();
            usdc.forceApprove(address(vault), amount);
            uint256 shares = vault.deposit(amount, address(this));
            a.vaultShares += shares;
            totalVaultShares += shares;
        }
    }

    /// @dev Empties an agreement's escrow and returns the USDC now free to pay out.
    function _releaseEscrow(Agreement storage a) internal returns (uint256 available) {
        if (a.yieldSource == YIELD_SOURCE_VAULT) {
            uint256 shares = a.vaultShares;
            a.vaultShares = 0;
            totalVaultShares -= shares;
            available = shares == 0 ? 0 : yieldVault.redeem(shares, address(this), address(this));
        } else {
            available = a.escrowDeposited;
        }
        a.escrowDeposited = 0;
    }

    function _decreaseTvl(uint256 amount) internal {
        currentTvl = amount > currentTvl ? 0 : currentTvl - amount;
    }

    function _dueTime(Agreement storage a, uint8 installment) internal view returns (uint256) {
        return uint256(a.startTime) + uint256(installment) * uint256(a.intervalSeconds);
    }

    function _defaultStatus(Agreement storage a)
        internal
        view
        returns (bool defaultable, uint8 nextInstallment, uint256 graceExpiry)
    {
        nextInstallment = a.paidInstallments + 1;
        graceExpiry = _dueTime(a, nextInstallment) + RelicConstants.GRACE_PERIOD_SECONDS;
        uint256 unpauseGrace = uint256(lastUnpausedAt) + RelicConstants.GRACE_PERIOD_SECONDS;
        if (lastUnpausedAt != 0 && unpauseGrace > graceExpiry) graceExpiry = unpauseGrace;
        defaultable = block.timestamp > graceExpiry;
    }
}
