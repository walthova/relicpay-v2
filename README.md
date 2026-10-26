# Relic Pay v2

**Yield-bearing Buy Now, Pay Later — where your payment plan makes you money.**

Relic Pay lets crypto holders buy real-world goods in installments without selling their crypto. The buyer locks USDC into on-chain escrow, pays over time, and the escrowed capital earns yield while it waits. Yield routing is protocol-agnostic: Kamino Lend is the first adapter, with more to follow.

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
- ProtocolConfig risk controls: emergency pause, per-agreement deposit cap, protocol-wide TVL cap.
- Kamino Lend adapter (CPI), tested end to end against a local mock reserve: deposit on installment, and single-transaction reconciled exits (`merchant_withdraw_reconciled`, `cancel_agreement_reconciled`, `trigger_default_reconciled`) that redeem collateral inline, with automatic fallback to raw USDC if the reserve is paused.
- Deployer-gated governance initialization. See [SECURITY.md](SECURITY.md).
- IBG Collection is the first merchant/pilot story.

What is next:

- Kamino adapter against the real klend program on devnet.
- IBG checkout demo connected to the production Relic Pay story.
- Merchant checkout SDK/spec.
- Mainnet readiness: security review, legal review, real merchant wallet, conservative TVL caps, and monitoring.

Important limitation:

> The demo uses simulated yield. The Kamino adapter is tested only against a local mock. Do not market real yield until it is tested against the real klend program and reviewed.

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
| Risk controls | none | `ProtocolConfig` emergency pause, per-agreement deposit cap, TVL cap |
| Real yield | none | Kamino Lend adapter (CPI) with reconciled single-transaction exits |
| Cancellation fee | could be routed to any token account | must belong to the recorded merchant |
| Yield source | implicit simulation | explicit `yield_source` field for simulated-now / Kamino-next |
| Tests | 18 integration | 18 characterization (v1 spec) + 48 v2 feature tests + Rust unit tests |

## Repository Map

```
relicpay/
├── programs/relicpay/src/
│   ├── lib.rs               ← program entry: instruction routing only
│   ├── state.rs             ← BnplAgreement, StakePool, UserStake, ProtocolConfig, KaminoConfig
│   ├── constants.rs         ← seeds, fees, tiers, grace period
│   ├── errors.rs            ← typed protocol errors
│   ├── events.rs            ← indexable on-chain events
│   ├── math.rs              ← yield + tier math (unit tested)
│   └── instructions/        ← one file per instruction (22 total) + kamino_cpi helpers
├── programs/mock_kamino_lend/ ← localnet stand-in for the klend reserve
├── tests/
│   ├── characterization.ts  ← v1 behavior spec — must always pass
│   └── v2-features.ts       ← new v2 behavior
├── app/                     ← Next.js demo checkout + Claude guide
├── extension/               ← browser extension (tier-based price overlay)
└── docs/                    ← whitepaper, technical breakdown, design, funding
```

## Quick Start

Install Solana, Anchor, Rust, and Node dependencies first. Then:

Toolchain: Anchor 0.32.1, Agave/Solana CLI 3.0.11 (platform-tools v1.51), Node 22.12+
(`nvm use`). Older Solana CLIs ship a Cargo that cannot parse edition-2024 dependencies;
older Node cannot `require()` the ESM modules in the web3 dependency chain. The committed
`Cargo.lock` and `.cargo/config.toml` keep resolution on versions the SBF toolchain compiles.

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

## Mainnet Blockers

- Independent security audit; resolve the known limitations in [SECURITY.md](SECURITY.md).
- Kamino adapter tested against the real klend program on devnet.
- Upgrade and governance authority moved to a multisig.
- Real merchant payout wallet configured via `NEXT_PUBLIC_MERCHANT_WALLET` (see `app/.env.example`).
- Legal review of the BNPL terms.
- Do not claim real yield until the above is done.
