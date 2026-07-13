//! v2.1: protocol-wide risk controls (DEVELOPMENT_PLAN.md v2.1 item 5).
//!
//! A singleton `ProtocolConfig` PDA holds an emergency pause flag and
//! deposit/TVL caps. `create_agreement` enforces `paused` and
//! `max_agreement_deposit`; `pay_installment` also enforces `paused` — see
//! state.rs and instructions/create_agreement.rs / pay_installment.rs
//! for how a constant-seed PDA gets wired into an existing instruction
//! without breaking the frozen v1 characterization suite. TVL cap
//! enforcement and `stake_usdc` wiring are still open (see state.rs).

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

// ─── Shared helpers for wiring ProtocolConfig into money-moving instructions ──
//
// create_agreement / pay_installment / merchant_withdraw / cancel_agreement /
// trigger_default all take `protocol_config` as an `UncheckedAccount` with a
// constant PDA seed (see create_agreement.rs's doc comment for why: Anchor's
// TS client auto-derives constant-seed PDAs even when a caller's
// `.accounts()` never lists them, which is what keeps the frozen v1
// characterization suite untouched while these instructions gain a new
// account). These helpers centralize the "read raw account data, treat a
// system-owned (uninitialized) PDA as no risk controls configured" pattern
// instead of duplicating it five times.

/// Deserializes the config if the PDA is owned by this program (i.e.
/// `init_protocol_config` has been called). Returns `None` for a
/// system-owned/uninitialized PDA — callers treat that as "no risk controls
/// configured" so deployments that predate governance setup are unaffected.
pub fn read_config(
    config_info: &AccountInfo,
    program_id: &Pubkey,
) -> Result<Option<ProtocolConfig>> {
    if config_info.owner != program_id {
        return Ok(None);
    }
    let data = config_info.try_borrow_data()?;
    Ok(Some(ProtocolConfig::try_deserialize(&mut &data[..])?))
}

fn write_config(config_info: &AccountInfo, config: &ProtocolConfig) -> Result<()> {
    let mut data = config_info.try_borrow_mut_data()?;
    let mut cursor: &mut [u8] = &mut data;
    config.try_serialize(&mut cursor)
}

/// Enforces the emergency pause switch. No-op if the config PDA isn't
/// initialized.
pub fn check_not_paused(config_info: &AccountInfo, program_id: &Pubkey) -> Result<()> {
    if let Some(config) = read_config(config_info, program_id)? {
        require!(!config.paused, RelicPayError::ProtocolPaused);
    }
    Ok(())
}

/// Enforces the protocol-wide TVL cap and increases `current_tvl` by
/// `amount` (USDC newly entering escrow). No-op if the config PDA isn't
/// initialized. Must be called before the corresponding token transfer so a
/// cap violation reverts the whole transaction (checks-effects-interactions).
pub fn apply_tvl_increase(
    config_info: &AccountInfo,
    program_id: &Pubkey,
    amount: u64,
) -> Result<()> {
    if let Some(mut config) = read_config(config_info, program_id)? {
        let projected = config
            .current_tvl
            .checked_add(amount)
            .ok_or(RelicPayError::MathOverflow)?;
        if config.tvl_cap > 0 {
            require!(projected <= config.tvl_cap, RelicPayError::TvlCapExceeded);
        }
        config.current_tvl = projected;
        write_config(config_info, &config)?;
    }
    Ok(())
}

/// Decreases `current_tvl` by `amount` (USDC leaving escrow — merchant
/// withdrawal, cancellation, or default). No-op if the config PDA isn't
/// initialized. Saturating: never fails, so a bookkeeping edge case can
/// never block a buyer/merchant from getting their funds.
pub fn apply_tvl_decrease(
    config_info: &AccountInfo,
    program_id: &Pubkey,
    amount: u64,
) -> Result<()> {
    if let Some(mut config) = read_config(config_info, program_id)? {
        config.current_tvl = config.current_tvl.saturating_sub(amount);
        write_config(config_info, &config)?;
    }
    Ok(())
}
