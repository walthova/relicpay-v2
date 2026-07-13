# Solana Foundation Funding Draft

_Apply: https://solana.org/grants-funding_

_Status: Draft. Do not submit without Walter approval._

## Recommended Grant Type

Start as a Solana Foundation convertible grant candidate if Relic Pay is framed
as a commercial protocol with public-good infrastructure. If the application
needs to stay purely non-dilutive, narrow the ask to open-source escrow,
checkout, and risk-control primitives.

## Project Overview

Relic Pay v2 is an open-source Solana protocol for yield-bearing BNPL. It lets
buyers create non-custodial installment agreements with USDC escrow, merchant
settlement rules, and transparent yield accounting. The first merchant proof is
IBG Collection, where art/fashion purchases provide a real-world checkout story
instead of an abstract DeFi dashboard.

The protocol is built around Solana-native primitives: PDAs for escrow and
agreement state, SPL token transfers for USDC payments, typed Anchor
instructions, on-chain events, and risk controls before funds route to external
yield. Today the demo uses simulated yield for safety and clarity. The next
milestone routes escrow USDC into Kamino Lend through CPI, with a raw-USDC
fallback path so checkout does not depend on a DeFi venue being available.

## Why This Is A Solana Public Good

- Demonstrates a consumer checkout primitive that is only practical with fast,
  low-cost settlement.
- Provides open-source examples for non-custodial installment escrow, merchant
  recovery, close/rent cleanup, and protocol-level pause/cap controls.
- Converts idle USDC in payment plans into productive capital without selling
  the buyer's crypto.
- Creates a bridge from independent merchants into Solana without requiring
  them to understand DeFi.

## Why Solana

Relic Pay needs low-cost, high-frequency transactions for installment creation,
payment updates, escrow settlement, merchant withdrawal, and eventual yield
movement. The buyer experience breaks if each payment costs too much or takes
too long. Solana also gives Relic Pay composability with SPL USDC, Kamino Lend,
wallets, PDAs, and on-chain events in one execution environment.

## Proposed Ask

> TODO: Choose amount. Suggested first ask: $10,000-$25,000 equivalent, milestone based.

## Milestones

| Milestone | Deliverable | Target Date | Budget Use |
|---|---|---|---|
| Public v2 launch | Public repo, README, docs, devnet demo, and legacy repo cleanup | 2026-07-15 | Documentation, polish, QA |
| IBG pilot flow | IBG checkout demo, screenshots, demo video, and one completed devnet flow | 2026-07-22 | Frontend/demo work |
| Kamino CPI design | Technical design, fallback path, risk-control extension, and devnet test plan | 2026-07-29 | Protocol engineering |
| Kamino CPI prototype | Escrow supply/redeem prototype against devnet or mocked market with tests | 2026-08-12 | Protocol engineering |
| Public merchant SDK plan | Merchant integration spec, hosted checkout flow, and onboarding docs | 2026-08-26 | Developer docs and merchant UX |

## Evaluation Alignment

Solana's funding guidance asks applicants to explain public-good impact,
open-source posture, why the project must be on Solana, and clear milestone use
of funds. This draft maps directly to those criteria.

## Remaining Inputs

- Final ask amount.
- Final public repo URL after visibility switch.
- Final demo URL.
- Whether to apply as standard grant or convertible grant.
- Walter's contact email and entity/person details for the form.

