use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::state::CreditConfig;

pub fn update_credit_config_handler(
    ctx: Context<UpdateCreditConfig>,
    ltv_bps: u16,
    paused: bool,
) -> Result<()> {
    require!(ltv_bps <= MAX_LTV_BPS, RelicPayError::LtvTooHigh);
    ctx.accounts.credit_config.ltv_bps = ltv_bps;
    ctx.accounts.credit_config.paused = paused;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateCreditConfig<'info> {
    #[account(mut, seeds = [SEED_CREDIT_CONFIG], bump = credit_config.bump, has_one = authority)]
    pub credit_config: Account<'info, CreditConfig>,
    pub authority: Signer<'info>,
}
