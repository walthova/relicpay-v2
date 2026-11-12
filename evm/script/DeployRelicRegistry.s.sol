// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/RelicRegistry.sol";

/// @notice Deploys the v2 RelicRegistry, the new tokenization contract that has
/// no legacy counterpart. Sets the deployer as the first issuer so a demo relic
/// can be minted immediately after deploy; real issuers (IBG Collection, other
/// galleries) should be added with setIssuer once verified.
contract DeployRelicRegistryScript is Script {
    function run() external returns (RelicRegistry registry) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying RelicRegistry with the account:", deployer);
        console.log("Account balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        registry = new RelicRegistry();
        registry.setIssuer(deployer, true);

        vm.stopBroadcast();

        console.log("RelicRegistry deployed at:", address(registry));
        console.log("Deployer authorized as issuer:", deployer);
        console.log("To verify on Etherscan, run:");
        console.log("forge verify-contract", vm.toString(address(registry)), "contracts/RelicRegistry.sol:RelicRegistry --etherscan-api-key $ETHERSCAN_API_KEY --chain sepolia");
    }
}
