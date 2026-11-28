use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::state::{CreditConfig, StakePool};

pub fn init_credit_config_handler(ctx: Context<InitCreditConfig>) -> Result<()> {
    ctx.accounts.credit_config.set_inner(CreditConfig {
        authority: ctx.accounts.authority.key(),
        usdc_mint: ctx.accounts.usdc_mint.key(),
        ltv_bps: 0,
        paused: false,
        bump: ctx.bumps.credit_config,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct InitCreditConfig<'info> {
    #[account(init, payer = authority, space = 8 + CreditConfig::INIT_SPACE, seeds = [SEED_CREDIT_CONFIG], bump)]
    pub credit_config: Account<'info, CreditConfig>,
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
    #[account(mint::decimals = 6)]
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        seeds = [SEED_STAKE_POOL],
        bump = stake_pool.bump,
        constraint = stake_pool.usdc_mint == usdc_mint.key() @ RelicPayError::CreditMintMismatch
    )]
    pub stake_pool: Account<'info, StakePool>,
    pub system_program: Program<'info, System>,
}
