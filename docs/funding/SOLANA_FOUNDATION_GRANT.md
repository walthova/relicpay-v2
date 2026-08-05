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

_Status column added 2026-08-05 (today) against actual `git log` and `gh repo view` state._

| Milestone | Deliverable | Target Date | Budget Use | Status as of 2026-08-05 |
|---|---|---|---|---|
| Public v2 launch | Public repo, README, docs, devnet demo, and legacy repo cleanup | 2026-07-15 | Documentation, polish, QA | **Blocked, 3+ weeks past target.** README/docs are done and committed; repo remains private (confirmed via `gh repo view`) and local `main` is 14 commits ahead of `origin/main`. Needs Walter's push/visibility decision — see NEEDS-WALTER in `docs/progress/2026-08-05.md`. |
| IBG pilot flow | IBG checkout demo, screenshots, demo video, and one completed devnet flow | 2026-07-22 | Frontend/demo work | Demo app copy and story cards shipped (per 2026-07-13 pass); no demo video produced yet (needs 3Shapes Media production per MARKETING.md Phase 1 — no shipped milestone to film against until repo is public). |
| Kamino CPI design | Technical design, fallback path, risk-control extension, and devnet test plan | 2026-07-29 | Protocol engineering | **Done**, and exceeded: `docs/design/KAMINO_CPI_INTEGRATION.md` plus a working mock-CPI proof of concept (`mock_kamino_lend` program, deposit/redeem/pause probe instructions, 3 new tests) shipped 2026-08-05 (commits `83f4efd`, `b004d7f`). |
| Kamino CPI prototype | Escrow supply/redeem prototype against devnet or mocked market with tests | 2026-08-12 | Protocol engineering | **On track, ahead of schedule.** The mocked-market prototype above already exists 1 week before target; remaining work is wiring the preflight-guarded CPI into the real money-moving instructions (`create_agreement`/`pay_installment`), gated on `KaminoConfig.enabled`. |
| Public merchant SDK plan | Merchant integration spec, hosted checkout flow, and onboarding docs | 2026-08-26 | Developer docs and merchant UX | Not started — correctly sequenced after the items above per `MARKETING.md` (checkout SDK is v2.2 roadmap, deferred until IBG demo is real). |

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

