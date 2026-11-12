// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Coinbase Spend Permissions (Base Account). Struct and function signatures copied from
///         github.com/coinbase/spend-permissions src/SpendPermissionManager.sol (read 2026-11-12).
///         Deployed at 0xf85210B21cC50302F477BA56686d2019dC9b67Ad on Base and Base Sepolia.
struct SpendPermission {
    address account;
    address spender;
    address token;
    uint160 allowance;
    uint48 period;
    uint48 start;
    uint48 end;
    uint256 salt;
    bytes extraData;
}

interface ISpendPermissionManager {
    function spend(SpendPermission memory spendPermission, uint160 value) external;
    function isValid(SpendPermission memory spendPermission) external view returns (bool);
    function revokeAsSpender(SpendPermission calldata spendPermission) external;
}

/// @notice ERC-8004 (Trustless Agents, Draft). Only the calls RelicPay makes. Signatures from
///         github.com/erc-8004/erc-8004-contracts and eips.ethereum.org/EIPS/eip-8004 (read 2026-11-12).
///         The EIP is a Draft, so these may change; every call site is optional and wrapped in try/catch.
interface IERC8004Identity {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}

interface IERC8004Reputation {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}
