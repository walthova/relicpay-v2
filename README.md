# Relic Pay v2

**Decentralized Buy Now, Pay Later — where your payment plan makes you money.**

Relic Pay lets you use crypto as collateral to buy things today, pay in installments, and earn yield on your locked funds while you pay. No banks. No credit checks. No selling your crypto.

Built on Solana. Ground-up v2 rebuild of the original MVP, verified against the full v1 characterization test suite.

> Live site: [relicpay.app](https://relicpay.app) | [Whitepaper](docs/WHITEPAPER.md) | [Development Plan](docs/DEVELOPMENT_PLAN.md) | [Marketing Plan](docs/MARKETING.md)

---

## How It Works in 5 Steps

```
1. BUYER  → sees an item ($300) and clicks "Pay with Relic Pay"
2. BUYER  → agrees to 3 installments of $100, 30 days apart
3. SMART CONTRACT → locks $100 in escrow and starts earning yield (3% APY)
4. BUYER  → pays installment 2 and 3 on schedule — yield builds each month
5. DONE   → Merchant gets $300. Buyer gets the earned yield.
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
└── docs/                    ← whitepaper, technical breakdown, plans
```

## Build & Test

Toolchain: Anchor 0.32.1, Agave/Solana CLI 3.0.11 (platform-tools v1.51), Node 22.12+
(`nvm use`). Older Solana CLIs ship a Cargo that cannot parse edition-2024 dependencies;
older Node cannot `require()` the ESM modules in the web3 dependency chain. The committed
`Cargo.lock` and `.cargo/config.toml` keep resolution on versions the SBF toolchain compiles.

```bash
anchor build                                   # compile the program
anchor test                                    # integration suite on localnet
cargo test --manifest-path programs/relicpay/Cargo.toml   # unit tests
```

Program ID (localnet/devnet): `5GPVYpyzdosbzWcdttcCdziJVqUCCARf98J857C3T6Gi`
