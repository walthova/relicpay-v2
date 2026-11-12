// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/RelicRegistry.sol";
import "../contracts/RelicPay.sol";
import "../contracts/PriceOracle.sol";
import "../contracts/DeFiIntegration.sol";
import "../contracts/RelicPayGovernance.sol";

/// @notice New for v2: one script that deploys the Phase 1 MVP tokenization
/// stack (RelicRegistry + RelicPay + PriceOracle + DeFiIntegration) and wires
/// the cross-contract permissions the demo script needs on a fresh Sepolia
/// deploy.
///
/// Governance (part b2): if GOVERNANCE_TOKEN_ADDRESS is set, this script also
/// deploys RelicPayGovernance and brings the stack up already governed, which
/// is both halves of the opt-in for all three targets: each target names the
/// governance contract as its governor, and governance allowlists exactly the
/// (target, parameter) pairs that target actually implements. Doing it here
/// rather than in a follow-up runbook is the point. Wiring governance by hand
/// after the fact is a dozen transactions across three contracts where a
/// forgotten one shows up as a proposal that passes and then reverts at the
/// end of a two day timelock.
///
/// If GOVERNANCE_TOKEN_ADDRESS is unset the script deploys the MVP stack alone
/// and says so. It is not a failure: there is no governance token on a bare
/// testnet, and an ungoverned stack is fully functional under its owner.
///
/// Target network (ADR-011): DEPLOY_NETWORK names it, "sepolia" (default) or "base-sepolia". The
/// script refuses to broadcast when block.chainid is not that network's chain id, so a stale
/// --rpc-url cannot put a Base Sepolia rehearsal on Sepolia or the reverse. The name picks the
/// output file. tools/networks.js carries the same table for the off-chain tools.
///
/// Usage:
///   forge script script/DeployAll.s.sol:DeployAllScript \
///     --rpc-url sepolia --broadcast --verify -vvvv
///   DEPLOY_NETWORK=base-sepolia forge script script/DeployAll.s.sol:DeployAllScript \
///     --rpc-url base_sepolia --broadcast --verify -vvvv
///
/// Writes deployed addresses to deployments/<DEPLOY_NETWORK>.txt (key=value per line)
/// so the demo script can read them without re-parsing broadcast logs.
contract DeployAllScript is Script {
    function run() external returns (
        RelicRegistry registry,
        RelicPay relicPay,
        PriceOracle priceOracle,
        DeFiIntegration defiIntegration,
        RelicPayGovernance governance
    ) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        // Optional. address(0) means "deploy ungoverned", which is the pre-b2 behaviour.
        address governanceToken = vm.envOr("GOVERNANCE_TOKEN_ADDRESS", address(0));
        string memory network = vm.envOr("DEPLOY_NETWORK", string("sepolia"));
        _requireChain(network);

        console.log("Network:", network);
        console.log("Deploying RelicPay v2 MVP stack with the account:", deployer);
        console.log("Account balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        registry = new RelicRegistry();
        relicPay = new RelicPay();
        priceOracle = new PriceOracle();
        defiIntegration = new DeFiIntegration();

        // Wiring for the MVP flow: mint relic -> collateral -> agreement -> payments -> ownership transfer.
        registry.setIssuer(deployer, true);
        relicPay.authorizeNFT(address(registry), true);
        // ADR-009: value non-ETH collateral in ETH wei through the oracle.
        relicPay.setPriceOracle(address(priceOracle));

        if (governanceToken != address(0)) {
            governance = new RelicPayGovernance(governanceToken);
            _wireGovernance(governance, relicPay, priceOracle, defiIntegration);
        }

        vm.stopBroadcast();

        console.log("\n=== RelicPay v2 MVP deployment complete ===");
        console.log("RelicRegistry:", address(registry));
        console.log("RelicPay:", address(relicPay));
        console.log("PriceOracle:", address(priceOracle));
        console.log("DeFiIntegration:", address(defiIntegration));
        console.log("Deployer authorized as RelicRegistry issuer");
        console.log("RelicRegistry authorized as an RWA NFT source on RelicPay");

        if (address(governance) != address(0)) {
            console.log("RelicPayGovernance:", address(governance));
            console.log("Governance token:", governanceToken);
            console.log("Governor set on RelicPay, PriceOracle and DeFiIntegration");
            console.log("Allowlisted: 6 parameters on RelicPay, 2 on PriceOracle, 2 on DeFiIntegration");
        } else {
            console.log("RelicPayGovernance: not deployed (GOVERNANCE_TOKEN_ADDRESS unset)");
            console.log("Stack is owner-controlled; re-run with the token set, or wire governance later");
        }

        string memory out = string.concat(
            "RELIC_REGISTRY=", vm.toString(address(registry)), "\n",
            "RELIC_PAY=", vm.toString(address(relicPay)), "\n",
            "PRICE_ORACLE=", vm.toString(address(priceOracle)), "\n",
            "DEFI_INTEGRATION=", vm.toString(address(defiIntegration)), "\n",
            "GOVERNANCE=", vm.toString(address(governance)), "\n",
            "DEPLOYER=", vm.toString(deployer), "\n"
        );
        string memory outPath = string.concat("deployments/", network, ".txt");
        vm.writeFile(outPath, out);
        console.log("\nAddresses written to", outPath);

        console.log("\n=== Remaining before pilot ===");
        console.log("- authorizeToken(...) for any ERC20 collateral you want to accept");
        console.log("- setYieldRate(...) if ETH default of 5% APY should change");
        console.log("- demo script: mint relic, deposit collateral, create agreement, pay installments, verify transfer");
    }

    /// @dev Only the networks tools/networks.js knows are deployable from here. Anything else, or a
    ///      chain id that does not match the name, reverts before a single transaction is sent.
    function _requireChain(string memory network) internal view {
        bytes32 h = keccak256(bytes(network));
        if (h == keccak256("sepolia")) {
            require(block.chainid == 11155111, "DEPLOY_NETWORK=sepolia but chain id is not 11155111");
        } else if (h == keccak256("base-sepolia")) {
            require(block.chainid == 84532, "DEPLOY_NETWORK=base-sepolia but chain id is not 84532");
        } else {
            revert("DEPLOY_NETWORK must be sepolia or base-sepolia");
        }
    }

    /// @dev Complete both halves of the governance opt-in for all three targets.
    /// @notice The target side (setGovernor) and the governance side (setParameterAllowed) are
    ///         separate on purpose and neither alone is enough, so this function does both or the
    ///         deploy is not actually governed. The allowlist is written per target with only the
    ///         parameters that target implements: allowlisting AuthorizedOracle against RelicPay
    ///         would resolve to a selector RelicPay does not have, and the proposal would fail at
    ///         execution rather than at review.
    function _wireGovernance(
        RelicPayGovernance governance,
        RelicPay relicPay,
        PriceOracle priceOracle,
        DeFiIntegration defiIntegration
    ) internal {
        relicPay.setGovernor(address(governance));
        priceOracle.setGovernor(address(governance));
        defiIntegration.setGovernor(address(governance));

        governance.setParameterAllowed(address(relicPay), RelicPayGovernance.ParameterType.CreditLimitRatio, true);
        governance.setParameterAllowed(address(relicPay), RelicPayGovernance.ParameterType.GracePeriod, true);
        governance.setParameterAllowed(address(relicPay), RelicPayGovernance.ParameterType.MinimumCollateral, true);
        governance.setParameterAllowed(address(relicPay), RelicPayGovernance.ParameterType.YieldRate, true);
        governance.setParameterAllowed(address(relicPay), RelicPayGovernance.ParameterType.AuthorizedToken, true);
        governance.setParameterAllowed(address(relicPay), RelicPayGovernance.ParameterType.AuthorizedNFT, true);

        governance.setParameterAllowed(address(priceOracle), RelicPayGovernance.ParameterType.AuthorizedOracle, true);
        governance.setParameterAllowed(address(priceOracle), RelicPayGovernance.ParameterType.MaxPriceAge, true);

        governance.setParameterAllowed(address(defiIntegration), RelicPayGovernance.ParameterType.AuthorizedProtocol, true);
        governance.setParameterAllowed(address(defiIntegration), RelicPayGovernance.ParameterType.ProtocolAPY, true);
    }
}
