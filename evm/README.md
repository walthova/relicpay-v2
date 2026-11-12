# RelicPay v2

Rebuild of the RelicPay RWA BNPL protocol. The old codebase (`~/Downloads/relicpay-demo-main`) is the spec; a characterization test suite captures everything it does, and v2 passes all of it plus fixes for the five bugs and five quirks documented in `docs/RELICPAY_SPEC.md`.

## Layout
- `legacy/` v1 contracts, unmodified (the spec)
- `contracts/` v2 contracts (same ABIs + fixes + new `RelicRegistry.sol` tokenization)
- `test/` characterization suite, runs against both implementations
- `tools/compile.js` solc-js pipeline (works fully offline)
- `dashboard/lib/` buyer and seller data layer (generated ABIs + viem reads and write plans, no framework)
- `dashboard/app/` Next.js buyer and seller front end (own package.json, see its README)
- `docs/` extracted spec + development plan

## Run
```bash
npm install
npm run compile
npm test          # legacy baseline (51) + v2 (169)
```
Also works with Foundry on your Mac for the original `.t.sol` suites.

## RelicPay agreement lifecycle

`Active -> Completed` on the final installment, which is when the relic NFT transfers to the buyer
and the reserved credit is released.

`Active -> Defaulted` via `triggerDefault(agreementId)`, callable by the seller once the grace
period on the next unpaid installment has expired. This closes V1-QUIRK-3, where a RelicPay
agreement had no way to leave the Active state. On default:

- every unpaid installment is marked `PaymentStatus.Defaulted`
- the buyer's collateral is seized up to the outstanding balance and credited to the seller's
  pull-payment balance (partial if the buyer is under-collateralised; the seller absorbs the gap)
- the buyer's reserved credit is released in full, so a dead agreement cannot strand the line
- the relic does **not** transfer; it stays with its current owner, normally the seller

Both terminal states are final: `processPayment`, `processOverduePayments` and a second
`triggerDefault` all revert afterwards. Call `getDefaultStatus(agreementId)` for
`(defaultable, nextInstallment, graceExpiry, outstanding)` without simulating the transaction.

## Stablecoin settlement

A seller can be paid in a stablecoin instead of ETH, so gallery proceeds are not exposed to ETH
price movement between the first installment and the last.

1. Owner authorizes the currency: `authorizeSettlementToken(token, true)`. This is a separate
   registry from `authorizeToken`, which governs collateral. A token being good collateral does not
   make it a currency the protocol will settle in, and vice versa.
2. Seller opts in: `setSettlementPreference(token)`. Pass `address(0)` to go back to ETH.
3. Every agreement created after that snapshots the currency at creation. A seller changing their
   preference later does not change what an open agreement's buyer owes.

Buyers on a stablecoin agreement call `processPayment(id, n)` with no ETH value after approving the
installment amount to RelicPay; attaching ETH reverts with `UnexpectedETHPayment` rather than
trapping it. Proceeds land in `sellerTokenBalances` and are pulled with
`withdrawSellerTokenBalance(token)`. `getSettlementTerms(agreementId)` returns
`(token, nextInstallment, amount, requiresApproval)` for a dashboard or buyer UI.

All four payment methods work against a stablecoin-settled agreement.

- **Manual** pulls the installment from `msg.sender` on an allowance, as above.
- **Auto** draws a token-denominated pool: `depositAutoPaymentTokens(token, amount)` and
  `withdrawAutoPaymentTokens(token, amount)`, read with
  `getAutoPaymentBalance(user, token)`. The ETH pool (`depositAutoPaymentFunds`) does not
  substitute for it; a token agreement with an empty token pool reverts with
  `InsufficientAutoPaymentBalance` however much ETH is sitting in the ETH pool.
- **Collateral** and the collateral half of **AutoWithCollateral** draw only from collateral
  denominated in the settlement token. If that is short the payment reverts with
  `InsufficientSettlementCollateral` rather than reaching for the buyer's ETH, since crediting the
  seller in the asset they opted out of is the failure this feature exists to prevent. So a
  stablecoin Collateral agreement needs the buyer to hold that stablecoin as collateral, which
  also means authorizing it with `authorizeToken`. Check before paying with
  `getSettlementReadiness(agreementId)`, which returns
  `(token, required, autoBalance, collateralAvailable, ready)`.
