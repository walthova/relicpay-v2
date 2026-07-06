//! v2.1: protocol-wide risk controls (DEVELOPMENT_PLAN.md v2.1 item 5).
//!
//! A singleton `ProtocolConfig` PDA holds an emergency pause flag and
//! deposit/TVL caps. This lands ahead of the real Kamino CPI integration so
//! the governance surface exists before yield-bearing deposits do. Not yet
//! wired into `create_agreement` / `stake_usdc` — see state.rs for why.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::{ProtocolConfigInitialized, ProtocolPauseUpdated, RiskLimitsUpdated};
use crate::state::ProtocolConfig;

pub fn init_handler(ctx: Context<InitProtocolConfig>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.paused = false;
    config.max_agreement_deposit = 0; // unlimited by default
    config.tvl_cap = 0; // unlimited by default
    config.current_tvl = 0;
    config.bump = ctx.bumps.config;

    emit!(ProtocolConfigInitialized {
        config: config.key(),
        authority: config.authority,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct InitProtocolConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = ProtocolConfig::SIZE,
        seeds = [SEED_PROTOCOL_CONFIG],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn set_paused_handler(ctx: Context<SetProtocolPaused>, paused: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.paused = paused;

    emit!(ProtocolPauseUpdated {
        config: config.key(),
        paused,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct SetProtocolPaused<'info> {
    #[account(
        mut,
        seeds = [SEED_PROTOCOL_CONFIG],
        bump = config.bump,
        constraint = config.authority == authority.key() @ RelicPayError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

pub fn update_risk_limits_handler(
    ctx: Context<UpdateRiskLimits>,
    max_agreement_deposit: u64,
    tvl_cap: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.max_agreement_deposit = max_agreement_deposit;
    config.tvl_cap = tvl_cap;

    emit!(RiskLimitsUpdated {
        config: config.key(),
        max_agreement_deposit,
        tvl_cap,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateRiskLimits<'info> {
    #[account(
        mut,
        seeds = [SEED_PROTOCOL_CONFIG],
        bump = config.bump,
        constraint = config.authority == authority.key() @ RelicPayError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}
