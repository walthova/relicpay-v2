# Relic Pay Pitch Packet

_Status: Reusable source for grants, hackathons, partner pitches, and deck work._

## One-Liner

The only BNPL where your payment plan makes you money.

## Plain-English Pitch

Relic Pay lets crypto holders buy real-world goods in installments without
selling their crypto or going through a credit bureau. The buyer locks USDC into
a Solana escrow, pays over time, and the locked repayment capital is modeled as
yield-bearing today. The next milestone routes that escrow into Kamino Lend so
the payment plan can earn real yield.

## The Problem

Traditional BNPL grew by making "four easy payments" feel separate from debt.
But the model still depends on consumer credit, late fees, merchant fees, and
increasingly institutional debt markets. Crypto holders have a different
problem: they may have liquid assets, but selling them creates tax, timing, and
portfolio tradeoffs.

## The Solution

Relic Pay turns checkout escrow into programmable Solana infrastructure:

- Buyer creates an installment agreement.
- USDC is locked in a PDA escrow.
- Merchant settlement follows on-chain rules.
- Buyer yield is tracked transparently.
- Governance can pause new risk and cap agreement size.
- Kamino Lend CPI is the next real-yield path.

## Why Now

- BNPL is increasingly being treated as credit by markets and regulators.
- Stablecoin checkout is becoming more normal for crypto-native buyers.
- Solana makes low-cost, fast installment updates practical.
- Kamino and other Solana money markets create a credible yield path.
- IBG Collection gives Relic Pay a real merchant story instead of a synthetic demo.

## Why Solana

Relic Pay needs cheap, frequent transactions and composability in one execution
environment: SPL USDC, PDAs, Anchor programs, wallet UX, on-chain events, and
eventual Kamino CPI. A slow or expensive chain breaks the checkout experience.

## Proof

- v2 Anchor rebuild complete.
- Frozen v1 characterization suite retained as behavior spec.
- v2 feature suite added for new behavior.
- Rust unit tests cover math.
- Pause and per-agreement cap risk controls shipped.
- `yield_source` field added to distinguish simulated and future real yield.
- IBG Collection identified as first merchant proof surface.
- Lovable Relic Pay v2 and IBG Collection sites exist as production-facing surfaces.

## Current Limitations

- Current devnet yield is simulated.
- Kamino CPI is not live yet.
- IBG merchant wallet is still a placeholder in the local demo app.
- Mainnet requires audit, legal review, real merchant wallet configuration, and conservative TVL caps.

## Roadmap

1. Public canonical repo and clean README.
2. Relic Pay v2 homepage aligned with funding story.
3. IBG devnet checkout demo and video.
4. Kamino CPI technical design.
5. Kamino CPI prototype with fallback path.
6. Merchant checkout SDK/spec.
7. Mainnet readiness: audit, legal, caps, monitoring.

## Ask Variants

### Superteam Agentic Engineering

> 200 USDG to support continued agent-assisted public buildout: repo
> canonicalization, funding packet, demo polish, and Kamino CPI planning.

### Solana Foundation

> Milestone funding for open-source Solana BNPL escrow infrastructure: protocol
> risk controls, checkout demo, merchant integration docs, and Kamino CPI
> prototype.

### Colosseum

> Compete for the next Solana hackathon / accelerator path with Relic Pay as a
> working consumer checkout protocol that can turn payment escrow into productive
> capital.

### Kamino

> Partner on the first consumer checkout use case where Kamino Lend powers
> yield-bearing BNPL escrow rather than a traditional DeFi dashboard.

### Merchant Partner

> Pilot a checkout option for high-ticket art/fashion pieces where buyers can
> pay over time without selling crypto and without merchant dependence on legacy
> BNPL providers.

## Hard Questions And Answers

**Is this real yield today?**

> Not yet. The devnet demo shows simulated yield so the flow is safe and clear.
> Kamino Lend CPI is the next milestone for real yield.

**Is this consumer debt?**

> It is an on-chain installment agreement backed by escrowed assets. The pitch
> should avoid pretending regulatory questions do not exist; legal review is a
> mainnet blocker.

**Why would a merchant care?**

> Relic Pay gives merchants access to crypto-native buyers who do not want to
> sell assets, while reducing dependency on legacy BNPL fee structures.

**Why would a buyer care?**

> They can preserve crypto exposure, avoid credit checks, and eventually earn
> yield on locked repayment capital.

**What is the biggest execution risk?**

> Real-yield integration and consumer-finance compliance. That is why the v2
> roadmap adds risk controls, caps, pause mechanics, and legal/audit gates before
> mainnet.

