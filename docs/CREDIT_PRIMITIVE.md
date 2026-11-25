# Agent Credit Primitive — Technical Design

**Status:** Design only (paired with pure math in `programs/relicpay/src/credit.rs`). No new on-chain instructions, accounts, or state transitions are implemented in this PR. The credit line, stake-pool yield adapter, and yield agent are **not live**, and the program is **unaudited**.

## Context and repo verification

Before wiring instructions, this design records what `walthova/relicpay-v2` actually implements on `main` today:

- **Agent spending (`programs/relicpay/src/instructions/agent_mandate.rs`)**: `agent_create_agreement` spends directly from the owner's USDC token account via an SPL delegate allowance and deposits the first installment into per-agreement `escrow_usdc`. That SPL-delegate path remains intact as the **no-credit fallback**.
- **Staking (`stake_usdc.rs`, `unstake_usdc.rs`)**: `StakePool` and `UserStake` hold raw USDC in `pool_vault` for browser-extension discount tiers and simulated demo rewards paid only from vault surplus. Staked USDC does not yet back credit, and `StakePool` does not yet deploy funds to Kamino.
- **Merchant settlement (`merchant_withdraw.rs`, `merchant_withdraw_reconciled.rs`)**: Merchants are paid `total_price` from `escrow_usdc` only after `agreement.state == AgreementState::Completed`.
- **Kamino CPI (`docs/design/KAMINO_CPI_INTEGRATION.md`, `kamino_probe.rs`, `*_reconciled.rs`)**: Today Kamino CPI exists only for per-agreement `BnplAgreement` escrow, not `StakePool`. Any failed CPI aborts the entire Solana transaction (there is no try/catch across CPI).
- **Web demo (`app/src/lib/creditDemo.ts`) & prototype (`walthova/relicpay-agents`)**: Both model an 80% LTV credit line (`500` USDC collateral -> `400` USDC credit limit, `180` USDC draw, three `60` USDC repayments) where a lending pool pays the merchant up front.

### Module placement (`programs/relicpay/src/credit.rs`)

The pure math lives in a dedicated `programs/relicpay/src/credit.rs` module rather than `math.rs`. `math.rs` holds simulated yield accrual and discount-tier thresholds; isolating credit-line math in `credit.rs` keeps solvency invariants and their unit tests separate from simulated yield logic and gives upcoming credit instructions a single clean import.

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

**What `main` implements today:** `main` implements **Option B** — `merchant_withdraw.rs` (and `merchant_withdraw_reconciled.rs`) pay `agreement.total_price` to the merchant from `escrow_usdc` only after the buyer completes all installments (`AgreementState::Completed`).

| Dimension | Option A: Upfront payout from a separate lending pool | Option B: Paid from escrow at agreement completion |
|---|---|---|
| **When merchant is paid** | Immediately at agent draw time in USDC | After all installments are paid (`AgreementState::Completed`) |
| **Funding source** | Separate `LendingPool` USDC vault | Per-agreement `escrow_usdc` funded by buyer installments |
| **Role of staked collateral** | Backs the lending pool's upfront advance (`<= 80%` LTV); seizable on default | Holds no protocol credit advance; only signals commitment unless repurposed |
| **Matches demo & product brief** | Yes — matches PR #14 (`app/src/lib/creditDemo.ts`), `RELICPAY_V2.md`, and `walthova/relicpay-agents` | No — behaves like layaway / delayed settlement rather than Buy Now, Pay Later |
| **Capital & liquidity requirement** | Requires funded `LendingPool` liquidity and utilization/solvency tracking | No external pool liquidity needed |
| **Default recovery** | Seize owner's staked collateral to reimburse the lending pool (merchant already paid) | Existing `trigger_default*` sends accumulated `escrow_usdc` to the merchant |
| **Implementation complexity** | Higher: new `LendingPool` vault, draw/repay flows, collateral seizure on default | Lower: reuses existing escrow settlement, fewer new vaults |

