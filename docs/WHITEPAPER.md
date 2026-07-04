# Relic Pay Whitepaper
### Decentralized Buy Now, Pay Later — Where Your Payment Plan Makes You Money
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

Relic Pay is a decentralized, non-custodial Buy Now Pay Later (BNPL) protocol built on Solana. It allows crypto holders to use their digital assets as collateral to generate instant credit lines — without selling their positions.

The protocol's defining innovation: the funds locked in escrow during the repayment period are automatically deployed into DeFi yield strategies. This means the buyer earns interest on their locked capital while paying back. The merchant receives full payment on completion. The seller gains access to a new category of buyer — the crypto holder who refuses to sell.

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

Relic Pay inverts this: the borrower's locked capital earns yield during the repayment period, partially or fully offsetting the cost of the installment plan.

### Merchants Lose Crypto-Native Sales
E-commerce merchants miss a significant demographic — crypto holders who actively avoid fiat spending. Without a BNPL product that meets buyers where they are (in-wallet, on-chain), these sales are lost.

---

## 3. The Relic Pay Solution

Relic Pay introduces three key mechanics that no existing BNPL product offers simultaneously:

**1. Collateral-Based Credit Lines**
The buyer locks USDC (or approved crypto assets in v2) into a smart contract escrow. This collateral determines their credit line. No credit bureau check. No bank account required.

**2. Yield-Bearing Escrow**
While installments sit in the escrow PDA, the protocol autonomously deploys them into DeFi yield protocols (Kamino Lend in v2). The yield accrues to the buyer — not the protocol.

**3. Browser Extension Pricing**
A browser extension detects product prices on any e-commerce page and overlays the "Relic Pay Price" — the item cost minus the buyer's discount tier, based on their staked USDC balance. This makes Relic Pay pricing visible at the point of purchase.

---

## 4. How It Works — End to End

### The Four Actors

