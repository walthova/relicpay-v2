// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AggregatorV3Interface
 * @dev The read surface of a Chainlink price feed, declared locally.
 * @notice Copied rather than imported. @chainlink/contracts is not a dependency of this repo and
 *         pulling it in for four function signatures would add a package to the offline toolchain
 *         for no behaviour. The shape is fixed and has not changed across Chainlink's v3
 *         aggregators; if it ever does, a feed compiled against a different shape simply fails the
 *         registration call rather than half-working.
 */
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/**
 * @title IPriceOracleSink
 * @dev The slice of PriceOracle this adapter writes through.
 * @notice Typed against the interface, not the PriceOracle contract, so the adapter compiles and
 *         deploys against any sink with the same three functions and does not inherit the oracle's
 *         storage layout or its deployment cost.
 */
interface IPriceOracleSink {
    function updatePrice(address asset, uint256 price, uint256 confidence) external;
    function batchUpdatePrices(
        address[] calldata assets,
        uint256[] calldata prices,
        uint256[] calldata confidences
    ) external;
    function isAssetSupported(address asset) external view returns (bool supported);
}

/**
 * @title ChainlinkPriceAdapter
 * @dev Pushes Chainlink aggregator answers into PriceOracle, normalized to the oracle's 1e8 scale.
 * @notice "Behind the PriceOracle interface" is the whole design goal. Nothing downstream learns
 *         that Chainlink exists: consumers keep calling PriceOracle.getPrice(asset) and the
 *         oracle's ABI is untouched. The adapter is simply another authorized oracle on the sink,
 *         so adopting it is one authorizeOracle call and abandoning it is one deauthorizeOracle
 *         call, with no migration of the read path either way.
 *
 *         Push, not pull, and deliberately. Making PriceOracle read an aggregator inside getPrice
 *         would be fewer moving parts but turns every valuation into an external staticcall to a
 *         contract the protocol does not control, on the hot path of collateral checks. Pushing
 *         keeps the read path a storage read and puts the failure where it can be seen: a feed
 *         that stops updating stops being pushed, the oracle's own maxPriceAge expires, and
 *         getPrice reverts with StalePrice exactly as it does for a silent human oracle.
 *
 *         The two staleness windows are not redundant. maxFeedAge here is how old a Chainlink
 *         answer may be when the adapter reads it; maxPriceAge on the oracle is how old the
 *         oracle's own copy may be when someone reads that. Without the first, a feed frozen for a
 *         week would be pushed every block and stamped block.timestamp, and the oracle's window
 *         would never expire because the adapter keeps refreshing it with the same dead number.
 *         The freshness check has to happen where the feed's own updatedAt is still visible.
 *
 *         Pushing is permissionless on purpose. The adapter cannot invent a price: everything it
 *         writes is whatever the registered aggregator says, validated and rescaled. Gating the
 *         push behind a keeper role would only add a way for the oracle to go stale because one
 *         address ran out of gas money.
 *
 *         Feed registration is onlyOwner, matching the argument PriceOracle.addAsset already makes
 *         for itself. Pointing an asset at an aggregator commits the protocol to valuing
 *         collateral by whatever that contract returns, which is a risk decision about a specific
 *         counterparty, not a parameter with a dial. Reaching it by governance proposal would need
 *         an appended ParameterType, which is a separate roadmap decision.
 */
