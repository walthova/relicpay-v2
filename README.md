# Relic Pay v2

**Yield-bearing Buy Now, Pay Later — where your payment plan makes you money.**

Relic Pay lets crypto holders buy real-world goods in installments without selling their crypto. The buyer locks USDC into on-chain escrow, pays over time, and the locked repayment capital is modeled today as yield-bearing capital. The next milestone routes escrow USDC into Kamino Lend for real yield.

Built on Solana. Ground-up v2 rebuild of the original MVP, verified against the full v1 characterization test suite.

> Live site: [relicpay.app](https://relicpay.app) | [Whitepaper](docs/WHITEPAPER.md) | [Development Plan](docs/DEVELOPMENT_PLAN.md) | [Marketing Plan](docs/MARKETING.md) | [Funding Pipeline](docs/FUNDING_PIPELINE.md)

---

## Current Status

Relic Pay v2 is a devnet/public-demo candidate, not a mainnet consumer finance product.

What works now:

- Modular Anchor v2 program with BNPL agreement lifecycle, escrow, merchant withdraw, cancellation/default paths, staking/yield accounting, and close/rent cleanup.
- Frozen v1 characterization suite plus v2 feature tests and Rust math unit tests.
- Simulated yield accounting so the buyer-facing mechanic can be demoed safely.
- `yield_source` groundwork to distinguish simulated yield from future real yield.
- ProtocolConfig risk controls: emergency pause and per-agreement deposit caps.
- IBG Collection is the first merchant/pilot story.

What is next:

- Kamino Lend CPI for real yield.
- IBG checkout demo connected to the production Relic Pay story.
- Merchant checkout SDK/spec.
- Mainnet readiness: security review, legal review, real merchant wallet, conservative TVL caps, and monitoring.

Important limitation:

> The current devnet demo uses simulated yield. Do not market it as real Kamino yield until the CPI integration lands and is tested.

## How It Works in 5 Steps

```
1. BUYER  → sees an item ($300) and clicks "Pay with Relic Pay"
2. BUYER  → agrees to 3 installments of $100, 30 days apart
3. SMART CONTRACT → locks $100 in escrow and records simulated yield
4. BUYER  → pays installment 2 and 3 on schedule — yield builds each month
5. DONE   → Merchant gets $300. Buyer can claim recorded yield in the demo.
```

## What's New in v2

| Area | v1 | v2 |
|---|---|---|
| Architecture | one 1,100-line `lib.rs` | modular: state / errors / events / math / one file per instruction |
| Arithmetic | saturating (silent) | checked, explicit `MathOverflow` |
| Merchant withdraw | balance-check only | `merchant_withdrawn` flag — double-withdraw structurally impossible |
| Default recovery | escrow could be sent to any token account passed in | recovery account must belong to the recorded merchant |
| Rent | locked forever | `close_agreement` reclaims agreement + escrow rent after settlement |
| Governance | fixed 3% APY | `update_pool_rate` (authority-only, capped 20%) |
| Risk controls | none | `ProtocolConfig` emergency pause + per-agreement deposit cap |
| Yield source | implicit simulation | explicit `yield_source` field for simulated-now / Kamino-next |
| Tests | 18 integration | 18 characterization (v1 spec) + v2 feature suite + Rust unit tests |

## Repository Map

```
relicpay/
├── programs/relicpay/src/
│   ├── lib.rs               ← program entry: instruction routing only
│   ├── state.rs             ← BnplAgreement, StakePool, UserStake
│   ├── constants.rs         ← seeds, fees, tiers, grace period
│   ├── errors.rs            ← typed protocol errors
│   ├── events.rs            ← indexable on-chain events
│   ├── math.rs              ← yield + tier math (unit tested)
│   └── instructions/        ← one file per instruction (11 total)
├── tests/
│   ├── characterization.ts  ← v1 behavior spec — must always pass
│   └── v2-features.ts       ← new v2 behavior
└── docs/                    ← whitepaper, technical breakdown, funding, plans
```

## Quick Start

Install Solana, Anchor, Rust, and Node dependencies first. Then:

```bash
npm install
anchor build                                   # compile the program
cargo test --manifest-path programs/relicpay/Cargo.toml   # unit tests
anchor test                                    # integration suite on localnet
cd app && npm install && npm run build         # demo app build
```

Program ID (localnet/devnet): `5GPVYpyzdosbzWcdttcCdziJVqUCCARf98J857C3T6Gi`

## Funding Room

This repo is being prepared as the canonical public Relic Pay repository for grants, hackathons, and partner review.

- [Repo Canonicalization](docs/REPO_CANONICALIZATION.md)
- [Funding Pipeline](docs/FUNDING_PIPELINE.md)
- [Agentic Engineering Grant Draft](docs/funding/AGENTIC_ENGINEERING_GRANT.md)
- [Solana Foundation Funding Draft](docs/funding/SOLANA_FOUNDATION_GRANT.md)
- [Colosseum Submission Packet](docs/funding/COLOSSEUM_PACKET.md)
- [Pitch Packet](docs/funding/PITCH_PACKET.md)
- [Lovable Homepage Update Prompt](docs/funding/LOVABLE_HOMEPAGE_UPDATE.md)

## Public Launch Blockers

- Replace the placeholder IBG merchant wallet in `app/src/lib/constants.ts`.
- Align the production Lovable Relic Pay site with the v2 story.
- Make `walthova/relicpay-v2` public only after final secret scan.
- Keep AI session transcripts ignored and attach them only to grant applications.
- Do not claim real yield until Kamino CPI is implemented, tested, and reviewed.
