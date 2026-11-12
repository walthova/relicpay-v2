// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/PriceOracle.sol";

/// @notice Adapted from legacy script/DeployPriceOracle.s.sol. Import path moved
/// from src/ to contracts/ for v2; contract name and constructor are unchanged.
contract DeployPriceOracle is Script {
    function run() external returns (PriceOracle priceOracle) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying PriceOracle v2 with account:", deployer);
        console.log("Account balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        priceOracle = new PriceOracle();

        console.log("PriceOracle deployed to:", address(priceOracle));

        address[] memory assets = priceOracle.getSupportedAssets();
        console.log("Initial supported assets:", assets.length);

        for (uint256 i = 0; i < assets.length; i++) {
            PriceOracle.AssetInfo memory info = priceOracle.getAssetInfo(assets[i]);
            console.log("Asset added:", info.symbol);
        }

        vm.stopBroadcast();

        console.log("Price Oracle deployment completed!");
        console.log("Initial assets supported:");
        console.log("- ETH (native): 18 decimals, 300s max age");
        console.log("- BTC: 8 decimals, 300s max age");
        console.log("- USDC: 6 decimals, 60s max age");
        console.log("- USDT: 6 decimals, 60s max age");
        console.log("Chainlink adapter behind this interface is Phase 2; placeholder prices are for demo only.");
    }
}
