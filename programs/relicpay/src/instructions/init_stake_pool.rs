//! One-time protocol initialization: creates the global StakePool, its vault, and the yield
//! reserve.
//!
//! The StakePool is separate from BNPL agreements. Users lock USDC to earn
//! 3% APY and unlock browser-extension discount tiers (see constants.rs).
//!
//! Parity (feat/base-parity):
//! - The yield reserve (seeds = ["yield_reserve"], authority = the stake pool PDA) is the only
//!   source of staking and escrow yield. Staked principal never pays anyone's yield (audit C-1).
//! - Audit C-2: once governance has initialized ProtocolConfig, only its authority may create the
//!   pool, and only for the pinned mint. Deploy runbook: init_protocol_config,
//!   init_protocol_config_ext and set_accepted_mint before init_stake_pool. The stronger fix (gate
//!   on the upgrade authority unconditionally) would break the frozen v1 characterization suite,
//!   which creates the pool from a fresh keypair, so it waits on Walter's decision.

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::StakePoolInitialized;
use crate::instructions::protocol_config::read_config;
use crate::instructions::protocol_config_ext::check_accepted_mint;
use crate::state::StakePool;

pub fn handler(ctx: Context<InitStakePool>) -> Result<()> {
    let config_info = ctx.accounts.protocol_config.to_account_info();
    if let Some(config) = read_config(&config_info, ctx.program_id)? {
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            RelicPayError::Unauthorized
        );
    }
    check_accepted_mint(
        &ctx.accounts.protocol_config_ext.to_account_info(),
        ctx.program_id,
        &ctx.accounts.usdc_mint.key(),
    )?;

    let pool = &mut ctx.accounts.stake_pool;
    pool.authority = ctx.accounts.authority.key();
    pool.usdc_mint = ctx.accounts.usdc_mint.key();
    pool.total_staked = 0;
    pool.yield_rate_bps_annual = DEFAULT_YIELD_RATE_BPS;
    pool.bump = ctx.bumps.stake_pool;
    pool.yield_index = 0;
    pool.last_index_update = Clock::get()?.unix_timestamp;

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

    /// Yield reserve: funded separately (fund_yield_reserve), pays staking and escrow yield.
    #[account(
        init,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = stake_pool,
        seeds = [SEED_YIELD_RESERVE],
        bump
    )]
    pub yield_reserve: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    /// CHECK: constant-seed PDA, may be uninitialized (then no authority gate applies).
    #[account(seeds = [SEED_PROTOCOL_CONFIG], bump)]
    pub protocol_config: UncheckedAccount<'info>,

    /// CHECK: parity singleton at a constant-seed PDA; may be uninitialized (then ignored).
    #[account(seeds = [SEED_PROTOCOL_CONFIG_EXT], bump)]
    pub protocol_config_ext: UncheckedAccount<'info>,
}