- `processOverduePayments`, the keeper sweep, is a collateral draw and follows the same rule.

`triggerDefault` is settlement-asset-first with a fallback: it drains the buyer's collateral in the
settlement token before touching anything else, then takes whatever is left in other assets. The
fallback is right here and wrong on the scheduled-payment path, because a defaulted agreement is
terminal and a mixed-asset recovery beats no recovery.

Everything above is scoped to sellers who opted in. An agreement with no settlement preference
takes exactly the code paths it did before this feature existed, including the unordered
all-positions collateral draw and seizure order.

Other behaviour worth knowing:

- de-authorizing a currency only blocks new agreements; open ones keep settling and the seller
  keeps their withdrawal path.
- `depositAutoPaymentTokens` is deliberately not gated on the settlement registry. Those are the
  buyer's own always-withdrawable funds, and gating them would let an owner de-authorization strand
  a buyer who needs to top up an agreement that is already open.
- `UnsupportedSettlementMethod` no longer fires. It stays in the ABI so a consumer built against
  the earlier release still decodes.

## Fuzz tests
`test/fuzz.test.js` is a randomized property suite over payment sequencing (RelicPay), credit math
(EnhancedBnpl) and yield accrual (DeFiIntegration). It is v2-only and runs as part of `npm run
test:v2`. There is no Foundry fuzzer in this offline toolchain, so cases come from a seeded PRNG
instead:
```bash
FUZZ_RUNS=100 npm run test:v2                    # more cases per property
FUZZ_SEED=alpha FUZZ_RUNS=100 npm run test:v2    # pin a seed
```
Default is 8 cases per property, tuned to keep the suite inside the mocha timeout on a host
without native ganache bindings. Every failure prints the seed and the exact generated case, so a
red run is replayable with `FUZZ_SEED=<printed seed>`.

## Demo script
`tools/demo.js` walks the Phase 1 MVP flow end to end with narrated console output: mint an Optic
Relic on RelicRegistry, buyer deposits ETH collateral, a BNPL agreement is created against the relic,
the buyer pays all installments, and the relic ownership transfers on completion.
```bash
npm run compile   # if you haven't already
npm run demo      # spins up a local offline instance and runs the full walkthrough
```
Against a live Sepolia deploy (after `script/DeployAll.s.sol`), point it at the deployed addresses:
```bash
RPC_URL=... PRIVATE_KEY=... npm run demo -- --network sepolia   # or base-sepolia
```
`GALLERY_KEY` and `BUYER_KEY` are optional; without them the deployer wallet plays every role, which
still exercises the full call path but the relic doesn't visibly change hands between wallets.
The same walkthrough is exercised by `test/demo.test.js` in the offline suite.

## Gas snapshot
`tools/gas-snapshot.js` deploys every v2 contract and exercises the core lifecycle calls
(agreement creation, payments, default, collateral, governance vote/queue/execute, yield
stake/close, oracle updates), recording gas used for each.
```bash
npm run compile       # if you haven't already
npm run gas           # regenerates gas-snapshot.txt from the current contracts
npm run gas:check      # diffs current gas against the committed gas-snapshot.txt,
                       # exits non-zero on a regression greater than 5%
```
`gas-snapshot.txt` is the committed baseline; run `gas:check` after any contract change to see
what moved. `test/gas-snapshot.test.js` sanity-checks the tool itself (every section present,
every measurement positive and under the block gas limit). The 5% threshold, not 2%, exists
because this offline sandbox's ganache runs without native bindings and shows a few percent of
run-to-run noise on calls that make an external contract call; see the comment in the script.

Caveat found 2026-07-31: that noise estimate assumes the same host architecture across runs.
Ganache's native bindings are x64-only; on an arm64 host it silently falls back to a pure-JS EVM
that measures gas differently at the operation level, not just noisier, by 30%+ on some calls,
even for contracts that were not touched. If `gas:check` ever reports large swings on code you
did not change, check whether the host architecture changed before treating it as a real
regression, and recapture the baseline with `npm run gas` on the new host instead of trusting the
diff. See the 2026-07-31 entry in PROGRESS.md for how this was confirmed with a same-host A/B.

