//! Withdraw USDC from the stake pool. amount=0 (or > balance) means full
//! unstake. Yield is paid out only on full unstake — the v2.0 accounting
//! simplification carried over from v1 and covered by the characterization
//! suite. Partial-unstake yield payout arrives with the Kamino integration.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::Unstaked;
use crate::math::{calculate_yield, compute_tier};
use crate::state::{StakePool, UserStake};

pub fn handler(ctx: Context<UnstakeUsdc>, amount: u64) -> Result<()> {
    let user_stake = &mut ctx.accounts.user_stake;
    let pool = &mut ctx.accounts.stake_pool;
    let clock = Clock::get()?;

    require!(
        user_stake.owner == ctx.accounts.user.key(),
        RelicPayError::Unauthorized
    );
    require!(user_stake.staked_amount > 0, RelicPayError::NothingToWithdraw);

    // Accrue yield for the period since last stake/unstake.
    let elapsed = (clock.unix_timestamp - user_stake.last_update) as u64;
    let new_yield = calculate_yield(
        user_stake.staked_amount,
        pool.yield_rate_bps_annual,
        elapsed,
    )?;
    user_stake.yield_accrued = user_stake
        .yield_accrued
        .checked_add(new_yield)
        .ok_or(RelicPayError::MathOverflow)?;

    let withdraw_principal = if amount == 0 || amount > user_stake.staked_amount {
        user_stake.staked_amount // full unstake
    } else {
        amount
    };

    // Yield paid only on full unstake.
    let withdraw_yield = if withdraw_principal == user_stake.staked_amount {
        user_stake.yield_accrued
    } else {
        0
    };

    let total_out = withdraw_principal
        .checked_add(withdraw_yield)
        .ok_or(RelicPayError::MathOverflow)?;

    let pool_seeds = &[SEED_STAKE_POOL, &[pool.bump]];
    let signer = &[&pool_seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.pool_vault.to_account_info(),
                to: ctx.accounts.user_usdc.to_account_info(),
                authority: pool.to_account_info(),
            },
            signer,
        ),
        total_out,
    )?;

    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_sub(withdraw_principal)
        .ok_or(RelicPayError::MathOverflow)?;
    if withdraw_yield > 0 {
        user_stake.yield_accrued = 0;
    }
    user_stake.last_update = clock.unix_timestamp;
    user_stake.tier = compute_tier(user_stake.staked_amount);
    pool.total_staked = pool
        .total_staked
        .checked_sub(withdraw_principal)
        .ok_or(RelicPayError::MathOverflow)?;

    emit!(Unstaked {
        user: user_stake.owner,
        principal: withdraw_principal,
        yield_paid: withdraw_yield,
        remaining_staked: user_stake.staked_amount,
        tier: user_stake.tier,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct UnstakeUsdc<'info> {
    #[account(mut, seeds = [SEED_STAKE_POOL], bump = stake_pool.bump)]
    pub stake_pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [SEED_USER_STAKE, user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key() @ RelicPayError::Unauthorized
    )]
    pub user_stake: Account<'info, UserStake>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, token::mint = stake_pool.usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_POOL_VAULT, stake_pool.key().as_ref()], bump)]
    pub pool_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
