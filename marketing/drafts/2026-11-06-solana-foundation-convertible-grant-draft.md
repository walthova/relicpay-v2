# Solana Foundation grant application (DRAFT, not submitted)

Status: DRAFT for Walter. Nothing has been submitted. Apply at https://solana.org/grants (rolling, no deadline listed; ~1 week review, ~3 week decision per the official page, fetched 2026-11-06).
Track to choose: **milestone-based convertible grant** (the page says primarily commercial projects usually do not qualify for a standard grant). Amounts are not listed on the official page; third-party sources cite $5k to $100k, unverified.
Items marked [WALTER] are facts only Walter can supply. The official form's exact fields were not inspected; map these sections to it when opening the form.
Tension to decide: a convertible grant converts to investment on milestones such as a priced round. Check terms in the Foundation's convertible-grants article before applying.

## Project overview
Relic Pay is buy now, pay later where the payment plan makes the buyer money. A buyer locks USDC in an on-chain escrow and pays in installments with no credit check. While funds sit in escrow they earn yield in a Solana lending market (Kamino Lend first), so the plan earns instead of costing late fees. Merchants are paid by program rules, without the 3 to 6 percent BNPL fee.

## Why Solana
Installment escrow with inline deposit into and redemption from a lending market in the same transaction needs low fees and fast finality, and Solana's composability. Every exit (withdraw, cancel, default) redeems inline. A raw-USDC fallback means a lending outage never blocks checkout.

## Public-good component (the part the Foundation weighs)
- Open-source Anchor program, checkout SDK (`packages/checkout`), and test suite, public on GitHub.
- Reusable pattern: escrow that deposits into and redeems from a lending market atomically, with emergency pause and deposit caps.
- Original research: "The Liquidation Tax" on Dune (89% of Aave v3 liquidations in the last 12 months hit positions under $10,000): https://dune.com/walthova/the-liquidation-tax

## Current state (honest)
- Modular Anchor v2 program; 89 anchor tests passing, 10 cargo tests passing (2026-11-06).
- Checkout SDK with a merchant data layer (receivables, overdue exposure, default recovery, pending payouts) and a merchant dashboard page, built 2026-11-05 and 2026-11-06. Withdraw and default buttons are not yet wired.
- Devnet only. Not on mainnet. Yield integration is tested against a local mock; real Kamino on devnet is not yet exercised. No users yet. Solo, part-time founder. [WALTER: confirm entity/team facts.]

## Milestones and budget (proposal, $0 assumed spent to date)
Budget total: [WALTER: amount]. Suggested structure:
1. Real Kamino klend integration tested on devnet, public demo at relicpay.app: [WALTER: $]. Evidence: recorded devnet agreement with yield accrual.
2. Independent security review of the escrow and adapter: [WALTER: $]. Evidence: published report.
3. Merchant dashboard transactions wired; first merchant pilot live on devnet (IBG Collection as merchant one): [WALTER: $].
4. Mainnet launch with deposit caps: [WALTER: $]. Evidence: mainnet program address and caps.

## Team
[WALTER: bio. Prior drafts lean on 12+ years running identity, security and compliance for a 600+ person org, per the a16z draft; confirm before reuse.]

## Risks stated up front
Smart contract risk (mitigated by pause, caps, review), lending-market dependency (fallback path), regulatory treatment of BNPL (no credit extended by the protocol beyond escrowed funds; [WALTER: confirm legal view]).