## Governance timelock
v2 execution is two-phase. A proposal that has passed its vote is not directly executable: an
authorized executor calls `queue(proposalId, updates)`, which publishes a `ProposalQueued` event
carrying the `eta` and the window's `expiresAt`, and only then can `execute(proposalId, updates)`
land, inside `[eta, eta + executionGracePeriod]`.

- `executionDelay` defaults to 2 days, `executionGracePeriod` to 14 days. Both are owner-tunable
  via `updateTimelockParameters`, bounded to 30 days and 1 to 90 days respectively.
- The eta is fixed at queue time, so retuning the delay never moves a countdown already running.
- The proposer or the owner can `cancel` during the delay, which clears the eta. That window is
  the reason the timelock exists.
- A proposal that misses its grace period reverts with `ProposalStale` and can be re-queued for a
  fresh window. Re-queueing inside a live window is refused with `ProposalAlreadyQueued`.
- `getExecutionWindow(proposalId)` returns `(eta, expiresAt, queued, ready, expired)` for a
  dashboard, and reports an unqueued/terminal proposal as all zeros.

Legacy has no timelock and executes straight from the vote result; this is a deliberate v2-only
ABI addition, not a port.

## Governance parameter wiring
`execute` now actually calls the target contract. A `ParameterUpdate` is `(paramType, target,
data)` where `data` is the ABI encoding of the setter's **arguments only**: the selector comes
from `paramSelector(paramType)` and can never be supplied by the proposal, so the enum value a
voter reads and the function that runs are the same fact.

Reaching a target takes a two-sided opt-in, and either side alone is not enough:

- **Governance side.** The owner allowlists a `(target, selector)` pair with
  `setParameterAllowed(target, paramType, allowed)` (resolves the selector for you) or
  `setActionAllowed(target, selector, allowed)` (raw). Not itself governable: a governance system
  that can extend its own reach by proposal has no allowlist, only a delay. `address(0)` and the
  governance contract itself are refused as targets.
- **Target side.** The target inherits `Governable` and its owner calls
  `setGovernor(governanceAddress)`. The owner keeps every right it had, `onlyGovernance` accepts
  owner or governor, and revocation is one transaction. Nothing has to hand over its `Ownable`
  owner to be governed.

Dispatch table. The `#` column is the on-chain enum value, which is what a proposal actually
encodes. The table names functions, not contracts: which address a type may be aimed at is the
allowlist's job, and the "contract" column is only where that selector exists today.

| # | ParameterType | contract | selector | data |
| --- | --- | --- | --- | --- |
| 0 | CreditLimitRatio | RelicPay | `setCreditLimitRatio(uint256)` | `abi.encode(ratio)` |
| 1 | GracePeriod | RelicPay | `setDefaultGracePeriod(uint256)` | `abi.encode(seconds)` |
| 2 | MinimumCollateral | RelicPay | `setMinCollateralAmount(uint256)` | `abi.encode(wei)` |
| 3 | YieldRate | RelicPay | `setYieldRate(address,uint256)` | `abi.encode(token, bps)` |
| 4 | ProtocolFee | none | retired in place | reverts `UnsupportedParameterType` |
| 5 | MaxInstallments | none | retired in place | reverts `UnsupportedParameterType` |
| 6 | AuthorizedToken | RelicPay | `authorizeToken(address,bool)` | `abi.encode(token, ok)` |
| 7 | AuthorizedNFT | RelicPay | `authorizeNFT(address,bool)` | `abi.encode(nft, ok)` |
| 8 | AuthorizedOracle | PriceOracle | `setOracleAuthorized(address,bool)` | `abi.encode(oracle, ok)` |
| 9 | MaxPriceAge | PriceOracle | `updateMaxPriceAge(address,uint256)` | `abi.encode(asset, seconds)` |
| 10 | AuthorizedProtocol | DeFiIntegration | `setProtocolAuthorized(address,bool,uint256)` | `abi.encode(protocol, ok, bps)` |
| 11 | ProtocolAPY | DeFiIntegration | `updateProtocolAPY(address,uint256)` | `abi.encode(protocol, bps)` |

Types 8 to 11 are appended, never inserted. A `ParameterType` travels the ABI as a `uint8`, so
appending leaves every existing value on the number it had, while inserting or removing one
renumbers the entries below it and a proposal encoded before the change would execute a different
function after it. That is also why 4 and 5 are still listed: neither names anything in v2 and both
revert, but deleting them would move `AuthorizedToken` from 6 to 4. They are retired in place.
Repurposing them to mean an oracle or an APY was the alternative and is worse than either, since it
rebinds a value old integrations can still encode.

