# Security

Relic Pay v2 is **unaudited** and **not deployed to mainnet** on either chain (Solana or Base). Do not send real funds to any deployment of this code.

## Reporting a vulnerability

Please report privately through GitHub's [private vulnerability reporting](https://github.com/walthova/relicpay-v2/security/advisories/new) rather than a public issue. Include the instruction, the accounts involved, and a reproduction (a failing `anchor test` case is ideal).

## Security model

- **Escrow is PDA-owned.** Each agreement's `escrow_usdc` token account is owned by the agreement PDA (`["agreement", buyer, product_id]`). No human key can move it; only program instructions sign for it.
- **Money only moves to recorded parties.** Every instruction that pays a merchant constrains the destination token account to `agreement.merchant` and `agreement.usdc_mint`. Refunds go only to an account owned by the signing buyer.
- **Checked arithmetic.** Overflow returns `MathOverflow` instead of saturating silently.
- **Governance singletons are deployer-gated.** `init_protocol_config` and `init_kamino_config` require the program upgrade authority to sign, so nobody can front-run initialization after deploy.
- **Kamino CPI targets are allow-listed.** Every Kamino account is checked against the governance-set `KaminoConfig` before any CPI. A mismatch reverts.
- **Emergency controls.** `ProtocolConfig` provides a pause switch, a per-agreement deposit cap and a protocol-wide TVL cap, enforced on every escrow inflow.

## Known limitations

These are tracked deliberately and must be resolved before mainnet:

| Area | Limitation | Plan |
|---|---|---|
| `init_stake_pool` | Partly fixed (feat/base-parity). Once `ProtocolConfig` exists, only its authority may create the pool, and only for the pinned mint. Before the config exists it is still first-caller-wins, because the frozen v1 suite creates the pool from an arbitrary keypair. Base has no initializer. | Decision D1 in docs/CHAIN_PARITY.md: gate on the upgrade authority with a documented amendment to the frozen suite. Until then, deploy runbook order: config, ext, accepted mint, stake pool. |
| Stake pool yield | Fixed on both chains (feat/base-parity). Yield is paid only from the separate yield reserve, capped at its balance, and rate changes are not retroactive. | Done. |
| `create_agreement` mint | Fixed (feat/base-parity). `set_accepted_mint` pins the mint, and every create path checks it. Base pins USDC at deploy. Merchants should still check `agreement.usdc_mint` on Solana until the mint is pinned on each cluster. | Pin on devnet and mainnet at deploy. |
| v1 `claim_yield` | Zeroes `yield_accrued` without paying anything. It is kept for the frozen v1 suite. | Use `claim_yield_paid`. Retiring v1 `claim_yield` is decision D2. |
| Pause and default | Fixed on both chains. Defaults are blocked while paused, with a fresh 7-day grace window after unpause. | Done. |
| Agent layer and credit line | Testnet design code. Credit is behind a flag that is off by default. There is no refund or dispute path. | Not for mainnet until audited and Q6 is resolved (docs/AGENT_CREDIT_LAYER.md). |
| Kamino pause preflight | `mock_reserve_looks_paused` reads a byte offset from the **mock** reserve layout. Against the real klend reserve it is a heuristic, not a guarantee. A real mid-CPI failure still reverts the whole transaction. | Read the real klend reserve status field before mainnet. |
| Governance keys | Authorities are single keys. | Move upgrade and governance authority to a multisig (for example Squads) before mainnet. |
| Demo app | `/api/claude` uses an in-memory, per-instance rate limiter. | Use a shared store (for example Upstash) if the demo gets real traffic. |

## Verifying locally

```bash
cargo test --manifest-path programs/relicpay/Cargo.toml   # unit tests
anchor test                                               # full integration suite on localnet
cd evm && forge test                                      # Base contracts and EVM v2 invariants
```
