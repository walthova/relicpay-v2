# RelicPay v2: Product Source of Truth

Last updated: 2026-11-08. Source: "RelicPay Concept: Agent Buy Now, Pay Later (Investor Brief)", November 5, 2026.
If this file and any other doc disagree on product direction, this file wins. `SECURITY.md` wins on security facts.

## The concept

**Credit for you and your agent.**
Let your AI agent buy now and pay later, inside limits you control, with keys you keep.

AI agents are becoming a major new class of buyers, and they pay with stablecoins. Almost every agent payment system is built for agents spending money that is already there. Almost nobody offers agent credit. RelicPay's goal is to be the first protocol where an AI agent can buy now and pay later on its owner's behalf, inside limits the owner sets, with the owner keeping their own keys.

## Envisioned flow

1. Owner stakes collateral and unlocks a credit line (80% LTV against staked USDC).
2. Owner grants their agent a spending permission: cap, approved merchants, time window.
3. Agent buys through an agent payment rail such as x402.
4. RelicPay pays the merchant up front in USDC and opens a repayment plan for the owner.
5. Repayment builds trust for owner and agent, unlocking better terms.
6. Owner can revoke the agent instantly.

## Trust and safety design (requirements for all code)

- Hard caps per purchase and per period.
- Human approval above a threshold or for anything irreversible.
- On-chain record of every agent purchase, for audit and disputes.
- Agent identity and reputation tied to the owner's wallet.
- Principle: not unhackable, but not worth hacking.
- The agent key can never move collateral, raise its own limits, or undo a revoke.

## What this repo actually has today (verified 2026-11-08)

Be exact about this in every pitch. The investor brief lists some items as "already on devnet" that are not.

| Brief claim | Reality in this repo |
|---|---|
| Self-custody credit wallet on Solana, USDC first | Partial. Buyer funds sit in a PDA-owned escrow; there is no wallet product. |
| Collateralized credit line, 80% LTV against staked USDC | **Not built here.** Staking exists (`stake_usdc`) but does not back credit. Built in `relicpay-agents` (hackathon repo). |
| Sellers paid up front in USDC | **Not built here.** v2 pays the merchant after the buyer completes all installments. Built in `relicpay-agents`. |
| Collateral earns yield during repayment | Escrow yield exists (simulated, plus a Kamino adapter). |
| Bounded agent permissions, one-tap revoke | **Added 2026-11-08** as `AgentMandate` (`instructions/agent_mandate.rs`): per-purchase cap, period cap, purchases per period, approved merchants, expiry, owner co-sign above a threshold, one-tap revoke. Local commit only. |
| On devnet | **No.** The program is not deployed to devnet. `relicpay-agents` is the devnet build. |

## Build direction

- New work should move v2 toward the flow above: credit line against collateral, merchant paid up front from a liquidity pool, agent mandates, repayment-based trust.
- `relicpay-agents` (separate repo, MLH hackathon) is the working prototype of that flow. Port proven pieces back here deliberately, with tests.
- Keep the frozen v1 characterization suite (`tests/characterization.ts`) untouched. New behavior gets new tests.

## Open decisions (Walter's call)

- Which agent payment standard first (x402 is the strongest early candidate).
- Agent identity approach: KYA, ERC-8004, or RelicPay native.
- Liability and dispute flow when an agent buys the wrong thing.
- How agent repayment history feeds the trust ladder.
- Whether IBG Collection is the first merchant for agent purchases.

## Status

Concept stage. Core protocol unaudited, not on mainnet. Independent audit before mainnet.
