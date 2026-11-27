# Security

Relic Pay v2 is **unaudited** and **not deployed to mainnet**. Do not send real funds to any deployment of this program.

## Reporting a vulnerability

Please report privately through GitHub's [private vulnerability reporting](https://github.com/walthova/relicpay-v2/security/advisories/new) rather than a public issue. Include the instruction, the accounts involved, and a reproduction (a failing `anchor test` case is ideal).

## Security model

- **Escrow is PDA-owned.** Each agreement's `escrow_usdc` token account is owned by the agreement PDA (`["agreement", buyer, product_id]`). No human key can move it; only program instructions sign for it.
- **Money only moves to recorded parties.** Every instruction that pays a merchant constrains the destination token account to `agreement.merchant` and `agreement.usdc_mint`. Refunds go only to an account owned by the signing buyer.
- **Checked arithmetic.** Overflow returns `MathOverflow`. The reward calculation explicitly treats a vault balance below total staked as zero surplus.
- **Governance singletons are deployer-gated.** `init_protocol_config` and `init_kamino_config` require the program upgrade authority to sign, so nobody can front-run initialization after deploy.
- **Kamino CPI targets are allow-listed.** Every Kamino account is checked against the governance-set `KaminoConfig` before any CPI. A mismatch reverts.
- **Emergency controls.** `ProtocolConfig` provides a pause switch, a per-agreement deposit cap and a protocol-wide TVL cap, enforced on every escrow inflow.

## Known limitations

These are tracked deliberately and must be resolved before mainnet:

| Area | Limitation | Plan |
|---|---|---|
| `init_stake_pool` | Still first-caller-wins. The frozen v1 characterization suite calls it with an arbitrary keypair, so gating it means amending that suite. The initializer picks the pool mint and can subsequently set the capped simulated rate; BNPL escrow is unaffected. | Gate it on the upgrade authority with a deliberate, documented amendment to the frozen suite, or initialize it in the same transaction as deploy. |
| Stake pool yield | Demo rewards are simulated. A full unstake pays rewards only from the pre-withdrawal surplus: the `pool_vault` balance above `total_staked`. A plain USDC transfer into `pool_vault` funds shared rewards without increasing principal. Unfunded rewards remain accrued; a later `unstake_usdc(0)` can collect them without a new deposit. There is no admin surplus withdrawal. | Build and validate a real stake yield adapter and the yield agent, both in development. No live yield or fixed APY. |
| `create_agreement` mint | `usdc_mint` is caller-chosen. Merchants and checkout integrations must verify `agreement.usdc_mint` before treating an agreement as paid. | Pin the accepted mint(s) in `ProtocolConfig`. |
| Kamino pause preflight | `mock_reserve_looks_paused` reads a byte offset from the **mock** reserve layout. Against the real klend reserve it is a heuristic, not a guarantee. A real mid-CPI failure still reverts the whole transaction. | Read the real klend reserve status field before mainnet. |
| Governance keys | Authorities are single keys. | Move upgrade and governance authority to a multisig (for example Squads) before mainnet. |
| Demo app | `/api/claude` uses an in-memory, per-instance rate limiter. | Use a shared store (for example Upstash) if the demo gets real traffic. |

## Credit line (design only)

The agent credit line is **design and pure math only** (`docs/CREDIT_PRIMITIVE.md`, `programs/relicpay/src/credit.rs`). No credit-line instructions or accounts are wired on-chain yet, the credit line and yield agent are not live, and nothing has been audited. Open risks tracked before any on-chain wiring:

- **USDC depeg (no oracle):** Collateral and debt share the same USDC mint with no price oracle; peg risk and liquidity runs remain outside price-feed protection and require mint pinning plus emergency pause controls.
- **Collateral locked in Kamino during default:** Once staked collateral can be deployed to Kamino, a paused or illiquid reserve would abort an inline redeem CPI; default must freeze draws and unstaking first and settle seizure asynchronously.
- **Agent key compromise within caps:** A compromised agent key can draw up to the minimum of its mandate caps and available credit at approved merchants until revoked; owner custody, tight caps, approval thresholds, and one-tap revoke bound exposure.
- **Unstake vs. pending draw race:** An owner unstaking ahead of an agent draw must be serialized atomically by on-chain checks so neither transaction order can leave an under-collateralized debt.
- **Rounding dust over many small draws:** Credit limits must round down and required collateral must round up in exact base units so repeated small draws cannot bypass LTV limits.
- **Mandate revoked mid-installment plan:** Revoking an agent must block only new draws while keeping existing debt, repayment schedules, unstake guards, and default recovery intact.

## Verifying locally

```bash
cargo test --manifest-path programs/relicpay/Cargo.toml   # unit tests
anchor test                                               # 66 integration tests on localnet
```
