// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import "./RelicConstants.sol";
import "./RelicGoverned.sol";
import "./RelicEscrow.sol";
import "./RelicCreditLine.sol";
import "./interfaces/IExternal.sol";

/// @title RelicAgentDelegate
/// @notice Base port of AgentMandate (create/update/revoke/close_agent_mandate,
///         agent_create_agreement) plus the agent credit layer (agent_charge). TESTNET ONLY.
///
///         A principal (owner) delegates to one agent key with: a per-transaction cap, a period
///         cap and purchase count, a non-empty merchant allowlist, a validity window and an
///         optional daily time window, an approval threshold above which the owner must sign,
///         and bounds on the BNPL terms the agent may pick. Revoking is one call and terminal.
///
///         Two ways to spend:
///         - `charge`: pay a merchant or API (the x402 payTo address) by drawing on the owner's
///           RelicCreditLine. Funds go straight from the credit pool to the payee.
///         - `purchase`: open a BNPL agreement in RelicEscrow with buyer = owner. The first
///           installment is pulled from the owner either by a plain ERC-20 allowance to this
///           contract or, for a Base Account owner, by a Coinbase Spend Permission.
///
///         Every spend carries a `ref` (for x402, the hash of the payment requirements) that can
///         be used once per mandate, so the same 402 challenge can never be paid twice.
contract RelicAgentDelegate is RelicGoverned, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    struct Limits {
        uint128 perTxCap;
        uint128 periodCap;
        uint64 periodSeconds;
        uint16 maxTxPerPeriod;
        uint128 approvalThreshold; // above this the owner must sign, 0 = never required
        uint64 validFrom; // 0 = immediately
        uint64 expiresAt; // 0 = no expiry
        uint32 windowStart; // daily window, seconds after 00:00 UTC; start == end = any time
        uint32 windowEnd;
        uint64 minIntervalSeconds; // shortest BNPL interval the agent may choose
        uint8 maxInstallments; // most BNPL installments the agent may choose
        address[] allowedMerchants; // non-empty, at most 8
    }

    struct Mandate {
        address owner;
        address agent;
        bool exists;
        bool revoked;
        uint64 createdAt;
        uint64 periodStart;
        uint128 periodSpent;
        uint16 periodTx;
        uint32 totalTx;
        uint128 totalSpent;
        uint256 agentId; // optional ERC-8004 identity
        Limits limits;
    }

    struct Purchase {
        address owner;
        address merchant;
        uint128 totalPrice;
        uint8 installmentCount;
        uint64 intervalSeconds;
        string productId;
        string merchantName;
    }

    bytes32 public constant APPROVAL_TYPEHASH =
        keccak256("OwnerApproval(bytes32 mandateId,address merchant,uint256 amount,bytes32 ref,uint64 deadline)");

    IERC20 public immutable usdc;
    RelicEscrow public immutable escrow;
    RelicCreditLine public immutable credit;
    ISpendPermissionManager public spendPermissionManager;
    IERC8004Identity public identityRegistry;

    mapping(bytes32 => Mandate) internal _mandates;
    mapping(bytes32 => mapping(bytes32 => bool)) public refUsed;

    event MandateSet(bytes32 indexed mandateId, address indexed owner, address indexed agent, uint128 perTxCap, uint128 periodCap);
    event MandateRevoked(bytes32 indexed mandateId, address indexed owner, address indexed agent);
    event MandateClosed(bytes32 indexed mandateId);
    event AgentIdentityBound(bytes32 indexed mandateId, uint256 agentId);
    event AgentCharge(bytes32 indexed mandateId, bytes32 indexed ref, address indexed payee, uint256 amount, bool ownerApproved);
    event AgentPurchase(bytes32 indexed mandateId, bytes32 indexed agreementId, address indexed merchant, uint256 totalPrice, bool ownerApproved);

    error InvalidMandate();
    error MandateExists();
    error MandateNotFound();
    error MandateRevokedErr();
    error MandateNotRevoked();
    error MandateNotYetValid();
    error MandateExpired();
    error OutsideTimeWindow();
    error MerchantNotApproved();
    error PerTxCapExceeded();
    error PeriodCapExceeded();
    error PurchaseLimitReached();
    error OwnerApprovalRequired();
    error ApprovalExpired();
    error RefAlreadyUsed();
    error TermsOutOfBounds();
    error SpendPermissionMismatch();
    error AgentIdentityMismatch();

    constructor(
        IERC20 usdc_,
        RelicEscrow escrow_,
        RelicCreditLine credit_,
        address governance_,
        address guardian_
    ) RelicGoverned(governance_, guardian_) EIP712("RelicAgentDelegate", "1") {
        usdc = usdc_;
        escrow = escrow_;
        credit = credit_;
    }

    // ───────────────────────────── owner ─────────────────────────────

    function mandateId(address owner, address agent) public pure returns (bytes32) {
        return keccak256(abi.encode("agent_mandate", owner, agent));
    }

    function createMandate(address agent, Limits calldata limits) external returns (bytes32 id) {
        id = mandateId(msg.sender, agent);
        Mandate storage m = _mandates[id];
        if (m.exists) revert MandateExists();
        _validate(agent, limits);
        m.owner = msg.sender;
        m.agent = agent;
        m.exists = true;
        m.createdAt = uint64(block.timestamp);
        m.periodStart = uint64(block.timestamp);
        m.limits = limits;
        emit MandateSet(id, msg.sender, agent, limits.perTxCap, limits.periodCap);
    }

    function updateMandate(address agent, Limits calldata limits) external {
        bytes32 id = mandateId(msg.sender, agent);
        Mandate storage m = _mandates[id];
        if (!m.exists) revert MandateNotFound();
        if (m.revoked) revert MandateRevokedErr();
        _validate(agent, limits);
        m.limits = limits;
        emit MandateSet(id, msg.sender, agent, limits.perTxCap, limits.periodCap);
    }

    /// @notice One call kills the agent's authority. Terminal: create a fresh mandate after close.
    ///         Also clears the owner's plain ERC-20 path in effect, since every spend checks this flag.
    function revokeMandate(address agent) external {
        bytes32 id = mandateId(msg.sender, agent);
        Mandate storage m = _mandates[id];
        if (!m.exists) revert MandateNotFound();
        m.revoked = true;
        emit MandateRevoked(id, msg.sender, agent);
    }

    /// @notice Delete a revoked mandate so the same agent key can be given a new one (audit C-14).
    function closeMandate(address agent) external {
        bytes32 id = mandateId(msg.sender, agent);
        Mandate storage m = _mandates[id];
        if (!m.exists) revert MandateNotFound();
        if (!m.revoked) revert MandateNotRevoked();
        delete _mandates[id];
        emit MandateClosed(id);
    }

    /// @notice Optionally bind an ERC-8004 agent id; when an identity registry is configured the
    ///         id's registered agent wallet must be this mandate's agent key.
    function bindAgentIdentity(address agent, uint256 agentId) external {
        bytes32 id = mandateId(msg.sender, agent);
        Mandate storage m = _mandates[id];
        if (!m.exists) revert MandateNotFound();
        if (address(identityRegistry) != address(0) && agentId != 0) {
            if (identityRegistry.getAgentWallet(agentId) != agent) revert AgentIdentityMismatch();
        }
        m.agentId = agentId;
        emit AgentIdentityBound(id, agentId);
    }

    // ───────────────────────────── agent ─────────────────────────────

    /// @notice Pay `payee` (merchant or x402 payTo) by drawing on the owner's credit line.
    function charge(
        address owner,
        address payee,
        uint256 amount,
        bytes32 ref,
        uint64 approvalDeadline,
        bytes calldata ownerApproval
    ) external nonReentrant {
        bytes32 id = mandateId(owner, msg.sender);
        bool approved = _authorize(id, payee, amount, ref, approvalDeadline, ownerApproval);
        credit.drawFor(owner, payee, amount);
        emit AgentCharge(id, ref, payee, amount, approved);
    }

    /// @notice Open a BNPL agreement for the owner (Solana: agent_create_agreement).
    function purchase(
        Purchase calldata p,
        uint64 approvalDeadline,
        bytes calldata ownerApproval,
        bool useSpendPermission,
        SpendPermission calldata permission
    ) external nonReentrant returns (bytes32 agreementId) {
        bytes32 id = mandateId(p.owner, msg.sender);
        bytes32 ref = keccak256(abi.encode("purchase", p.productId));
        bool approved = _authorize(id, p.merchant, p.totalPrice, ref, approvalDeadline, ownerApproval);

        Limits storage lim = _mandates[id].limits;
        if (p.installmentCount > lim.maxInstallments || p.intervalSeconds < lim.minIntervalSeconds) {
            revert TermsOutOfBounds();
        }

        uint256 first = uint256(p.totalPrice) / p.installmentCount;
        if (useSpendPermission) {
            if (
                permission.account != p.owner || permission.spender != address(this)
                    || permission.token != address(usdc) || address(spendPermissionManager) == address(0)
            ) revert SpendPermissionMismatch();
            spendPermissionManager.spend(permission, uint160(first));
        } else {
            usdc.safeTransferFrom(p.owner, address(this), first);
        }
        usdc.forceApprove(address(escrow), first);
        agreementId = escrow.agentCreateAgreement(
            p.owner, p.merchant, p.totalPrice, p.installmentCount, p.intervalSeconds, p.productId, p.merchantName
        );
        emit AgentPurchase(id, agreementId, p.merchant, p.totalPrice, approved);
    }

    // ───────────────────────────── governance ─────────────────────────────

    function setSpendPermissionManager(ISpendPermissionManager manager) external onlyGovernance {
        spendPermissionManager = manager;
    }

    function setIdentityRegistry(IERC8004Identity registry) external onlyGovernance {
        identityRegistry = registry;
    }

    // ───────────────────────────── views ─────────────────────────────

    function getMandate(address owner, address agent) external view returns (Mandate memory) {
        return _mandates[mandateId(owner, agent)];
    }

    function approvalDigest(bytes32 id, address merchant, uint256 amount, bytes32 ref, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(APPROVAL_TYPEHASH, id, merchant, amount, ref, deadline)));
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _validate(address agent, Limits calldata l) internal view {
        uint256 n = l.allowedMerchants.length;
        bool ok = agent != address(0) && l.perTxCap > 0 && l.periodCap >= l.perTxCap && l.periodSeconds > 0
            && l.maxTxPerPeriod > 0 && n > 0 && n <= RelicConstants.MAX_MANDATE_MERCHANTS
            && (l.expiresAt == 0 || (l.expiresAt > block.timestamp && l.expiresAt > l.validFrom))
            && l.windowStart < RelicConstants.SECONDS_PER_DAY && l.windowEnd < RelicConstants.SECONDS_PER_DAY
            && l.minIntervalSeconds > 0 && l.maxInstallments >= RelicConstants.MIN_INSTALLMENTS
            && l.maxInstallments <= RelicConstants.MAX_INSTALLMENTS;
        if (!ok) revert InvalidMandate();
        for (uint256 i; i < n; ++i) {
            if (l.allowedMerchants[i] == address(0)) revert InvalidMandate();
        }
    }

    /// @dev Every mandate check, in the same order as agent_mandate.rs, then the books.
    function _authorize(
        bytes32 id,
        address merchant,
        uint256 amount,
        bytes32 ref,
        uint64 approvalDeadline,
        bytes calldata ownerApproval
    ) internal returns (bool approved) {
        Mandate storage m = _mandates[id];
        if (!m.exists) revert MandateNotFound();
        if (m.revoked) revert MandateRevokedErr();
        Limits storage l = m.limits;
        if (block.timestamp < l.validFrom) revert MandateNotYetValid();
        if (l.expiresAt != 0 && block.timestamp >= l.expiresAt) revert MandateExpired();
        if (!_inWindow(l.windowStart, l.windowEnd)) revert OutsideTimeWindow();
        if (!_allowed(l.allowedMerchants, merchant)) revert MerchantNotApproved();
        if (amount == 0 || amount > l.perTxCap) revert PerTxCapExceeded();
        if (refUsed[id][ref]) revert RefAlreadyUsed();

        if (l.approvalThreshold != 0 && amount > l.approvalThreshold) {
            if (ownerApproval.length == 0) revert OwnerApprovalRequired();
            if (block.timestamp > approvalDeadline) revert ApprovalExpired();
            bytes32 digest = approvalDigest(id, merchant, amount, ref, approvalDeadline);
            if (!SignatureChecker.isValidSignatureNow(m.owner, digest, ownerApproval)) revert OwnerApprovalRequired();
            approved = true;
        }

        if (block.timestamp >= uint256(m.periodStart) + l.periodSeconds) {
            m.periodStart = uint64(block.timestamp);
            m.periodSpent = 0;
            m.periodTx = 0;
        }
        uint256 spent = uint256(m.periodSpent) + amount;
        if (spent > l.periodCap) revert PeriodCapExceeded();
        if (m.periodTx >= l.maxTxPerPeriod) revert PurchaseLimitReached();

        refUsed[id][ref] = true;
        m.periodSpent = uint128(spent);
        m.periodTx += 1;
        m.totalTx += 1;
        m.totalSpent += uint128(amount);
    }

    function _inWindow(uint32 start, uint32 end) internal view returns (bool) {
        if (start == end) return true;
        uint256 sod = block.timestamp % RelicConstants.SECONDS_PER_DAY;
        if (start < end) return sod >= start && sod < end;
        return sod >= start || sod < end; // window wraps past midnight
    }

    function _allowed(address[] storage list, address merchant) internal view returns (bool) {
        uint256 n = list.length;
        for (uint256 i; i < n; ++i) {
            if (list[i] == merchant) return true;
        }
        return false;
    }
}
