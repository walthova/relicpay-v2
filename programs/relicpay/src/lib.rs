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
}
