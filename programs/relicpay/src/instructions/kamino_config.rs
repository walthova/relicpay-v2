//! v2.1: `KaminoConfig` governance PDA — landing pad for real Kamino Lend
//! CPI (DEVELOPMENT_PLAN.md v2.1 items 1-3). See
//! `docs/design/KAMINO_CPI_INTEGRATION.md` for the full technical design and
//! `state.rs` for the account schema. No instruction reads this account yet
//! (`enabled` defaults to `false`) — this ships the governance-controlled
//! storage ahead of the CPI code that will consume it, the same sequencing
//! already used for `ProtocolConfig` in this codebase.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::{KaminoConfigInitialized, KaminoConfigUpdated};
use crate::state::KaminoConfig;

pub fn init_kamino_config_handler(ctx: Context<InitKaminoConfig>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.enabled = false;
    config.kamino_program = Pubkey::default();
    config.lending_market = Pubkey::default();
    config.lending_market_authority = Pubkey::default();
    config.reserve = Pubkey::default();
    config.reserve_liquidity_supply = Pubkey::default();
    config.reserve_collateral_mint = Pubkey::default();
    config.bump = ctx.bumps.config;

    emit!(KaminoConfigInitialized {
        config: config.key(),
        authority: config.authority,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct InitKaminoConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = KaminoConfig::SIZE,
        seeds = [SEED_KAMINO_CONFIG],
        bump
    )]
    pub config: Account<'info, KaminoConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn set_kamino_config_handler(
    ctx: Context<SetKaminoConfig>,
    enabled: bool,
    kamino_program: Pubkey,
    lending_market: Pubkey,
    lending_market_authority: Pubkey,
    reserve: Pubkey,
    reserve_liquidity_supply: Pubkey,
    reserve_collateral_mint: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.enabled = enabled;
    config.kamino_program = kamino_program;
    config.lending_market = lending_market;
    config.lending_market_authority = lending_market_authority;
    config.reserve = reserve;
    config.reserve_liquidity_supply = reserve_liquidity_supply;
    config.reserve_collateral_mint = reserve_collateral_mint;

    emit!(KaminoConfigUpdated {
        config: config.key(),
        enabled,
        reserve,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct SetKaminoConfig<'info> {
    #[account(
        mut,
        seeds = [SEED_KAMINO_CONFIG],
        bump = config.bump,
        constraint = config.authority == authority.key() @ RelicPayError::Unauthorized
    )]
    pub config: Account<'info, KaminoConfig>,

    pub authority: Signer<'info>,
}
