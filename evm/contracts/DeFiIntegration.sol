// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Governable.sol";

// DeFi Protocol Interfaces
interface ILido {
    function submit(address _referral) external payable returns (uint256);
    function sharesOf(address _account) external view returns (uint256);
    function getTotalShares() external view returns (uint256);
    function getTotalPooledEther() external view returns (uint256);
    function balanceOf(address _account) external view returns (uint256);
}

interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getUserAccountData(address user) external view returns (
        uint256 totalCollateralETH,
        uint256 totalDebtETH,
        uint256 availableBorrowsETH,
        uint256 currentLiquidationThreshold,
        uint256 ltv,
        uint256 healthFactor
    );
}

interface ICompound {
    function mint() external payable;
    function redeem(uint256 redeemTokens) external returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function exchangeRateStored() external view returns (uint256);
}

/**
 * @title DeFiIntegration
 * @dev SIMULATOR: Integrates RelicPay with major DeFi protocols for yield generation
 * @notice This contract SIMULATES staking, lending, and other DeFi operations for demo purposes
 * @notice In production, this would integrate with real protocols like Lido, Aave, and Compound
 * @notice Governable (part b2): the protocol whitelist and the APY table are protocol parameters
 *         and are reachable by governance proposal. Governable extends Ownable, so the owner keeps
 *         every power it had. emergencyWithdraw stays onlyOwner: it moves funds rather than
 *         setting a parameter, and putting it behind a 2 day timelock would be a downgrade in
 *         exactly the situation it exists for.
 */