**Recommendation: Option A.**
Option A is what makes RelicPay an actual credit protocol for AI agents: merchants receive instant USDC settlement at checkout (required for real agent rails like x402 where a seller delivers API calls, compute, or goods immediately), staked collateral performs a real underwriting function, and on-chain behavior matches both `RELICPAY_V2.md` and the PR #14 web demo. Option B leaves merchants waiting through the entire installment schedule and does not advance credit at purchase time.

**Decision status:** Open for Walter. No instruction or pool account is wired until Walter chooses Option A or Option B.

---

## 3. Unstake guard

While an owner has `outstanding_debt > 0`, unstaking collateral is rejected if the remaining collateral would no longer cover their debt at the active `ltv_bps`:

- Reject unstake if `credit_limit(collateral - withdraw_amount, ltv_bps) < outstanding_debt`.
- Equivalently, the maximum withdrawable collateral is:
  `max_unstake(collateral, ltv_bps, debt) = collateral.saturating_sub(ceil(debt * 10_000 / ltv_bps))`
  (or `collateral` when `debt == 0`; `0` when `debt > 0` and `ltv_bps == 0`).
- **Interaction with `unstake_usdc(0)` on `main`**: Today `unstake_usdc(0)` means "withdraw all principal and collect payable surplus rewards" (and after full unstake, `unstake_usdc(0)` collects deferred rewards). When the guard is wired, `unstake_usdc(0)` with `outstanding_debt > 0` must be rejected rather than draining locked collateral; deferred-reward collection when `staked_amount == 0 && outstanding_debt == 0` stays allowed.

---

## 4. Repayment

- Every repayment reduces `outstanding_debt` first (`apply_repayment(debt, payment)`), which immediately restores `available_credit` by the repaid principal (assuming `ltv_bps` and `collateral` are unchanged).
- Under Option A, repayment transfers USDC from the owner to the `LendingPool` liquidity vault and records installment progress on the credit agreement.
- **Overpayment is rejected**, not silently kept or auto-staked: `payment == 0` returns `InvalidAmount` and `payment > outstanding_debt` returns `RepaymentExceedsDebt`.

---

## 5. Default, rounding, and illiquid Kamino collateral

### Collateral and debt on default

- After a missed payment plus `GRACE_PERIOD_SECONDS` (7 days on `main`), a permissionless default instruction marks the credit draw defaulted.
- **Under Option A**: The merchant was already paid up front by the lending pool. Default seizes staked collateral from the owner's `UserStake` / `pool_vault` up to `outstanding_debt` (capped at available collateral; any shortfall is bad debt tracked on the pool, and any excess collateral above `outstanding_debt` stays with the owner) and transfers it to the lending pool vault, reducing `outstanding_debt` by the recovered amount.
- **Under Option B**: Existing `trigger_default` / `trigger_default_reconciled` behavior applies — escrowed installments go to the merchant.

### Rounding direction

All credit math rounds conservatively in favor of protocol solvency:

- **Collateral value / borrowing power (`credit_limit`)**: rounds **down** (`floor`).
- **Required collateral (`max_unstake`) and any future debt/fee accrual**: rounds **up** (`ceil`).

Combined, `credit_limit(collateral - max_unstake, ltv_bps) >= debt` always holds, and withdrawing even 1 additional base unit drops `credit_limit` strictly below `debt`.

### When collateral is deployed to Kamino and cannot be withdrawn in one transaction

On `main` today, `StakePool` holds raw USDC in `pool_vault` and has no Kamino CPI yet. Once a future stake-pool Kamino adapter deploys idle collateral to Kamino, a reserve pause, 100% utilization, or oracle staleness can prevent redeeming kTokens in the same transaction — and per `docs/design/KAMINO_CPI_INTEGRATION.md`, a failed CPI aborts the entire Solana transaction.

To prevent defaulted owners from escaping seizure when Kamino cannot redeem atomically, default must use a **two-phase settlement**:

1. **Phase 1 — Freeze (always succeeds without Kamino CPI):** Verify grace-period expiry, mark the draw `DefaultPending`, lock `seizure_pending += outstanding_debt` on the owner's credit state, and block all new draws and unstakes for that owner immediately.
2. **Phase 2 — Reconcile & seize (permissionless crank):** Redeem the needed kTokens from Kamino into `pool_vault` (when liquidity/reserve status allows) and transfer `seizure_pending` to the lending pool vault, reducing `UserStake.staked_amount`, `StakePool.total_staked`, and `outstanding_debt`.

