//! v2.1: `pay_installment` with an inline Kamino deposit (DEVELOPMENT_PLAN.md
//! v2.1 items 1 and 3).
//!
//! Runs the exact same checks, yield accrual, TVL accounting and bookkeeping
//! as `pay_installment` (the shared `prepare_installment` /
//! `finish_installment` helpers), moves the installment buyer -> escrow_usdc,
//! then deposits that installment's USDC from `escrow_usdc` into the
//! governance-approved Kamino reserve in the same transaction. The escrow PDA
//! ends up holding kTokens in `escrow_kamino_collateral` and
//! `yield_source` flips to KaminoLend. The reconciled exits
//! (`merchant_withdraw_reconciled`, `cancel_agreement_reconciled`,
//! `trigger_default_reconciled`) already redeem that collateral inline, so
//! no keeper crank is needed on either side of an agreement's life.
//!
//! FALLBACK ("never block a purchase on a DeFi dependency"): a CPI failure
//! cannot be caught on Solana, so this predicts it. If `KaminoConfig` is
//! disabled, or the reserve looks paused (same best-effort preflight as the
//! probe), the deposit is skipped, a `KaminoDepositProbeFallback` event is
//! emitted, and the installment lands as raw USDC exactly as plain
//! `pay_installment` would. Passing accounts that do NOT match an enabled
//! `KaminoConfig` is a caller error and reverts.
//!
//! ADDITIVE: `pay_installment` keeps its original Accounts struct (frozen
//! suite). CALLER: the buyer's wallet.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::events::{KaminoDepositProbeFallback, KaminoDepositProbeSucceeded};
use crate::instructions::kamino_cpi::{try_kamino_deposit, KaminoDepositAccounts};
use crate::instructions::merchant_withdraw_reconciled::{
    mock_reserve_looks_paused, require_matches_kamino_config,
};
use crate::instructions::pay_installment::{finish_installment, prepare_installment};
use crate::state::{BnplAgreement, KaminoConfig};

pub fn handler(ctx: Context<PayInstallmentKamino>) -> Result<()> {
    let config_info = ctx.accounts.protocol_config.to_account_info();
    let (next_installment, amount_due, is_last) = prepare_installment(
        &mut ctx.accounts.agreement,
        &config_info,
        ctx.program_id,
    )?;

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer_usdc.to_account_info(),
                to: ctx.accounts.escrow_usdc.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        amount_due,
    )?;

    let agreement_key = ctx.accounts.agreement.key();
    finish_installment(
        &mut ctx.accounts.agreement,
        agreement_key,
        next_installment,
        amount_due,
        is_last,
    )?;

    // Deposit step.
    let reserve_info = ctx.accounts.kamino_reserve.to_account_info();
    if !ctx.accounts.config.enabled || mock_reserve_looks_paused(&reserve_info) {
        emit!(KaminoDepositProbeFallback {
            agreement: agreement_key,
            amount: amount_due,
        });
        return Ok(());
    }

    require_matches_kamino_config(
        &ctx.accounts.config,
        &ctx.accounts.kamino_program.key(),
        &ctx.accounts.kamino_lending_market.key(),
        &ctx.accounts.kamino_lending_market_authority.key(),
        &ctx.accounts.kamino_reserve.key(),
        &ctx.accounts.kamino_reserve_liquidity_supply.key(),
        &ctx.accounts.kamino_reserve_collateral_mint.key(),
    )?;

    let buyer = ctx.accounts.agreement.buyer;
    let product_id = ctx.accounts.agreement.product_id.clone();
    let bump = ctx.accounts.agreement.bump;

    let owner_info = ctx.accounts.agreement.to_account_info();
    let kamino_program_info = ctx.accounts.kamino_program.to_account_info();
    let lending_market_info = ctx.accounts.kamino_lending_market.to_account_info();
    let lending_market_authority_info =
        ctx.accounts.kamino_lending_market_authority.to_account_info();
    let reserve_liquidity_supply_info =
        ctx.accounts.kamino_reserve_liquidity_supply.to_account_info();
    let reserve_collateral_mint_info =
        ctx.accounts.kamino_reserve_collateral_mint.to_account_info();
    let user_source_liquidity_info = ctx.accounts.escrow_usdc.to_account_info();
    let user_destination_collateral_info = ctx.accounts.escrow_kamino_collateral.to_account_info();
    let token_program_info = ctx.accounts.token_program.to_account_info();

    let accs = KaminoDepositAccounts {
        kamino_program: &kamino_program_info,
        owner: &owner_info,
        lending_market: &lending_market_info,
        lending_market_authority: &lending_market_authority_info,
        reserve: &reserve_info,
        reserve_liquidity_supply: &reserve_liquidity_supply_info,
        reserve_collateral_mint: &reserve_collateral_mint_info,
        user_source_liquidity: &user_source_liquidity_info,
        user_destination_collateral: &user_destination_collateral_info,
        token_program: &token_program_info,
    };

    let seeds: &[&[u8]] = &[SEED_AGREEMENT, buyer.as_ref(), product_id.as_bytes(), &[bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    try_kamino_deposit(&accs, amount_due, signer_seeds)?;
    ctx.accounts.agreement.yield_source = BnplAgreement::YIELD_SOURCE_KAMINO_LEND;
    emit!(KaminoDepositProbeSucceeded {
        agreement: agreement_key,
        amount: amount_due,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct PayInstallmentKamino<'info> {
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, buyer.key().as_ref(), agreement.product_id.as_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Box<Account<'info, BnplAgreement>>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        token::mint = agreement.usdc_mint,
        token::authority = buyer,
    )]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Box<Account<'info, TokenAccount>>,

    /// CHECK: see pay_installment.rs (constant-seed PDA, may be uninitialized).
    #[account(mut, seeds = [SEED_PROTOCOL_CONFIG], bump)]
    pub protocol_config: UncheckedAccount<'info>,

    #[account(
        seeds = [SEED_KAMINO_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, KaminoConfig>>,

    /// CHECK: checked against `config.kamino_program` before the deposit.
    pub kamino_program: UncheckedAccount<'info>,
    /// CHECK: checked against `config.lending_market` before the deposit.
    pub kamino_lending_market: UncheckedAccount<'info>,
    /// CHECK: checked against `config.lending_market_authority`.
    pub kamino_lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: checked against `config.reserve`.
    #[account(mut)]
    pub kamino_reserve: UncheckedAccount<'info>,

    #[account(mut)]
    pub kamino_reserve_liquidity_supply: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub kamino_reserve_collateral_mint: Box<Account<'info, anchor_spl::token::Mint>>,

    /// Created on the first Kamino-routed installment, paid by the buyer.
    #[account(
        init_if_needed,
        payer = buyer,
        token::mint = kamino_reserve_collateral_mint,
        token::authority = agreement,
        seeds = [SEED_KAMINO_COLLATERAL, agreement.key().as_ref()],
        bump
    )]
    pub escrow_kamino_collateral: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
