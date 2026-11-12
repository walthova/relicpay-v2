// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/PriceOracle.sol";
import "../contracts/ChainlinkPriceAdapter.sol";

/// @notice New for v2: deploys ChainlinkPriceAdapter against an already-deployed PriceOracle and
/// brings it up authorized and registered, so the stack goes from placeholder prices to real
/// Chainlink prices in one broadcast rather than a runbook of hand-sent transactions.
///
/// This is deliberately a separate script from DeployAll. Feed addresses are per-network and
/// per-asset, and hardcoding a Sepolia aggregator into the script that also deploys mainnet would
/// be the kind of default nobody notices until collateral is mispriced. DeployAll brings up an
/// oracle with placeholder prices, which is honest about being a demo; pointing it at real feeds
/// is an explicit second step taken by whoever knows which feeds are right.
///
/// Env:
///   PRIVATE_KEY            required, must be the PriceOracle owner for the authorize step
///   PRICE_ORACLE_ADDRESS   required, from deployments/sepolia.txt
///   MAX_FEED_AGE           optional, seconds, default 3600
///   FEED_CONFIDENCE        optional, 0-100, default 95
///   ETH_USD_FEED           optional, Chainlink ETH/USD aggregator
///   BTC_USD_FEED           optional, Chainlink BTC/USD aggregator
///   USDC_USD_FEED          optional, Chainlink USDC/USD aggregator
///   USDT_USD_FEED          optional, Chainlink USDT/USD aggregator
///   SEQUENCER_UPTIME_FEED  optional, Chainlink L2 sequencer uptime feed (ADR-011 risk 1). Set it on
///                          every L2 deploy; unset leaves the check disabled, which is correct on
///                          L1 and wrong on Base mainnet. Verify the address on docs.chain.link,
///                          and check whether the feed exists at all on Base Sepolia.
///   SEQUENCER_GRACE_PERIOD optional, seconds, 60 to 86400, default 3600
///   DEPLOY_NETWORK         optional, when set the adapter address is appended to
///                          deployments/<DEPLOY_NETWORK>.txt as CHAINLINK_ADAPTER so the monitor
///                          (tools/monitor.js) covers it. The file must already exist (DeployAll).
///
/// Sepolia aggregators at the time of writing (verify against docs.chain.link before use, feed
/// addresses do get deprecated and replaced):
///   ETH/USD   0x694AA1769357215DE4FAC081bf1f309aDC325306
///   BTC/USD   0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43
///   USDC/USD  0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E
///
/// Usage:
///   forge script script/DeployChainlinkAdapter.s.sol:DeployChainlinkAdapterScript \
///     --rpc-url sepolia --broadcast --verify -vvvv
contract DeployChainlinkAdapterScript is Script {
    /// @dev The four assets PriceOracle seeds itself with, in its own address convention.
    address constant ETH_ASSET = address(0);
    address constant BTC_ASSET = address(0x1);
    address constant USDC_ASSET = address(0x2);
    address constant USDT_ASSET = address(0x3);

    function run() external returns (ChainlinkPriceAdapter adapter) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address oracleAddress = vm.envAddress("PRICE_ORACLE_ADDRESS");

        uint32 maxFeedAge = uint32(vm.envOr("MAX_FEED_AGE", uint256(3600)));
        uint8 confidence = uint8(vm.envOr("FEED_CONFIDENCE", uint256(95)));

        PriceOracle priceOracle = PriceOracle(oracleAddress);
        address sequencerFeed = vm.envOr("SEQUENCER_UPTIME_FEED", address(0));
        uint32 sequencerGrace = uint32(vm.envOr("SEQUENCER_GRACE_PERIOD", uint256(3600)));
        string memory network = vm.envOr("DEPLOY_NETWORK", string(""));

        console.log("Deploying ChainlinkPriceAdapter with the account:", deployer);
        console.log("PriceOracle:", oracleAddress);
        console.log("Max feed age (s):", maxFeedAge);
        console.log("Feed confidence:", confidence);

        vm.startBroadcast(deployerPrivateKey);

        adapter = new ChainlinkPriceAdapter(oracleAddress);

        // Half of the adoption. Without this the adapter deploys fine and every push reverts
        // "Unauthorized oracle", which is a confusing way to discover a missing transaction.
        priceOracle.authorizeOracle(address(adapter));

        // Before any feed is registered or pushed, so the first pushAll is already guarded.
        if (sequencerFeed != address(0)) {
            adapter.setSequencerUptimeFeed(sequencerFeed, sequencerGrace);
        }

        uint256 registered = 0;
        registered += _maybeSetFeed(adapter, ETH_ASSET, "ETH_USD_FEED", maxFeedAge, confidence);
        registered += _maybeSetFeed(adapter, BTC_ASSET, "BTC_USD_FEED", maxFeedAge, confidence);
        registered += _maybeSetFeed(adapter, USDC_ASSET, "USDC_USD_FEED", maxFeedAge, confidence);
        registered += _maybeSetFeed(adapter, USDT_ASSET, "USDT_USD_FEED", maxFeedAge, confidence);

        // Seed the oracle from the feeds immediately, so the stack is never sitting on the
        // constructor's placeholder prices with a live adapter attached and nobody having pushed.
        // Tolerant mode: a single misconfigured feed should not undo the whole deploy.
        uint256 pushed = registered > 0 ? adapter.pushAll() : 0;

        vm.stopBroadcast();

        console.log("ChainlinkPriceAdapter deployed to:", address(adapter));
        console.log("Authorized as an oracle on PriceOracle: true");
        if (sequencerFeed != address(0)) {
            console.log("Sequencer uptime feed:", sequencerFeed);
            console.log("Sequencer grace period (s):", sequencerGrace);
        } else {
            console.log("WARNING: SEQUENCER_UPTIME_FEED unset, the sequencer check is disabled (fine on L1, not on Base mainnet).");
        }
        if (bytes(network).length > 0) {
            string memory depPath = string.concat("deployments/", network, ".txt");
            if (vm.exists(depPath)) {
                vm.writeLine(depPath, string.concat("CHAINLINK_ADAPTER=", vm.toString(address(adapter))));
                console.log("Appended CHAINLINK_ADAPTER to", depPath);
            } else {
                console.log("No", depPath, "to append to; add CHAINLINK_ADAPTER by hand.");
            }
        }
        console.log("Feeds registered:", registered);
        console.log("Prices pushed on deploy:", pushed);

        if (registered == 0) {
            console.log("No *_USD_FEED env vars were set, so the oracle is still on placeholder prices.");
            console.log("Register feeds with adapter.setFeed(asset, aggregator, maxFeedAge, confidence).");
        } else if (pushed < registered) {
            console.log("WARNING: some registered feeds did not push. Call adapter.peekFeed(asset) per asset.");
        }

        console.log("Keep prices fresh by scheduling adapter.pushAll() (permissionless, any address).");
    }

    /// @dev Register one feed if its env var is set, and say either way. Skipping silently is how
    ///      a deploy ends up half-configured with nothing in the logs to show which half.
    function _maybeSetFeed(
        ChainlinkPriceAdapter adapter,
        address asset,
        string memory envKey,
        uint32 maxFeedAge,
        uint8 confidence
    ) internal returns (uint256) {
        address aggregator = vm.envOr(envKey, address(0));
        if (aggregator == address(0)) {
            console.log("Skipped (unset):", envKey);
            return 0;
        }
        adapter.setFeed(asset, aggregator, maxFeedAge, confidence);
        console.log("Registered:", envKey, aggregator);
        return 1;
    }
}
