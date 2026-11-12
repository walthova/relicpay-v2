use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("5GPVYpyzdosbzWcdttcCdziJVqUCCARf98J857C3T6Gi");

// ─── RELIC PAY v2 — Decentralized BNPL on Solana ─────────────────────────────
//
// Ground-up rebuild of the v1 contract. Behavior-compatible with the v1
// interface (same instructions, PDAs, errors, and economics) and verified by
// the v1 characterization test suite, plus:
//
//   - Modular layout: state / errors / events / math / one file per instruction
//   - Checked arithmetic everywhere (MathOverflow instead of silent saturation)
//   - merchant_withdrawn flag blocks any double-withdraw path
//   - close_agreement: reclaim rent from settled agreements + empty escrows
//   - update_pool_rate: governance can tune stake pool APY (capped)
//
// THE THREE ROLES:
//   BUYER    — buys today, pays over time, earns yield on escrowed funds
//   MERCHANT — paid in full automatically when the buyer completes payments
//   STAKER   — deposits USDC for 3% APY + browser extension discount tiers
//   AGENT    — an AI agent buying for its owner inside an AgentMandate
//
// YIELD ENGINE:
//   v2.0 (this contract): yield tracked on-chain via simple interest math,
//        paid from a protocol reserve.
//   v2.1 (next milestone): escrow deposited into Kamino Lend via CPI for
//        real USDC supply APY. See "V2_KAMINO:" markers.

#[program]
pub mod relicpay {
    use super::*;

    pub fn create_agreement(
        ctx: Context<CreateAgreement>,
        total_price: u64,
        installment_count: u8,
        interval_seconds: i64,
        product_id: String,
        merchant_name: String,
    ) -> Result<()> {
        instructions::create_agreement::handler(
            ctx,
            total_price,
            installment_count,
            interval_seconds,
            product_id,
            merchant_name,
        )
    }

    pub fn pay_installment(ctx: Context<PayInstallment>) -> Result<()> {
        instructions::pay_installment::handler(ctx)
    }

    pub fn cancel_agreement(ctx: Context<CancelAgreement>) -> Result<()> {
        instructions::cancel_agreement::handler(ctx)
    }

    pub fn merchant_withdraw(ctx: Context<MerchantWithdraw>) -> Result<()> {
        instructions::merchant_withdraw::handler(ctx)
    }

    pub fn claim_yield(ctx: Context<ClaimYield>) -> Result<()> {
        instructions::claim_yield::handler(ctx)
    }

    pub fn trigger_default(ctx: Context<TriggerDefault>) -> Result<()> {
        instructions::trigger_default::handler(ctx)
    }

    /// v2: reclaim rent from a settled agreement (Completed/Cancelled/Defaulted).
    pub fn close_agreement(ctx: Context<CloseAgreement>) -> Result<()> {
        instructions::close_agreement::handler(ctx)
    }

    pub fn init_stake_pool(ctx: Context<InitStakePool>) -> Result<()> {
        instructions::init_stake_pool::handler(ctx)
    }

    pub fn stake_usdc(ctx: Context<StakeUsdc>, amount: u64) -> Result<()> {
        instructions::stake_usdc::handler(ctx, amount)
    }

    pub fn unstake_usdc(ctx: Context<UnstakeUsdc>, amount: u64) -> Result<()> {
        instructions::unstake_usdc::handler(ctx, amount)
    }

    /// v2: stake pool authority tunes the APY (capped at MAX_YIELD_RATE_BPS).
    pub fn update_pool_rate(ctx: Context<UpdatePoolRate>, new_rate_bps: u16) -> Result<()> {
        instructions::update_pool_rate::handler(ctx, new_rate_bps)
    }

    // ── v2.1: protocol-wide risk controls (ahead of real Kamino CPI yield) ──

    /// Creates the singleton ProtocolConfig PDA. Caller becomes governance authority.
    pub fn init_protocol_config(ctx: Context<InitProtocolConfig>) -> Result<()> {
        instructions::protocol_config::init_handler(ctx)
    }

    /// Governance-only emergency stop switch.
    pub fn set_protocol_paused(ctx: Context<SetProtocolPaused>, paused: bool) -> Result<()> {
        instructions::protocol_config::set_paused_handler(ctx, paused)
    }

    /// Governance-only per-agreement deposit cap and protocol-wide TVL cap.
    /// A value of 0 means unlimited.
    pub fn update_risk_limits(
        ctx: Context<UpdateRiskLimits>,
        max_agreement_deposit: u64,
        tvl_cap: u64,
    ) -> Result<()> {
        instructions::protocol_config::update_risk_limits_handler(
            ctx,
            max_agreement_deposit,
            tvl_cap,
        )
    }

    // ── v2.1: KaminoConfig — landing pad for real Kamino Lend CPI ──
    // (DEVELOPMENT_PLAN.md v2.1 items 1-3; see
    // docs/design/KAMINO_CPI_INTEGRATION.md). No instruction reads this
    // config yet — `enabled` defaults to false, so every existing code path
    // is unaffected until the CPI call itself is wired in a future session.

