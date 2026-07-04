//! Deposit USDC into the stake pool. Creates the UserStake PDA on first
//! deposit; on top-ups, accrues yield on the prior balance first so the new
//! principal doesn't retroactively earn.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::Staked;
use crate::math::{calculate_yield, compute_tier};
use crate::state::{StakePool, UserStake};

pub fn handler(ctx: Context<StakeUsdc>, amount: u64) -> Result<()> {
    require!(amount > 0, RelicPayError::InvalidAmount);

    let user_stake = &mut ctx.accounts.user_stake;
    let pool = &mut ctx.accounts.stake_pool;
    let clock = Clock::get()?;

    if user_stake.staked_amount > 0 {
        // Existing staker: accrue yield on prior balance before topping up.
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
    } else {
        // First stake: initialize PDA fields.
        user_stake.owner = ctx.accounts.user.key();
        user_stake.bump = ctx.bumps.user_stake;
    }

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_usdc.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_add(amount)
        .ok_or(RelicPayError::MathOverflow)?;
    user_stake.last_update = clock.unix_timestamp;
    user_stake.tier = compute_tier(user_stake.staked_amount);
    pool.total_staked = pool
        .total_staked
        .checked_add(amount)
        .ok_or(RelicPayError::MathOverflow)?;

    emit!(Staked {
        user: user_stake.owner,
        amount,
        new_total: user_stake.staked_amount,
        tier: user_stake.tier,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct StakeUsdc<'info> {
    #[account(mut, seeds = [SEED_STAKE_POOL], bump = stake_pool.bump)]
    pub stake_pool: Account<'info, StakePool>,

    #[account(
        init_if_needed,
        payer = user,
        space = UserStake::SIZE,
        seeds = [SEED_USER_STAKE, user.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, token::mint = stake_pool.usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_POOL_VAULT, stake_pool.key().as_ref()], bump)]
    pub pool_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
