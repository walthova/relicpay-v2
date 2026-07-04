//! One-time protocol initialization: creates the global StakePool and vault.
//!
//! The StakePool is separate from BNPL agreements. Users lock USDC to earn
//! 3% APY and unlock browser-extension discount tiers (see constants.rs).

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::events::StakePoolInitialized;
use crate::state::StakePool;

pub fn handler(ctx: Context<InitStakePool>) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;
    pool.authority = ctx.accounts.authority.key();
    pool.usdc_mint = ctx.accounts.usdc_mint.key();
    pool.total_staked = 0;
    pool.yield_rate_bps_annual = DEFAULT_YIELD_RATE_BPS;
    pool.bump = ctx.bumps.stake_pool;

    emit!(StakePoolInitialized {
        pool: pool.key(),
        authority: pool.authority,
        yield_rate_bps_annual: pool.yield_rate_bps_annual,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct InitStakePool<'info> {
    #[account(
        init,
        payer = authority,
        space = StakePool::SIZE,
        seeds = [SEED_STAKE_POOL],
        bump
    )]
    pub stake_pool: Account<'info, StakePool>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(
        init,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = stake_pool,
        seeds = [SEED_POOL_VAULT, stake_pool.key().as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
