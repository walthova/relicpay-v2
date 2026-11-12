# Relic Pay v2

**Yield-bearing Buy Now, Pay Later — where your payment plan makes you money.**

Relic Pay lets crypto holders buy real-world goods in installments without selling their crypto. The buyer locks USDC into on-chain escrow, pays over time, and the escrowed capital earns yield while it waits. Yield routing is protocol-agnostic: Kamino Lend is the first adapter, with more to follow.

Two chains, one set of mechanics: **Solana** (Anchor program in `programs/relicpay`) and **Base** (Solidity contracts in `evm/contracts/base`). Every instruction and constant is mapped one to one in [docs/CHAIN_PARITY.md](docs/CHAIN_PARITY.md), and a change lands on both chains or on neither.

> Live site: [relicpay.app](https://relicpay.app) | [Whitepaper](docs/WHITEPAPER.md) | [Technical Breakdown](docs/TECHNICAL_BREAKDOWN.md) | [Chain Parity](docs/CHAIN_PARITY.md) | [Agent Credit Layer](docs/AGENT_CREDIT_LAYER.md) | [Development Plan](docs/DEVELOPMENT_PLAN.md)

---

## Status

Stated plainly:

- **No audit.** Neither chain's code has had an independent security audit. An internal review (audit run 1, 2026-11-10) found issues, and this branch fixes the ones listed in CHAIN_PARITY.md section 4. That review is not an audit.
- **Simulated yield.** Buyer and staker yield is on-chain interest math, paid only from a separately funded yield reserve. The live adapters (Kamino on Solana, an ERC-4626 Morpho vault on Base) are tested only against local mocks. Do not market real yield.
- **Testnet only.** Solana: localnet and devnet. Base: local Foundry tests, with a Base Sepolia deploy script that has not been run yet. Nothing is on mainnet.
- **The agent layer is not live.** Agent mandates, agent credit charges and the x402 client are design plus testnet code. The collateralized credit line is behind a feature flag that is off by default on both chains.

## Two chains

| | Solana | Base |
|---|---|---|
| Code | `programs/relicpay` (Anchor 0.32.1) | `evm/contracts/base` (Solidity 0.8.24, Foundry) |
| Escrow BNPL | `create_agreement`, `pay_installment`, `merchant_withdraw`, `cancel_agreement`, `trigger_default`, `close_agreement` | `RelicEscrow` |
| Staking and tiers | `stake_usdc`, `unstake_usdc`, `update_pool_rate` (capped at 20%) | `RelicStakePool` |
| Pause and caps | `ProtocolConfig`, `ProtocolConfigExt` | `RelicEscrow.setPaused`, `setRiskLimits` |
| Yield source | simulated, or Kamino (disabled) | simulated, or ERC-4626 vault (Morpho) |
| Credit line (flagged) | `credit_line.rs` | `RelicCreditLine` |
| Agent mandates | `AgentMandate`, `agent_create_agreement`, `agent_charge` | `RelicAgentDelegate` (with optional Coinbase Spend Permissions) |
| Governance | authority keys. On mainnet these must be a Squads multisig with a 2-day time lock. | a TimelockController of at least 2 days, enforced in code, plus a pause-only guardian |
| Deploy (not run) | `scripts/deploy-solana-devnet.sh` | `evm/script/DeployBaseSepolia.s.sol` |

`evm/contracts/RelicPay.sol` and the other top-level EVM contracts are the earlier EVM v2 RWA relic module, imported unchanged. They are **not** the parity core. Deploy `evm/contracts/base` for two-chain RelicPay.

## RelicPay Agents (agent buy now, pay later)

Product direction: **credit for you and your agent** (see `RELICPAY_V2.md`).
The agent-credit layer is prototyped in [relicpay-agents](https://github.com/walthova/relicpay-agents), built at the MLH Solana Hackathon (Nov 2026) and live on devnet: an 80% LTV credit vault, a pool that pays merchants up front, and on-chain agent mandates the agent key cannot bypass. This repo is the core protocol it grows into: yield-bearing escrow, the Kamino adapter, risk controls, and `AgentMandate`. The plan is to merge the two into one RelicPay protocol, with v2's yield engine earning on the agents' collateral.

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
├── evm/                     ← Base: Foundry project
│   ├── contracts/base/      ← parity core: RelicEscrow, RelicStakePool, RelicCreditLine, RelicAgentDelegate
│   ├── contracts/           ← earlier EVM v2 RWA relic module (unchanged)
│   ├── test/base/           ← parity, credit, agent, governance tests and invariants
│   └── script/DeployBaseSepolia.s.sol
├── agent-layer/x402/        ← x402 reference client policy (testnet design code)
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

cd evm && forge test                           # Base contracts (Foundry 1.9+), existing EVM v2 invariants included
node --test agent-layer/x402/policy.test.js    # x402 reference client policy

cd app && npm install && npm run build         # demo app build
```

`evm/lib` holds git submodules: run `git submodule update --init --recursive` after cloning.

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
- Upgrade and governance authority moved to a multisig (Solana: Squads with a 2-day time lock; Base: the TimelockController proposer is a Safe).
- Decisions D1 and D2 in docs/CHAIN_PARITY.md (they change the frozen v1 spec).
- A refund and dispute path for agent purchases (docs/AGENT_CREDIT_LAYER.md, Q6).
- Real merchant payout wallet configured via `NEXT_PUBLIC_MERCHANT_WALLET` (see `app/.env.example`).
- Legal review of the BNPL terms.
- Do not claim real yield until the above is done.
