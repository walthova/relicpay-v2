use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::credit::apply_repayment;
use crate::errors::RelicPayError;
use crate::state::{CreditDraw, CreditDrawState, CreditLine, LendingPool};

pub fn handler(ctx: Context<RepayCreditDraw>, payment: u64) -> Result<()> {
    let draw = &mut ctx.accounts.credit_draw;
    let line = &mut ctx.accounts.credit_line;
    let pool = &mut ctx.accounts.lending_pool;
    require!(
        draw.state == CreditDrawState::Active,
        RelicPayError::InvalidCreditDrawState
    );
    let remaining = draw
        .principal
        .checked_sub(draw.amount_repaid)
        .ok_or(RelicPayError::MathOverflow)?;
    let remaining = apply_repayment(remaining, payment)?;
    draw.amount_repaid = draw
        .principal
        .checked_sub(remaining)
        .ok_or(RelicPayError::MathOverflow)?;
    line.outstanding_debt = apply_repayment(line.outstanding_debt, payment)?;
    line.total_repaid = line
        .total_repaid
        .checked_add(payment)
        .ok_or(RelicPayError::MathOverflow)?;
    if remaining == 0 {
        draw.state = CreditDrawState::Repaid;
        line.draws_repaid = line
            .draws_repaid
            .checked_add(1)
            .ok_or(RelicPayError::MathOverflow)?;
    }
    pool.total_repaid = pool
        .total_repaid
        .checked_add(payment)
        .ok_or(RelicPayError::MathOverflow)?;
    pool.total_liquidity = pool
        .total_liquidity
        .checked_add(payment)
        .ok_or(RelicPayError::MathOverflow)?;

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.owner_usdc.to_account_info(),
                to: ctx.accounts.lending_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        payment,
    )
}

#[derive(Accounts)]
pub struct RepayCreditDraw<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_CREDIT_LINE, owner.key().as_ref()],
        bump = credit_line.bump,
        has_one = owner
    )]
    pub credit_line: Account<'info, CreditLine>,
    #[account(
        mut,
        seeds = [SEED_CREDIT_DRAW, owner.key().as_ref(), credit_draw.product_id.as_bytes()],
        bump = credit_draw.bump,
        has_one = owner
    )]
    pub credit_draw: Account<'info, CreditDraw>,
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
    #[account(mut, token::mint = lending_pool.usdc_mint, token::authority = owner)]
    pub owner_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