contract ChainlinkPriceAdapter is Ownable {
    /// @dev The scale PriceOracle stores every price at.
    uint8 public constant ORACLE_DECIMALS = 8;

    /// @dev Ceiling on a registered feed's staleness window, so a feed cannot be registered with
    ///      an age tolerance so wide that the check is decorative.
    uint32 public constant MAX_FEED_AGE_LIMIT = 7 days;

    /**
     * @dev One registered aggregator, packed into a single slot.
     * @notice 160 + 8 + 32 + 8 + 8 = 216 bits. Every push reads this struct, so the packing is
     *         paid back on every call rather than once at registration. feedDecimals is cached at
     *         registration instead of read per push for the same reason: an aggregator's decimals
     *         are immutable, so re-reading them across a contract boundary every push buys nothing.
     */
    struct Feed {
        address aggregator;   // Chainlink aggregator for this asset
        uint8 feedDecimals;   // cached aggregator.decimals() at registration
        uint32 maxFeedAge;    // how old the aggregator's answer may be when read (seconds)
        uint8 confidence;     // confidence stamped onto the sink for this feed (0-100)
        bool isSet;           // whether this asset has a registered feed
    }

    /// @dev Bounds on the grace period after the L2 sequencer comes back. Below a minute the
    ///      window is decorative, above a day it would freeze pricing for longer than any feed's
    ///      own staleness limit.
    uint32 public constant MIN_SEQUENCER_GRACE_PERIOD = 1 minutes;
    uint32 public constant MAX_SEQUENCER_GRACE_PERIOD = 1 days;

    IPriceOracleSink public immutable priceOracle;

    /// @notice L2 sequencer uptime feed (answer 0 = up, 1 = down; startedAt = when the status
    ///         last changed). Zero address disables the check, which is the L1 and test default.
    ///         Packed with sequencerGracePeriod in one slot.
    address public sequencerUptimeFeed;
    /// @notice Seconds after the sequencer restarts during which no price is pushed.
    uint32 public sequencerGracePeriod;

    mapping(address => Feed) private feeds;
    address[] private registeredAssets;

    event FeedRegistered(
        address indexed asset,
        address indexed aggregator,
        uint8 feedDecimals,
        uint32 maxFeedAge,
        uint8 confidence
    );
    event FeedRemoved(address indexed asset, address indexed aggregator);
    event PricePushed(address indexed asset, uint256 price, uint256 feedUpdatedAt, uint80 roundId);
    event PushSkipped(address indexed asset, string reason);
    event SequencerFeedSet(address indexed feed, uint32 gracePeriod);

    error InvalidSink();
    error InvalidAggregator();
    error InvalidConfidence();
    error InvalidFeedAge();
    error AssetNotSupportedBySink();
    error FeedNotSet();
    error FeedAnswerInvalid();
    error FeedRoundIncomplete();
    error FeedStale();
    error AggregatorCallFailed();
    error NoAssets();
    error InvalidGracePeriod();
    error SequencerDown();
    error SequencerGracePeriodNotOver();
    error SequencerRoundInvalid();
    error SequencerCheckFailed();

    /**
     * @param sink PriceOracle (or anything with the same three functions) this adapter writes to
     */
    constructor(address sink) Ownable(msg.sender) {
        if (sink == address(0)) revert InvalidSink();
        priceOracle = IPriceOracleSink(sink);
    }

    // ---------------------------------------------------------------- registration (owner only)

    /**
     * @dev Point an asset at a Chainlink aggregator
     * @notice Re-registering an asset overwrites its feed in place and does not duplicate it in
     *         registeredAssets, so repointing ETH at a replacement aggregator is one call.
     * @param asset Asset address as PriceOracle knows it (address(0) is native ETH there)
     * @param aggregator Chainlink aggregator address
     * @param maxFeedAge Maximum age of the aggregator's answer, in seconds
     * @param confidence Confidence level stamped onto the sink for this feed (0-100)
     */
    function setFeed(address asset, address aggregator, uint32 maxFeedAge, uint8 confidence) external onlyOwner {
        if (aggregator == address(0)) revert InvalidAggregator();
        if (maxFeedAge == 0 || maxFeedAge > MAX_FEED_AGE_LIMIT) revert InvalidFeedAge();
        if (confidence > 100) revert InvalidConfidence();
        // The sink rejects an unsupported asset anyway, but it does so at push time, which is
        // hours later and in someone else's transaction. Failing at registration puts the error
        // in front of the operator who can actually fix it by calling addAsset first.
        if (!priceOracle.isAssetSupported(asset)) revert AssetNotSupportedBySink();

        // Reading decimals() doubles as proof the address is a live aggregator and not a typo:
        // an EOA or an unrelated contract reverts here rather than being registered and then
        // failing every push forever.
        uint8 feedDecimals = AggregatorV3Interface(aggregator).decimals();

        if (!feeds[asset].isSet) registeredAssets.push(asset);
        feeds[asset] = Feed({
            aggregator: aggregator,
            feedDecimals: feedDecimals,
            maxFeedAge: maxFeedAge,
            confidence: confidence,
            isSet: true
        });

        emit FeedRegistered(asset, aggregator, feedDecimals, maxFeedAge, confidence);
    }

    /**
     * @dev Stop tracking an asset
     * @notice Removing a feed does not clear the price already written to the sink. That is the
     *         sink's business: the last pushed price stays until it ages past maxPriceAge and
     *         getPrice starts reverting, which is the same end state as a feed that went quiet.
     * @param asset Asset address
     */
    function removeFeed(address asset) external onlyOwner {
        Feed memory feed = feeds[asset];
        if (!feed.isSet) revert FeedNotSet();

        delete feeds[asset];
        uint256 length = registeredAssets.length;
        for (uint256 i = 0; i < length; i++) {
            if (registeredAssets[i] == asset) {
                registeredAssets[i] = registeredAssets[length - 1];
                registeredAssets.pop();
                break;
            }
        }

        emit FeedRemoved(asset, feed.aggregator);
    }

    /**
     * @dev Configure the L2 sequencer uptime check
     * @notice On an L2 a stopped sequencer freezes every feed and the first updates after restart
     *         can lag the market. While the sequencer is down, or inside the grace period after
     *         it restarts, every push and read reverts (or is skipped by the tolerant paths), so
     *         the oracle ages out via maxPriceAge instead of being stamped with a stale number.
     *         Pass address(0) to disable, which is correct on L1 and on chains with no such feed.
     *         Owner only, for the same reason as setFeed: it names a counterparty the protocol
     *         trusts for liveness.
     * @param feed Chainlink L2 sequencer uptime aggregator, or address(0) to disable
     * @param gracePeriod Seconds to wait after a restart (ignored and zeroed when disabling)
     */
    function setSequencerUptimeFeed(address feed, uint32 gracePeriod) external onlyOwner {
        if (feed == address(0)) {
            sequencerUptimeFeed = address(0);
            sequencerGracePeriod = 0;
            emit SequencerFeedSet(address(0), 0);
            return;
        }
        if (gracePeriod < MIN_SEQUENCER_GRACE_PERIOD || gracePeriod > MAX_SEQUENCER_GRACE_PERIOD) {
            revert InvalidGracePeriod();
        }
        // Proof the address is a live aggregator and not a typo, as in setFeed.
        AggregatorV3Interface(feed).decimals();
        sequencerUptimeFeed = feed;
        sequencerGracePeriod = gracePeriod;
        emit SequencerFeedSet(feed, gracePeriod);
    }

    // ---------------------------------------------------------------------------- reads (public)

    /**
     * @dev Whether pricing is currently allowed by the sequencer check
     * @return ok True when no feed is configured, or the sequencer is up past its grace period
     * @return reason Empty when ok, otherwise SequencerDown, SequencerGracePeriod,
     *         SequencerRoundInvalid or SequencerCheckFailed
     */
    function sequencerStatus() external view returns (bool ok, string memory reason) {
        reason = _sequencerReason();
        ok = bytes(reason).length == 0;
    }

    /**
     * @dev Read and normalize a registered feed, reverting on anything unusable
     * @param asset Asset address
     * @return price Answer rescaled to the sink's 1e8 scale
     * @return feedUpdatedAt The aggregator's own updatedAt, not block.timestamp
     * @return roundId The aggregator round this answer came from
     */
    function readFeed(address asset) public view returns (uint256 price, uint256 feedUpdatedAt, uint80 roundId) {
        bool ok;
        string memory reason;
        (ok, price, feedUpdatedAt, roundId, reason) = _peekFeed(asset);
        if (!ok) _revertPeek(reason);
    }

    /**
     * @dev Non-reverting form of readFeed, for dashboards and keepers
     * @notice Same checks, same order, but answers instead of reverting. A keeper deciding whether
     *         a push is worth sending should not have to simulate a transaction and decode a
     *         custom error selector to find out.
     * @param asset Asset address
     * @return ok Whether a push would currently succeed
     * @return price Normalized price, 0 when not ok
     * @return feedUpdatedAt The aggregator's updatedAt, 0 when unreadable
     * @return reason Empty when ok, otherwise a short machine-readable cause
     */
    function peekFeed(address asset)
        external
        view
        returns (bool ok, uint256 price, uint256 feedUpdatedAt, string memory reason)
    {
        uint80 roundId;
        (ok, price, feedUpdatedAt, roundId, reason) = _peekFeed(asset);
    }

    /**
     * @dev Registered feed configuration for an asset
     * @param asset Asset address
     * @return feed Feed struct, zeroed when nothing is registered
     */
    function getFeed(address asset) external view returns (Feed memory feed) {
        return feeds[asset];
    }

    /**
     * @dev Whether an asset has a registered feed
     * @param asset Asset address
     */
    function hasFeed(address asset) external view returns (bool) {
        return feeds[asset].isSet;
    }

    /**
     * @dev Every asset with a registered feed
     */
    function getRegisteredAssets() external view returns (address[] memory assets) {
        return registeredAssets;
    }

    // ------------------------------------------------------------------------- pushes (anyone)

    /**
     * @dev Read one feed and write it to the sink
     * @param asset Asset address
     * @return price The price written, on the sink's 1e8 scale
     */
    function pushPrice(address asset) external returns (uint256 price) {
        uint256 feedUpdatedAt;
        uint80 roundId;
        (price, feedUpdatedAt, roundId) = readFeed(asset);

        priceOracle.updatePrice(asset, price, feeds[asset].confidence);
        emit PricePushed(asset, price, feedUpdatedAt, roundId);
    }

    /**
     * @dev Read several feeds and write them to the sink in one sink call
     * @notice skipUnhealthy is the difference between a keeper job and an operator action. A
     *         keeper sweeping every asset every few minutes wants the healthy ones through and a
     *         PushSkipped log for the rest; an operator pushing a specific set before a
     *         liquidation wants all or nothing. Both are legitimate and neither should be
     *         simulated to find out which one happened, so the caller states which it wants.
     * @param assets Assets to push
     * @param skipUnhealthy Skip unreadable feeds instead of reverting the whole call
     * @return pushed How many prices were written
     */
    function pushPrices(address[] calldata assets, bool skipUnhealthy) external returns (uint256 pushed) {
        return _pushMany(assets, skipUnhealthy);
    }

    /**
     * @dev Push every registered feed, skipping any that is unreadable
     * @notice The call a keeper schedules. Equivalent to pushPrices(getRegisteredAssets(), true)
     *         without making the keeper read the list first and pay to send it back in calldata.
     * @return pushed How many prices were written
     */
    function pushAll() external returns (uint256 pushed) {
        return _pushMany(registeredAssets, true);
    }

    // ------------------------------------------------------------------------------- internals

    /**
     * @dev Shared body of pushPrices and pushAll
     * @notice One sink call for the whole batch, not one per asset. batchUpdatePrices takes
     *         exact-length arrays, so the scratch arrays are allocated at the input length and
     *         trimmed to the healthy count before the call rather than padded with zeros the sink
     *         would reject as an invalid price.
     */
    function _pushMany(address[] memory assets, bool skipUnhealthy) internal returns (uint256 pushed) {
        uint256 length = assets.length;
        if (length == 0) revert NoAssets();

        address[] memory okAssets = new address[](length);
        uint256[] memory prices = new uint256[](length);
        uint256[] memory confidences = new uint256[](length);
        uint256[] memory updatedAts = new uint256[](length);
        uint80[] memory roundIds = new uint80[](length);

        for (uint256 i = 0; i < length; i++) {
            address asset = assets[i];
            (bool ok, uint256 price, uint256 updatedAt, uint80 roundId, string memory reason) = _peekFeed(asset);

            if (!ok) {
                if (!skipUnhealthy) _revertPeek(reason);
                emit PushSkipped(asset, reason);
                continue;
            }

            okAssets[pushed] = asset;
            prices[pushed] = price;
            confidences[pushed] = feeds[asset].confidence;
            updatedAts[pushed] = updatedAt;
            roundIds[pushed] = roundId;
            pushed++;
        }

        if (pushed == 0) return 0;

        assembly {
            mstore(okAssets, pushed)
            mstore(prices, pushed)
            mstore(confidences, pushed)
        }

        priceOracle.batchUpdatePrices(okAssets, prices, confidences);

        for (uint256 i = 0; i < pushed; i++) {
            emit PricePushed(okAssets[i], prices[i], updatedAts[i], roundIds[i]);
        }
    }

    /**
     * @dev Read and validate one feed without reverting
     * @notice The single place the validation rules live. readFeed, peekFeed and the batch push
     *         all route through here, so the strict path and the tolerant path cannot disagree
     *         about whether a given feed is usable, which is the bug this shape exists to prevent.
     */
    function _peekFeed(address asset)
        internal
        view
        returns (bool ok, uint256 price, uint256 feedUpdatedAt, uint80 roundId, string memory reason)
    {
        Feed memory feed = feeds[asset];
        if (!feed.isSet) return (false, 0, 0, 0, "FeedNotSet");

        // Before the aggregator is even read: a frozen L2 feed can look perfectly fresh.
        string memory seqReason = _sequencerReason();
        if (bytes(seqReason).length != 0) return (false, 0, 0, 0, seqReason);

        try AggregatorV3Interface(feed.aggregator).latestRoundData() returns (
            uint80 rid,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // updatedAt == 0 is Chainlink's marker for a round that was started and never
            // answered. answeredInRound < roundId means the answer being reported is carried over
            // from an earlier round, which is the shape of a feed that has stopped advancing.
            if (updatedAt == 0 || answeredInRound < rid) return (false, 0, updatedAt, rid, "FeedRoundIncomplete");
            if (answer <= 0) return (false, 0, updatedAt, rid, "FeedAnswerInvalid");
            if (block.timestamp > updatedAt && block.timestamp - updatedAt > feed.maxFeedAge) {
                return (false, 0, updatedAt, rid, "FeedStale");
            }
            uint256 normalized = _normalize(uint256(answer), feed.feedDecimals);
            // Only reachable when a feed with more decimals than the sink reports a price small
            // enough that rescaling floors it to zero. The sink would reject it as "Invalid price"
            // with no indication of why, so it is named here instead.
            if (normalized == 0) return (false, 0, updatedAt, rid, "FeedAnswerInvalid");
            return (true, normalized, updatedAt, rid, "");
        } catch {
            return (false, 0, 0, 0, "AggregatorCallFailed");
        }
    }

    /**
     * @dev Sequencer uptime check, non-reverting
     * @notice Follows Chainlink's published L2 pattern: answer 1 is down, startedAt == 0 is an
     *         uninitialised round, and prices are refused until gracePeriod has passed since the
     *         status last changed. A feed call that throws fails closed.
     */
    function _sequencerReason() internal view returns (string memory) {
        address feed = sequencerUptimeFeed;
        if (feed == address(0)) return "";
        try AggregatorV3Interface(feed).latestRoundData() returns (
            uint80,
            int256 answer,
            uint256 startedAt,
            uint256,
            uint80
        ) {
            if (answer != 0) return "SequencerDown";
            if (startedAt == 0) return "SequencerRoundInvalid";
            if (block.timestamp < startedAt || block.timestamp - startedAt <= sequencerGracePeriod) {
                return "SequencerGracePeriod";
            }
            return "";
        } catch {
            return "SequencerCheckFailed";
        }
    }

    /**
     * @dev Turn a _peekFeed reason back into the matching custom error
     * @notice So the strict callers revert with a typed error rather than a string, and the string
     *         stays an implementation detail of the tolerant path.
     */
    function _revertPeek(string memory reason) internal pure {
        bytes32 h = keccak256(bytes(reason));
        if (h == keccak256("FeedNotSet")) revert FeedNotSet();
        if (h == keccak256("FeedRoundIncomplete")) revert FeedRoundIncomplete();
        if (h == keccak256("FeedAnswerInvalid")) revert FeedAnswerInvalid();
        if (h == keccak256("FeedStale")) revert FeedStale();
        if (h == keccak256("SequencerDown")) revert SequencerDown();
        if (h == keccak256("SequencerGracePeriod")) revert SequencerGracePeriodNotOver();
        if (h == keccak256("SequencerRoundInvalid")) revert SequencerRoundInvalid();
        if (h == keccak256("SequencerCheckFailed")) revert SequencerCheckFailed();
        revert AggregatorCallFailed();
    }

    /**
     * @dev Rescale an aggregator answer to the sink's 1e8 scale
     * @notice Most USD feeds are already 8 decimals and land in the first branch untouched. The
     *         other two exist because ETH-denominated feeds are 18 and the protocol should not
     *         silently misprice collateral by a factor of 1e10 if one is ever registered.
     */
    function _normalize(uint256 answer, uint8 feedDecimals) internal pure returns (uint256) {
        if (feedDecimals == ORACLE_DECIMALS) return answer;
        if (feedDecimals < ORACLE_DECIMALS) return answer * (10 ** (ORACLE_DECIMALS - feedDecimals));
        return answer / (10 ** (feedDecimals - ORACLE_DECIMALS));
    }
}
