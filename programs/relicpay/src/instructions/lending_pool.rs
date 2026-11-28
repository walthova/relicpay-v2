use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::state::{CreditConfig, LendingPool};

pub fn init_lending_pool_handler(ctx: Context<InitLendingPool>) -> Result<()> {
    ctx.accounts.lending_pool.set_inner(LendingPool {
        authority: ctx.accounts.authority.key(),
        usdc_mint: ctx.accounts.usdc_mint.key(),
        total_liquidity: 0,
        total_lent: 0,
        total_repaid: 0,
        bad_debt: 0,
        bump: ctx.bumps.lending_pool,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct InitLendingPool<'info> {
    #[account(init, payer = authority, space = 8 + LendingPool::INIT_SPACE, seeds = [SEED_LENDING_POOL], bump)]
    pub lending_pool: Account<'info, LendingPool>,
    #[account(
        init,
        payer = authority,
        seeds = [SEED_LENDING_VAULT, lending_pool.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = lending_pool
    )]
    pub lending_vault: Account<'info, TokenAccount>,
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
    #[account(seeds = [SEED_CREDIT_CONFIG], bump = credit_config.bump, has_one = usdc_mint)]
    pub credit_config: Account<'info, CreditConfig>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn fund_lending_pool_handler(ctx: Context<FundLendingPool>, amount: u64) -> Result<()> {
    require!(amount > 0, RelicPayError::InvalidAmount);
    let pool = &mut ctx.accounts.lending_pool;
    pool.total_liquidity = pool
        .total_liquidity
        .checked_add(amount)
        .ok_or(RelicPayError::MathOverflow)?;
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.provider_usdc.to_account_info(),
                to: ctx.accounts.lending_vault.to_account_info(),
                authority: ctx.accounts.provider.to_account_info(),
            },
        ),
        amount,
    )
}

#[derive(Accounts)]
pub struct FundLendingPool<'info> {
    #[account(mut, seeds = [SEED_LENDING_POOL], bump = lending_pool.bump)]
    pub lending_pool: Account<'info, LendingPool>,
    #[account(
        mut,
        seeds = [SEED_LENDING_VAULT, lending_pool.key().as_ref()],
        bump,
        token::mint = lending_pool.usdc_mint,
        token::authority = lending_pool
    )]
    pub lending_vault: Account<'info, TokenAccount>,
    pub provider: Signer<'info>,
    #[account(mut, token::mint = lending_pool.usdc_mint, token::authority = provider)]
    pub provider_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