`setProtocolAuthorized` takes three arguments because authorizing a protocol is meaningless without
the rate it is authorized at. Deauthorizing must pass `apy == 0`: the field is unread on that path,
so an unchecked one would let two byte-different proposals have identical effects while hashing
differently.

The three single-parameter setters on RelicPay are new. `updateGovernanceParams` takes all three
at once, so routing a proposal through it would force a read-modify-write, and two proposals
queued against the same snapshot would silently revert each other's parameter.

Not everything owner-only became governable. `authorizeSettlementToken` on RelicPay,
`addAsset`/`removeAsset` on PriceOracle and `emergencyWithdraw` on DeFiIntegration stay owner-only:
the first three are risk decisions with counterparty exposure rather than parameters, and the last
moves funds, so a two day timelock in front of it would be a downgrade in the case it exists for.

`data.length` is checked against the exact expected length. Solidity's decoder ignores trailing
calldata, so without that check a proposal could carry arbitrary extra bytes that hash into
`proposalActionsHash` and survive review as "32 bytes of uint256".

`checkParameterUpdate(update)` returns `(ok, selector, reason)` so a proposer can find out before
writing the proposal, rather than days later from a whole-proposal revert at the end of a timelock.
A multi-action proposal is all-or-nothing: one bad action reverts the whole `execute`.

`checkParameterUpdate` answers "is this encoded and permitted", not "does this function exist on
that address". Aiming a type at the wrong contract is caught by the target reverting, not by the
proposer's dry run, so the allowlist is where a `(target, paramType)` pair should be got right.
`script/DeployAll.s.sol` writes the correct pairs for all three contracts automatically.

## Chainlink price feeds

`contracts/ChainlinkPriceAdapter.sol` puts real Chainlink data behind the existing PriceOracle
interface. Nothing downstream changes: consumers keep calling `PriceOracle.getPrice(asset)` and the
oracle's ABI is untouched. The adapter is just another authorized oracle on it, so adoption is one
`authorizeOracle` call and abandoning it is one `deauthorizeOracle` call.

```
Chainlink aggregator --latestRoundData--> ChainlinkPriceAdapter --updatePrice--> PriceOracle --getPrice--> consumers
```

Push, not pull, deliberately. Reading an aggregator inside `getPrice` would be fewer moving parts
but puts an external staticcall to a contract the protocol does not control on the hot path of
every collateral check. Pushing keeps the read path a storage read, and a feed that stops updating
stops being pushed, the oracle's own `maxPriceAge` expires, and `getPrice` reverts with
`StalePrice` exactly as it does for a silent human oracle.

Two staleness windows, and they are not redundant:

| Window | Where | Question it answers |
| --- | --- | --- |
| `maxFeedAge` | adapter, per feed | how old may the aggregator's answer be when the adapter reads it |
| `maxPriceAge` | PriceOracle, per asset | how old may the oracle's own copy be when someone reads that |

Without the first, a feed frozen for a week would be pushed every block and stamped with
`block.timestamp`, so the oracle's window would never expire because the adapter keeps refreshing
it with the same dead number. The freshness check has to happen where the feed's own `updatedAt`
is still visible.

Pushing is permissionless: the adapter cannot invent a price, it only relays a validated, rescaled
aggregator answer. Gating it behind a keeper role would only add a way for the oracle to go stale
because one address ran out of gas money.

| Call | Who | Notes |
| --- | --- | --- |
| `setFeed(asset, aggregator, maxFeedAge, confidence)` | owner | caches `decimals()`, rejects unlisted assets and non-aggregators |
| `removeFeed(asset)` | owner | stops the refresh; the last pushed price ages out on its own |
| `pushPrice(asset)` | anyone | one feed, one sink write |
| `pushPrices(assets, skipUnhealthy)` | anyone | `false` is all or nothing, `true` skips and logs `PushSkipped` |
| `pushAll()` | anyone | the call a keeper schedules; sweeps every registered feed, tolerant |
| `peekFeed(asset)` | view | non-reverting probe: `(ok, price, feedUpdatedAt, reason)` |
| `readFeed(asset)` | view | same checks, reverts with a typed error instead |

