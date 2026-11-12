# ADR-012: The credit line counts recorded principal only

Status: accepted. Closes the follow-up named in ADR-010.

## Problem
ADR-010 capped settlement draws and seizures at `collateralPrincipal`, so simulated yield could no
longer be paid to a seller. The credit line still summed `position.amount` plus `stakingRewards`, both of
which include value backed by nothing. A buyer with a year of simulated yield was granted a limit above
what any draw or seizure could ever settle, and a collateral-method payment against that headroom reverted
`Insufficient collateral` (ADR-010, consequences).

## Options
1. Value credit at recorded principal only (chosen).
2. Keep valuing yield and add a haircut. Rejected: any nonzero credit for unbacked value is a hole, and a
   haircut is a parameter someone has to defend.
3. Back yield with a real source. Out of scope, as in ADR-010.

## Decision
`_getCollateralValue(user, positionId)` returns `collateralPrincipal`, capped at `position.amount` as a guard
for the `principal <= amount` invariant, and normalized to ETH wei through the oracle for plain ERC20
positions as before (ADR-009). `stakingRewards` is no longer added: it is a simulated 0.5 percent bonus on
staked ETH deposits and is unbacked in the same way. The field stays on `CollateralPosition` for ABI
stability and is still recorded.

The credit-bearing value now equals what `getSettlementCollateral` reports for the ETH path, so the line a
buyer is granted and the collateral a draw or seizure can take agree by construction.

## Consequences
- Credit limit is `principal * creditLimitRatio`. Yield never lifts it. A buyer is never granted credit that
  settlement cannot cover from real deposits.
- `getWithdrawableCollateral` was a floor only because a pending accrual could raise the credit headroom
  term. It is now exact on every term. The dashboard reader (`mayAccrue`) and the extension quote
  (`mayCreditGrow`) gate the floor and softened-refusal handling behind `ACCRUAL_RAISES_CREDIT = false`.
  The downstream branches stay in place and tested, so a real yield source could reverse this in one place.
- An extension quote over the line is a refusal again, with no `unconfirmed` softening on account of
  pending yield. The chain refuses the same terms, so the layer is no longer more permissive than the
  contract.
- Existing positions are re-valued the next time the credit line is touched. A buyer whose open credit was
  covered only by yield will see `creditLimit < usedCredit` after the next touch. Open agreements are not
  affected (no forced action), but `withdrawCollateral` will revert `CollateralBacksOpenCredit` until the
  line is covered. Acceptable for the pilot, where no such position exists; flag it in any mainnet migration.
- Behaviour change from v1 and from earlier v2 builds: staked ETH no longer earns credit for the bonus.
  Legacy is untouched.
