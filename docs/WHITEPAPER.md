# Relic Pay Whitepaper
### Buy Now, Pay Later with a DeFi Yield Roadmap
**Version 1.0 | May 2026**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Problem](#2-the-problem)
3. [The Relic Pay Solution](#3-the-relic-pay-solution)
4. [How It Works — End to End](#4-how-it-works--end-to-end)
5. [Smart Contract Architecture](#5-smart-contract-architecture)
6. [The Yield Engine](#6-the-yield-engine)
7. [The Browser Extension](#7-the-browser-extension)
8. [Stakeholder Value Breakdown](#8-stakeholder-value-breakdown)
9. [Fee Structure](#9-fee-structure)
10. [Roadmap](#10-roadmap)
11. [Security Considerations](#11-security-considerations)
12. [Conclusion](#12-conclusion)

---

## 1. Executive Summary

Relic Pay is a non-custodial Buy Now Pay Later (BNPL) protocol built on Solana. It allows crypto holders to use their digital assets as collateral to generate instant credit lines — without selling their positions.

The goal is to put staked collateral to work in approved DeFi markets. A yield agent is in development to compare available yields and monitor the risk of those positions. Demo yield is simulated; there is no live yield or fixed APY. The installment program pays the merchant when the buyer completes the plan.

Relic Pay does not require banks, credit checks, or intermediaries. It is governed by smart contracts alone.

---

## 2. The Problem

### Traditional BNPL Fails Crypto Holders
Services like Klarna, Afterpay, and Affirm have popularized installment payments for consumers. But they operate entirely in fiat rails — inaccessible to the hundreds of millions of people whose primary wealth is in crypto.

A crypto holder who wants to buy a $600 piece of art from IBG Collection faces a binary choice:
- Sell crypto to buy it (taxable event, loses upside)
- Don't buy it at all

Neither outcome serves the buyer, the merchant, or the ecosystem.

### DeFi BNPL Has No Yield for Borrowers
Existing on-chain lending protocols (Aave, Compound, MarginFi) let users borrow against collateral — but the borrower pays interest to lenders. They are a cost center for the borrower.

Relic Pay is exploring whether deployed collateral can generate returns during repayment. Those returns would depend on market conditions and would not be guaranteed to offset installment costs.

### Merchants Lose Crypto-Native Sales
E-commerce merchants miss a significant demographic — crypto holders who actively avoid fiat spending. Without a BNPL product that meets buyers where they are (in-wallet, on-chain), these sales are lost.

---

## 3. The Relic Pay Solution

Relic Pay introduces three key mechanics that no existing BNPL product offers simultaneously:

**1. Collateral-Based Credit Lines**
The buyer locks USDC (or approved crypto assets in v2) into a smart contract escrow. This collateral determines their credit line. No credit bureau check. No bank account required.

**2. DeFi Yield Roadmap**
The demo tracks simulated yield. The Kamino escrow adapter has been tested against a local mock reserve. The separate stake pool still needs a real yield adapter and the yield agent is not live.

**3. Browser Extension Pricing**
A browser extension detects product prices on any e-commerce page and overlays the "Relic Pay Price" — the item cost minus the buyer's discount tier, based on their staked USDC balance. This makes Relic Pay pricing visible at the point of purchase.

---

## 4. How It Works — End to End

### The Four Actors

```
BUYER        — Has crypto. Wants to buy now. Pays in installments.
MERCHANT     — Sells goods. Receives full payment on completion. New payment rail.
STAKER       — Locks USDC. Unlocks browser extension discounts.
PROTOCOL     — Smart contracts enforce the agreement and stake pool rules.
```

### The Purchase Flow

```
Step 1: BUYER selects item at checkout (e.g. IBG Collection drop, $300)
           |
           v
Step 2: BUYER connects wallet. Chooses "Pay with Relic Pay — 3 installments"
           |
           v
Step 3: create_agreement() called on-chain
        - Agreement PDA created (stores all terms, state, yield tracking)
        - Escrow PDA created (holds USDC, owned by Agreement PDA — no human key)
        - First installment ($100) transferred: BUYER wallet → Escrow PDA
           |
           v
Step 4: Demo accounting tracks simulated yield on escrow
           |
           v
Step 5: 30 days later — BUYER calls pay_installment()
        - Simulated yield for the prior escrow balance is recorded
        - Second installment ($100) transferred: BUYER → Escrow
        - Escrow now holds $200 for the next accrual window
           |
           v
Step 6: 60 days — BUYER calls pay_installment() for final payment
        - Simulated yield for the latest window is recorded
        - Final installment transferred (adjusted for any remainder)
        - Agreement state → Completed
           |
           v
Step 7: MERCHANT calls merchant_withdraw()
        - Receives exactly $300 from escrow
           |
           v
Step 8: BUYER calls claim_yield()
        - Records the simulated claim; no USDC is transferred
```

### The Default Flow

If the buyer misses a payment and the 7-day grace period expires:

```
Anyone calls trigger_default()
  → Agreement state → Defaulted
  → All escrowed USDC transferred to MERCHANT as partial recovery
  → Buyer forfeits paid installments
```

### The Cancel Flow

If the buyer needs to exit early (before default):

```
BUYER calls cancel_agreement()
  → 10% of escrowed USDC → MERCHANT (cancellation fee)
  → 90% of escrowed USDC → BUYER (refund)
  → Agreement state → Cancelled
```

---

## 5. Smart Contract Architecture

### Program ID
See [Anchor.toml](../Anchor.toml) for the configured program ID. This is not a live yield deployment.

### Account Structure (PDA Model)

Relic Pay uses Program Derived Addresses (PDAs) — accounts owned and controlled by the smart contract itself. No private key can drain them. Only the program's own logic can authorize transfers.

```
BnplAgreement PDA
  Seeds: ["agreement", buyer_pubkey, product_id]
  Stores: all agreement terms, state, yield tracking, timestamps
  
  └── Escrow Token Account PDA
        Seeds: ["escrow", agreement_pubkey]
        Holds: USDC installments
        Authority: BnplAgreement PDA (not a human wallet)

StakePool PDA
  Seeds: ["stake_pool"]
  Stores: global pool state, total staked, yield rate
  
  └── Pool Vault PDA
        Seeds: ["pool_vault", stake_pool_pubkey]
        Holds: all staker USDC

UserStake PDA (one per staker)
  Seeds: ["user_stake", user_pubkey]
  Stores: staked amount, yield accrued, tier, last update timestamp
```

### Instructions

| Instruction | Caller | What It Does |
|---|---|---|
| `create_agreement` | Buyer | Creates agreement + escrow, pays first installment |
| `pay_installment` | Buyer | Pays next installment, records simulated yield |
| `cancel_agreement` | Buyer | Early exit: 10% fee to merchant, 90% refund to buyer |
| `merchant_withdraw` | Merchant | Withdraws total_price after completion |
| `claim_yield` | Buyer | Records a simulated claim after completion; no token transfer |
| `trigger_default` | Anyone | Liquidates escrow to merchant after grace period |
| `init_stake_pool` | Protocol admin | One-time: creates global stake pool |
| `stake_usdc` | Staker | Deposits USDC and updates the discount tier |
| `unstake_usdc` | Staker | Withdraws principal; pays demo rewards only from surplus on full unstake |

### State Machine

```
                    cancel_agreement()
          ┌─────────────────────────────────► Cancelled
          │
Active ───┤  pay_installment() (final)     ► Completed ──► merchant_withdraw()
          │                                                ──► claim_yield()
          └─────────────────────────────────► Defaulted
                    trigger_default()
```

---

## 6. The Yield Engine

### Simulated Yield (Demo)

The demo uses simple interest to illustrate accrual:

```
yield = principal × (rate_bps / 10_000) × (elapsed_seconds / 31_536_000)
```

The agreement's `yield_accrued` field records a simulated amount. The corresponding claim does not transfer tokens.

**Key implementation detail:** yield is computed only for the window since `last_yield_update`, not from `start_time`. This prevents double-counting as the escrow balance grows with each installment.

Stake pool rewards are also simulated. Any payout is limited to USDC in the vault above all stakers' principal. A direct USDC top-up funds rewards; unpaid amounts remain accrued for a later claim.

### DeFi Yield (In Development)

The Kamino escrow adapter has been exercised against a local mock. A real stake pool adapter and a yield agent to find available yields and monitor DeFi positions are in development. See the [yield engine](DEFI_YIELD_ENGINE.md).

---

## 7. The Browser Extension

The browser extension is the consumer-facing product layer. It activates on any e-commerce page where a price is detected.

### What It Does
1. Reads the page DOM for product prices
2. Fetches the user's `UserStake` PDA to read their discount tier
3. Computes: `relic_price = original_price × (1 - tier_discount_bps / 10_000)`
4. Overlays: "Pay with Relic Pay: $X" alongside the merchant's price

### Discount Tiers

| Tier | Staked USDC | Discount |
|------|-------------|----------|
| 0 | < $10 | 0% |
| 1 | $10+ | 0.5% |
| 2 | $50+ | 1.0% |
| 3 | $200+ | 2.0% |
| 4 | $500+ | 3.0% |

### Why Stake?
Staking unlocks checkout discounts. DeFi deployment of staked collateral and the yield agent are in development; demo rewards are not investment returns.

---

## 8. Stakeholder Value Breakdown

### For the Buyer
- Buy now, pay in installments — no credit check
- Unlock extension discounts by staking
- Never forced to sell crypto to buy things

### For the Merchant
- Instant full payment on agreement completion (no installment risk)
- Access to a new buyer demographic: crypto holders
- No chargebacks (blockchain is final)
- Partial recovery on default (escrowed installments)

### For the Staker
- Future access to variable DeFi yield, if deployed and realized
- Discount tiers on all Relic Pay purchases
- No lockup period (unstake anytime)

### For the Ecosystem
- Idle crypto becomes productive without selling
- New payment rail that bridges DeFi and commerce
- Planned governance of protocol parameters (approved markets, fees, tiers)

---

## 9. Fee Structure

| Fee | Amount | Recipient |
|-----|--------|-----------|
| Protocol fee (v2) | 0.5% of total_price | Protocol treasury |
| Cancellation fee | 10% of escrow balance | Merchant |
| Default recovery | 100% of escrow | Merchant |

The protocol fee is not yet implemented in v1. It will be introduced in v2 governance.

---

## 10. Roadmap

### Phase 1 — MVP (Current)
- Anchor smart contract tested on localnet
- Core BNPL instructions: create, pay, withdraw, default, cancel
- Stake pool with tier-based discounts
- Simulated yield (demo only)
- Next.js demo frontend with Claude AI guide
- Whitepaper + technical breakdown docs

### Phase 2 — Testnet
- Anchor.toml configured for devnet public deployment
- Validate the Kamino escrow adapter against a real test market
- Develop the stake pool yield adapter and yield agent
- Browser extension beta (Chrome)
- IBG Collection merchant integration (first live merchant)
- Claude-powered credit assessment layer

### Phase 3 — Mainnet
- Independent smart contract audit before launch
- Planned governance (approved markets, fees, whitelist)
- Multi-asset collateral (SOL, JitoSOL, mSOL)
- Mobile app (React Native, Solana Mobile Stack)
- Superposition.ai credit scoring layer

### Phase 4 — Scale
- Cross-chain bridging (Base, Arbitrum via Wormhole)
- Merchant SDK for plug-and-play checkout integration
- Real-world asset (RWA) collateral support
- Fiat off-ramp for merchants who prefer USD

---

## 11. Security Considerations

### PDA Ownership
All funds are held in PDAs whose authority is the program itself — not any human key. This means no individual (including the protocol team) can drain escrow funds outside of the defined instruction logic.

### Reentrancy
`claim_yield` zeroes simulated `yield_accrued` before emitting the event. It does not transfer tokens.

### Default Authorization
`trigger_default` is permissionless — any account can call it after the grace period. This ensures liquidation is not dependent on the protocol team being online. It is time-gated by the on-chain clock.

### Integer Overflow
Yield math uses checked arithmetic and `u128` intermediates. The stake pool clamps surplus to zero if the vault balance falls below total staked.

### Price Oracle (v2)
Collateral LTV ratios in v2 will rely on a Pyth Network price feed. Stale price protection (price older than 60 seconds is rejected) will be enforced on-chain.

### Audit Status
v1: unaudited prototype. v2 testnet will be submitted for a security review before mainnet launch.

---

## 12. Conclusion

Relic Pay combines on-chain installments and browser-level checkout discounts for crypto holders. Its roadmap adds DeFi deployment of staked collateral and a yield agent to find and monitor opportunities; those features are not live.

The protocol is built on Solana for speed and cost — a $300 purchase agreement costs under $0.01 in fees. It is governed by smart contracts alone, with La Familia DAO providing the governance layer for long-term parameter evolution.

Relic Pay does not ask crypto holders to give up their assets to participate in commerce. It asks them to let their assets work harder.

---

*Relic Pay is a work in progress. This whitepaper describes the prototype and roadmap. Demo rewards are simulated and are not financial advice.*

*Built by Walter Mendez | github.com/walthova/relicpay-v2 | relicpay.app*
