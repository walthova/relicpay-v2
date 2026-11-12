//! Parity (feat/base-parity): the yield reserve and real escrow-yield payouts.
//!
//! `fund_yield_reserve`: anyone tops up the reserve. It is the only source of simulated yield.
//!
//! `claim_yield_paid`: pays a Completed agreement's simulated `yield_accrued` from the reserve,
//! never from escrow, capped at the reserve balance (partial payouts allowed, the rest stays
//! owed). Base: RelicEscrow.claimYield.
//!
//! v1 `claim_yield` is kept unchanged because the frozen characterization suite covers it. It
//! zeroes `yield_accrued` without paying anything (audit C-12). Clients should call
//! `claim_yield_paid`; retiring v1 `claim_yield` is a decision for Walter.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::{EscrowYieldPaid, YieldReserveFunded};
use crate::state::{AgreementState, BnplAgreement, StakePool};

/// Creates the yield reserve for a stake pool that predates it (devnet pools created before this
/// branch). Permissionless: the address and mint are fixed by the pool, so there is nothing to choose.
pub fn init_reserve_handler(_ctx: Context<InitYieldReserve>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct InitYieldReserve<'info> {
    #[account(seeds = [SEED_STAKE_POOL], bump = stake_pool.bump)]
    pub stake_pool: Account<'info, StakePool>,

    #[account(
        init,
        payer = payer,
        token::mint = usdc_mint,
        token::authority = stake_pool,
        seeds = [SEED_YIELD_RESERVE],
        bump
    )]
    pub yield_reserve: Account<'info, TokenAccount>,

    #[account(address = stake_pool.usdc_mint @ RelicPayError::MintNotAccepted)]
    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn fund_handler(ctx: Context<FundYieldReserve>, amount: u64) -> Result<()> {
    require!(amount > 0, RelicPayError::InvalidAmount);
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.funder_usdc.to_account_info(),
                to: ctx.accounts.yield_reserve.to_account_info(),
                authority: ctx.accounts.funder.to_account_info(),
            },
        ),
        amount,
    )?;
    emit!(YieldReserveFunded {
        from: ctx.accounts.funder.key(),
        amount,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FundYieldReserve<'info> {
    #[account(seeds = [SEED_STAKE_POOL], bump = stake_pool.bump)]
    pub stake_pool: Account<'info, StakePool>,

    #[account(mut, seeds = [SEED_YIELD_RESERVE], bump, token::authority = stake_pool)]
    pub yield_reserve: Account<'info, TokenAccount>,

    pub funder: Signer<'info>,

    #[account(mut, token::mint = stake_pool.usdc_mint, token::authority = funder)]
    pub funder_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn claim_paid_handler(ctx: Context<ClaimYieldPaid>) -> Result<()> {
    let reserve_balance = ctx.accounts.yield_reserve.amount;
    let agreement = &mut ctx.accounts.agreement;
    require!(
        agreement.state == AgreementState::Completed,
        RelicPayError::AgreementNotComplete
    );
    require_keys_eq!(
        agreement.usdc_mint,
        ctx.accounts.stake_pool.usdc_mint,
        RelicPayError::MintNotAccepted
    );
    let owed = agreement.yield_accrued;
    require!(owed > 0, RelicPayError::NothingToWithdraw);
    let pay = owed.min(reserve_balance);
    require!(pay > 0, RelicPayError::YieldReserveEmpty);

    agreement.yield_accrued = owed - pay;

    let pool_seeds = &[SEED_STAKE_POOL, &[ctx.accounts.stake_pool.bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.yield_reserve.to_account_info(),
                to: ctx.accounts.buyer_usdc.to_account_info(),
                authority: ctx.accounts.stake_pool.to_account_info(),
            },
            &[&pool_seeds[..]],
        ),
        pay,
    )?;

    emit!(EscrowYieldPaid {
        agreement: agreement.key(),
        buyer: agreement.buyer,
        amount: pay,
        still_owed: agreement.yield_accrued,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimYieldPaid<'info> {
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, buyer.key().as_ref(), agreement.product_id.as_bytes()],
        bump = agreement.bump,
        constraint = agreement.buyer == buyer.key() @ RelicPayError::Unauthorized
    )]
    pub agreement: Account<'info, BnplAgreement>,

    pub buyer: Signer<'info>,

    #[account(mut, token::mint = agreement.usdc_mint, token::authority = buyer)]
    pub buyer_usdc: Account<'info, TokenAccount>,

    #[account(seeds = [SEED_STAKE_POOL], bump = stake_pool.bump)]
    pub stake_pool: Account<'info, StakePool>,

    #[account(mut, seeds = [SEED_YIELD_RESERVE], bump, token::authority = stake_pool)]
    pub yield_reserve: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
