//! Parity singleton ProtocolConfigExt (seeds = ["protocol_config_ext"]).
//!
//! Holds the accepted USDC mint (audit C-4), the last unpause time used by the default grace rule
//! (audit C-5), and the credit line feature flag and rate. Same pattern as ProtocolConfig: init is
//! gated on the program upgrade authority, every reader takes it as an `UncheckedAccount` at its
//! constant-seed PDA and treats an uninitialized (system-owned) account as "not configured", so
//! the frozen v1 characterization suite runs unchanged.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::ProtocolConfigExtUpdated;
use crate::state::ProtocolConfigExt;

pub fn init_ext_handler(ctx: Context<InitProtocolConfigExt>) -> Result<()> {
    let ext = &mut ctx.accounts.ext;
    ext.authority = ctx.accounts.authority.key();
    ext.accepted_mint = Pubkey::default();
    ext.last_unpaused_at = 0;
    ext.credit_enabled = false;
    ext.credit_rate_bps = DEFAULT_CREDIT_RATE_BPS;
    ext.bump = ctx.bumps.ext;
    emit!(ProtocolConfigExtUpdated {
        accepted_mint: ext.accepted_mint,
        credit_enabled: ext.credit_enabled,
        credit_rate_bps: ext.credit_rate_bps,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct InitProtocolConfigExt<'info> {
    #[account(
        init,
        payer = authority,
        space = ProtocolConfigExt::SIZE,
        seeds = [SEED_PROTOCOL_CONFIG_EXT],
        bump
    )]
    pub ext: Account<'info, ProtocolConfigExt>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub upgrade_authority: Signer<'info>,

    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = anchor_lang::solana_program::bpf_loader_upgradeable::ID,
        constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key())
            @ RelicPayError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

/// Pin the canonical USDC mint. Once set, every agreement, mandate purchase, stake pool and credit
/// path rejects any other mint. Governance can re-point it (for a mint migration), never unset it.
pub fn set_accepted_mint_handler(ctx: Context<UpdateProtocolConfigExt>, mint: Pubkey) -> Result<()> {
    require!(mint != Pubkey::default(), RelicPayError::MintNotAccepted);
    let ext = &mut ctx.accounts.ext;
    ext.accepted_mint = mint;
    emit!(ProtocolConfigExtUpdated {
        accepted_mint: ext.accepted_mint,
        credit_enabled: ext.credit_enabled,
        credit_rate_bps: ext.credit_rate_bps,
    });
    Ok(())
}

pub fn set_credit_params_handler(
    ctx: Context<UpdateProtocolConfigExt>,
    enabled: bool,
    rate_bps: u16,
) -> Result<()> {
    require!(rate_bps <= MAX_CREDIT_RATE_BPS, RelicPayError::RateTooHigh);
    let ext = &mut ctx.accounts.ext;
    ext.credit_enabled = enabled;
    ext.credit_rate_bps = rate_bps;
    emit!(ProtocolConfigExtUpdated {
        accepted_mint: ext.accepted_mint,
        credit_enabled: ext.credit_enabled,
        credit_rate_bps: ext.credit_rate_bps,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateProtocolConfigExt<'info> {
    #[account(
        mut,
        seeds = [SEED_PROTOCOL_CONFIG_EXT],
        bump = ext.bump,
        constraint = ext.authority == authority.key() @ RelicPayError::Unauthorized
    )]
    pub ext: Account<'info, ProtocolConfigExt>,

    pub authority: Signer<'info>,
}

// ── helpers for other instructions ──

pub fn read_ext(info: &AccountInfo, program_id: &Pubkey) -> Result<Option<ProtocolConfigExt>> {
    if info.owner != program_id {
        return Ok(None);
    }
    let data = info.try_borrow_data()?;
    Ok(Some(ProtocolConfigExt::try_deserialize(&mut &data[..])?))
}

/// Rejects `mint` when an accepted mint is pinned and this is not it.
pub fn check_accepted_mint(info: &AccountInfo, program_id: &Pubkey, mint: &Pubkey) -> Result<()> {
    if let Some(ext) = read_ext(info, program_id)? {
        if ext.accepted_mint != Pubkey::default() {
            require_keys_eq!(ext.accepted_mint, *mint, RelicPayError::MintNotAccepted);
        }
    }
    Ok(())
}

/// The grace deadline a default must clear: the normal 7 days past the missed due date, or
/// 7 days past the last unpause, whichever is later.
pub fn effective_grace_expiry(info: &AccountInfo, program_id: &Pubkey, grace_expiry: i64) -> Result<i64> {
    if let Some(ext) = read_ext(info, program_id)? {
        if ext.last_unpaused_at > 0 {
            let unpause_grace = ext
                .last_unpaused_at
                .checked_add(GRACE_PERIOD_SECONDS)
                .ok_or(RelicPayError::MathOverflow)?;
            return Ok(grace_expiry.max(unpause_grace));
        }
    }
    Ok(grace_expiry)
}

/// Records an unpause so defaults restart their grace window from it.
pub fn record_unpause(info: &AccountInfo, program_id: &Pubkey, now: i64) -> Result<()> {
    if let Some(mut ext) = read_ext(info, program_id)? {
        ext.last_unpaused_at = now;
        let mut data = info.try_borrow_mut_data()?;
        let mut cursor: &mut [u8] = &mut data;
        ext.try_serialize(&mut cursor)?;
    }
    Ok(())
}
