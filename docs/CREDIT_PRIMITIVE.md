# Agent Credit Primitive: Technical Design

**Status:** Option A is implemented for localnet. The program is unaudited and the credit line has not been deployed. A stake-pool yield adapter and yield agent are outside this implementation.

## Context and repo verification

The credit line adds a separate path alongside the existing escrow flow:

- **Agent spending (`programs/relicpay/src/instructions/agent_mandate.rs`)**: `agent_create_agreement` spends directly from the owner's USDC token account via an SPL delegate allowance and deposits the first installment into per-agreement `escrow_usdc`. That SPL-delegate path remains intact as the **no-credit fallback**.
- **Staking (`stake_usdc.rs`, `unstake_usdc.rs`)**: `StakePool` and `UserStake` hold raw USDC in `pool_vault` for credit collateral and browser-extension discount tiers. Simulated demo rewards are paid only from vault surplus. `StakePool` does not deploy funds to Kamino.
- **Merchant settlement (`merchant_withdraw.rs`, `merchant_withdraw_reconciled.rs`)**: Merchants are paid `total_price` from `escrow_usdc` only after `agreement.state == AgreementState::Completed`.
- **Kamino CPI (`docs/design/KAMINO_CPI_INTEGRATION.md`, `kamino_probe.rs`, `*_reconciled.rs`)**: Today Kamino CPI exists only for per-agreement `BnplAgreement` escrow, not `StakePool`. Any failed CPI aborts the entire Solana transaction (there is no try/catch across CPI).
- **Web demo (`app/src/lib/creditDemo.ts`) & prototype (`walthova/relicpay-agents`)**: Both model an 80% LTV credit line (`500` USDC collateral -> `400` USDC credit limit, `180` USDC draw, three `60` USDC repayments) where a lending pool pays the merchant up front.

### Module placement (`programs/relicpay/src/credit.rs`)

The pure math lives in `programs/relicpay/src/credit.rs`. `math.rs` holds simulated yield accrual and discount-tier thresholds.

---

## 1. Mechanism

An owner's credit line is backed by their staked USDC collateral:

- **Credit limit**:
  `credit_limit = floor(collateral * ltv_bps / 10_000)`
  - `ltv_bps` is a governance-configurable protocol parameter with a hard maximum of `8_000` (80% LTV, `MAX_LTV_BPS`). Any value above `8_000` is rejected (`LtvTooHigh`).
  - Integer division floors down so borrowing power never rounds up.
- **Available credit**:
  `available = credit_limit.saturating_sub(outstanding_debt)`
  - Saturates at `0` if `outstanding_debt > credit_limit` (for example, if governance lowers `ltv_bps` while debt is open).
- **Dual gate on every credit-backed agent draw**:
  An agent draw is allowed **only** if it passes **both**:
  1. All existing `AgentMandate` checks (`!revoked`, not expired, merchant on `allowed_merchants` if non-empty, `total_price <= per_purchase_cap`, `period_spent + total_price <= period_cap`, `period_purchases < max_purchases_per_period`, and owner co-sign when `approval_threshold > 0 && total_price > approval_threshold`).
  2. Available credit check (`check_draw(amount, collateral, ltv_bps, outstanding_debt)`), ensuring `amount > 0` and `outstanding_debt + amount <= credit_limit`.
- **No-credit fallback**:
  The existing `agent_create_agreement` instruction (SPL delegate spending from `owner_usdc` into escrow) remains unchanged for owners who do not use a credit line.

---

## 2. Merchant funding: Option A vs Option B (Walter's decision)

**Decision:** Walter chose Option A for credit-backed purchases. The existing escrow flow remains available as the no-credit fallback and still pays merchants at agreement completion.

| Dimension | Option A: Upfront payout from a separate lending pool | Option B: Paid from escrow at agreement completion |
|---|---|---|
| **When merchant is paid** | Immediately at agent draw time in USDC | After all installments are paid (`AgreementState::Completed`) |
| **Funding source** | Separate `LendingPool` USDC vault | Per-agreement `escrow_usdc` funded by buyer installments |
| **Role of staked collateral** | Backs the lending pool's upfront advance (`<= 80%` LTV); seizable on default | Holds no protocol credit advance; only signals commitment unless repurposed |
| **Matches demo & product brief** | Yes: matches PR #14 (`app/src/lib/creditDemo.ts`), `RELICPAY_V2.md`, and `walthova/relicpay-agents` | No: behaves like layaway / delayed settlement rather than Buy Now, Pay Later |
| **Capital & liquidity requirement** | Requires funded `LendingPool` liquidity and utilization/solvency tracking | No external pool liquidity needed |
| **Default recovery** | Seize owner's staked collateral to reimburse the lending pool (merchant already paid) | Existing `trigger_default*` sends accumulated `escrow_usdc` to the merchant |
| **Implementation complexity** | Higher: new `LendingPool` vault, draw/repay flows, collateral seizure on default | Lower: reuses existing escrow settlement, fewer new vaults |

