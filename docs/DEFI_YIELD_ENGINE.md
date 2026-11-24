# Relic Pay — DeFi Yield Engine

Relic Pay's goal is to put staked collateral to work in approved DeFi markets. A yield agent is in development to compare available yields and monitor the safety and liquidity of those positions. There is no live yield, fixed APY, or minimum return.

## What the demo does today

| Path | What it does | What it does not do |
|---|---|---|
| Stake pool | Records simulated rewards using a capped, authority-configurable demo rate. A full unstake pays only from vault USDC above total staked principal. Unfunded rewards remain recorded and can be requested later with `unstake_usdc(0)`. | It does not deploy staked USDC to DeFi. A direct USDC transfer to the vault funds demo rewards and does not count as principal. |
| BNPL escrow | Tracks simulated yield per agreement. The simulated `claim_yield` updates state and emits an event; it does not pay USDC. | It does not promise the buyer a return or automatically offset installments. |
| Kamino escrow adapter | Deposit and reconciled exits have been tested against a local mock reserve. This work is separate from the stake pool. | Local mock results do not validate live returns or liquidity. |

See [the security model](../SECURITY.md) for the stake pool's payout rule and current limitations.

## What the yield agent is for

1. Compare available returns on approved Solana DeFi markets, accounting for fees, liquidity, and protocol risk.
2. Help allocate staked collateral within explicit exposure limits and monitor positions for changes in risk or withdrawal liquidity.
3. Support a safe exit to USDC when market conditions or risk limits require it.

The stake pool still needs a real yield adapter that distinguishes deployed principal, withdrawn principal, and realized rewards. Any future return would vary with market conditions and could be zero. Live-market validation and an independent security review are required before mainnet.
