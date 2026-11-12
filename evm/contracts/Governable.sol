// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Governable
 * @dev Adds a single governor address that sits beside the owner rather than replacing it.
 * @notice This is the target side of the governance wiring. The obvious way to let
 *         RelicPayGovernance change a protocol parameter is to transfer the target's ownership to
 *         the governance contract, but that is a one-way door: every owner-only function on the
 *         target, including the emergency ones, would then sit behind a multi-day timelock, and
 *         a bug in governance would lock the contract out of its own admin surface forever.
 *
 *         A governor role avoids that. The owner keeps everything it had, names a governor
 *         explicitly, and can revoke it in one transaction. `onlyGovernance` accepts either, so
 *         adopting this on an existing function widens who may call it and breaks nothing.
 *
 *         The role is deliberately a single address, not a set. A set invites the question of who
 *         curates it; one slot makes "who can move this parameter besides the owner" answerable
 *         with a single read, and the answer is almost always "the governance contract or nobody".
 */
abstract contract Governable is Ownable {
    /// @dev Address allowed to call onlyGovernance functions alongside the owner. 0 means nobody.
    address public governor;

    event GovernorUpdated(address indexed previousGovernor, address indexed newGovernor);

    error UnauthorizedGovernance();

    /**
     * @dev Restricts a call to the owner or the currently appointed governor.
     * @notice The zero-address check is not redundant with the equality check: `governor` is 0
     *         until the owner opts in, and without the guard any call from address(0) (which a
     *         node can fake in an eth_call) would read as authorized.
     */
    modifier onlyGovernance() {
        if (msg.sender != owner() && (governor == address(0) || msg.sender != governor)) {
            revert UnauthorizedGovernance();
        }
        _;
    }

    /**
     * @dev Appoint or revoke the governor (only owner)
     * @param newGovernor Address to appoint, or the zero address to revoke
     */
    function setGovernor(address newGovernor) external onlyOwner {
        address previous = governor;
        governor = newGovernor;
        emit GovernorUpdated(previous, newGovernor);
    }

    /**
     * @dev Whether an address may currently call onlyGovernance functions
     * @notice Exposed so a dashboard can tell whether a governance proposal targeting this
     *         contract could land at all, without simulating the call and reading a revert.
     * @param account Address to check
     */
    function hasGovernanceRights(address account) external view returns (bool) {
        return account == owner() || (governor != address(0) && account == governor);
    }
}
