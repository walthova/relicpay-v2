# ADR-009: collateral valuation across mixed decimals

Status: decided (part a). Implementation is part b.

## Problem
`RelicPay._getCollateralValue` returns `amount + stakingRewards` in raw token units. Credit limits,
`getWithdrawableCollateral`, the withdrawal solvency check and the dashboard all read that number as
wei of ETH. Three consequences, each pinned by test/collateral-valuation.test.js:

1. 1 ETH plus 1e18 raw units of a 6-decimal token reads as 2e18, although the token amount is a
   trillion dollars of USDC or, read the other way, the same deposit of 1 real USDC is worth 1e-12.
2. `minCollateralAmount` (1e18 raw) is compared to the raw amount, so the smallest 6-decimal deposit
   accepted is 1e12 USDC and a normal 1,000 USDC deposit is refused.
3. Withdrawal headroom is computed in the same units, so it inherits both errors.

Only an 18-decimal token priced at 1 ETH happens to be right.

## Decision
Value every position in ETH wei through PriceOracle, and compare the minimum in that unit too.

- RelicPay gets an optional `priceOracle` (Governable-gated setter, zero means legacy raw behaviour
  so a fresh deploy and every existing test keep working until an oracle is wired).
- Unit: ETH wei. `valueWei = oracle.getUSDValue(asset, amount) * 1e18 / oracle.getPrice(address(0))`.
  getUSDValue is USD scaled 1e8 and already divides by the asset's decimals, so decimals stop
  mattering once the value is expressed in USD. ETH stays exact (identity path, no oracle call).
- Staking rewards and yield are already ETH-denominated simulations; they are added after
  normalization, not priced.
- Rounding goes against the buyer: the division truncates, so a position is never over-valued.
- A stale or unsupported price reverts the operations that need a value (deposit, credit refresh,
  withdrawal). Reverting is chosen over falling back to raw units, because a silent fallback
  reintroduces the bug exactly when the oracle is unhealthy. Pure views that only read stored
  `collateralValue` keep working.
- `minCollateralAmount` is enforced on the normalized value, so it means "at least 1 ETH worth".
- `getWithdrawableCollateral` converts its headroom, which is in ETH wei, back into the position's
  own units (`headroom * amount-per-wei`, rounded down), then caps by principal as before.

## Why not the alternatives
- Per-token decimals scaling only (no prices): fixes unit mismatch but values 1 USDC and 1 ETH
  equally. Wrong for any non-ETH asset.
- Store prices in RelicPay: duplicates PriceOracle and its staleness rules.

## Part b scope
Add the oracle wiring, normalize `_getCollateralValue`, the minimum check, `getWithdrawableCollateral`
and the settlement-asset draw paths that compare collateral to installment amounts, wire it into
DeployAll, then flip every BUG test in the characterization file on purpose.

## Part b outcome (shipped)
- `RelicPay.priceOracle` plus `setPriceOracle(address)`, onlyGovernance (owner or appointed governor).
  A non-zero oracle must answer an ETH price at install time. It is not a governed ParameterType,
  because that enum is part of the governance ABI; the governor role reaches it directly.
- `_toWei` / `_fromWei` are the only conversion points. Identity for ETH and whenever no oracle is
  wired. `_fromWei` probes `getUSDValue(token, 1e18)` instead of reading decimals, so the oracle
  interface RelicPay depends on is just `getPrice` and `getUSDValue`.
- Normalized: `_getCollateralValue`, the ERC20 minimum, `getWithdrawableCollateral` headroom,
  `_withdrawFromCollateral` (ETH-denominated draws), `_seizeCollateral` (including the token-settled
  fallback pass, converted through ETH wei into the settlement token) and the ETH path of
  `getSettlementCollateral`. Token-denominated paths (`_drawCollateralInToken`, a token's
  `getSettlementCollateral`) were already single-asset and are unchanged.
- Conversion rounds down in both directions. A draw that converts to zero token units is skipped
  rather than consumed, so dust is never burned.
- ETH deposits keep their existing `msg.value >= minCollateralAmount` check (identity conversion).

### Known consequence: a stale oracle blocks more than deposits
Anything that refreshes the credit line re-prices every ERC20 position, and that includes the
payment-completion path and `triggerDefault` (via `_releaseCredit`). While the ETH price is stale,
a buyer holding ERC20 collateral cannot complete a payment that releases credit, and a seller cannot
default them. This follows the revert-over-fallback decision above. The mitigation is operational:
keep the oracle fresh (ChainlinkPriceAdapter.pushAll on a keeper). Accounts holding only ETH
collateral are unaffected because ETH never calls the oracle. Worth revisiting in the monitoring
plan (Phase 3).