Feed registration is owner-only for the same reason `PriceOracle.addAsset` is: pointing an asset at
an aggregator commits the protocol to valuing collateral by whatever that contract returns, which
is a risk decision about a specific counterparty, not a parameter with a dial. Reaching it by
governance proposal would need an appended `ParameterType` and is not wired today.

Deploy it against an existing oracle:
```bash
PRICE_ORACLE_ADDRESS=0x... \
ETH_USD_FEED=0x694AA1769357215DE4FAC081bf1f309aDC325306 \
forge script script/DeployChainlinkAdapter.s.sol:DeployChainlinkAdapterScript \
  --rpc-url sepolia --broadcast --verify -vvvv
```
The script deploys the adapter, authorizes it on the oracle, registers whichever `*_USD_FEED` env
vars are set (`ETH`, `BTC`, `USDC`, `USDT`), and calls `pushAll()` once so the stack is never left
sitting on the constructor's placeholder prices with a live adapter attached. It is separate from
`DeployAll` on purpose: feed addresses are per-network, and a hardcoded default is the kind of
thing nobody notices until collateral is mispriced. Verify aggregator addresses against
docs.chain.link before use, they do get deprecated.

On an L2 also set `SEQUENCER_UPTIME_FEED` (and optionally `SEQUENCER_GRACE_PERIOD`, default 3600) so
the script calls `setSequencerUptimeFeed` before the first push; left unset the check is disabled
and the script says so. Set `DEPLOY_NETWORK=base-sepolia` and it appends `CHAINLINK_ADAPTER=` to
`deployments/base-sepolia.txt` so `tools/monitor.js` covers the adapter. Whether Chainlink runs a
sequencer feed on Base Sepolia is not verified here: if it does not, the rehearsal runs with the
check disabled and the feed is a launch-day gate for Base mainnet (ADR-011).

## Dashboard data layer

`dashboard/lib/` is part a of the buyer/seller dashboard: everything the screens need, as plain
data, with no React, Next.js or wagmi anywhere in it. That is what lets the characterization suite
run the exact code the browser will run, against ganache, with no renderer.

```bash
npm run abi:export     # regenerate dashboard/lib/abis.js + abis.d.ts from build/v2
npm run abi:check      # fail if the checked-in export is stale (also asserted in the test suite)
npm run abi:typecheck  # tsc over dashboard/lib, proves viem type inference still works
```

```js
const { createRelicPayReader, resolveAddresses } = require('./dashboard/lib');
const reader = createRelicPayReader({
  publicClient,                                   // any viem PublicClient
  addresses: resolveAddresses({ network: 'sepolia' }),
  fromBlock: 0n,                                  // pass the deploy block on a public chain
});
await reader.getBuyerDashboard(address);
await reader.getSellerDashboard(address);
```

Three things are worth knowing before building on it.

**Every dashboard read is pinned to one block.** A buyer dashboard makes around twenty `eth_call`s.
Unpinned they land across several blocks, so a credit line from block N renders beside a payment
schedule from N+2 that already spent it. `getBuyerDashboard` and `getSellerDashboard` resolve the
block once and thread it through every read, and return it as `at` so the UI can say as of when. In
tests that drive `evm_increaseTime`, set `cacheTime: 0` on the viem client: its default block-number
cache will otherwise pin every read to before the warp.

**Discovery is by event, truth is by call.** RelicPay has no enumeration, so the only way to find a
user's agreements is the `AgreementCreated` log, whose `seller` and `buyer` are both indexed. Logs
supply the id set and nothing else; every rendered field comes from a live `getAgreement`, because
the log payload is frozen at creation while state, `paidInstallments` and `ownershipTransferred` all
move afterwards. `logChunkSize` defaults to 10k blocks per `eth_getLogs`, under the cap every hosted
RPC enforces.

**Overdue is derived, never read.** `PaymentSchedule.status` only advances when somebody pays for
`processOverduePayments`, so an installment a month past due still reads `Pending`. Trusting it tells
a buyer they are current while their grace period runs out. Every `isOverdue` and `defaultable` flag
is computed from `dueDate` against the pinned block timestamp; the stored value is still returned as
`storedStatus`, and the seller dashboard surfaces the gap as `summary.staleSchedules` since the
seller is the one who would pay to close it.