    /// Creates the singleton KaminoConfig PDA. Caller becomes governance authority.
    pub fn init_kamino_config(ctx: Context<InitKaminoConfig>) -> Result<()> {
        instructions::kamino_config::init_kamino_config_handler(ctx)
    }

    /// Governance-only: sets the target Kamino reserve/market accounts and
    /// the master enable switch. All-zero pubkeys + enabled=false (the
    /// post-init default) is always safe — no CPI is attempted.
    #[allow(clippy::too_many_arguments)]
    pub fn set_kamino_config(
        ctx: Context<SetKaminoConfig>,
        enabled: bool,
        kamino_program: Pubkey,
        lending_market: Pubkey,
        lending_market_authority: Pubkey,
        reserve: Pubkey,
        reserve_liquidity_supply: Pubkey,
        reserve_collateral_mint: Pubkey,
    ) -> Result<()> {
        instructions::kamino_config::set_kamino_config_handler(
            ctx,
            enabled,
            kamino_program,
            lending_market,
            lending_market_authority,
            reserve,
            reserve_liquidity_supply,
            reserve_collateral_mint,
        )
    }

    // ── v2.1: Kamino CPI proof-of-concept ──
    // Proves the manual-CPI + fallback-on-failure mechanics end to end
    // against a local mock Kamino program (see `instructions/kamino_probe.rs`
    // and `docs/design/KAMINO_CPI_INTEGRATION.md`). NOT wired into
    // create_agreement/pay_installment/merchant_withdraw — deliberately a
    // standalone probe; see kamino_probe.rs module doc for why.

    /// Moves USDC already sitting in an agreement's escrow into a Kamino
    /// (or mock-Kamino) reserve. Never fails the transaction on a CPI
    /// error — emits a fallback event instead.
    pub fn kamino_probe_deposit(ctx: Context<KaminoProbeDeposit>, amount: u64) -> Result<()> {
        instructions::kamino_probe::probe_deposit_handler(ctx, amount)
    }

    /// Redeems kTokens held by an agreement's escrow back into USDC.
    pub fn kamino_probe_redeem(ctx: Context<KaminoProbeRedeem>, amount: u64) -> Result<()> {
        instructions::kamino_probe::probe_redeem_handler(ctx, amount)
    }

    /// v2.1: single-transaction, Kamino-aware `merchant_withdraw`. If
    /// `escrow_usdc` alone doesn't cover `total_price`, redeems just enough
    /// `escrow_kamino_collateral` first (same CPI path as
    /// `kamino_probe_redeem`), then pays the merchant — collapsing the
    /// previous two-transaction "crank, then withdraw" flow into one. Purely
    /// additive: `merchant_withdraw` is untouched, and this degrades to the
    /// same behavior when an agreement never touched Kamino. See
    /// `merchant_withdraw_reconciled.rs`.
    pub fn merchant_withdraw_reconciled(ctx: Context<MerchantWithdrawReconciled>) -> Result<()> {
        instructions::merchant_withdraw_reconciled::handler(ctx)
    }

    /// v2.1: single-transaction, Kamino-aware `cancel_agreement`. Redeems the
    /// full `escrow_kamino_collateral` balance (if any) back into
    /// `escrow_usdc` first, then runs the same fee/refund split
    /// `cancel_agreement` does — so a buyer never needs to know a separate
    /// `kamino_probe_redeem` crank exists before they can cancel cleanly.
    /// Purely additive: `cancel_agreement` is untouched, and this degrades to
    /// the same behavior when an agreement never touched Kamino. See
    /// `cancel_agreement_reconciled.rs`.
    pub fn cancel_agreement_reconciled(ctx: Context<CancelAgreementReconciled>) -> Result<()> {
        instructions::cancel_agreement_reconciled::handler(ctx)
    }

    /// v2.1: `create_agreement` plus an inline Kamino deposit of the first
    /// installment (same fallback rules as `pay_installment_kamino`).
    /// Purely additive; see `create_agreement_kamino.rs`.
    pub fn create_agreement_kamino(
        ctx: Context<CreateAgreementKamino>,
        total_price: u64,
        installment_count: u8,
        interval_seconds: i64,
        product_id: String,
        merchant_name: String,
    ) -> Result<()> {
        instructions::create_agreement_kamino::handler(
            ctx,
            total_price,
            installment_count,
            interval_seconds,
            product_id,
            merchant_name,
        )
    }

    /// v2.1: `pay_installment` plus an inline Kamino deposit of the
    /// installment into the governance-approved reserve (falls back to raw
    /// USDC if Kamino is disabled or the reserve is paused). Purely
    /// additive; see `pay_installment_kamino.rs`.
    pub fn pay_installment_kamino(ctx: Context<PayInstallmentKamino>) -> Result<()> {
        instructions::pay_installment_kamino::handler(ctx)
    }

