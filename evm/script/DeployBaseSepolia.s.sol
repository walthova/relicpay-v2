// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";

import "../contracts/base/RelicEscrow.sol";
import "../contracts/base/RelicStakePool.sol";
import "../contracts/base/RelicCreditLine.sol";
import "../contracts/base/RelicAgentDelegate.sol";

/// @notice Base Sepolia ONLY. Deploys the parity core behind a 2-day TimelockController and
///         schedules the wiring calls. Run the Wire step (below) once 2 days have passed.
///
///   cd evm
///   export BASE_SEPOLIA_RPC_URL=...            # your provider URL
///   export RELIC_PROPOSER=0x...                # Safe or EOA allowed to schedule (testnet: your EOA)
///   export RELIC_GUARDIAN=0x...                # pause-only key
///   forge script script/DeployBaseSepolia.s.sol:DeployBaseSepolia --rpc-url base_sepolia --broadcast --account <keystore>
///   # 2 days later:
///   forge script script/DeployBaseSepolia.s.sol:WireBaseSepolia --rpc-url base_sepolia --broadcast --account <keystore>
///
/// Nothing here has been run. The script refuses any chain other than 84532.
contract DeployBaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA = 84532;
    // Circle USDC on Base Sepolia (developers.circle.com, read 2026-11-12)
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    // Coinbase SpendPermissionManager (github.com/coinbase/spend-permissions, read 2026-11-12)
    address internal constant SPEND_PERMISSION_MANAGER = 0xf85210B21cC50302F477BA56686d2019dC9b67Ad;
    // ERC-8004 registries on Base Sepolia (github.com/erc-8004/erc-8004-contracts, read 2026-11-12). Draft EIP.
    address internal constant ERC8004_IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address internal constant ERC8004_REPUTATION = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    function run() external virtual {
        require(block.chainid == BASE_SEPOLIA, "Base Sepolia only");
        address proposer = vm.envAddress("RELIC_PROPOSER");
        address guardian = vm.envAddress("RELIC_GUARDIAN");

        vm.startBroadcast();
        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone executes once the delay has passed
        TimelockController timelock = new TimelockController(2 days, proposers, executors, address(0));

        IERC20 usdc = IERC20(USDC);
        RelicEscrow escrow = new RelicEscrow(usdc, address(timelock), guardian);
        RelicStakePool pool = new RelicStakePool(usdc, address(timelock), guardian);
        RelicCreditLine credit = new RelicCreditLine(usdc, address(timelock), guardian);
        RelicAgentDelegate delegate = new RelicAgentDelegate(usdc, escrow, credit, address(timelock), guardian);
        vm.stopBroadcast();

        string memory out = string.concat(
            "TIMELOCK=", vm.toString(address(timelock)), "\n",
            "ESCROW=", vm.toString(address(escrow)), "\n",
            "STAKE_POOL=", vm.toString(address(pool)), "\n",
            "CREDIT_LINE=", vm.toString(address(credit)), "\n",
            "AGENT_DELEGATE=", vm.toString(address(delegate)), "\n"
        );
        vm.createDir("deployments", true);
        vm.writeFile("deployments/base-sepolia.env", out);
        console.log(out);
        console.log("Next: as RELIC_PROPOSER, run ScheduleBaseSepolia, wait 2 days, run WireBaseSepolia.");
    }
}

/// @dev Shared list of the governance calls that wire the system together. Credit stays OFF.
abstract contract WiringOps is DeployBaseSepolia {
    function _ops() internal view returns (address[] memory targets, bytes[] memory datas) {
        address escrow = vm.envAddress("ESCROW");
        address credit = vm.envAddress("CREDIT_LINE");
        address delegate = vm.envAddress("AGENT_DELEGATE");
        targets = new address[](5);
        datas = new bytes[](5);
        targets[0] = escrow;
        datas[0] = abi.encodeCall(RelicEscrow.setAgentDelegate, (delegate));
        targets[1] = credit;
        datas[1] = abi.encodeCall(RelicCreditLine.setAgentDelegate, (delegate));
        targets[2] = delegate;
        datas[2] = abi.encodeCall(RelicAgentDelegate.setSpendPermissionManager, (ISpendPermissionManager(SPEND_PERMISSION_MANAGER)));
        targets[3] = delegate;
        datas[3] = abi.encodeCall(RelicAgentDelegate.setIdentityRegistry, (IERC8004Identity(ERC8004_IDENTITY)));
        targets[4] = credit;
        datas[4] = abi.encodeCall(RelicCreditLine.setRegistries, (IERC8004Identity(ERC8004_IDENTITY), IERC8004Reputation(ERC8004_REPUTATION)));
    }

    function _salt() internal pure returns (bytes32) {
        return keccak256("relicpay-base-sepolia-wiring-v1");
    }
}

/// @notice Step 2, as RELIC_PROPOSER: schedule the wiring batch on the timelock.
contract ScheduleBaseSepolia is WiringOps {
    function run() external override {
        require(block.chainid == BASE_SEPOLIA, "Base Sepolia only");
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK")));
        (address[] memory targets, bytes[] memory datas) = _ops();
        uint256[] memory values = new uint256[](targets.length);
        vm.startBroadcast();
        timelock.scheduleBatch(targets, values, datas, bytes32(0), _salt(), 2 days);
        vm.stopBroadcast();
    }
}

/// @notice Step 3, by anyone, at least 2 days after step 2: execute the wiring batch.
contract WireBaseSepolia is WiringOps {
    function run() external override {
        require(block.chainid == BASE_SEPOLIA, "Base Sepolia only");
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK")));
        (address[] memory targets, bytes[] memory datas) = _ops();
        uint256[] memory values = new uint256[](targets.length);
        vm.startBroadcast();
        timelock.executeBatch(targets, values, datas, bytes32(0), _salt());
        vm.stopBroadcast();
    }
}