Two getter quirks are papered over here rather than in the UI. `getDefaultStatus`,
`getSettlementTerms` and `getSettlementReadiness` all return zeros for a non-Active agreement, so
`outstanding` is computed as `totalPrice - totalPaid` instead of taken from the getter (otherwise a
defaulted agreement with real debt renders as settled), and `settlement` is `null` rather than a
zero-filled object (whose zero token address is indistinguishable from "settles in ETH").
Similarly, `CreditLine.creditUtilization` is clamped at 10000 bps in the contract, so the reader
returns both the clamped `utilizationBps` and a recomputed `trueUtilizationBps`, plus `isClamped`
and `isOverLimit`.

## Dashboard render model

Reads run in server components calling the reader directly; wagmi is client-side only, for wallet
identity and (part c) writes. The reasoning is in `docs/ADR-001-dashboard-reads.md`, and the short
version is that the reader's one-render-one-block pin does not survive per-field hooks, and that
`eth_getLogs` over the full deploy range does not belong in a browser.

The price of that decision is that React cannot serialize `BigInt` across the server/client
boundary, and every reader amount, timestamp and duration is one. `dashboard/lib/present.js` turns
reader output into a JSON-safe view model, still with no framework in it.

```js
const { loadDashboard } = require('./dashboard/lib');
// one call, one block, already serializable
const view = await loadDashboard(address, { role: 'buyer' }); // or 'seller'
```

`RPC_URL` is read server-side and is deliberately not `NEXT_PUBLIC_RPC_URL`: that prefix inlines a
value into the browser bundle, which hands a keyed endpoint to every visitor. Addresses may use the
`NEXT_PUBLIC_` names, since addresses are public. Set `DEPLOY_BLOCK` on a public network so
agreement discovery does not scan from block 0.

**Every amount carries its own currency, and an unknown currency renders as nothing.** The contracts
convert nothing: `getSettlementTerms` returns the raw schedule amount, so an agreement's
`totalPrice` is denominated in that agreement's settlement token and is not wei. A 6-decimal
stablecoin formatted at 18 shows `0.000000000001`. `dashboard/lib/tokens.js` resolves
`symbol`/`decimals` once per address and caches them (metadata is immutable, so it is the one read
that must sit outside the pin); a currency it cannot resolve presents as `display: null,
known: false` and the UI says so rather than showing a confident wrong number. Cross-currency totals
are grouped per currency, never added.

`assertSerializable(view)` walks the tree and names the path of anything React would reject. It runs
inside `loadDashboard` and in the suite against live reader output, so a new `BigInt` field added to
the reader fails a test instead of a render.

### The app

`dashboard/app/` is the Next.js front end, with its own `package.json` so the root install stays
small and offline for the solc + ganache suite. Full notes in
[`dashboard/app/README.md`](dashboard/app/README.md).

```bash
npm install                 # repo root, once: the data layer resolves viem from here
cd dashboard/app && npm install && cp .env.example .env.local && npm run dev
```

`/buyer?address=0x...` and `/seller?address=0x...` are server components calling `loadDashboard`;
add `&at=<block>` to pin the same view to a historical block. **The route is the source of truth for
whose dashboard this is**, so every view is a link that can be copied, bookmarked and reloaded
without reconnecting a wallet, and wagmi's whole job is the connect button that writes the connected
address into it.

`dashboard/lib/routes.js` decides what a URL means, and it lives in the framework-free layer because
the route is where a dashboard takes its one piece of user input. It never throws: `loadDashboard`
hands its address straight to viem, and a viem throw inside a server component is a 500 with a stack
trace on a page that exists to tell someone what they owe. A failed checksum is reported with a
correction rather than lowercased away, and `?address=` given twice with different values is refused
rather than resolved by picking one.

## Dashboard write layer

`dashboard/lib/writes.js` turns an intention into the exact transaction to send. Framework free like
the rest of the directory, so the request the browser hands to wagmi is the request the mocha suite
sends to ganache.

```js
const { planAction, resolveAfter, isPlanStale } = require('./dashboard/lib');

const plan = planAction('payInstallment', { agreementId }, { relicPay, view });
if (!plan.ok) show(plan.reason);          // prose, because a person reads it
for (const step of plan.steps) await write(step.request);  // approve, then pay
const { reload, blockNumber } = resolveAfter(plan, receipt);
```

