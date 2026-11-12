// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Governance token interface
interface IGovernanceToken {
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function getPastVotes(address account, uint256 blockNumber) external view returns (uint256);
}

/**
 * @title RelicPayGovernance
 * @dev Governance system for community-driven parameter management
 * @notice Allows token holders to vote on protocol parameters and upgrades
 */
contract RelicPayGovernance is Ownable, ReentrancyGuard {
    
    // Proposal structure
    // Field order below is chosen for storage packing, not readability. proposer (20 bytes) +
    // startTime (5) + endTime (5) + executed (1) + canceled (1) is exactly 32 bytes, so the whole
    // hot read set that vote(), execute(), cancel() and isProposalActive() touch lives in a single
    // slot. `id` stays uint256: nothing is left to share a slot with it, and narrowing a field that
    // still occupies a full slot only adds mask/shift work on every read and write.
    // The two strings and the two vote tallies are unbounded and stay in their own slots.
    // uint40 seconds overflows in roughly the year 36812; propose() guards the cast anyway because
    // votingDelay and votingPeriod are owner-supplied.
    struct Proposal {
        uint256 id;
        address proposer;
        uint40 startTime;
        uint40 endTime;
        bool executed;
        bool canceled;
        string title;
        string description;
        uint256 totalForVotes;
        uint256 totalAgainstVotes;
        mapping(address => bool) hasVoted;
    }
    
    // Parameter types that can be governed
    //
    // The four entries below AuthorizedNFT are new in part b2, and they are appended rather than
    // slotted in anywhere sensible on purpose. A ParameterType travels the ABI as a uint8, so
    // appending is additive and every value that existed keeps the number it had, while inserting
    // or removing one silently renumbers the entries after it: a queued proposal encoded before
    // the change would execute a different function after it.
    //
    // That is also why ProtocolFee and MaxInstallments are still here. Neither names anything in
    // the v2 contracts and both revert (see paramSelector), but deleting them would shift
    // AuthorizedToken from 6 to 4 and AuthorizedNFT from 7 to 5, which is the exact failure the
    // append rule exists to avoid. They are retired in place: the slots are held, nothing maps to
    // them, and a proposal naming one fails loudly. Repurposing either to mean an oracle or an
    // APY was the other option considered and is worse than both: it keeps the enum small by
    // rebinding a value that legacy callers can still encode, so an old integration asking for
    // "ProtocolFee" would find itself authorizing an oracle.
    enum ParameterType {
        CreditLimitRatio,   // 0  RelicPay
        GracePeriod,        // 1  RelicPay
        MinimumCollateral,  // 2  RelicPay
        YieldRate,          // 3  RelicPay
        ProtocolFee,        // 4  retired in place, reverts
        MaxInstallments,    // 5  retired in place, reverts
        AuthorizedToken,    // 6  RelicPay
        AuthorizedNFT,      // 7  RelicPay
        AuthorizedOracle,   // 8  PriceOracle
        MaxPriceAge,        // 9  PriceOracle
        AuthorizedProtocol, // 10 DeFiIntegration
        ProtocolAPY         // 11 DeFiIntegration
    }
    
    // Parameter update structure
    //
    // `data` is the ABI encoding of the setter's ARGUMENTS ONLY, with no function selector. The
    // selector is derived from paramType by paramSelector() and can never be supplied by the
    // proposal. That is the point: if a proposal carried raw calldata, a passing vote on
    // "raise the credit ratio" could execute any function on any contract governance can reach,
    // and reviewers would have to decode four bytes by hand to notice. Here the enum value and
    // the function called are the same fact.
    struct ParameterUpdate {
        ParameterType paramType;
        address target;         // Contract address
        bytes data;            // ABI-encoded arguments for the selector paramType maps to
    }
    
    // State variables
    IGovernanceToken public governanceToken;
    uint256 public proposalCount;
    uint256 public votingDelay = 1 days;
    uint256 public votingPeriod = 3 days;
    uint256 public proposalThreshold = 1000 * 1e18; // 1000 tokens
    uint256 public quorumVotes = 10000 * 1e18; // 10000 tokens

    // Timelock. A proposal that has passed is not executable directly: it must first be queued,
    // which publishes an eta, and only then executed inside [eta, eta + executionGracePeriod].
    // The delay is the window in which anyone watching ProposalQueued can react, and the grace
    // period stops a stale proposal from being executed against a protocol that has moved on.
    uint256 public executionDelay = 2 days;
    uint256 public executionGracePeriod = 14 days;

    // Bounds on the two above. The delay cap stops an owner from parking a passed proposal
    // beyond any useful horizon; the grace floor stops one from being set so tight that a
    // legitimate execution is unlandable.
    uint256 public constant MAX_EXECUTION_DELAY = 30 days;
    uint256 public constant MIN_EXECUTION_GRACE_PERIOD = 1 days;
    uint256 public constant MAX_EXECUTION_GRACE_PERIOD = 90 days;

    // proposalId => earliest timestamp at which execute() may run. 0 means not queued.
    // Kept in its own mapping rather than folded into Proposal: the packed slot there
    // (proposer + startTime + endTime + executed + canceled) is exactly 32 bytes with nothing
    // left over, so a uint40 eta would open a new slot anyway and cost a read-modify-write on
    // top. A dedicated mapping is the same one cold slot with none of the masking.
    mapping(uint256 => uint256) public proposalEta;

    // proposalId => the block whose checkpoints decide voting power for that proposal (V1-BUG-4).
    // getPastVotes takes a clock value in the token's own units, which for an ERC20Votes token is
    // a block number. v1 passed startTime - 1, a unix timestamp, so against a real token every
    // vote asked about a block roughly 1.7e9 in the future and reverted. The snapshot is the block
    // before the proposal was created: strictly in the past from the first block a vote can land
    // in (even with votingDelay zero), and fixed, so tokens acquired after a proposal is visible
    // cannot vote on it. Own mapping rather than a Proposal field: that struct's packed slot is
    // already exactly 32 bytes.
    mapping(uint256 => uint256) public proposalSnapshotBlock;
    
    // Track votes separately for "for" and "against" to avoid underflow issues
    mapping(uint256 => mapping(address => uint256)) public userForVotes; // proposalId => voter => votes
    mapping(uint256 => mapping(address => uint256)) public userAgainstVotes; // proposalId => voter => votes
    
    // Storage is internal so the Proposal struct can be repacked without changing the external
    // ABI. The explicit `proposals(uint256)` view below returns the exact tuple (same order, same
    // uint256 widths) that the auto-generated public getter used to return.
    mapping(uint256 => Proposal) internal _proposals;
    mapping(address => bool) public authorizedExecutors;

    // proposalId => hash of the proposed parameter updates (V1-QUIRK-4 fix)
    mapping(uint256 => bytes32) public proposalActionsHash;

    // target contract => selector => whether execute() may make that call.
    //
    // Second half of a two-sided opt-in. This side says which calls governance is willing to make;
    // the target side says whether it accepts governance at all (Governable.setGovernor). Neither
    // alone is enough, so a mis-encoded proposal cannot reach a contract that never agreed to be
    // governed, and a contract that did agree cannot be reached through a call its allowlist entry
    // was never added for.
    mapping(address => mapping(bytes4 => bool)) public allowedActions;

    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string title,
        uint256 startTime,
        uint256 endTime
    );
    
    event VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        bool support,
        uint256 votes
    );
    
    event ProposalQueued(uint256 indexed proposalId, uint256 eta, uint256 expiresAt);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);
    event TimelockParametersUpdated(uint256 executionDelay, uint256 executionGracePeriod);
    event ParameterUpdated(
        ParameterType indexed paramType,
        address indexed target,
        bytes data
    );
    event ActionAllowanceUpdated(
        address indexed target,
        bytes4 indexed selector,
        bool allowed
    );

    // Errors
    error ProposalNotFound();
    error ProposalNotActive();
    error ProposalAlreadyExecuted();
    error ProposalAlreadyCanceled();
    error InsufficientVotingPower();
    error QuorumNotMet();
    error ExecutionFailed();
    error UnauthorizedExecutor();
    error ValueTooLarge();
    error ProposalNotQueued();
    error ProposalAlreadyQueued();
    error TimelockNotExpired();
    error ProposalStale();
    error InvalidTimelockParameters();
    error UnsupportedParameterType();
    error ActionNotAllowed();
    error InvalidParameterData();
    error InvalidTarget();

    constructor(address _governanceToken) Ownable(msg.sender) {
        governanceToken = IGovernanceToken(_governanceToken);
        authorizedExecutors[msg.sender] = true;
    }
    
    /**
     * @dev Create a new governance proposal
     * @param title Proposal title
     * @param description Proposal description
     * @param updates Array of parameter updates
     */
    function propose(
        string calldata title,
        string calldata description,
        ParameterUpdate[] calldata updates
    ) external returns (uint256) {
        require(governanceToken.balanceOf(msg.sender) >= proposalThreshold, "Insufficient voting power");
        
        uint256 proposalId = ++proposalCount; // Increment first to start from 1

        uint256 startTime_ = block.timestamp + votingDelay;
        uint256 endTime_ = startTime_ + votingPeriod;
        // startTime_ <= endTime_ always, so bounding endTime_ bounds both casts below
        if (endTime_ > type(uint40).max) revert ValueTooLarge();

        Proposal storage proposal = _proposals[proposalId];

        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.title = title;
        proposal.description = description;
        proposal.startTime = uint40(startTime_);
        proposal.endTime = uint40(endTime_);
        // executed, canceled, totalForVotes and totalAgainstVotes are deliberately not written.
        // proposalId comes from ++proposalCount so it is never reused, meaning the struct is always
        // fresh and those fields are already zero. Writing zero over zero cost gas for nothing, and
        // now that executed/canceled share a slot with proposer it cost a read-modify-write too.

        proposalSnapshotBlock[proposalId] = block.number - 1;

        // commit to the exact actions being voted on
        proposalActionsHash[proposalId] = keccak256(abi.encode(updates));

        emit ProposalCreated(proposalId, msg.sender, title, proposal.startTime, proposal.endTime);
        
        return proposalId;
    }
    
    /**
     * @dev Vote on a proposal
     * @param proposalId Proposal ID
     * @param support True for yes, false for no
     */
    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = _proposals[proposalId];
        
        if (proposal.id == 0 || proposalId == 0) revert ProposalNotFound();
        if (proposal.canceled) revert ProposalAlreadyCanceled();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp < proposal.startTime || block.timestamp > proposal.endTime) {
            revert ProposalNotActive();
        }
        
        uint256 votingPower = governanceToken.getPastVotes(msg.sender, proposalSnapshotBlock[proposalId]);
        if (votingPower == 0) revert InsufficientVotingPower();
        
        if (proposal.hasVoted[msg.sender]) {
            // Remove previous vote
            uint256 previousForVotes = userForVotes[proposalId][msg.sender];
            uint256 previousAgainstVotes = userAgainstVotes[proposalId][msg.sender];
            
            if (previousForVotes > 0) {
                proposal.totalForVotes -= previousForVotes;
                userForVotes[proposalId][msg.sender] = 0;
            }
            if (previousAgainstVotes > 0) {
                proposal.totalAgainstVotes -= previousAgainstVotes;
                userAgainstVotes[proposalId][msg.sender] = 0;
            }
        }
        
        proposal.hasVoted[msg.sender] = true;
        
        if (support) {
            userForVotes[proposalId][msg.sender] = votingPower;
            proposal.totalForVotes += votingPower;
        } else {
            userAgainstVotes[proposalId][msg.sender] = votingPower;
            proposal.totalAgainstVotes += votingPower;
        }
        
        emit VoteCast(msg.sender, proposalId, support, votingPower);
    }
    
    /**
     * @dev Queue a successful proposal for execution after the timelock delay
     * @notice This is the first half of execution. It commits the proposal to an eta and
     *         publishes it, giving anyone who disagrees a window to react before the actions
     *         land. The proposer or the owner can still cancel during that window.
     * @param proposalId Proposal ID
     * @param updates Array of parameter updates, must match what was proposed
     */
    function queue(uint256 proposalId, ParameterUpdate[] calldata updates) external {
        require(authorizedExecutors[msg.sender], "Unauthorized executor");

        _requirePassed(proposalId, updates);

        // Re-queueing is allowed once, and only once, the previous window has lapsed. Without
        // this a proposal that passed but missed its grace period would be permanently dead
        // with no path back: it can never execute, and cancel() is not a fix. Inside a live
        // window it stays refused, so a queue cannot be used to reset an eta voters are
        // already counting down.
        uint256 currentEta = proposalEta[proposalId];
        if (currentEta != 0 && block.timestamp <= currentEta + executionGracePeriod) {
            revert ProposalAlreadyQueued();
        }

        // The eta is fixed at queue time. A later updateTimelockParameters call moves the delay
        // for proposals queued after it, never for one already in flight, so an owner cannot
        // stretch or collapse a window that voters are already watching.
        uint256 eta = block.timestamp + executionDelay;
        proposalEta[proposalId] = eta;

        emit ProposalQueued(proposalId, eta, eta + executionGracePeriod);
    }

    /**
     * @dev Execute a queued proposal once its timelock has elapsed
     * @param proposalId Proposal ID
     * @param updates Array of parameter updates to execute
     */
    function execute(uint256 proposalId, ParameterUpdate[] calldata updates) external {
        require(authorizedExecutors[msg.sender], "Unauthorized executor");

        // Re-checked rather than trusted from queue time. Votes are frozen once the voting
        // period ends, but cancel() is not: a proposal can be queued and then canceled inside
        // the delay, which is the entire point of having the delay.
        _requirePassed(proposalId, updates);

        uint256 eta = proposalEta[proposalId];
        if (eta == 0) revert ProposalNotQueued();
        if (block.timestamp < eta) revert TimelockNotExpired();
        // Grace period is read live rather than snapshotted with the eta: it only ever bounds
        // how long a passed proposal stays landable, and a proposal sitting unexecuted past its
        // window should be re-queued against current parameters, not grandfathered in.
        if (block.timestamp > eta + executionGracePeriod) revert ProposalStale();

        _proposals[proposalId].executed = true;

        // Execute parameter updates
        for (uint256 i = 0; i < updates.length; i++) {
            _executeParameterUpdate(updates[i]);
        }

        emit ProposalExecuted(proposalId);
    }

    /**
     * @dev Shared eligibility check for queue() and execute()
     * @notice Everything that makes a proposal executable except the timelock itself: it exists,
     *         it is live, voting is over, the actions match what was voted on, and it passed.
     */
    function _requirePassed(uint256 proposalId, ParameterUpdate[] calldata updates) internal view {
        Proposal storage proposal = _proposals[proposalId];

        if (proposal.id == 0) revert ProposalNotFound();
        if (proposal.canceled) revert ProposalAlreadyCanceled();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp <= proposal.endTime) revert ProposalNotActive();

        // Executed actions must match what was proposed and voted on
        require(keccak256(abi.encode(updates)) == proposalActionsHash[proposalId], "Actions mismatch");

        // Check if proposal passed
        require(proposal.totalForVotes > proposal.totalAgainstVotes, "Proposal did not pass");
        require(proposal.totalForVotes >= quorumVotes, "Quorum not met");
    }

    /**
     * @dev Cancel a proposal (only proposer or owner)
     * @param proposalId Proposal ID
     */
    function cancel(uint256 proposalId) external {
        Proposal storage proposal = _proposals[proposalId];
        
        if (proposal.id == 0 || proposalId == 0) revert ProposalNotFound();
        if (proposal.canceled) revert ProposalAlreadyCanceled();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        
        require(
            msg.sender == proposal.proposer || msg.sender == owner(),
            "Not authorized to cancel"
        );
        
        proposal.canceled = true;
        // Clear any pending eta. The canceled flag alone would already stop execute(), but a
        // stale eta left behind would keep reading as "queued" to every view and indexer, and
        // it makes cancel-then-nothing indistinguishable from cancel-mid-timelock on chain.
        if (proposalEta[proposalId] != 0) delete proposalEta[proposalId];
        emit ProposalCanceled(proposalId);
    }
    
    /**
     * @dev Get proposal details
     * @param proposalId Proposal ID
     * @return id Proposal ID
     * @return proposer Proposer address
     * @return title Proposal title
     * @return description Proposal description
     * @return startTime Start time
     * @return endTime End time
     * @return forVotes For votes
     * @return againstVotes Against votes
     * @return executed Whether executed
     * @return canceled Whether canceled
     */
    function getProposal(uint256 proposalId) external view returns (
        uint256 id,
        address proposer,
        string memory title,
        string memory description,
        uint256 startTime,
        uint256 endTime,
        uint256 forVotes,
        uint256 againstVotes,
        bool executed,
        bool canceled
    ) {
        return _proposalView(proposalId);
    }

    /**
     * @dev Proposal storage accessor, ABI-identical to the public mapping getter this replaces.
     * @notice `_proposals` is internal so the Proposal struct can be repacked freely. This getter
     *         keeps the external surface unchanged: same name, same tuple order, same uint256
     *         widths as the auto-generated getter returned before the packing pass.
     * @param proposalId Proposal ID
     */
    function proposals(uint256 proposalId) external view returns (
        uint256 id,
        address proposer,
        string memory title,
        string memory description,
        uint256 startTime,
        uint256 endTime,
        uint256 totalForVotes,
        uint256 totalAgainstVotes,
        bool executed,
        bool canceled
    ) {
        return _proposalView(proposalId);
    }

    /**
     * @dev Shared read path for getProposal and proposals, so the two views cannot drift apart.
     *      The narrowed uint40 timestamps widen back to uint256 on return.
     */
    function _proposalView(uint256 proposalId) internal view returns (
        uint256,
        address,
        string memory,
        string memory,
        uint256,
        uint256,
        uint256,
        uint256,
        bool,
        bool
    ) {
        Proposal storage proposal = _proposals[proposalId];
        return (
            proposal.id,
            proposal.proposer,
            proposal.title,
            proposal.description,
            proposal.startTime,
            proposal.endTime,
            proposal.totalForVotes,
            proposal.totalAgainstVotes,
            proposal.executed,
            proposal.canceled
        );
    }
    
    /**
     * @dev Check if user has voted on a proposal
     * @param proposalId Proposal ID
     * @param voter Voter address
     * @return hasVoted Whether user has voted
     * @return forVoteAmount Number of votes cast for the proposal
     * @return againstVoteAmount Number of votes cast against the proposal
     */
    function getVote(uint256 proposalId, address voter) external view returns (bool hasVoted, uint256 forVoteAmount, uint256 againstVoteAmount) {
        Proposal storage proposal = _proposals[proposalId];
        return (
            proposal.hasVoted[voter], 
            userForVotes[proposalId][voter], 
            userAgainstVotes[proposalId][voter]
        );
    }
    
    /**
     * @dev Get voting power for a user at a specific block
     * @param account User address
     * @param blockNumber Block number
     * @return votingPower Voting power
     */
    function getVotingPower(address account, uint256 blockNumber) external view returns (uint256 votingPower) {
        return governanceToken.getPastVotes(account, blockNumber);
    }
    
    /**
     * @dev Update governance parameters (only owner)
     * @param _votingDelay New voting delay
     * @param _votingPeriod New voting period
     * @param _proposalThreshold New proposal threshold
     * @param _quorumVotes New quorum requirement
     */
    function updateGovernanceParameters(
        uint256 _votingDelay,
        uint256 _votingPeriod,
        uint256 _proposalThreshold,
        uint256 _quorumVotes
    ) external onlyOwner {
        // Fail fast on a value that could never produce a storable startTime/endTime.
        // propose() re-checks the actual computed endTime, which is the authoritative guard.
        if (_votingDelay > type(uint40).max || _votingPeriod > type(uint40).max) revert ValueTooLarge();
        votingDelay = _votingDelay;
        votingPeriod = _votingPeriod;
        proposalThreshold = _proposalThreshold;
        quorumVotes = _quorumVotes;
    }
    
    /**
     * @dev Update timelock parameters (only owner)
     * @notice Kept off updateGovernanceParameters on purpose: that signature is part of the
     *         legacy ABI and consumers built against it should keep compiling.
     * @param _executionDelay Seconds between queueing and the earliest execution
     * @param _executionGracePeriod Seconds after the eta during which execution stays possible
     */
    function updateTimelockParameters(
        uint256 _executionDelay,
        uint256 _executionGracePeriod
    ) external onlyOwner {
        if (_executionDelay > MAX_EXECUTION_DELAY) revert InvalidTimelockParameters();
        if (
            _executionGracePeriod < MIN_EXECUTION_GRACE_PERIOD ||
            _executionGracePeriod > MAX_EXECUTION_GRACE_PERIOD
        ) revert InvalidTimelockParameters();

        executionDelay = _executionDelay;
        executionGracePeriod = _executionGracePeriod;

        emit TimelockParametersUpdated(_executionDelay, _executionGracePeriod);
    }

    /**
     * @dev Authorize an executor
     * @param executor Executor address
     * @param authorized Whether to authorize
     */
    function setExecutor(address executor, bool authorized) external onlyOwner {
        authorizedExecutors[executor] = authorized;
    }

    /**
     * @dev Describe where a proposal sits relative to its timelock
     * @notice The answer to "can this be executed right now, and if not, when". Written for a
     *         dashboard: every field is readable without a second call, and an unqueued or
     *         terminal proposal reports zeros rather than a misleading window.
     * @param proposalId Proposal ID
     * @return eta Earliest execution timestamp, 0 if not queued
     * @return expiresAt Last execution timestamp, 0 if not queued
     * @return queued Whether the proposal is queued and still cancelable or executable
     * @return ready Whether execute() would pass its timelock checks at this block
     * @return expired Whether the grace period has already elapsed
     */
    function getExecutionWindow(uint256 proposalId) external view returns (
        uint256 eta,
        uint256 expiresAt,
        bool queued,
        bool ready,
        bool expired
    ) {
        Proposal storage proposal = _proposals[proposalId];
        eta = proposalEta[proposalId];

        // A canceled or executed proposal is never actionable again, so it reports as unqueued
        // regardless of what is left in storage.
        if (eta == 0 || proposal.canceled || proposal.executed) {
            return (0, 0, false, false, false);
        }

        expiresAt = eta + executionGracePeriod;
        queued = true;
        expired = block.timestamp > expiresAt;
        ready = block.timestamp >= eta && !expired;
    }
    
    /**
     * @dev Map a governed parameter to the function that changes it
     * @notice The dispatch table. A ParameterType resolves to exactly one selector and one
     *         argument length, and nothing else in this contract can produce a selector, so the
     *         set of calls governance is capable of making is fully enumerated right here.
     *
     *         `argBytes` is enforced rather than assumed. Solidity's ABI decoder ignores trailing
     *         calldata, so without a length check a proposal could carry arbitrary extra bytes
     *         that hash into proposalActionsHash, survive review as "32 bytes of uint256", and
     *         mean nothing on execution. Requiring the exact length makes the committed hash a
     *         commitment to the call and only the call. Under-length calldata already reverts in
     *         the target's decoder, but failing here gives the honest error.
     *
     *         ProtocolFee and MaxInstallments resolve to nothing: neither names a parameter that
     *         exists in the v2 contracts today. They stay in the enum because removing them would
     *         renumber every entry after them (see the enum), and a proposal naming one reverts
     *         with UnsupportedParameterType rather than being quietly accepted and silently doing
     *         nothing, which is what the old stub did for every type.
     *
     *         The table names functions, not contracts. Nothing here says which address a
     *         selector belongs on, because that is the allowlist's job: `setParameterAllowed`
     *         binds a type to one target, so pointing AuthorizedOracle at RelicPay is refused by
     *         the allowlist rather than by a special case in here.
     *
     * @param paramType Parameter type to resolve
     * @return selector Function selector to call on the target
     * @return argBytes Exact expected length of ParameterUpdate.data
     */
    function paramSelector(ParameterType paramType) public pure returns (bytes4 selector, uint256 argBytes) {
        // RelicPay
        if (paramType == ParameterType.CreditLimitRatio) {
            return (bytes4(keccak256("setCreditLimitRatio(uint256)")), 32);
        }
        if (paramType == ParameterType.GracePeriod) {
            return (bytes4(keccak256("setDefaultGracePeriod(uint256)")), 32);
        }
        if (paramType == ParameterType.MinimumCollateral) {
            return (bytes4(keccak256("setMinCollateralAmount(uint256)")), 32);
        }
        if (paramType == ParameterType.YieldRate) {
            return (bytes4(keccak256("setYieldRate(address,uint256)")), 64);
        }
        if (paramType == ParameterType.AuthorizedToken) {
            return (bytes4(keccak256("authorizeToken(address,bool)")), 64);
        }
        if (paramType == ParameterType.AuthorizedNFT) {
            return (bytes4(keccak256("authorizeNFT(address,bool)")), 64);
        }
        // PriceOracle
        if (paramType == ParameterType.AuthorizedOracle) {
            return (bytes4(keccak256("setOracleAuthorized(address,bool)")), 64);
        }
        if (paramType == ParameterType.MaxPriceAge) {
            return (bytes4(keccak256("updateMaxPriceAge(address,uint256)")), 64);
        }
        // DeFiIntegration
        if (paramType == ParameterType.AuthorizedProtocol) {
            return (bytes4(keccak256("setProtocolAuthorized(address,bool,uint256)")), 96);
        }
        if (paramType == ParameterType.ProtocolAPY) {
            return (bytes4(keccak256("updateProtocolAPY(address,uint256)")), 64);
        }
        revert UnsupportedParameterType();
    }

    /**
     * @dev Allow or forbid governance calling a specific function on a specific contract
     * @notice Owner-managed and deliberately not itself governable. A governance system that can
     *         extend its own reach by proposal has no allowlist, only a delay.
     * @param target Contract governance may call
     * @param selector Function selector on that contract
     * @param allowed Whether to allow it
     */
    function setActionAllowed(address target, bytes4 selector, bool allowed) external onlyOwner {
        if (target == address(0) || target == address(this)) revert InvalidTarget();
        allowedActions[target][selector] = allowed;
        emit ActionAllowanceUpdated(target, selector, allowed);
    }

    /**
     * @dev Allow or forbid a whole ParameterType against one target, resolving the selector here
     * @notice Convenience over setActionAllowed for the common case, so an operator allowlisting
     *         "RelicPay may have its credit ratio governed" never has to hand-compute a selector
     *         and cannot allowlist one that no ParameterType maps to.
     * @param target Contract governance may call
     * @param paramType Parameter type to allow
     * @param allowed Whether to allow it
     */
    function setParameterAllowed(address target, ParameterType paramType, bool allowed) external onlyOwner {
        if (target == address(0) || target == address(this)) revert InvalidTarget();
        (bytes4 selector, ) = paramSelector(paramType);
        allowedActions[target][selector] = allowed;
        emit ActionAllowanceUpdated(target, selector, allowed);
    }

    /**
     * @dev Check whether one parameter update would be executable, without executing it
     * @notice Every reason execute() can reject an action, answerable before the proposal is even
     *         written. Anything a proposer gets wrong here is otherwise discovered days later, at
     *         the end of a timelock, by a whole-proposal revert.
     * @param update Parameter update to check
     * @return ok Whether this update would pass the dispatch checks
     * @return selector Selector the update resolves to, 0 if the type is unsupported
     * @return reason Empty if ok, otherwise a short machine-readable cause
     */
    function checkParameterUpdate(ParameterUpdate calldata update)
        external
        view
        returns (bool ok, bytes4 selector, string memory reason)
    {
        uint256 argBytes;
        // paramSelector reverts on an unsupported type; catching it here keeps this a pure view
        // that always answers instead of one that reverts on exactly the input worth asking about.
        try this.paramSelector(update.paramType) returns (bytes4 sel, uint256 len) {
            selector = sel;
            argBytes = len;
        } catch {
            return (false, bytes4(0), "unsupported parameter type");
        }

        if (!allowedActions[update.target][selector]) return (false, selector, "action not allowed");
        if (update.data.length != argBytes) return (false, selector, "invalid parameter data");
        return (true, selector, "");
    }

    /**
     * @dev Internal function to execute parameter updates
     * @notice Resolves the selector from the parameter type, checks the allowlist and the argument
     *         length, then makes the call. The event is emitted after the call succeeds, not
     *         before: previously it was the entire implementation, so a ParameterUpdated log meant
     *         "a vote happened". It now means the parameter actually moved.
     * @param update Parameter update to execute
     */
    function _executeParameterUpdate(ParameterUpdate memory update) internal {
        (bytes4 selector, uint256 argBytes) = paramSelector(update.paramType);

        if (!allowedActions[update.target][selector]) revert ActionNotAllowed();
        if (update.data.length != argBytes) revert InvalidParameterData();

        (bool success, ) = update.target.call(abi.encodePacked(selector, update.data));
        if (!success) revert ExecutionFailed();

        emit ParameterUpdated(update.paramType, update.target, update.data);
    }

    /**
     * @dev Get current proposal count
     * @return count Number of proposals created
     */
    function getProposalCount() external view returns (uint256 count) {
        return proposalCount;
    }
    
    /**
     * @dev Check if a proposal is active
     * @param proposalId Proposal ID
     * @return active Whether proposal is active
     */
    function isProposalActive(uint256 proposalId) external view returns (bool active) {
        Proposal storage proposal = _proposals[proposalId];
        return (
            proposal.id != 0 &&
            proposalId != 0 &&
            !proposal.canceled &&
            !proposal.executed &&
            block.timestamp >= proposal.startTime &&
            block.timestamp <= proposal.endTime
        );
    }
}