contract DeFiIntegration is Governable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Protocol Addresses (Mainnet)
    address public constant LIDO_STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address public constant AAVE_V3_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address public constant COMPOUND_ETH = 0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5;
    
    // WETH address for Aave
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // Yield tracking
    // protocol + timestamp + apy share one storage slot (20 + 5 + 4 = 29 bytes); asset gets its
    // own slot since 3 leftover bytes can't fit another address; amount/shares stay full uint256
    // since they are wei amounts with no safe bound to truncate to.
    struct YieldPosition {
        address protocol;
        uint40 timestamp;
        uint32 apy; // Annual percentage yield (basis points)
        address asset;
        uint256 amount;
        uint256 shares;
    }

    mapping(address => YieldPosition[]) public userYieldPositions;
    mapping(address => uint256) public totalYieldEarned;
    
    // Protocol configurations
    mapping(address => bool) public authorizedProtocols;
    mapping(address => uint256) public protocolAPYs; // Basis points (100 = 1%)
    
    // Events
    event YieldPositionCreated(address indexed user, address protocol, address asset, uint256 amount, uint256 shares);
    event YieldPositionClosed(address indexed user, address protocol, uint256 amount, uint256 yield);
    event YieldClaimed(address indexed user, uint256 amount);
    event ProtocolAuthorized(address protocol, uint256 apy);
    event ProtocolDeauthorized(address protocol);

    // Errors
    error ValueTooLarge();
    error InvalidProtocolUpdate();

    constructor() Ownable(msg.sender) {
        // Initialize with default protocols
        _authorizeProtocol(LIDO_STETH, 500); // 5% APY for Lido
        _authorizeProtocol(AAVE_V3_POOL, 300); // 3% APY for Aave
        _authorizeProtocol(COMPOUND_ETH, 250); // 2.5% APY for Compound
        
        // IMPORTANT: This is a SIMULATOR for demo purposes
        // In production, you would integrate with real DeFi protocols
        // The actual protocol addresses and interactions would be different
    }

    /**
* @dev Stake ETH with Lido to earn stETH (simplified for demo)
     */
    function stakeWithLido() external payable nonReentrant {
        require(msg.value > 0, "No ETH provided");
        require(authorizedProtocols[LIDO_STETH], "Lido not authorized");
        
        // Simplified: just store the ETH and simulate stETH shares
        uint256 shares = msg.value; // 1:1 ratio for demo
        
        YieldPosition memory position = YieldPosition({
            protocol: LIDO_STETH,
            timestamp: uint40(block.timestamp),
            apy: uint32(protocolAPYs[LIDO_STETH]),
            asset: LIDO_STETH,
            amount: msg.value,
            shares: shares
        });
        
        userYieldPositions[msg.sender].push(position);
        
        emit YieldPositionCreated(msg.sender, LIDO_STETH, LIDO_STETH, msg.value, shares);
    }

    /**
     * @dev Supply ETH to Aave V3
     */
    function supplyToAave() external payable nonReentrant {
        require(msg.value > 0, "No ETH provided");
        require(authorizedProtocols[AAVE_V3_POOL], "Aave not authorized");
        
        // Convert ETH to WETH first (simplified - in production, use WETH contract)
        // For demo purposes, we'll simulate this
        
        YieldPosition memory position = YieldPosition({
            protocol: AAVE_V3_POOL,
            timestamp: uint40(block.timestamp),
            apy: uint32(protocolAPYs[AAVE_V3_POOL]),
            asset: WETH,
            amount: msg.value,
            shares: msg.value // Simplified
        });
        
        userYieldPositions[msg.sender].push(position);
        
        emit YieldPositionCreated(msg.sender, AAVE_V3_POOL, WETH, msg.value, msg.value);
    }

    /**
     * @dev Supply ETH to Compound (simplified for demo)
     */
    function supplyToCompound() external payable nonReentrant {
        require(msg.value > 0, "No ETH provided");
        require(authorizedProtocols[COMPOUND_ETH], "Compound not authorized");
        
        // Simplified: just store the ETH and simulate cToken shares
        uint256 cTokenBalance = msg.value; // 1:1 ratio for demo
        
        YieldPosition memory position = YieldPosition({
            protocol: COMPOUND_ETH,
            timestamp: uint40(block.timestamp),
            apy: uint32(protocolAPYs[COMPOUND_ETH]),
            asset: COMPOUND_ETH,
            amount: msg.value,
            shares: cTokenBalance
        });
        
        userYieldPositions[msg.sender].push(position);
        
        emit YieldPositionCreated(msg.sender, COMPOUND_ETH, COMPOUND_ETH, msg.value, cTokenBalance);
    }

    /**
     * @dev Close a yield position and claim rewards
     */
    function closeYieldPosition(uint256 positionIndex) external nonReentrant {
        require(positionIndex < userYieldPositions[msg.sender].length, "Invalid position index");
        
        YieldPosition storage position = userYieldPositions[msg.sender][positionIndex];
        require(position.amount > 0, "Position already closed");
        
        uint256 currentValue = _getCurrentValue(position);
        uint256 yield = currentValue > position.amount ? currentValue - position.amount : 0;
        uint256 totalToTransfer = position.amount + yield;
        
        // Transfer funds back to user (simplified for demo)
        require(address(this).balance >= totalToTransfer, "Insufficient contract balance");
        (bool ok, ) = payable(msg.sender).call{value: totalToTransfer}("");
        require(ok, "ETH transfer failed");
        
        totalYieldEarned[msg.sender] += yield;
        
        // Store original values for event emission before clearing
        uint256 originalAmount = position.amount;
        address protocol = position.protocol;
        
        // Mark position as closed
        position.amount = 0;
        position.shares = 0;
        
        emit YieldPositionClosed(msg.sender, protocol, originalAmount, yield);
    }

    /**
     * @dev Get current value of a yield position
     */
    function getPositionValue(address user, uint256 positionIndex) external view returns (uint256) {
        require(positionIndex < userYieldPositions[user].length, "Invalid position index");
        
        YieldPosition memory position = userYieldPositions[user][positionIndex];
        return _getCurrentValue(position);
    }

    /**
     * @dev Get all yield positions for a user
     */
    function getUserYieldPositions(address user) external view returns (YieldPosition[] memory) {
        return userYieldPositions[user];
    }

    /**
     * @dev Get total yield earned by a user
     */
    function getTotalYieldEarned(address user) external view returns (uint256) {
        return totalYieldEarned[user];
    }

    /**
     * @dev Calculate projected yield for a given amount and protocol
     */
    function calculateProjectedYield(uint256 amount, address protocol, uint256 timeInSeconds) external view returns (uint256) {
        require(authorizedProtocols[protocol], "Protocol not authorized");
        
        uint256 apy = protocolAPYs[protocol];
        uint256 secondsInYear = 365 * 24 * 60 * 60;
        
        return (amount * apy * timeInSeconds) / (secondsInYear * 10000);
    }

    /**
     * @dev Authorize a new DeFi protocol
     */
    function authorizeProtocol(address protocol, uint256 apy) external onlyOwner {
        _authorizeProtocol(protocol, apy);
    }

    /**
     * @dev Deauthorize a DeFi protocol
     */
    function deauthorizeProtocol(address protocol) external onlyOwner {
        _deauthorizeProtocol(protocol);
    }

    /**
     * @dev Authorize or deauthorize a protocol in one call
     * @notice The governable form of the pair above, and the only one the dispatch table can
     *         reach. Three arguments rather than two because authorizing a protocol is
     *         meaningless without the APY it is authorized at: `authorizeProtocol` has always
     *         taken both, and a two-argument version would either invent a default rate or
     *         require a second proposal to make the first one usable.
     *
     *         Deauthorizing must pass apy == 0. The field is unread on that path, so an
     *         unchecked one would let two byte-different proposals produce identical effects
     *         while hashing differently, and the extra number would sit in the committed
     *         actions looking like it meant something. Rejecting it keeps the hash a
     *         commitment to the effect, not just to the encoding.
     * @param protocol Protocol address
     * @param authorized Whether the protocol may be staked into
     * @param apy Annual yield in basis points, must be 0 when deauthorizing
     */
    function setProtocolAuthorized(address protocol, bool authorized, uint256 apy) external onlyGovernance {
        if (!authorized && apy != 0) revert InvalidProtocolUpdate();
        if (authorized) {
            _authorizeProtocol(protocol, apy);
        } else {
            _deauthorizeProtocol(protocol);
        }
    }

    /**
     * @dev Update APY for a protocol
     * @notice Widened from onlyOwner to onlyGovernance. The rate a protocol accrues at is the
     *         clearest example of a number token holders should be able to move, and it is
     *         bounded and reversible, so the timelock is protection enough.
     */
    function updateProtocolAPY(address protocol, uint256 newAPY) external onlyGovernance {
        require(authorizedProtocols[protocol], "Protocol not authorized");
        // apy is packed into YieldPosition as uint32; bound it so that narrowing cast
        // at position-creation time can never silently truncate
        if (newAPY > type(uint32).max) revert ValueTooLarge();
        protocolAPYs[protocol] = newAPY;
        emit ProtocolAuthorized(protocol, newAPY);
    }

    /**
     * @dev Internal function to authorize a protocol
     */
    function _authorizeProtocol(address protocol, uint256 apy) internal {
        // apy is packed into YieldPosition as uint32; bound it so that narrowing cast
        // at position-creation time can never silently truncate
        if (apy > type(uint32).max) revert ValueTooLarge();
        authorizedProtocols[protocol] = true;
        protocolAPYs[protocol] = apy;
        emit ProtocolAuthorized(protocol, apy);
    }

    /**
     * @dev Internal function to deauthorize a protocol
     * @notice Shared by the owner-only entry point and the governable one so the two cannot
     *         drift. Emits ProtocolDeauthorized either way.
     */
    function _deauthorizeProtocol(address protocol) internal {
        authorizedProtocols[protocol] = false;
        protocolAPYs[protocol] = 0;
        emit ProtocolDeauthorized(protocol);
    }

    /**
     * @dev Internal function to get current value of a position
     */
    function _getCurrentValue(YieldPosition memory position) internal view returns (uint256) {
        if (position.amount == 0) return 0;
        
        uint256 timeElapsed = block.timestamp - position.timestamp;
        uint256 secondsInYear = 365 * 24 * 60 * 60;
        
        // Calculate yield based on APY and time elapsed
        uint256 yield = (position.amount * position.apy * timeElapsed) / (secondsInYear * 10000);
        
        return position.amount + yield;
    }

    /**
     * @dev Get simulator status and information
     */
    function getSimulatorInfo() external pure returns (
        bool isSimulator,
        string memory description,
        string memory warning
    ) {
        return (
            true,
            "This is a DeFi integration simulator for demo purposes",
            "DO NOT USE IN PRODUCTION - This simulates DeFi protocols but does not interact with real ones"
        );
    }

    /**
     * @dev Emergency function to withdraw stuck funds
     */
    function emergencyWithdraw() external onlyOwner {
        (bool ok, ) = payable(owner()).call{value: address(this).balance}("");
        require(ok, "ETH transfer failed");
    }

    /**
     * @dev Receive ETH
     */
    receive() external payable {}
}
