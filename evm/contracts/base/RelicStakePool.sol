// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./RelicConstants.sol";
import "./RelicGoverned.sol";

/// @title RelicStakePool
/// @notice Base port of init_stake_pool, stake_usdc, unstake_usdc and update_pool_rate.
///         Stakers get a discount tier (0 to 4) read by the checkout extension, plus simulated
///         yield. Two audit fixes ship here and on Solana together:
///         - C-1: yield is paid only from `yieldReserve`, a separately funded balance. Staked
///           principal is never used to pay anyone else's yield, so every staker can always
///           withdraw their full principal.
///         - Rate changes are not retroactive: a global yield index is checkpointed before every
///           rate change, so a new rate only applies from the moment it lands.
///         - C-2: there is no initializer to front-run; the constructor sets everything.
contract RelicStakePool is RelicGoverned, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct UserStake {
        uint128 stakedAmount;
        uint128 yieldAccrued; // owed, paid from the reserve
        uint256 indexSnapshot; // yield index at the last settlement
        uint64 lastUpdate;
        uint8 tier;
    }

    IERC20 public immutable usdc;
    uint16 public yieldRateBps = RelicConstants.DEFAULT_YIELD_RATE_BPS;
    uint256 public totalStaked;
    uint256 public yieldReserve;
    uint256 public yieldIndex; // cumulative yield per staked unit, scaled by YIELD_INDEX_SCALE
    uint64 public lastIndexUpdate;

    mapping(address => UserStake) public stakes;

    event Staked(address indexed user, uint256 amount, uint256 newTotal, uint8 tier);
    event Unstaked(address indexed user, uint256 principal, uint256 yieldPaid, uint256 yieldStillOwed, uint256 remainingStaked, uint8 tier);
    event PoolRateUpdated(uint16 oldRateBps, uint16 newRateBps);
    event YieldReserveFunded(address indexed from, uint256 amount);

    error InvalidAmount();
    error NothingToWithdraw();
    error RateTooHigh();

    constructor(IERC20 usdc_, address governance_, address guardian_) RelicGoverned(governance_, guardian_) {
        usdc = usdc_;
        lastIndexUpdate = uint64(block.timestamp);
    }

    /// @notice Solana: stake_usdc.
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        _checkpoint();
        UserStake storage s = stakes[msg.sender];
        _settle(s);

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        s.stakedAmount += uint128(amount);
        s.lastUpdate = uint64(block.timestamp);
        s.tier = RelicConstants.computeTier(s.stakedAmount);
        totalStaked += amount;
        emit Staked(msg.sender, amount, s.stakedAmount, s.tier);
    }

    /// @notice Solana: unstake_usdc. amount 0 or above the stake means a full unstake. A full
    ///         unstake also pays accrued yield, capped at the reserve; any shortfall stays owed and
    ///         can be collected later by calling unstake again with nothing staked.
    function unstake(uint256 amount) external nonReentrant {
        UserStake storage s = stakes[msg.sender];
        if (s.stakedAmount == 0 && s.yieldAccrued == 0) revert NothingToWithdraw();
        _checkpoint();
        _settle(s);

        uint256 principal = (amount == 0 || amount > s.stakedAmount) ? s.stakedAmount : amount;
        bool full = principal == s.stakedAmount;
        uint256 yieldPaid;
        if (full) {
            yieldPaid = s.yieldAccrued < yieldReserve ? s.yieldAccrued : yieldReserve;
            s.yieldAccrued -= uint128(yieldPaid);
            yieldReserve -= yieldPaid;
        }

        s.stakedAmount -= uint128(principal);
        s.lastUpdate = uint64(block.timestamp);
        s.tier = RelicConstants.computeTier(s.stakedAmount);
        totalStaked -= principal;

        uint256 out = principal + yieldPaid;
        if (out > 0) usdc.safeTransfer(msg.sender, out);
        emit Unstaked(msg.sender, principal, yieldPaid, s.yieldAccrued, s.stakedAmount, s.tier);
    }

    /// @notice Anyone may top up the yield reserve. This is the only source of staking yield.
    function fundYieldReserve(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        yieldReserve += amount;
        emit YieldReserveFunded(msg.sender, amount);
    }

    /// @notice Solana: update_pool_rate. Capped at 20% APY, timelocked, and never retroactive.
    function updatePoolRate(uint16 newRateBps) external onlyGovernance {
        if (newRateBps > RelicConstants.MAX_YIELD_RATE_BPS) revert RateTooHigh();
        _checkpoint();
        emit PoolRateUpdated(yieldRateBps, newRateBps);
        yieldRateBps = newRateBps;
    }

    function tierOf(address user) external view returns (uint8) {
        return stakes[user].tier;
    }

    /// @notice Yield owed to `user` right now (accrued plus unsettled), before the reserve cap.
    function pendingYield(address user) external view returns (uint256) {
        UserStake storage s = stakes[user];
        uint256 index = yieldIndex + _indexDelta();
        return s.yieldAccrued + (uint256(s.stakedAmount) * (index - s.indexSnapshot)) / RelicConstants.YIELD_INDEX_SCALE;
    }

    /// @notice Principal is always covered: the balance never dips below totalStaked + reserve.
    function isSolvent() external view returns (bool) {
        return usdc.balanceOf(address(this)) >= totalStaked + yieldReserve;
    }

    function _indexDelta() internal view returns (uint256) {
        uint256 dt = block.timestamp - lastIndexUpdate;
        return (uint256(yieldRateBps) * dt * RelicConstants.YIELD_INDEX_SCALE) / (RelicConstants.BPS * RelicConstants.SECONDS_PER_YEAR);
    }

    function _checkpoint() internal {
        yieldIndex += _indexDelta();
        lastIndexUpdate = uint64(block.timestamp);
    }

    function _settle(UserStake storage s) internal {
        if (s.stakedAmount > 0) {
            uint256 earned = (uint256(s.stakedAmount) * (yieldIndex - s.indexSnapshot)) / RelicConstants.YIELD_INDEX_SCALE;
            s.yieldAccrued += uint128(earned);
        }
        s.indexSnapshot = yieldIndex;
    }
}
