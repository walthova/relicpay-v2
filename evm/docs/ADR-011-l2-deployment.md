# ADR-011: L2 deployment target

Status: recommended, pending owner sign-off. Date: 2026-10-17.

## Decision

Deploy the first live RelicPay v2 instance on Base mainnet, after a Base Sepolia dress rehearsal. Do not launch on Ethereum L1. Do not build multi-chain in this phase.

The market facts below (fees, stage of decentralization, USDC and Chainlink availability) change quickly and were not re-verified in this offline build. Re-check each one in the gate list at the end before money moves.

## Why an L2 at all

Every lifecycle call in the gas snapshot (createAgreementWithRWA, processPayment, deposit and withdraw collateral, settlement draws) is a state-changing transaction that a buyer or a keeper pays for. BNPL ticket sizes for the IBG Collection pilot are small relative to L1 gas in busy periods. Installment payments, `processOverduePayments` keepers and the monitoring scan all multiply the transaction count. An L2 keeps the per-installment cost below the installment itself.

## Why Base

1. Native ETH. RelicPay settles and collateralizes in ETH and ERC20s. Base uses ETH as the gas and value token, so no contract change is needed (a chain with its own gas token would break the ETH-denominated oracle and settlement assumptions).
2. Native USDC. Stablecoin settlement (Phase 2 parts a and b) needs a settlement token sellers trust. Circle issues USDC natively on Base, which avoids a bridged-token trust assumption.
3. Chainlink coverage. ChainlinkPriceAdapter registers aggregators per asset. Base has Chainlink price feeds and an L2 sequencer uptime feed (see risk 1).
4. EVM compatibility. The suite compiles with solc 0.8.20 and `evmVersion: 'paris'` (tools/compile.js), so the bytecode does not rely on newer opcodes. OP Stack chains run the same EVM, so the current build is deployable as is.
5. Distribution. Base has the consumer and wallet reach that the buyer dashboard and the browser extension (ADR-003 to ADR-008) depend on, and the strongest existing stablecoin and RWA liquidity among the OP Stack chains.
6. Tooling. Foundry, viem, Tenderly and OpenZeppelin Defender all support Base, and Base Sepolia gives a like-for-like testnet. The scripts in script/ take their target from the RPC URL, not from code.

## Alternatives considered

- Ethereum L1: strongest settlement guarantees, but per-call cost makes small installments uneconomic. Revisit only for large-ticket RWAs.
- Arbitrum One: comparable fees and a strong DeFi base, with a different fraud proof and sequencer stack. A credible second target, not a better first one. The contracts need no change to deploy there, so this stays open.
- Optimism mainnet: same stack as Base with less user distribution.
- Solana: aligns with Walter's Solana thesis but is a rewrite, not a deployment. Already scoped out of this phase in DEVELOPMENT_PLAN.md (bridge explored later).

## Costs and risks of choosing Base

1. Sequencer downtime is not handled by the oracle path. On an L2, a stopped sequencer leaves feed prices frozen and then jumps on restart. ChainlinkPriceAdapter checks per-feed staleness (FeedStale) but does not read the L2 sequencer uptime feed or enforce a grace period after restart. A buyer could be treated against a stale price at the moment the sequencer returns. This is a contract item and is added to ROADMAP.md as a follow-up that must land before mainnet. Resolved: ChainlinkPriceAdapter.setSequencerUptimeFeed(feed, gracePeriod) now refuses pricing while the sequencer is down or inside the grace period after a restart (1 minute to 1 day, zero address disables it). The Base sequencer feed address still has to be verified on launch day (gate list).
2. Centralized sequencer and upgrade keys. Base is operated by a single company and its withdrawal and proof system is still maturing. RelicPay holds user collateral in RelicPay.sol, so a chain-level halt freezes withdrawals. The monitoring plan has no pause path (docs/MONITORING.md, known gaps), which makes a chain-level incident harder to answer.
3. Finality and reorg depth. L2 soft confirmation is fast but not final until the batch lands on L1. `tools/monitor.js scan` should read at a safe block tag for page-tier alerts, and the dashboard `?at=` pinning (ADR-002) should pin at a safe block, not latest, on Base.
4. Gas model. The L2 execution cost is low but each transaction also pays an L1 data fee that depends on calldata size and L1 conditions. gas-snapshot.txt measures execution gas on ganache only. Recapture a baseline on Base Sepolia before quoting costs to sellers.
5. Time. `block.timestamp` drives due dates, grace periods and timelocks. On OP Stack chains it advances in regular short steps, so the existing tests hold, but short windows (the governance timelock minimum, the oracle maxAge) should be re-read with sequencer delay in mind.
6. Regulatory exposure is unchanged by the chain choice and still needs counsel before mainnet (docs/DEVELOPMENT_PLAN.md, Risks).

## What this decision does not change

No contract, ABI or test baseline changes. ADR-011 is a deployment decision. Existing deployments on Sepolia keep unenforced `maxAgreementDuration` until redeployed, and the next deploy should be a fresh DeployAll on Base Sepolia.

## Rollout order

1. Resolve the sequencer uptime item (new ROADMAP entry).
2. Run forge against DeployAll.s.sol and the invariant suite locally (still pending from earlier runs).
3. Fresh DeployAll on Base Sepolia with `DEPLOY_NETWORK=base-sepolia` (checks chain id 84532, writes deployments/base-sepolia.txt), then DeployChainlinkAdapter with `SEQUENCER_UPTIME_FEED` where a feed exists, then the pilot with `npm run pilot:mint -- --network base-sepolia` (ROADMAP: IBG Collection pilot, part b, retargeted from Sepolia). tools/networks.js holds the network table the demo and pilot check against.
4. Capture a Base Sepolia gas baseline and set the monitor thresholds from real pilot volumes.
5. External audit on the post-fix code.
6. Base mainnet with conservative caps (low governance maxima for credit and agreement size), raised by governance as the pilot proves out.

## Gate list: verify on the day of launch

- Current Base fee level against the gas snapshot, including the L1 data fee.
- Base's current stage of decentralization and proof system status, and what it means for withdrawal delay.
- Native USDC contract address on Base and the Chainlink feed addresses for ETH/USD, USDC/USD and the sequencer uptime feed.
- Etherscan-equivalent (Basescan) verification works for the solc 0.8.20 build.
- Counsel sign-off on the BNPL structure in the target jurisdictions.

## Owner decisions

- Confirm Base as the first target (this ADR recommends it; the choice is Walter's).
- Confirm that Arbitrum stays a later second deployment rather than a parallel one.
