//! Withdraw USDC from the stake pool. amount=0 (or > balance) means full
//! unstake. Yield is paid out only on full unstake (the v1 accounting rule the
//! characterization suite covers).
//!
//! Parity (feat/base-parity, audit C-1): principal comes from the pool vault,
//! yield comes only from the separately funded yield reserve and is capped at
//! its balance. Any shortfall stays owed in `yield_accrued` and can be collected
//! later by calling unstake again with nothing staked. Staked principal is never
//! used to pay anyone's yield, so every staker can always withdraw in full.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::Unstaked;
use crate::math::{checkpoint_pool, compute_tier, settle_stake};
use crate::state::{StakePool, UserStake};

pub fn handler(ctx: Context<UnstakeUsdc>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let reserve_balance = ctx.accounts.yield_reserve.amount;
    let user_stake = &mut ctx.accounts.user_stake;
    let pool = &mut ctx.accounts.stake_pool;

    require!(
        user_stake.owner == ctx.accounts.user.key(),
        RelicPayError::Unauthorized
    );
    require!(
        user_stake.staked_amount > 0 || user_stake.yield_accrued > 0,
        RelicPayError::NothingToWithdraw
    );

    checkpoint_pool(pool, clock.unix_timestamp)?;
    settle_stake(user_stake, pool.yield_index)?;

    let withdraw_principal = if amount == 0 || amount > user_stake.staked_amount {
        user_stake.staked_amount
    } else {
        amount
    };
    let full = withdraw_principal == user_stake.staked_amount;
    let withdraw_yield = if full {
        user_stake.yield_accrued.min(reserve_balance)
    } else {
        0
    };

    let pool_seeds = &[SEED_STAKE_POOL, &[pool.bump]];
    let signer = &[&pool_seeds[..]];

    if withdraw_principal > 0 {
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
            withdraw_principal,
        )?;
    }
    if withdraw_yield > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.yield_reserve.to_account_info(),
                    to: ctx.accounts.user_usdc.to_account_info(),
                    authority: pool.to_account_info(),
                },
                signer,
            ),
            withdraw_yield,
        )?;
    }

    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_sub(withdraw_principal)
        .ok_or(RelicPayError::MathOverflow)?;
    user_stake.yield_accrued = user_stake
        .yield_accrued
        .checked_sub(withdraw_yield)
        .ok_or(RelicPayError::MathOverflow)?;
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

    #[account(
        mut,
        seeds = [SEED_YIELD_RESERVE],
        bump,
        token::mint = stake_pool.usdc_mint,
        token::authority = stake_pool,
    )]
    pub yield_reserve: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