A plan is a **list** of steps, because approve-then-pay is two transactions; it declares the
**scopes** it can move, so a write in flight disables its own region instead of the page; and it
records the block it was planned at, so `isPlanStale` catches a plan clicked after a reload.

See `docs/ADR-002-dashboard-writes.md` for the model. The short version: the pinned snapshot is
immutable, a write replaces it rather than patching it, and the reload re-pins at
`receipt.blockNumber` rather than at `latest`, since refetching on send races the miner and renders
a block from before the transaction.

Two things the layer exists to get right. `processPayment` is `payable` but only `_settleManual`
reads `msg.value`; the Collateral, Auto and AutoWithCollateral branches ignore it, so ETH attached
to one of those is accepted, the collateral draw happens anyway, and the attached ETH is left in the
contract owed to nobody. The planner computes `value` from currency and method together and emits
`0n` everywhere except ETH-settled Manual. And the preflight is advisory: it runs against a pinned
block, so every rejection it produces is also sent to the chain in the suite to prove the chain
refuses it too, because a rule that blocks a payment the contract would have accepted is worse than
no rule at all.

Not offered, because it does not exist: **RelicPay has no collateral withdrawal function.** Posted
collateral leaves only through a payment draw or a default seizure. See the roadmap.

## v2 fixes over v1
Seller-approved early-payoff discounts (was: buyer could settle for free), collateral withdrawal blocked below credit backing, credit lines recomputed from live collateral, governance executes only the exact proposed actions, `call` instead of `transfer` everywhere, strict installment sequence with prepayment allowed, integer-division remainder added to the final installment, and a new issuer-gated RelicRegistry for asset tokenization (the MVP flow: mint relic, finance via BNPL, ownership transfers on final payment).

## Deploy (Sepolia and Base Sepolia)
`script/` holds Foundry deploy scripts, adapted from the legacy `script/` folder to import from `contracts/` instead of `src/`. This runs with Foundry on your Mac, not the offline mocha suite.

One-time setup:
```bash
forge install foundry-rs/forge-std --no-commit
npm install   # provides @openzeppelin/contracts for the foundry.toml remapping
```

Set env vars: `PRIVATE_KEY`, and either `INFURA_API_KEY` or `ALCHEMY_API_KEY` (matching the RPC endpoint you pick), plus `ETHERSCAN_API_KEY` (Sepolia) or `BASESCAN_API_KEY` (Base Sepolia) if verifying. `foundry.toml` grants the scripts write access to `deployments/` only.

ADR-011 makes Base Sepolia the dress rehearsal for Base mainnet. `DEPLOY_NETWORK` names the target (`sepolia`, the default, or `base-sepolia`); `DeployAll` reverts unless the RPC's chain id matches (11155111 and 84532) and writes `deployments/<DEPLOY_NETWORK>.txt`. The demo, pilot and monitor tools take the same names, and the demo and pilot also refuse an `RPC_URL` on the wrong chain.

Deploy the Phase 1 MVP stack in one shot (RelicRegistry + RelicPay + PriceOracle + DeFiIntegration, wired so the deployer can mint and RelicRegistry is an authorized RWA source):
```bash
forge script script/DeployAll.s.sol:DeployAllScript --rpc-url sepolia --broadcast --verify -vvvv

# Base Sepolia rehearsal
DEPLOY_NETWORK=base-sepolia forge script script/DeployAll.s.sol:DeployAllScript \
  --rpc-url base_sepolia --broadcast --verify -vvvv
```
Set `GOVERNANCE_TOKEN_ADDRESS` as well and the same script also deploys `RelicPayGovernance` and
brings the stack up already governed: it appoints the governance contract as governor on RelicPay,
PriceOracle and DeFiIntegration, and allowlists exactly the parameters each one implements (6, 2
and 2). Leave the variable unset and you get the ungoverned MVP stack, which is fully functional
under its owner. Wiring this by hand afterwards is a dozen transactions across three contracts
where one forgotten call shows up as a proposal that passes and then reverts at the end of a two
day timelock, so prefer letting the script do it.

Addresses land in `deployments/<DEPLOY_NETWORK>.txt` (`deployments/sepolia.txt` by default), including `GOVERNANCE=` (zero address when ungoverned).
Individual contracts (including Bnpl, EnhancedBnpl, and RelicPayGovernance) each have their own
script for standalone deploys.
