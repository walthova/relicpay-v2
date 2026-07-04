//! v2: governance tunes the stake pool APY, capped at MAX_YIELD_RATE_BPS.
//!
//! CALLER: the stake pool authority only.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::PoolRateUpdated;
use crate::state::StakePool;

pub fn handler(ctx: Context<UpdatePoolRate>, new_rate_bps: u16) -> Result<()> {
    require!(new_rate_bps <= MAX_YIELD_RATE_BPS, RelicPayError::RateTooHigh);

    let pool = &mut ctx.accounts.stake_pool;
    let old_rate = pool.yield_rate_bps_annual;
    pool.yield_rate_bps_annual = new_rate_bps;

    emit!(PoolRateUpdated {
        pool: pool.key(),
        old_rate_bps: old_rate,
        new_rate_bps,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct UpdatePoolRate<'info> {
    #[account(
        mut,
        seeds = [SEED_STAKE_POOL],
        bump = stake_pool.bump,
        constraint = stake_pool.authority == authority.key() @ RelicPayError::Unauthorized
    )]
    pub stake_pool: Account<'info, StakePool>,

    pub authority: Signer<'info>,
}
