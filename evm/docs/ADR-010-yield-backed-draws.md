# ADR-010: Settlement draws and seizures are bounded by principal (FINDING-1)

Status: accepted. Resolves FINDING-1 from the Foundry invariant suite.

## Problem
Simulated yield (`_updateYield`, default 5% with autoReinvest) raises `position.amount` without any ETH
or token entering the contract. Default seizure and collateral-method payment draws took
`position.amount`, credited the seller's pull balance, and so sellers could be owed more than the
contract holds. The gap came out of other users' deposits.

## Options
1. Cap draws and seizures at `collateralPrincipal` (chosen).
2. Back yield with a real source (staking, lending). Out of scope: nothing in the contract earns a return.

## Decision
`_withdrawFromCollateral`, `_drawCollateralInToken` and `_seizeCollateral` take at most
`collateralPrincipal[user][positionId]`. `getSettlementCollateral` reports the same figure so the
preflight matches what a draw can take. `_reducePrincipal` still saturates; with the cap it now never
needs to.

## Consequences
- Every seller credit is backed by a real deposit. ETH solvency holds with simulated yield on.
- Yield above principal stays in `position.amount`, counts toward the credit line (unchanged), and is
  not payable or withdrawable. A buyer whose credit is inflated by yield can see a payment draw revert
  `Insufficient collateral` where it would have passed before. Superseded in part by ADR-012, which
  excludes unbacked yield from the credit line.
- Sellers recover less on default when the buyer's position had accrued yield. That is the correct
  outcome: the extra was never funded.
