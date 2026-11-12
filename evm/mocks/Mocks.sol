// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// A stablecoin with configurable decimals. MockERC20 is 18, the same as ETH, so a dashboard that
// assumes 18 everywhere passes every test written against it and then renders a real 6-decimal
// USDC balance off by a factor of a trillion. Settlement amounts are never converted by the
// contracts, so decimals are the only thing separating "3 USDC" from "3 millionths of an ETH".
contract MockStablecoin is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) { return _decimals; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockNFT is ERC721 {
    uint256 public nextId = 1;
    constructor() ERC721("Optic Relic", "RELIC") {}
    function mint(address to) external returns (uint256 id) {
        id = nextId++;
        _mint(to, id);
    }
}

// Chainlink AggregatorV3 stand-in with every field of latestRoundData settable, so tests can
// reproduce the failure modes a real feed has and a happy-path mock would hide: a round that was
// never answered (updatedAt 0), an answer carried over from an earlier round (answeredInRound
// below roundId), a negative or zero answer, a frozen updatedAt, and a feed whose decimals are
// not the oracle's 8. `reverting` makes the aggregator itself throw, which is the case the
// adapter's try/catch exists for.
contract MockAggregatorV3 {
    uint8 public decimals;
    string public description;
    uint256 public version = 4;

    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    bool public reverting;

    constructor(uint8 _decimals, string memory _description, int256 _answer) {
        decimals = _decimals;
        description = _description;
        roundId = 1;
        answer = _answer;
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = 1;
    }

    /// @dev Publish a new round at the current block time, the way a live feed advances.
    function setAnswer(int256 _answer) external {
        roundId += 1;
        answer = _answer;
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = roundId;
    }

    /// @dev Set every field by hand, for the malformed cases a live feed cannot be asked to produce.
    function setRound(uint80 _roundId, int256 _answer, uint256 _startedAt, uint256 _updatedAt, uint80 _answeredInRound)
        external
    {
        roundId = _roundId;
        answer = _answer;
        startedAt = _startedAt;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }

    function setReverting(bool _reverting) external { reverting = _reverting; }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        require(!reverting, "aggregator down");
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}

// Governance token with manually settable past votes so tests control voting power.
contract MockGovToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) private pastVotes;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
    function setPastVotes(address account, uint256 votes) external { pastVotes[account] = votes; }
    function getPastVotes(address account, uint256) external view returns (uint256) { return pastVotes[account]; }
}


// A real checkpointed governance token (OpenZeppelin ERC20Votes, block-number clock). Unlike
// MockGovToken it honours the timepoint argument, so it reverts on a future lookup. That is
// what makes it usable as a regression for V1-BUG-4: a governor that passes a timestamp where a
// block number belongs fails against this token and passes against the lenient mock.
contract MockVotesToken is ERC20, EIP712, ERC20Votes {
    constructor() ERC20("Votes", "VOTE") EIP712("Votes", "1") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }
    function nonces(address owner) public view override(Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}

// A contract wallet whose receive() does real work (a storage write), so it needs far more than
// the 2300 gas a push transfer() forwards. Used for V1-BUG-5. It can also be told to reject ETH.
contract MockSmartWallet {
    uint256 public received;
    bool public reject;
    function setReject(bool r) external { reject = r; }
    receive() external payable {
        require(!reject, "wallet rejects");
        received += msg.value;
    }
    function exec(address target, bytes calldata data, uint256 value) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) { assembly { revert(add(ret, 32), mload(ret)) } }
        return ret;
    }
}
