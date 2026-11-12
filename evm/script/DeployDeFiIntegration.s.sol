// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/DeFiIntegration.sol";

/// @notice Adapted from legacy script/DeployDeFiIntegration.s.sol. Import path
/// moved from src/ to contracts/ for v2; contract name and constructor are
/// unchanged. Still a simulator: real Lido/Aave/Compound adapters are Phase 2.
contract DeployDeFiIntegration is Script {
    function run() external returns (DeFiIntegration defiIntegration) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying DeFiIntegration v2 with account:", deployer);
        console.log("Account balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        defiIntegration = new DeFiIntegration();

        console.log("DeFiIntegration deployed to:", address(defiIntegration));
        console.log("Lido stETH address:", defiIntegration.LIDO_STETH());
        console.log("Aave V3 Pool address:", defiIntegration.AAVE_V3_POOL());
        console.log("Compound ETH address:", defiIntegration.COMPOUND_ETH());
        console.log("WETH address:", defiIntegration.WETH());

        vm.stopBroadcast();

        console.log("DeFi Integration deployment completed!");
        console.log("Authorized protocols (simulated yield):");
        console.log("- Lido (stETH): 5% APY");
        console.log("- Aave V3: 3% APY");
        console.log("- Compound: 2.5% APY");
    }
}