Option A provides upfront merchant settlement without spending the owner's or the agent's liquid funds and without moving the staked principal at draw time. It matches the product brief and the web demo.

---

## 3. Unstake guard

While an owner has `outstanding_debt > 0`, unstaking collateral is rejected if the remaining collateral would no longer cover their debt at the active `ltv_bps`:

- Reject unstake if `credit_limit(collateral - withdraw_amount, ltv_bps) < outstanding_debt`.
- Equivalently, the maximum withdrawable collateral is:
  `max_unstake(collateral, ltv_bps, debt) = collateral.saturating_sub(ceil(debt * 10_000 / ltv_bps))`
  (or `collateral` when `debt == 0`; `0` when `debt > 0` and `ltv_bps == 0`).
- **Interaction with `unstake_usdc(0)`**: The zero sentinel still requests full unstake. It is rejected with outstanding debt. Deferred rewards on a fully unstaked, debt-free line can still be collected from available surplus.

---

## 4. Repayment

- Every repayment reduces debt first (`apply_repayment(debt, payment)`). When the position is at or below its credit limit (`outstanding_debt <= credit_limit`), repayment immediately restores `available_credit` by the repaid principal (assuming `ltv_bps` and `collateral` are unchanged); if `outstanding_debt > credit_limit` (for example after an LTV reduction), repayment closes the shortfall first and `available_credit` stays `0` until `outstanding_debt < credit_limit`.
- Repayment transfers USDC from the owner to the lending vault and records progress on the selected active draw. Owners can prepay or make partial payments.
- **Overpayment is rejected**, not silently kept or auto-staked: `payment == 0` returns `InvalidAmount` and a payment above the selected draw's remaining principal returns `RepaymentExceedsDebt`, even if the owner has debt on other draws.

---

## 5. Default, rounding, and illiquid Kamino collateral

### Collateral and debt on default

- The first repayment is due one interval after the draw. Each installment is principal divided by installment count, rounded down, with any remainder due in the final installment. Repayments cover the earliest installments first.
- Anyone may freeze a draw strictly after its first unpaid installment's due time plus the existing seven-day grace period. Default applies to the unpaid balance of that draw, not the entire line. The merchant is already paid and receives nothing at default.

### Rounding direction

All credit math rounds conservatively in favor of protocol solvency:

- **Collateral value / borrowing power (`credit_limit`)**: rounds **down** (`floor`).
- **Required collateral (`max_unstake`) and any future debt/fee accrual**: rounds **up** (`ceil`).

Combined, whenever a position is covered (`credit_limit(collateral, ltv_bps) >= debt`), `credit_limit(collateral - max_unstake, ltv_bps) >= debt` always holds, and withdrawing even 1 additional base unit drops `credit_limit` strictly below `debt`. If a position is already under-collateralized (for example after governance lowers `ltv_bps`), `max_unstake` returns `0` and blocks all withdrawals until collateral is added or debt is repaid.

### When collateral is deployed to Kamino and cannot be withdrawn in one transaction

On `main` today, `StakePool` holds raw USDC in `pool_vault` and has no Kamino CPI yet. Once a future stake-pool Kamino adapter deploys idle collateral to Kamino, a reserve pause, 100% utilization, or oracle staleness can prevent redeeming kTokens in the same transaction, and per `docs/design/KAMINO_CPI_INTEGRATION.md`, a failed CPI aborts the entire Solana transaction.

To prevent defaulted owners from escaping seizure when Kamino cannot redeem atomically, default must use a **two-phase settlement**:

