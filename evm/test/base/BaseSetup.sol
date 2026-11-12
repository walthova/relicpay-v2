// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";

import "../../contracts/base/RelicEscrow.sol";
import "../../contracts/base/RelicStakePool.sol";
import "../../contracts/base/RelicCreditLine.sol";
import "../../contracts/base/RelicAgentDelegate.sol";
import "../../contracts/base/interfaces/IExternal.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// ERC-4626 stand-in for a Morpho vault. `harvest` simulates interest; `slash` simulates a loss.
contract MockVault is ERC4626 {
    constructor(IERC20 asset_) ERC20("Mock Morpho USDC", "mmUSDC") ERC4626(asset_) {}

    function harvest(uint256 amount) external {
        MockUSDC(asset()).mint(address(this), amount);
    }

    function slash(uint256 amount, address to) external {
        IERC20(asset()).transfer(to, amount);
    }
}

contract MockReputation is IERC8004Reputation {
    uint256 public calls;
    int128 public lastValue;
    uint256 public lastAgentId;
    string public lastTag2;
    bool public shouldRevert;

    function setRevert(bool r) external {
        shouldRevert = r;
    }

    function giveFeedback(uint256 agentId, int128 value, uint8, string calldata, string calldata tag2, string calldata, string calldata, bytes32)
        external
    {
        require(!shouldRevert, "registry down");
        calls++;
        lastValue = value;
        lastAgentId = agentId;
        lastTag2 = tag2;
    }
}

contract MockIdentity is IERC8004Identity {
    mapping(uint256 => address) public owners;
    mapping(uint256 => address) public wallets;

    function set(uint256 id, address owner, address wallet) external {
        owners[id] = owner;
        wallets[id] = wallet;
    }

    function ownerOf(uint256 id) external view returns (address) {
        return owners[id];
    }

    function getAgentWallet(uint256 id) external view returns (address) {
        return wallets[id];
    }
}

/// Minimal Spend Permission manager: enforces account/spender/token, the allowance per period,
/// and revocation, then moves tokens from account to spender, like the real one does through
/// the owner's smart wallet.
contract MockSpendPermissionManager is ISpendPermissionManager {
    mapping(bytes32 => uint256) public spent;
    mapping(bytes32 => bool) public revoked;

    function hashOf(SpendPermission memory p) public pure returns (bytes32) {
        return keccak256(abi.encode(p.account, p.spender, p.token, p.allowance, p.period, p.start, p.end, p.salt));
    }

    function spend(SpendPermission memory p, uint160 value) external {
        require(msg.sender == p.spender, "not spender");
        bytes32 h = hashOf(p);
        require(!revoked[h], "revoked");
        require(block.timestamp >= p.start && block.timestamp < p.end, "outside permission window");
        require(spent[h] + value <= p.allowance, "allowance");
        spent[h] += value;
        IERC20(p.token).transferFrom(p.account, p.spender, value);
    }

    function isValid(SpendPermission memory p) external view returns (bool) {
        return !revoked[hashOf(p)];
    }

    function revokeAsSpender(SpendPermission calldata p) external {
        revoked[hashOf(p)] = true;
    }

    function revoke(SpendPermission calldata p) external {
        require(msg.sender == p.account, "not account");
        revoked[hashOf(p)] = true;
    }
}

abstract contract BaseSetup is Test {
    MockUSDC usdc;
    TimelockController timelock;
    RelicEscrow escrow;
    RelicStakePool pool;
    RelicCreditLine credit;
    RelicAgentDelegate delegate;

    address proposer = makeAddr("proposer");
    address guardian = makeAddr("guardian");
    address buyer = makeAddr("buyer");
    address merchant = makeAddr("merchant");
    address stranger = makeAddr("stranger");
    address lender = makeAddr("lender");

    uint256 constant USDC1 = 1e6;
    uint256 salt;

    function setUp() public virtual {
        vm.warp(1_750_000_000);
        usdc = new MockUSDC();
        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone may execute once the delay has passed
        timelock = new TimelockController(2 days, proposers, executors, address(0));

        escrow = new RelicEscrow(usdc, address(timelock), guardian);
        pool = new RelicStakePool(usdc, address(timelock), guardian);
        credit = new RelicCreditLine(usdc, address(timelock), guardian);
        delegate = new RelicAgentDelegate(usdc, escrow, credit, address(timelock), guardian);

        _gov(address(escrow), abi.encodeCall(RelicEscrow.setAgentDelegate, (address(delegate))));
        _gov(address(credit), abi.encodeCall(RelicCreditLine.setAgentDelegate, (address(delegate))));

        _fund(buyer, 100_000 * USDC1);
        _fund(lender, 1_000_000 * USDC1);
    }

    /// Schedule, wait out the 2-day delay, execute.
    function _gov(address target, bytes memory data) internal {
        bytes32 s = bytes32(++salt);
        vm.prank(proposer);
        timelock.schedule(target, 0, data, bytes32(0), s, 2 days);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        timelock.execute(target, 0, data, bytes32(0), s);
    }

    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(escrow), type(uint256).max);
        usdc.approve(address(pool), type(uint256).max);
        usdc.approve(address(credit), type(uint256).max);
        usdc.approve(address(delegate), type(uint256).max);
        vm.stopPrank();
    }
}
