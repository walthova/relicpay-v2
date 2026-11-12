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
    struct Proposal {
        uint256 id;
        address proposer;
        string title;
        string description;
        uint256 startTime;
        uint256 endTime;
        uint256 totalForVotes;
        uint256 totalAgainstVotes;
        bool executed;
        bool canceled;
        mapping(address => bool) hasVoted;
    }
    
    // Parameter types that can be governed
    enum ParameterType {
        CreditLimitRatio,
        GracePeriod,
        MinimumCollateral,
        YieldRate,
        ProtocolFee,
        MaxInstallments,
        AuthorizedToken,
        AuthorizedNFT
    }
    
    // Parameter update structure
    struct ParameterUpdate {
        ParameterType paramType;
        address target;         // Contract address
        bytes data;            // Encoded parameter data
    }
    
    // State variables
    IGovernanceToken public governanceToken;
    uint256 public proposalCount;
    uint256 public votingDelay = 1 days;
    uint256 public votingPeriod = 3 days;
    uint256 public proposalThreshold = 1000 * 1e18; // 1000 tokens
    uint256 public quorumVotes = 10000 * 1e18; // 10000 tokens
    
    // Track votes separately for "for" and "against" to avoid underflow issues
    mapping(uint256 => mapping(address => uint256)) public userForVotes; // proposalId => voter => votes
    mapping(uint256 => mapping(address => uint256)) public userAgainstVotes; // proposalId => voter => votes
    
    mapping(uint256 => Proposal) public proposals;
    mapping(address => bool) public authorizedExecutors;
    
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
    
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);
    event ParameterUpdated(
        ParameterType indexed paramType,
        address indexed target,
        bytes data
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
        Proposal storage proposal = proposals[proposalId];
        
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.title = title;
        proposal.description = description;
        proposal.startTime = block.timestamp + votingDelay;
        proposal.endTime = block.timestamp + votingDelay + votingPeriod;
        proposal.executed = false;
        proposal.canceled = false;
        proposal.totalForVotes = 0;
        proposal.totalAgainstVotes = 0;
        
        emit ProposalCreated(proposalId, msg.sender, title, proposal.startTime, proposal.endTime);
        
        return proposalId;
    }
    
    /**
     * @dev Vote on a proposal
     * @param proposalId Proposal ID
     * @param support True for yes, false for no
     */
    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.id == 0 || proposalId == 0) revert ProposalNotFound();
        if (proposal.canceled) revert ProposalAlreadyCanceled();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp < proposal.startTime || block.timestamp > proposal.endTime) {
            revert ProposalNotActive();
        }
        
        uint256 votingPower = governanceToken.getPastVotes(msg.sender, proposal.startTime - 1);
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
     * @dev Execute a successful proposal
     * @param proposalId Proposal ID
     * @param updates Array of parameter updates to execute
     */
    function execute(uint256 proposalId, ParameterUpdate[] calldata updates) external {
        require(authorizedExecutors[msg.sender], "Unauthorized executor");
        
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.id == 0) revert ProposalNotFound();
        if (proposal.canceled) revert ProposalAlreadyCanceled();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp <= proposal.endTime) revert ProposalNotActive();
        
        // Check if proposal passed
        require(proposal.totalForVotes > proposal.totalAgainstVotes, "Proposal did not pass");
        require(proposal.totalForVotes >= quorumVotes, "Quorum not met");
        
        proposal.executed = true;
        
        // Execute parameter updates
        for (uint256 i = 0; i < updates.length; i++) {
            _executeParameterUpdate(updates[i]);
        }
        
        emit ProposalExecuted(proposalId);
    }
    
    /**
     * @dev Cancel a proposal (only proposer or owner)
     * @param proposalId Proposal ID
     */
    function cancel(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.id == 0 || proposalId == 0) revert ProposalNotFound();
        if (proposal.canceled) revert ProposalAlreadyCanceled();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        
        require(
            msg.sender == proposal.proposer || msg.sender == owner(),
            "Not authorized to cancel"
        );
        
        proposal.canceled = true;
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
        Proposal storage proposal = proposals[proposalId];
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
        Proposal storage proposal = proposals[proposalId];
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
        votingDelay = _votingDelay;
        votingPeriod = _votingPeriod;
        proposalThreshold = _proposalThreshold;
        quorumVotes = _quorumVotes;
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
     * @dev Internal function to execute parameter updates
     * @param update Parameter update to execute
     */
    function _executeParameterUpdate(ParameterUpdate memory update) internal {
        // This would contain the actual parameter update logic
        // For demo purposes, we'll just emit an event
        emit ParameterUpdated(update.paramType, update.target, update.data);
        
        // In a real implementation, this would call the appropriate contract
        // with the encoded data to update the parameter
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
        Proposal storage proposal = proposals[proposalId];
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