1. **Phase 1: Freeze (always succeeds without Kamino CPI):** Verify grace-period expiry on the delinquent `CreditDraw`, mark that draw `DefaultPending`, add only that draw's unpaid balance (`draw_remaining = principal - amount_repaid`) to `seizure_pending` on the owner's `CreditLine` (so other draws in good standing are not prematurely seized or double-counted), and set `CreditLine.frozen = true` to block all new draws and unstakes for that owner immediately.
2. **Phase 2: Seize (permissionless crank):** Transfer the draw's unpaid balance from the raw stake vault to the lending vault, capped at the owner's staked principal. Recovery reduces `UserStake.staked_amount`, `StakePool.total_staked`, `seizure_pending`, and `outstanding_debt`; the draw becomes `Defaulted` and cannot settle again. The line unfreezes after all pending balances are recovered. An unrecovered shortfall is recorded once as pool bad debt and leaves the line frozen; the raw-USDC model has no expected shortfall and there is no shortfall resolution instruction. A future Kamino adapter would have to redeem funds before this transfer.

---

## 6. Yield

Staked collateral may later be put to work in DeFi by a yield agent that is in development. Today, demo yield is simulated, and `unstake_usdc` pays simulated rewards only from pre-withdrawal `pool_vault` surplus. No live DeFi yield is active on `StakePool`, and this design makes no fixed or target return claims.

---

## 7. Failure-case table

| Failure case | Risk | Mitigation / open design requirement |
|---|---|---|
| **USDC depeg (no oracle)** | Collateral and debt share a mint, but lenders and merchants still bear issuer and peg risk. | Governance pins the mint and can pause new draws via `CreditConfig`. Repayment, collateral release subject to LTV, and default settlement remain available when paused. |
| **Collateral locked in Kamino during default** | If `StakePool` collateral is deployed to Kamino and the reserve is paused or illiquid, an inline Kamino redeem CPI fails and aborts the whole default transaction. | Use two-phase default (freeze draws and unstaking immediately without CPI; settle seizure via a permissionless crank once Kamino liquidity is available). Keep a raw-USDC liquidity buffer in `pool_vault` when the stake yield adapter is built. |
| **Agent key compromise within caps** | A stolen agent key can draw up to `min(mandate caps, available_credit)` at approved merchants before the owner revokes it. The agent key can never unstake collateral, raise limits, or undo a revoke. | Enforce strict per-purchase cap, period cap, purchase-count limit, merchant allowlist, expiry, owner co-sign `approval_threshold`, and one-tap `revoke_agent_mandate`. |
| **Owner unstaking ahead of a pending draw** | An owner submits `unstake_usdc` that lands in the same slot before a pending agent draw transaction, reducing `credit_limit` below the draw amount. | Atomic on-chain ordering: if `unstake_usdc` lands first, the draw reads the post-unstake `staked_amount` and fails `ExceedsCreditLimit`; if the draw lands first, `unstake_usdc` reads the updated `outstanding_debt` and fails the unstake guard. Neither order can produce an under-collateralized position. |
| **Rounding dust over many small draws** | Repeated 1-unit or sub-cent draws could try to exploit rounding to borrow more than `ltv_bps` of collateral or leave un-repayable dust. | `outstanding_debt` is tracked in exact integer USDC base units (no fractional debt), `credit_limit` rounds down, and `max_unstake` rounds required collateral up. Debt is summed in exact base units and checked against `credit_limit(collateral, ltv_bps)` on every draw, so small draws cannot accumulate past the exact limit. |
| **Mandate revoked mid-installment plan** | Owner revokes the agent while credit draws from that agent still have unpaid installments. | Revoking a mandate only blocks **new** agent draws (`AgentMandate.revoked = true`). Existing credit draws, repayment obligations, unstake guards, and default paths stay attached to the owner's `CreditLine` and continue normally (matching `creditDemo.ts` and `agent_mandate.rs`). |

---

## 8. Accounts and instructions

### Accounts

1. **`CreditConfig`**
   - **Seeds:** `["credit_config"]` (separate singleton PDA avoids modifying existing `ProtocolConfig` deserialization on older accounts; upgrade-authority gated like `init_protocol_config`).
   - **Fields:** `authority: Pubkey`, `usdc_mint: Pubkey`, `ltv_bps: u16` (`<= 8_000`, defaults to `0` = disabled until governance enables), `paused: bool`, `bump: u8`.
