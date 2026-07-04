# Relic Pay — DeFi Yield Engine
### How We Find, Optimize, and Protect Yield for Our Holders

---

## The Core Idea

Relic Pay is not a single yield source. It is a yield intelligence layer.

When a buyer locks USDC into a Relic Pay escrow, that capital does not sit idle. The protocol continuously routes it through the highest-yielding, lowest-risk DeFi opportunities available on-chain — automatically, transparently, and with the buyer's safety as the primary constraint.

This is not a fixed 3% APY. That number is the floor. The ceiling is what the DeFi market makes available at any given moment.

---

## The Yield Stack (v1 → v3)

### v1 — Simulated Yield (Current)
Yield is calculated on-chain using simple interest math and tracked in the `yield_accrued` field of each agreement. Actual USDC payouts come from the protocol reserve fund. This lets us demonstrate the mechanic cleanly before wiring real DeFi integrations.

**Rate:** 3% APY (fixed)
**Source:** Protocol reserve

---

### v2 — Single-Protocol CPI (Next Milestone)
The escrow PDA deposits directly into **Kamino Lend** via Cross-Program Invocation (CPI) on every installment payment. Kamino's USDC lending market currently yields 4–8% APY depending on utilization. The escrow holds kUSDC (Kamino's receipt token) during the payment period and redeems it at completion.

**Rate:** 4–8% APY (variable, real)
**Source:** Kamino Lend lending supply

---

### v3 — Multi-Protocol Yield Router (Roadmap)
The protocol deploys a Yield Router program that monitors APY across approved protocols in real time and allocates escrow capital to the highest-yielding option at each installment cycle.

**Approved protocol list (subject to governance vote):**

| Protocol | Type | Target APY | Risk Level |
|---|---|---|---|
| Kamino Lend | Lending | 4–8% | Low |
| MarginFi | Lending | 3–7% | Low |
| Solend | Lending | 3–6% | Low |
| Jupiter Perpetuals | LP fees | 5–12% | Medium |
| Marinade Finance | Liquid staking | 6–8% | Low |
| Jito | MEV + staking | 7–10% | Low-Medium |

The Yield Router never allocates to protocols with:
- Unaudited smart contracts
- Less than $10M TVL
- No on-chain price oracle
- Governance attack history

---

## How the Router Works (v3 Architecture)

```
Every pay_installment() call:

1. Yield Router queries APY oracle for all approved protocols
2. Compares current allocation vs. best available rate
3. If reallocation improves yield by > 50 bps: rebalance
   - Withdraw from current protocol via CPI
   - Deposit into better protocol via CPI
4. Receipt tokens held in escrow PDA
5. On completion: redeem all receipt tokens → USDC → buyer + merchant

Smart contract enforces:
- Max 40% in any single protocol (diversification)
- Minimum 3-day lockup before reallocation (prevents MEV)
- Emergency pause (La Familia DAO multisig)
```

---

## Why This Matters for Holders

Traditional BNPL is a wealth transfer: the borrower pays interest to a bank. Relic Pay inverts this.

| Scenario | Traditional BNPL | Relic Pay |
|---|---|---|
| Buy a $300 item, 3 payments | Pay ~$15 in fees/interest | Earn ~$3–12 in yield |
| Hold $500 staked | Earn nothing | Earn $15–50/yr + discounts |
| Miss a payment | Credit score damage | Lose only escrowed installments |

The longer your payment plan, the more yield you accumulate. A 12-installment, 12-month plan on a $1,000 item at 7% APY earns approximately **$35 back** — nearly offsetting an installment.

---

## Intelligence Layer: Finding the Best Yield

In v3, a Claude-powered AI agent monitors DeFi conditions daily and:

1. Scans APY across 20+ Solana DeFi protocols
2. Filters by risk parameters (audit status, TVL, oracle quality)
3. Simulates reallocation impact on current escrows
4. Proposes rebalancing transactions for governance approval
5. Alerts holders if a protocol in their escrow shows anomalous behavior

This is Relic Pay's moat: not just smart contracts, but active intelligence deployed in service of the holders.

---

## Security Constraints on Yield

The yield engine operates under hard constraints that cannot be overridden by any single actor:

- **No leverage.** Yield comes from lending supply and staking — never leveraged positions.
- **No bridges.** All yield protocols must be native Solana. No cross-chain bridge risk.
- **Escrow is sovereign.** The escrow PDA can only receive and send USDC/kTokens per program logic — no arbitrary instructions.
- **Governance gated.** Adding a new protocol to the approved list requires a La Familia DAO vote with 7-day timelock.
- **Emergency exit.** Any holder can trigger withdrawal to raw USDC escrow (forfeiting yield) if they believe protocol risk is elevated.

---

## For Merchants

Merchants always receive exactly `total_price` in USDC on agreement completion — regardless of yield performance. They bear zero DeFi risk. The yield accrues exclusively to the buyer (and a small protocol fee).

---

*This document describes v1 (current), v2 (next), and v3 (roadmap) architecture. All APY figures are estimates based on current market conditions and will vary. Nothing here is financial advice.*

*github.com/walthova/relicpay-claude*
