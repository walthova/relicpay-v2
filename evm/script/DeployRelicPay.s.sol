// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/RelicPay.sol";

/// @notice Adapted from the legacy DeployRelicPay script: same contract name and
/// zero-arg constructor, import path moved from src/ to contracts/ for v2.
contract DeployRelicPayScript is Script {
    function run() external returns (RelicPay relicPay) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying RelicPay v2 with the account:", deployer);
        console.log("Account balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        relicPay = new RelicPay();

        vm.stopBroadcast();

        console.log("RelicPay contract deployed at:", address(relicPay));
        console.log("To verify on Etherscan, run:");
        console.log("forge verify-contract", vm.toString(address(relicPay)), "contracts/RelicPay.sol:RelicPay --etherscan-api-key $ETHERSCAN_API_KEY --chain sepolia");

        console.log("\n=== Next steps ===");
        console.log("1. Authorize the RelicRegistry as an RWA NFT source: relicPay.authorizeNFT(registryAddress, true)");
        console.log("2. Authorize collateral tokens: relicPay.authorizeToken(tokenAddress, true)");
        console.log("3. Set yield rates: relicPay.setYieldRate(tokenAddress, rateBasisPoints)");
        console.log("4. Tune governance params: relicPay.updateGovernanceParams(...)");
        console.log("Prefer script/DeployAll.s.sol for a fresh environment; it wires steps 1 automatically.");
    }
}
