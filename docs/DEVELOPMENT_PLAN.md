# Relic Pay v2 — Development Plan

*The roadmap from rebuilt MVP to a 10x product. Last updated: 2026-07-03.*

## Where v1 stood (the spec we rebuilt from)

The v1 codebase (`~/relicpay-claude`) was a working hackathon-grade MVP: a single-file Anchor program with 9 instructions, 18 passing integration tests, a Next.js demo app, a browser extension prototype, and a whitepaper. Yield was simulated on-chain (3% APY simple interest, paid from a protocol reserve). It proved the mechanic; it was not production-grade.

## v2.0 — The rebuild (DONE — this repo)

Behavior-identical to v1 for everything the characterization suite covers, plus:

- Modular program architecture (11 instruction files, separated state/errors/events/math)
- Checked arithmetic everywhere; explicit `MathOverflow`
- `merchant_withdrawn` flag kills the double-withdraw class of bugs
- **Security fix**: `trigger_default` now requires the recovery token account to belong to the recorded merchant (v1 allowed any account to be passed as the destination)
- `close_agreement` — buyers reclaim rent from settled agreements
- `update_pool_rate` — governance-tunable stake APY, capped at 20%
- Three test layers: Rust unit tests (math), v1 characterization suite (18 tests), v2 feature suite

**Definition of done:** `anchor test` fully green. This is the new foundation every later phase builds on.

## v2.1 — Real yield (Kamino CPI) — *the 10x unlock*

The single biggest product claim ("your payment plan makes you money") currently runs on simulated yield. Make it real:

1. Escrow USDC deposited into Kamino Lend via CPI on every `create_agreement` / `pay_installment`
2. Escrow PDA holds kTokens; `merchant_withdraw` and `claim_yield` redeem via CPI
3. Fallback path if Kamino deposit fails: hold raw USDC (never block a purchase on a DeFi dependency)
4. Devnet integration tests against Kamino's devnet market; add a `yield_source` field so agreements record simulated vs. real
5. Risk controls: per-agreement deposit cap, protocol-wide TVL cap, emergency `pause` flag on a new `ProtocolConfig` PDA

## v2.2 — Merchant surface

- **Checkout SDK**: a TypeScript package (`@relicpay/checkout`) any merchant can drop in — "Pay with Relic Pay" button, agreement creation, status webhooks via event indexer
- **Merchant dashboard**: Next.js app — active agreements, expected payouts, default exposure
- **Browser extension v2**: rebuild on the v2 IDL; tier overlay reads on-chain `UserStake.tier`
- First merchant: **IBG Collection** (cross-leverage — live products, owned end-to-end)

## v2.3 — Underwriting & product depth

- Payment-history-based credit tiers on-chain (`BuyerProfile` PDA: completed agreements, defaults, on-time ratio)
- Collateral ratios by tier: new buyers prepay 1/N; proven buyers unlock lower upfront locks
- Pay-from-yield: long agreements can route accrued yield toward the final installment
- Multi-token collateral (SOL, jitoSOL, mSOL via liquid staking — instant liquidation path on default)

## v2.4 — Mainnet

- External audit (program is small; scope ~2 weeks)
- Squads multisig as upgrade + pool authority
- Mainnet USDC, TVL caps ramped gradually
- Legal review of BNPL terms per T&C doc

## Testing discipline (standing rule)

The characterization suite is frozen — it is the v1 spec. Any change that breaks it is a breaking change and needs an explicit decision, not a test edit. New behavior always lands with new tests in `v2-features.ts` or a new file.

## MVP cut line

**MVP = v2.0 (done) + demo app pointed at the new program ID + devnet deploy.**
Everything from v2.1 onward is build-out, sequenced by the swarm (see SWARM.md).
