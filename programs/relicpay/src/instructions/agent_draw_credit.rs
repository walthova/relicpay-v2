use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use super::agent_mandate::record_purchase;
use super::authorize_agent_credit::credit_authorized;
use super::create_agreement::ProductIdSeed;
use super::freeze_credit_default::grace_expiry;
use crate::constants::*;
use crate::credit::check_draw;
use crate::errors::RelicPayError;
use crate::state::{
    AgentMandate, CreditConfig, CreditDraw, CreditDrawState, CreditLine, LendingPool, StakePool,
    UserStake,
};

pub fn handler(
    ctx: Context<AgentDrawCredit>,
    principal: u64,
    installment_count: u8,
    interval_seconds: i64,
    product_id: String,
) -> Result<()> {
    let config = &ctx.accounts.credit_config;
    let line = &mut ctx.accounts.credit_line;
    let pool = &mut ctx.accounts.lending_pool;
    let now = Clock::get()?.unix_timestamp;

    require!(!config.paused, RelicPayError::CreditPaused);
    require!(!line.frozen, RelicPayError::CreditLineFrozen);
    require!(
        (MIN_INSTALLMENTS..=MAX_INSTALLMENTS).contains(&installment_count),
        RelicPayError::InvalidInstallments
    );
    require!(interval_seconds > 0, RelicPayError::InvalidInterval);
    grace_expiry(now, interval_seconds, installment_count)?;

    require!(
        credit_authorized(&ctx.accounts.mandate.to_account_info())?,
        RelicPayError::CreditNotAuthorized
    );
    record_purchase(
        &mut ctx.accounts.mandate,
        principal,
        ctx.accounts.merchant.key(),
        ctx.accounts.owner.is_signer,
        now,
    )?;
    line.outstanding_debt = check_draw(
        principal,
        ctx.accounts.user_stake.staked_amount,
        config.ltv_bps,
        line.outstanding_debt,
    )?;
    require!(
        principal <= ctx.accounts.lending_vault.amount,
        RelicPayError::InsufficientLendingLiquidity
    );
    pool.total_liquidity = pool
        .total_liquidity
        .checked_sub(principal)
        .ok_or(RelicPayError::InsufficientLendingLiquidity)?;
    pool.total_lent = pool
        .total_lent
        .checked_add(principal)
        .ok_or(RelicPayError::MathOverflow)?;
    line.owner = ctx.accounts.owner.key();
    line.bump = ctx.bumps.credit_line;
    line.total_borrowed = line
        .total_borrowed
        .checked_add(principal)
        .ok_or(RelicPayError::MathOverflow)?;
    ctx.accounts.credit_draw.set_inner(CreditDraw {
        owner: line.owner,
        agent: ctx.accounts.agent.key(),
        mandate: ctx.accounts.mandate.key(),
        merchant: ctx.accounts.merchant.key(),
        principal,
        amount_repaid: 0,
        installment_count,
        interval_seconds,
        start_time: now,
        state: CreditDrawState::Active,
        product_id,
        bump: ctx.bumps.credit_draw,
    });

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.lending_vault.to_account_info(),
                to: ctx.accounts.merchant_usdc.to_account_info(),
                authority: pool.to_account_info(),
            },
            &[&[SEED_LENDING_POOL, &[pool.bump]]],
        ),
        principal,
    )
}

#[derive(Accounts)]
#[instruction(principal: u64, installment_count: u8, interval_seconds: i64, product_id: String)]
pub struct AgentDrawCredit<'info> {
    #[account(
        mut,
        seeds = [SEED_AGENT_MANDATE, owner.key().as_ref(), agent.key().as_ref()],
        bump = mandate.bump,
        has_one = owner,
        has_one = agent
    )]
    pub mandate: Box<Account<'info, AgentMandate>>,
    #[account(mut)]
    pub agent: Signer<'info>,
    /// CHECK: Bound to the mandate; signs above the approval threshold.
    pub owner: UncheckedAccount<'info>,
    /// CHECK: Checked against the mandate allowlist and the payout token account.
    pub merchant: UncheckedAccount<'info>,
    #[account(seeds = [SEED_CREDIT_CONFIG], bump = credit_config.bump)]
    pub credit_config: Box<Account<'info, CreditConfig>>,
    #[account(
        seeds = [SEED_STAKE_POOL],
        bump = stake_pool.bump,
        constraint = stake_pool.usdc_mint == credit_config.usdc_mint @ RelicPayError::CreditMintMismatch
    )]
    pub stake_pool: Box<Account<'info, StakePool>>,
    #[account(
        seeds = [SEED_USER_STAKE, owner.key().as_ref()],
        bump = user_stake.bump,
        has_one = owner
    )]
    pub user_stake: Box<Account<'info, UserStake>>,
    #[account(
        init_if_needed,
        payer = agent,
        space = 8 + CreditLine::INIT_SPACE,
        seeds = [SEED_CREDIT_LINE, owner.key().as_ref()],
        bump
    )]
    pub credit_line: Box<Account<'info, CreditLine>>,
    #[account(
        init,
        payer = agent,
        space = 8 + CreditDraw::INIT_SPACE,
        seeds = [SEED_CREDIT_DRAW, owner.key().as_ref(), product_id.checked_seed()?.as_bytes()],
        bump
    )]
    pub credit_draw: Box<Account<'info, CreditDraw>>,
    #[account(
        mut,
        seeds = [SEED_LENDING_POOL],
        bump = lending_pool.bump,
        constraint = lending_pool.usdc_mint == credit_config.usdc_mint @ RelicPayError::CreditMintMismatch
    )]
    pub lending_pool: Box<Account<'info, LendingPool>>,
    #[account(
        mut,
        seeds = [SEED_LENDING_VAULT, lending_pool.key().as_ref()],
        bump,
        token::mint = lending_pool.usdc_mint,
        token::authority = lending_pool
    )]
    pub lending_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = lending_pool.usdc_mint,
        token::authority = merchant,
        constraint = merchant_usdc.key() != lending_vault.key() @ RelicPayError::InvalidCreditDestination
    )]
    pub merchant_usdc: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