---

## 6. Yield

Staked collateral may later be put to work in DeFi by a yield agent that is in development. Today, demo yield is simulated, and `unstake_usdc` pays simulated rewards only from pre-withdrawal `pool_vault` surplus. No live DeFi yield is active on `StakePool`, and this design makes no fixed or target return claims.

---

## 7. Failure-case table

| Failure case | Risk | Mitigation / open design requirement |
|---|---|---|
| **USDC depeg (no oracle)** | Both collateral and debt are denominated in USDC base units with no external price oracle. Because collateral and debt share the same unit of account, a USDC depeg does not create a collateral-vs-debt price mismatch inside the pool, but lenders and merchants holding USDC still bear issuer/peg risk and a depeg could trigger a bank run on pool liquidity. | Keep collateral and debt strictly same-mint (`usdc_mint` pinned in `ProtocolConfig` before mainnet). Add an emergency pause switch (`ProtocolConfig.paused`) to halt new draws during a depeg event. |
| **Collateral locked in Kamino during default** | If `StakePool` collateral is deployed to Kamino and the reserve is paused or illiquid, an inline Kamino redeem CPI fails and aborts the whole default transaction. | Use two-phase default (freeze draws and unstaking immediately without CPI; settle seizure via a permissionless crank once Kamino liquidity is available). Keep a raw-USDC liquidity buffer in `pool_vault` when the stake yield adapter is built. |
| **Agent key compromise within caps** | A stolen agent key can draw up to `min(mandate caps, available_credit)` at approved merchants before the owner revokes it. The agent key can never unstake collateral, raise limits, or undo a revoke. | Enforce strict per-purchase cap, period cap, purchase-count limit, merchant allowlist, expiry, owner co-sign `approval_threshold`, and one-tap `revoke_agent_mandate`. |
| **Owner unstaking ahead of a pending draw** | An owner submits `unstake_usdc` that lands in the same slot before a pending agent draw transaction, reducing `credit_limit` below the draw amount. | Atomic on-chain ordering: if `unstake_usdc` lands first, the draw reads the post-unstake `staked_amount` and fails `ExceedsCreditLimit`; if the draw lands first, `unstake_usdc` reads the updated `outstanding_debt` and fails the unstake guard. Neither order can produce an under-collateralized position. |
| **Rounding dust over many small draws** | Repeated 1-unit or sub-cent draws could try to exploit rounding to borrow more than `ltv_bps` of collateral or leave un-repayable dust. | `outstanding_debt` is tracked in exact integer USDC base units (no fractional debt), `credit_limit` rounds down, and `max_unstake` rounds required collateral up. Debt is summed in exact base units and checked against `credit_limit(collateral, ltv_bps)` on every draw, so small draws cannot accumulate past the exact limit. |
| **Mandate revoked mid-installment plan** | Owner revokes the agent while credit draws from that agent still have unpaid installments. | Revoking a mandate only blocks **new** agent draws (`AgentMandate.revoked = true`). Existing credit draws, repayment obligations, unstake guards, and default paths stay attached to the owner's `CreditLine` and continue normally (matching `creditDemo.ts` and `agent_mandate.rs`). |

---

## 8. Proposed accounts and instructions for the NEXT PR

**All items below are PROPOSED, NOT IMPLEMENTED in this PR.** Account layouts and instruction signatures will be finalized after Walter approves this design and decides Option A vs Option B.

### Proposed accounts (not implemented)

1. **`CreditConfig` (or reserved bytes in `ProtocolConfig`)** — proposed, not implemented
   - **Seeds:** `["credit_config"]` (separate singleton PDA avoids modifying existing `ProtocolConfig` deserialization on older accounts; upgrade-authority gated like `init_protocol_config`).
   - **Fields:** `authority: Pubkey`, `usdc_mint: Pubkey`, `ltv_bps: u16` (`<= 8_000`, defaults to `0` = disabled until governance enables), `paused: bool`, `bump: u8`.
