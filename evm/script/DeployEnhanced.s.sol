// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/EnhancedBnpl.sol";

/// @notice Adapted from legacy script/DeployEnhanced.s.sol. Import path moved
/// from src/ to contracts/ for v2; contract name and constructor are unchanged.
contract DeployEnhancedScript is Script {
    function run() external returns (EnhancedBnpl enhancedBnpl) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying Enhanced BNPL v2 with the account:", deployer);
        console.log("Account balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        enhancedBnpl = new EnhancedBnpl();

        vm.stopBroadcast();

        console.log("Enhanced BNPL contract deployed at:", address(enhancedBnpl));
        console.log("To verify on Etherscan, run:");
        console.log("forge verify-contract", vm.toString(address(enhancedBnpl)), "contracts/EnhancedBnpl.sol:EnhancedBnpl --etherscan-api-key $ETHERSCAN_API_KEY --chain sepolia");

        console.log("\n=== Enhanced BNPL v2 fixes over v1 ===");
        console.log("- withdrawCollateral blocked below required credit backing (V1-BUG-2 fixed)");
        console.log("- Credit lines recomputed from live collateral (V1-BUG-3 fixed)");
    }
}