```
BUYER        — Has crypto. Wants to buy now. Pays in installments. Earns yield.
MERCHANT     — Sells goods. Receives full payment on completion. New payment rail.
STAKER       — Locks USDC. Earns 3% APY. Gets browser extension discounts.
PROTOCOL     — Smart contracts + reserve fund. Enforces rules autonomously.
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
Step 4: Yield begins accruing on $100 in escrow (3% APY, computes per-second)
           |
           v
Step 5: 30 days later — BUYER calls pay_installment()
        - Yield accrued on $100 for 30 days (~$0.25) is recorded
        - Second installment ($100) transferred: BUYER → Escrow
        - Escrow now holds $200, yield accrual continues
           |
           v
Step 6: 60 days — BUYER calls pay_installment() for final payment
        - Yield accrued on $200 for 30 days (~$0.49) recorded
        - Final installment transferred (adjusted for any remainder)
        - Agreement state → Completed
        - Total yield earned: ~$0.74 over 60 days
           |
           v
Step 7: MERCHANT calls merchant_withdraw()
        - Receives exactly $300 from escrow
           |
           v
Step 8: BUYER calls claim_yield()
        - Receives ~$0.74 USDC (from protocol reserve in v1; from Kamino in v2)
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
`DEWSsuX2icjv8Dd6VHMGYoBEUfaF1uZbwFDWrzZmMW5` (Solana devnet)

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
| `pay_installment` | Buyer | Pays next installment, accrues yield |
| `cancel_agreement` | Buyer | Early exit: 10% fee to merchant, 90% refund to buyer |
| `merchant_withdraw` | Merchant | Withdraws total_price after completion |
| `claim_yield` | Buyer | Claims earned yield after completion |
| `trigger_default` | Anyone | Liquidates escrow to merchant after grace period |
| `init_stake_pool` | Protocol admin | One-time: creates global stake pool |
| `stake_usdc` | Staker | Deposits USDC, earns yield, advances tier |
| `unstake_usdc` | Staker | Withdraws principal + yield |

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

### v1: Simulated On-Chain (Current)

Yield is computed using simple interest:

```
yield = principal × (rate_bps / 10_000) × (elapsed_seconds / 31_536_000)
```

At 3% APY (300 bps):
- $100 locked for 30 days → $0.25 yield
- $200 locked for 30 days → $0.49 yield
- $500 locked for 90 days → $3.70 yield

Yield is tracked in the `yield_accrued` field of `BnplAgreement`. Actual USDC payout at `claim_yield` comes from the protocol reserve in v1.

**Key implementation detail:** yield is computed only for the window since `last_yield_update`, not from `start_time`. This prevents double-counting as the escrow balance grows with each installment.

### v2: Kamino Lend CPI (Next Milestone)

In v2, `create_agreement` and `pay_installment` will include a Kamino Lend CPI to:
1. Deposit USDC into Kamino's USDC lending market
2. Receive kUSDC (receipt token) in the escrow PDA
3. At `merchant_withdraw` and `claim_yield`: redeem kUSDC for USDC + real yield

Target APY: 3–8% on USDC depending on Kamino utilization.

This makes Relic Pay self-sustaining — no protocol reserve needed.

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
Stakers earn 3% APY on their locked USDC AND gain checkout discounts. The more you stake, the cheaper every Relic Pay purchase becomes. This creates a flywheel: stakers are incentivized to use Relic Pay for every purchase.

---

## 8. Stakeholder Value Breakdown

### For the Buyer
- Buy now, pay in installments — no credit check
- Earn yield on locked funds while you pay
- Unlock extension discounts by staking
- Never forced to sell crypto to buy things

### For the Merchant
- Instant full payment on agreement completion (no installment risk)
- Access to a new buyer demographic: crypto holders
- No chargebacks (blockchain is final)
- Partial recovery on default (escrowed installments)

### For the Staker (yield earner)
- 3% APY on idle USDC (v1 simulated; v2 real Kamino yield)
- Discount tiers on all Relic Pay purchases
- No lockup period (unstake anytime)

### For the Ecosystem
- Idle crypto becomes productive without selling
- New payment rail that bridges DeFi and commerce
- La Familia DAO governance of protocol parameters (yield rate, fees, tiers)

---

## 9. Fee Structure

| Fee | Amount | Recipient |
|-----|--------|-----------|
| Protocol fee (v2) | 0.5% of total_price | Protocol treasury |
| Cancellation fee | 10% of escrow balance | Merchant |
| Default recovery | 100% of escrow | Merchant |
| Stake pool yield (v1) | 3% APY | Staker (from reserve) |
| Stake pool yield (v2) | Kamino APY | Staker (from Kamino) |

The protocol fee is not yet implemented in v1. It will be introduced in v2 governance.

---

## 10. Roadmap

### Phase 1 — MVP (Current)
- Anchor smart contract on Solana devnet
- Core BNPL instructions: create, pay, withdraw, default, cancel
- Stake pool with tier-based discounts
- Simulated yield (v1)
- Next.js demo frontend with Claude AI guide
- Whitepaper + technical breakdown docs

### Phase 2 — Testnet
- Anchor.toml configured for devnet public deployment
- Kamino Lend CPI integration (real yield)
- Browser extension beta (Chrome)
- IBG Collection merchant integration (first live merchant)
- Claude-powered credit assessment layer

### Phase 3 — Mainnet
- Audited smart contract (OtterSec or Neodyme)
- La Familia DAO governance (yield rate, fees, whitelist)
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
`claim_yield` zeroes `yield_accrued` before emitting the event. In v2, the Kamino CPI call follows the zero-before-transfer pattern to prevent reentrancy.

### Default Authorization
`trigger_default` is permissionless — any account can call it after the grace period. This ensures liquidation is not dependent on the protocol team being online. It is time-gated by the on-chain clock.

### Integer Overflow
All arithmetic uses Rust's `saturating_add` / `saturating_sub`. Yield math uses `u128` intermediate values to prevent overflow on large principals.

### Price Oracle (v2)
Collateral LTV ratios in v2 will rely on a Pyth Network price feed. Stale price protection (price older than 60 seconds is rejected) will be enforced on-chain.

### Audit Status
v1: unaudited prototype. v2 testnet will be submitted for a security review before mainnet launch.

---

## 12. Conclusion

Relic Pay is the first BNPL protocol designed explicitly for the crypto holder. By combining on-chain escrow, automated yield, and browser-level price overlays, it creates a financial product that is better for buyers (earn while you pay), better for merchants (new customers, guaranteed payment), and better for the ecosystem (idle capital becomes productive).

The protocol is built on Solana for speed and cost — a $300 purchase agreement costs under $0.01 in fees. It is governed by smart contracts alone, with La Familia DAO providing the governance layer for long-term parameter evolution.

Relic Pay does not ask crypto holders to give up their assets to participate in commerce. It asks them to let their assets work harder.

---

*Relic Pay is a work in progress. This whitepaper describes the v1 architecture and v2 roadmap as of May 2026. All yields described are estimates and not financial advice.*

*Built by Walter Mendez | github.com/walthova/relicpay-claude | relicpay.app*