2. **`CreditLine` (one per owner, created at first successful draw)**
   - **Seeds:** `["credit_line", owner.key().as_ref()]`.
   - **Fields:** `owner: Pubkey`, `outstanding_debt: u64`, `seizure_pending: u64`, `total_borrowed: u64`, `total_repaid: u64`, `draws_repaid: u32`, `frozen: bool`, `bump: u8`.
   - **Why a new PDA instead of adding fields to `UserStake` or `AgentMandate`:** Keeps `UserStake` (covered by the frozen v1 characterization suite) and `AgentMandate` (which contains `allowed_merchants: Vec<Pubkey>`, where appended trailing fields can read stale bytes on existing accounts) untouched.
3. **`LendingPool` + `lending_vault`**
   - **Seeds:** `["lending_pool"]` and `["lending_vault", lending_pool.key().as_ref()]`.
   - **Fields:** `authority: Pubkey`, `usdc_mint: Pubkey`, `total_liquidity: u64`, `total_lent: u64`, `total_repaid: u64`, `bad_debt: u64`, `bump: u8`.
   - **Liquidity accounting:** `total_liquidity` is tracked spendable principal. Funding, repayments and recoveries increase it; draws decrease it. Direct vault transfers are not tracked, and this version has no provider shares or liquidity withdrawal.
4. **`CreditDraw` (one per credit-backed agent purchase)**
   - **Seeds:** `["credit_draw", owner.key().as_ref(), product_id.as_bytes()]`.
   - **Fields:** `owner: Pubkey`, `agent: Pubkey`, `mandate: Pubkey`, `merchant: Pubkey`, `principal: u64`, `amount_repaid: u64`, `installment_count: u8`, `interval_seconds: i64`, `start_time: i64`, `state: CreditDrawState` (`Active | Repaid | DefaultPending | Defaulted`), `product_id: String`, `bump: u8`.

### Instructions

| Instruction | Signer(s) | Summary | Existing instructions touched |
|---|---|---|---|
| `init_credit_config` / `update_credit_config` | Upgrade authority (init) / governance authority (update) | Creates `CreditConfig` with the existing stake pool's mint and sets `ltv_bps <= 8_000` and pause flag. | Initialize the stake pool first. |
| `init_lending_pool` / `fund_lending_pool` *(Option A)* | Upgrade authority (init) / liquidity provider (fund) | Creates `LendingPool` + `lending_vault` and deposits USDC liquidity. | None. |
| `authorize_agent_credit` | Mandate owner | Explicitly allows collateral-backed draws for this mandate. Existing and newly created mandates are escrow-only until authorized. Revoking the mandate stops new draws, and a recreated mandate needs a fresh grant. | No change to SPL delegate spending. |
| `agent_draw_credit` | `agent` (+ `owner` if above `approval_threshold`) | Requires the mandate's credit grant. Runs all `AgentMandate` checks + `credit::check_draw` against `UserStake.staked_amount` and `CreditLine.outstanding_debt`; updates `CreditLine` and creates `CreditDraw`; under Option A pays `merchant_usdc` up front from `lending_vault`. | Reuses shared limit-check helper factored from `agent_mandate.rs` without changing `agent_create_agreement`. |
| `repay_credit_draw` | `owner` | Calls `credit::apply_repayment(draw_remaining, payment)` on the draw's unpaid balance (`principal - amount_repaid`) to reject per-draw overpayment and detect draw completion, calls `credit::apply_repayment(credit_line.outstanding_debt, payment)` to update the line total, transfers USDC from `owner_usdc` to `lending_vault` (Option A), and marks `CreditDraw` repaid when `draw_remaining` reaches `0`. | None. |
| `freeze_credit_default` / `settle_credit_default` | Permissionless | Phase 1 freezes `CreditLine` after grace expires; phase 2 seizes raw collateral from `pool_vault` into `lending_vault`. | Updates `StakePool` and `UserStake`; leaves existing `trigger_default*` unchanged. |
| `close_credit_draw` | Draw owner | Closes only `Repaid` or `Defaulted` draws, sends the account rent to the owner, and makes the product ID reusable. | Does not change credit line or pool balances. |
| Unstake guard in `unstake_usdc` | `user` (owner) | Requires the canonical credit PDAs and checks active LTV and freeze status if the owner has a line. | The new Anchor IDL auto-resolves the PDAs. Clients that hand-build the old account list must append read-only `credit_line` (`["credit_line", user]`) and `credit_config` (`["credit_config"]`) PDAs even when uninitialized. |

Credit draws require the governance-configured mint to match the legacy stake pool's mint. Credit initialization does not change the legacy stake pool's first-caller initialization or migrate any accounts.
