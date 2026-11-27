use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::math::{calculate_yield, compute_tier};
use crate::state::{CreditDraw, CreditDrawState, CreditLine, LendingPool, StakePool, UserStake};

pub(super) fn grace_expiry(start: i64, interval_seconds: i64, installment: u8) -> Result<i64> {
    interval_seconds
        .checked_mul(i64::from(installment))
        .and_then(|offset| start.checked_add(offset))
        .and_then(|due| due.checked_add(GRACE_PERIOD_SECONDS))
        .ok_or_else(|| error!(RelicPayError::MathOverflow))
}

pub fn freeze_handler(ctx: Context<FreezeCreditDefault>) -> Result<()> {
    let draw = &mut ctx.accounts.credit_draw;
    let line = &mut ctx.accounts.credit_line;
    require!(
        draw.state == CreditDrawState::Active,
        RelicPayError::InvalidCreditDrawState
    );

    let installment_amount = draw.principal / u64::from(draw.installment_count);
    let first_unpaid = if installment_amount > 0 {
        (draw.amount_repaid / installment_amount).min(u64::from(draw.installment_count) - 1) as u8
            + 1
    } else {
        draw.installment_count
    };
    require!(
        Clock::get()?.unix_timestamp
            > grace_expiry(draw.start_time, draw.interval_seconds, first_unpaid)?,
        RelicPayError::GracePeriodNotExpired
    );
    let remaining = draw
        .principal
        .checked_sub(draw.amount_repaid)
        .ok_or(RelicPayError::MathOverflow)?;
    line.seizure_pending = line
        .seizure_pending
        .checked_add(remaining)
        .ok_or(RelicPayError::MathOverflow)?;
    line.frozen = true;
    draw.state = CreditDrawState::DefaultPending;
    Ok(())
}

#[derive(Accounts)]
pub struct FreezeCreditDefault<'info> {
    #[account(
        mut,
        seeds = [SEED_CREDIT_DRAW, credit_draw.owner.as_ref(), credit_draw.product_id.as_bytes()],
        bump = credit_draw.bump
    )]
    pub credit_draw: Account<'info, CreditDraw>,
    #[account(
        mut,
        seeds = [SEED_CREDIT_LINE, credit_draw.owner.as_ref()],
        bump = credit_line.bump
    )]
    pub credit_line: Account<'info, CreditLine>,
}

pub fn settle_handler(ctx: Context<SettleCreditDefault>) -> Result<()> {
    let draw = &mut ctx.accounts.credit_draw;
    let line = &mut ctx.accounts.credit_line;
    let user_stake = &mut ctx.accounts.user_stake;
    let stake_pool = &mut ctx.accounts.stake_pool;
    let lending_pool = &mut ctx.accounts.lending_pool;
    require!(
        draw.state == CreditDrawState::DefaultPending,
        RelicPayError::InvalidCreditDrawState
    );
    let remaining = draw
        .principal
        .checked_sub(draw.amount_repaid)
        .ok_or(RelicPayError::MathOverflow)?;
    let recovered = remaining.min(user_stake.staked_amount);
    let shortfall = remaining
        .checked_sub(recovered)
        .ok_or(RelicPayError::MathOverflow)?;

    if recovered > 0 {
        let now = Clock::get()?.unix_timestamp;
        let elapsed = now
            .checked_sub(user_stake.last_update)
            .ok_or(RelicPayError::MathOverflow)?
            .max(0) as u64;
        let accrued = calculate_yield(
            user_stake.staked_amount,
            stake_pool.yield_rate_bps_annual,
            elapsed,
        )?;
        user_stake.yield_accrued = user_stake
            .yield_accrued
            .checked_add(accrued)
            .ok_or(RelicPayError::MathOverflow)?;
        user_stake.last_update = user_stake.last_update.max(now);
        user_stake.staked_amount = user_stake
            .staked_amount
            .checked_sub(recovered)
            .ok_or(RelicPayError::MathOverflow)?;
        user_stake.tier = compute_tier(user_stake.staked_amount);
        stake_pool.total_staked = stake_pool
            .total_staked
            .checked_sub(recovered)
            .ok_or(RelicPayError::MathOverflow)?;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_vault.to_account_info(),
                    to: ctx.accounts.lending_vault.to_account_info(),
                    authority: stake_pool.to_account_info(),
                },
                &[&[SEED_STAKE_POOL, &[stake_pool.bump]]],
            ),
            recovered,
        )?;
    }

    line.outstanding_debt = line
        .outstanding_debt
        .checked_sub(recovered)
        .ok_or(RelicPayError::MathOverflow)?;
    line.seizure_pending = line
        .seizure_pending
        .checked_sub(recovered)
        .ok_or(RelicPayError::MathOverflow)?;
    line.frozen = line.seizure_pending > 0;
    lending_pool.total_liquidity = lending_pool
        .total_liquidity
        .checked_add(recovered)
        .ok_or(RelicPayError::MathOverflow)?;
    lending_pool.bad_debt = lending_pool
        .bad_debt
        .checked_add(shortfall)
        .ok_or(RelicPayError::MathOverflow)?;
    draw.state = CreditDrawState::Defaulted;
    Ok(())
}

#[derive(Accounts)]
pub struct SettleCreditDefault<'info> {
    #[account(
        mut,
        seeds = [SEED_CREDIT_DRAW, credit_draw.owner.as_ref(), credit_draw.product_id.as_bytes()],
        bump = credit_draw.bump
    )]
    pub credit_draw: Account<'info, CreditDraw>,
    #[account(
        mut,
        seeds = [SEED_CREDIT_LINE, credit_draw.owner.as_ref()],
        bump = credit_line.bump
    )]
    pub credit_line: Account<'info, CreditLine>,
    #[account(
        mut,
        seeds = [SEED_USER_STAKE, credit_draw.owner.as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == credit_draw.owner @ RelicPayError::Unauthorized
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(mut, seeds = [SEED_STAKE_POOL], bump = stake_pool.bump)]
    pub stake_pool: Account<'info, StakePool>,
    #[account(
        mut,
        seeds = [SEED_POOL_VAULT, stake_pool.key().as_ref()],
        bump,
        token::mint = stake_pool.usdc_mint,
        token::authority = stake_pool
    )]
    pub pool_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [SEED_LENDING_POOL],
        bump = lending_pool.bump,
        constraint = lending_pool.usdc_mint == stake_pool.usdc_mint @ RelicPayError::CreditMintMismatch
    )]
    pub lending_pool: Account<'info, LendingPool>,
    #[account(
        mut,
        seeds = [SEED_LENDING_VAULT, lending_pool.key().as_ref()],
        bump,
        token::mint = lending_pool.usdc_mint,
        token::authority = lending_pool
    )]
    pub lending_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
