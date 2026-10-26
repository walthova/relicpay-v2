# X Thread Draft: Kamino-backed from the first USDC

*Drafted 2026-10-26 by relicpay-growth. NOT reviewed, NOT approved, NOT posted.
Anchored on shipped work: `create_agreement_kamino` (commit `df51ef8`) and
`pay_installment_kamino` (commit `aa1d2b9`). Suite: anchor 70/70, cargo 6/6, per
docs/progress/2026-10-26.md. Devnet only; do not imply mainnet.*

---

**Tweet 1**

Your payment plan should not sit idle while you pay it off.

Relic Pay now puts your first installment to work the moment the plan starts, in the same transaction that creates it.

**Tweet 2**

How it works: you check out, the agreement is created, and your first USDC installment is deposited into Kamino Lend. Every later installment does the same.

You earn while you pay. No separate deposit step, no second signature.

**Tweet 3**

What if the yield source has a bad day?

If Kamino is disabled or its reserve is paused, the deposit falls back to plain USDC in escrow. The purchase still goes through. A DeFi outage never blocks checkout.

**Tweet 4**

Getting out is also one transaction. Withdraw, cancel, or default all redeem from Kamino inline, then split fees and refunds against the true balance.

**Tweet 5**

Under the hood: modular Anchor program, emergency pause, per-agreement deposit caps, 70 passing program tests. Live on devnet, not mainnet yet.

Repo and demo: [relicpay.app / GitHub link, confirm before posting]

---
Notes for Walter: confirm the Kamino path is exercised against a mock reserve in tests (real devnet Kamino market integration is the next build item), so tweet 2 should say "devnet" explicitly if posted before that lands.
