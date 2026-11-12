// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITimelockDelay {
    function getMinDelay() external view returns (uint256);
}

/// @title RelicGoverned
/// @notice Governance for the Base contracts. Every parameter change goes through `governance`,
///         which must be a timelock (OpenZeppelin TimelockController) whose minimum delay is at
///         least 2 days. This keeps the 2-day governance timelock from the EVM v2 code, but closes
///         the v2 gap where `Governable` let the owner bypass the timelock entirely: there is no
///         owner here.
///
///         `guardian` is an emergency key that can only pause. Unpausing, and everything else,
///         waits out the timelock. Solana has no on-chain timelock; the parity rule there is that
///         the governance authority is a Squads multisig with a 2-day time lock (CHAIN_PARITY.md).
abstract contract RelicGoverned {
    uint256 public constant MIN_GOVERNANCE_DELAY = 2 days;

    address public governance;
    address public guardian;

    event GovernanceUpdated(address indexed previousGovernance, address indexed newGovernance);
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);

    error Unauthorized();
    error GovernanceDelayTooShort(uint256 delay);

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    modifier onlyGuardianOrGovernance() {
        if (msg.sender != governance && (guardian == address(0) || msg.sender != guardian)) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address governance_, address guardian_) {
        _requireTimelock(governance_);
        governance = governance_;
        guardian = guardian_;
        emit GovernanceUpdated(address(0), governance_);
        emit GuardianUpdated(address(0), guardian_);
    }

    /// @notice Hand governance to a new timelock. The new one must also enforce 2 days or more.
    function setGovernance(address newGovernance) external onlyGovernance {
        _requireTimelock(newGovernance);
        emit GovernanceUpdated(governance, newGovernance);
        governance = newGovernance;
    }

    /// @notice Appoint or remove (address(0)) the pause-only guardian.
    function setGuardian(address newGuardian) external onlyGovernance {
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    function _requireTimelock(address timelock) internal view {
        if (timelock.code.length == 0) revert GovernanceDelayTooShort(0);
        uint256 delay = ITimelockDelay(timelock).getMinDelay();
        if (delay < MIN_GOVERNANCE_DELAY) revert GovernanceDelayTooShort(delay);
    }
}