    /// v2.1: single-transaction, Kamino-aware `trigger_default`. Redeems the
    /// full `escrow_kamino_collateral` balance (if any) back into
    /// `escrow_usdc` first, then runs the same full-recovery transfer
    /// `trigger_default` does — so a liquidator/bot never needs to know a
    /// separate `kamino_probe_redeem` crank exists before it can recover a
    /// defaulted agreement's full value. Purely additive: `trigger_default`
    /// is untouched, and this degrades to the same behavior when an
    /// agreement never touched Kamino. See `trigger_default_reconciled.rs`.
    pub fn trigger_default_reconciled(ctx: Context<TriggerDefaultReconciled>) -> Result<()> {
        instructions::trigger_default_reconciled::handler(ctx)
    }

    // ── Agent BNPL: owner-set agent spending mandates (agent_mandate.rs) ──

    /// Owner lets one agent buy on their behalf inside `limits`, and
    /// delegates a bounded USDC allowance to the mandate PDA.
    pub fn create_agent_mandate(
        ctx: Context<CreateAgentMandate>,
        limits: MandateLimits,
    ) -> Result<()> {
        instructions::agent_mandate::create_handler(ctx, limits)
    }

    /// Owner changes an active mandate's limits and allowance.
    pub fn update_agent_mandate(
        ctx: Context<UpdateAgentMandate>,
        limits: MandateLimits,
    ) -> Result<()> {
        instructions::agent_mandate::update_handler(ctx, limits)
    }

    /// One-tap revoke: kills the mandate and pulls back the allowance.
    pub fn revoke_agent_mandate(ctx: Context<RevokeAgentMandate>) -> Result<()> {
        instructions::agent_mandate::revoke_handler(ctx)
    }

    /// Reclaims rent from a revoked mandate.
    pub fn close_agent_mandate(ctx: Context<CloseAgentMandate>) -> Result<()> {
        instructions::agent_mandate::close_handler(ctx)
    }

    /// The agent opens a BNPL agreement for its owner, inside the mandate.
    pub fn agent_create_agreement(
        ctx: Context<AgentCreateAgreement>,
        total_price: u64,
        installment_count: u8,
        interval_seconds: i64,
        product_id: String,
        merchant_name: String,
    ) -> Result<()> {
        instructions::agent_mandate::agent_purchase_handler(
            ctx,
            total_price,
            installment_count,
            interval_seconds,
            product_id,
            merchant_name,
        )
    }

    // ── Two-chain parity (feat/base-parity). Base equivalents in docs/CHAIN_PARITY.md ──

    pub fn init_protocol_config_ext(ctx: Context<InitProtocolConfigExt>) -> Result<()> {
        instructions::protocol_config_ext::init_ext_handler(ctx)
    }

    pub fn set_accepted_mint(ctx: Context<UpdateProtocolConfigExt>, mint: Pubkey) -> Result<()> {
        instructions::protocol_config_ext::set_accepted_mint_handler(ctx, mint)
    }

    pub fn set_credit_params(
        ctx: Context<UpdateProtocolConfigExt>,
        enabled: bool,
        rate_bps: u16,
    ) -> Result<()> {
        instructions::protocol_config_ext::set_credit_params_handler(ctx, enabled, rate_bps)
    }

    pub fn init_yield_reserve(ctx: Context<InitYieldReserve>) -> Result<()> {
        instructions::yield_reserve::init_reserve_handler(ctx)
    }

    pub fn fund_yield_reserve(ctx: Context<FundYieldReserve>, amount: u64) -> Result<()> {
        instructions::yield_reserve::fund_handler(ctx, amount)
    }

    pub fn claim_yield_paid(ctx: Context<ClaimYieldPaid>) -> Result<()> {
        instructions::yield_reserve::claim_paid_handler(ctx)
    }

    pub fn init_credit_pool(ctx: Context<InitCreditPool>) -> Result<()> {
        instructions::credit_line::init_pool_handler(ctx)
    }

    pub fn supply_liquidity(ctx: Context<SupplyLiquidity>, amount: u64) -> Result<()> {
        instructions::credit_line::supply_handler(ctx, amount)
    }

    pub fn withdraw_liquidity(ctx: Context<WithdrawLiquidity>, amount: u64) -> Result<()> {
        instructions::credit_line::withdraw_liquidity_handler(ctx, amount)
    }

    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        instructions::credit_line::deposit_collateral_handler(ctx, amount)
    }

    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
        instructions::credit_line::withdraw_collateral_handler(ctx, amount)
    }

    pub fn draw_credit(ctx: Context<DrawCredit>, amount: u64) -> Result<()> {
        instructions::credit_line::draw_handler(ctx, amount)
    }

    pub fn repay_credit(ctx: Context<RepayCredit>, amount: u64) -> Result<()> {
        instructions::credit_line::repay_handler(ctx, amount)
    }

    pub fn liquidate_credit(ctx: Context<LiquidateCredit>) -> Result<()> {
        instructions::credit_line::liquidate_handler(ctx)
    }

    pub fn agent_charge(
        ctx: Context<AgentChargeCredit>,
        amount: u64,
        payment_ref: [u8; 32],
    ) -> Result<()> {
        instructions::agent_mandate::agent_charge_handler(ctx, amount, payment_ref)
    }
}
