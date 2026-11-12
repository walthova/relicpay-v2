//! v2.1: `create_agreement` with an inline Kamino deposit of the first
//! installment (DEVELOPMENT_PLAN.md v2.1 items 1 and 3).
//!
//! Same validation, risk controls, state and `AgreementCreated` event as
//! `create_agreement` (shared `init_agreement` / `finish_agreement`), moves
//! the first installment buyer -> escrow_usdc, then deposits it from
//! `escrow_usdc` into the governance-approved Kamino reserve in the same
//! transaction. With `pay_installment_kamino` this means a purchase is
//! Kamino-backed from the first USDC, with no keeper crank. The reconciled
//! exits redeem the collateral inline.
//!
//! FALLBACK ("never block a purchase on a DeFi dependency"): if
//! `KaminoConfig` is disabled or the reserve looks paused, the deposit is
//! skipped, `KaminoDepositProbeFallback` is emitted and the agreement is
//! created exactly as plain `create_agreement` would (raw USDC, Simulated).
//! Passing accounts that do NOT match an enabled `KaminoConfig` reverts.
//!
//! ADDITIVE: `create_agreement` keeps its original Accounts struct (frozen
//! suite). CALLER: the buyer's wallet.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::events::{KaminoDepositProbeFallback, KaminoDepositProbeSucceeded};
use crate::instructions::create_agreement::{finish_agreement, init_agreement, AgreementParams};
use crate::instructions::kamino_cpi::{
    mock_reserve_looks_paused, try_kamino_deposit, KaminoDepositAccounts,
};
use crate::instructions::merchant_withdraw_reconciled::require_matches_kamino_config;
use crate::state::{BnplAgreement, KaminoConfig};

pub fn handler(
    ctx: Context<CreateAgreementKamino>,
    total_price: u64,
    installment_count: u8,
    interval_seconds: i64,
    product_id: String,
    merchant_name: String,
) -> Result<()> {
    // Parity (audit C-4): only the pinned USDC mint, once governance has pinned one.
    crate::instructions::protocol_config_ext::check_accepted_mint(
        &ctx.accounts.protocol_config_ext.to_account_info(),
        ctx.program_id,
        &ctx.accounts.usdc_mint.key(),
    )?;
    let config_info = ctx.accounts.protocol_config.to_account_info();
    let first_installment = init_agreement(
        &mut ctx.accounts.agreement,
        &config_info,
        ctx.program_id,
        AgreementParams {
            buyer: ctx.accounts.buyer.key(),
            merchant: ctx.accounts.merchant.key(),
            usdc_mint: ctx.accounts.usdc_mint.key(),
            total_price,
            installment_count,
            interval_seconds,
            product_id,
            merchant_name,
            bump: ctx.bumps.agreement,
        },
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
        first_installment,
    )?;

    let agreement_key = ctx.accounts.agreement.key();
    finish_agreement(
        &mut ctx.accounts.agreement,
        agreement_key,
        first_installment,
    );

    // Deposit step.
    let reserve_info = ctx.accounts.kamino_reserve.to_account_info();
    if !ctx.accounts.config.enabled || mock_reserve_looks_paused(&reserve_info) {
        emit!(KaminoDepositProbeFallback {
            agreement: agreement_key,
            amount: first_installment,
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
    let lending_market_authority_info = ctx
        .accounts
        .kamino_lending_market_authority
        .to_account_info();
    let reserve_liquidity_supply_info = ctx
        .accounts
        .kamino_reserve_liquidity_supply
        .to_account_info();
    let reserve_collateral_mint_info = ctx
        .accounts
        .kamino_reserve_collateral_mint
        .to_account_info();
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

    let seeds: &[&[u8]] = &[
        SEED_AGREEMENT,
        buyer.as_ref(),
        product_id.as_bytes(),
        &[bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    try_kamino_deposit(&accs, first_installment, signer_seeds)?;
    ctx.accounts.agreement.yield_source = BnplAgreement::YIELD_SOURCE_KAMINO_LEND;
    emit!(KaminoDepositProbeSucceeded {
        agreement: agreement_key,
        amount: first_installment,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(total_price: u64, installment_count: u8, interval_seconds: i64, product_id: String)]
pub struct CreateAgreementKamino<'info> {
    #[account(
        init,
        payer = buyer,
        space = BnplAgreement::SIZE,
        seeds = [SEED_AGREEMENT, buyer.key().as_ref(), product_id.as_bytes()],
        bump
    )]
    pub agreement: Box<Account<'info, BnplAgreement>>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Merchant's pubkey, stored for withdrawal authorization.
    pub merchant: AccountInfo<'info>,

    pub usdc_mint: Box<Account<'info, anchor_spl::token::Mint>>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = buyer,
    )]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = buyer,
        token::mint = usdc_mint,
        token::authority = agreement,
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Box<Account<'info, TokenAccount>>,

    /// CHECK: see create_agreement.rs (constant-seed PDA, may be uninitialized).
    #[account(mut, seeds = [SEED_PROTOCOL_CONFIG], bump)]
    pub protocol_config: UncheckedAccount<'info>,

    /// CHECK: parity singleton at a constant-seed PDA; may be uninitialized (then ignored).
    #[account(seeds = [SEED_PROTOCOL_CONFIG_EXT], bump)]
    pub protocol_config_ext: UncheckedAccount<'info>,

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
