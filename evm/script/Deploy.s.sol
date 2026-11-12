// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/Bnpl.sol";

/// @notice Adapted from legacy script/Deploy.s.sol. Import path moved from src/
/// to contracts/ for v2; contract name and constructor are unchanged.
contract DeployScript is Script {
    function run() external returns (Bnpl bnpl) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying Bnpl v2 with the account:", deployer);
        console.log("Account balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        bnpl = new Bnpl();

        vm.stopBroadcast();

        console.log("Bnpl contract deployed at:", address(bnpl));
        console.log("To verify on Etherscan, run:");
        console.log("forge verify-contract", vm.toString(address(bnpl)), "contracts/Bnpl.sol:Bnpl --etherscan-api-key $ETHERSCAN_API_KEY --chain sepolia");
    }
}
