// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/RelicPayGovernance.sol";

/// @notice Adapted from legacy script/DeployRelicPayGovernance.s.sol. Import
/// path moved from src/ to contracts/ for v2; constructor still takes the
/// governance token address. Legacy hardcoded a placeholder token address;
/// v2 requires GOVERNANCE_TOKEN_ADDRESS to be set explicitly so a real token
/// is never deployed against a fake address by mistake. Governance timelock
/// wiring (Phase 2) still needs to land before this is used for real votes.
contract DeployRelicPayGovernance is Script {
    function run() external returns (RelicPayGovernance governance) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address governanceToken = vm.envAddress("GOVERNANCE_TOKEN_ADDRESS");

        console.log("Deploying RelicPayGovernance v2 with account:", deployer);
        console.log("Account balance:", deployer.balance);
        console.log("Governance token:", governanceToken);

        vm.startBroadcast(deployerPrivateKey);

        governance = new RelicPayGovernance(governanceToken);

        console.log("RelicPayGovernance deployed to:", address(governance));
        console.log("Voting delay:", governance.votingDelay());
        console.log("Voting period:", governance.votingPeriod());
        console.log("Proposal threshold:", governance.proposalThreshold());
        console.log("Quorum votes:", governance.quorumVotes());

        vm.stopBroadcast();

        console.log("RelicPay Governance v2 deployment completed!");
    }
}