2. **`CreditLine` (one per owner)** — proposed, not implemented
   - **Seeds:** `["credit_line", owner.key().as_ref()]`.
   - **Fields:** `owner: Pubkey`, `outstanding_debt: u64`, `seizure_pending: u64`, `total_borrowed: u64`, `total_repaid: u64`, `draws_repaid: u32`, `frozen: bool`, `bump: u8`.
   - **Why a new PDA instead of adding fields to `UserStake` or `AgentMandate`:** Keeps `UserStake` (covered by the frozen v1 characterization suite) and `AgentMandate` (which contains `allowed_merchants: Vec<Pubkey>`, where appended trailing fields can read stale bytes on existing accounts) untouched.
3. **`LendingPool` + `lending_vault` (Option A only)** — proposed, not implemented
   - **Seeds:** `["lending_pool"]` and `["lending_vault", lending_pool.key().as_ref()]`.
   - **Fields:** `authority: Pubkey`, `usdc_mint: Pubkey`, `total_liquidity: u64`, `total_lent: u64`, `total_repaid: u64`, `bad_debt: u64`, `bump: u8`.
4. **`CreditDraw` (one per credit-backed agent purchase)** — proposed, not implemented
   - **Seeds:** `["credit_draw", owner.key().as_ref(), product_id.as_bytes()]`.
   - **Fields:** `owner: Pubkey`, `agent: Pubkey`, `mandate: Pubkey`, `merchant: Pubkey`, `principal: u64`, `amount_repaid: u64`, `installment_count: u8`, `interval_seconds: i64`, `start_time: i64`, `state: u8` (`Active | Repaid | DefaultPending | Defaulted`), `product_id: String`, `bump: u8`.

### Proposed instructions (not implemented)

| Proposed instruction | Signer(s) | Summary | Existing instructions touched |
|---|---|---|---|
| `init_credit_config` / `update_credit_config` | Upgrade authority (init) / governance authority (update) | Creates `CreditConfig` and sets `ltv_bps <= 8_000` and pause flag. | None (new singleton; mirrors `protocol_config.rs`). |
| `init_lending_pool` / `fund_lending_pool` *(Option A)* | Upgrade authority (init) / liquidity provider (fund) | Creates `LendingPool` + `lending_vault` and deposits USDC liquidity. | None. |
| `agent_draw_credit` | `agent` (+ `owner` if above `approval_threshold`) | Runs all `AgentMandate` checks + `credit::check_draw` against `UserStake.staked_amount` and `CreditLine.outstanding_debt`; updates `CreditLine` and creates `CreditDraw`; under Option A pays `merchant_usdc` up front from `lending_vault`. | Reuses shared limit-check helper factored from `agent_mandate.rs` without changing `agent_create_agreement`. |
| `repay_credit_draw` | `owner` | Calls `credit::apply_repayment`, transfers USDC from `owner_usdc` to `lending_vault` (Option A), reduces `CreditLine.outstanding_debt`, and marks `CreditDraw` repaid when zero. | None. |
| `freeze_credit_default` / `settle_credit_default` | Permissionless | Phase 1 freezes `CreditLine` after grace period (`seizure_pending`); Phase 2 seizes collateral from `UserStake`/`pool_vault` into `lending_vault` (with Kamino redeem crank once stake-pool Kamino exists). | Touches `StakePool` / `UserStake` balances during Phase 2 seizure; leaves existing `trigger_default*` untouched. |
| Unstake guard in `unstake_usdc` | `user` (owner) | Reads optional/uninitialized `CreditLine` PDA (`["credit_line", user]`) and `CreditConfig` (`["credit_config"]`), enforces `withdraw_principal <= credit::max_unstake(staked_amount, ltv_bps, outstanding_debt)` and `!credit_line.frozen`. | Touches `unstake_usdc.rs`. Must preserve frozen `tests/characterization.ts` calls (using Anchor constant/derived PDA resolution with `UncheckedAccount` when `CreditLine` is uninitialized, same pattern as `ProtocolConfig`). |
