use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::state::LendingPool;

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
