# Security

Relic Pay v2 is **unaudited** and **not deployed to mainnet**. Do not send real funds to any deployment of this program.

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
| `init_stake_pool` | Still first-caller-wins. The frozen v1 characterization suite calls it with an arbitrary keypair, so gating it means amending that suite. Impact is limited to the staking feature (a front-runner could pick the pool mint and rate, capped at 20%); BNPL escrow is unaffected. | Gate it on the upgrade authority with a deliberate, documented amendment to the frozen suite, or initialize it in the same transaction as deploy. |
| Stake pool yield | Simulated yield is paid out of `pool_vault`, which holds stakers' principal. With no reward reserve, paying yield can leave the pool unable to return everyone's principal. | Fund a separate reward reserve, or pay only realized yield from a yield adapter. |
| `create_agreement` mint | `usdc_mint` is caller-chosen. Merchants and checkout integrations must verify `agreement.usdc_mint` before treating an agreement as paid. | Pin the accepted mint(s) in `ProtocolConfig`. |
| Kamino pause preflight | `mock_reserve_looks_paused` reads a byte offset from the **mock** reserve layout. Against the real klend reserve it is a heuristic, not a guarantee. A real mid-CPI failure still reverts the whole transaction. | Read the real klend reserve status field before mainnet. |
| Governance keys | Authorities are single keys. | Move upgrade and governance authority to a multisig (for example Squads) before mainnet. |
| Demo app | `/api/claude` uses an in-memory, per-instance rate limiter. | Use a shared store (for example Upstash) if the demo gets real traffic. |

## Verifying locally

```bash
cargo test --manifest-path programs/relicpay/Cargo.toml   # unit tests
anchor test                                               # 66 integration tests on localnet
```
