//! Merchant pulls their full payment (total_price) from escrow after the
//! agreement completes. Yield stays behind for the buyer's claim_yield.
//!
//! v2: a merchant_withdrawn flag makes double-withdrawal structurally
//! impossible instead of relying on the escrow balance check alone.
//!
//! CALLER: the merchant's wallet (must match agreement.merchant).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::MerchantPaid;
use crate::instructions::protocol_config::apply_tvl_decrease;
use crate::state::{AgreementState, BnplAgreement};

pub fn handler(ctx: Context<MerchantWithdraw>) -> Result<()> {
    let config_info = ctx.accounts.protocol_config.to_account_info();
    let agreement = &mut ctx.accounts.agreement;

    require!(
        agreement.state == AgreementState::Completed,
        RelicPayError::AgreementNotComplete
    );
    require!(
        ctx.accounts.merchant.key() == agreement.merchant,
        RelicPayError::Unauthorized
    );
    require!(!agreement.merchant_withdrawn, RelicPayError::AlreadyWithdrawn);

    let merchant_amount = agreement.total_price;
    require!(
        ctx.accounts.escrow_usdc.amount >= merchant_amount,
        RelicPayError::NothingToWithdraw
    );

    // Flag set before the transfer — checks-effects-interactions.
    agreement.merchant_withdrawn = true;
    agreement.escrow_deposited = agreement.escrow_deposited.saturating_sub(merchant_amount);

    // v2.1: this USDC is leaving escrow for good — shrink protocol-wide TVL
    // to match. Saturating/no-op if the config PDA isn't initialized.
    apply_tvl_decrease(&config_info, ctx.program_id, merchant_amount)?;

    let seeds = &[
        SEED_AGREEMENT,
        agreement.buyer.as_ref(),
        agreement.product_id.as_bytes(),
        &[agreement.bump],
    ];
    let signer = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.escrow_usdc.to_account_info(),
                to: ctx.accounts.merchant_usdc.to_account_info(),
                authority: agreement.to_account_info(),
            },
            signer,
        ),
        merchant_amount,
    )?;

    emit!(MerchantPaid {
        agreement: agreement.key(),
        merchant: agreement.merchant,
        amount: merchant_amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct MerchantWithdraw<'info> {
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, agreement.buyer.as_ref(), agreement.product_id.as_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Account<'info, BnplAgreement>,

    pub merchant: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = agreement.usdc_mint,
        token::authority = merchant,
    )]
    pub merchant_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

    /// CHECK: v2.1 risk controls (see protocol_config.rs / create_agreement.rs
    /// for the constant-seed-PDA auto-derivation pattern). Deliberately
    /// `UncheckedAccount` — the PDA may not exist yet. `mut` so
    /// `apply_tvl_decrease` can write the updated `current_tvl` back.
    #[account(mut, seeds = [SEED_PROTOCOL_CONFIG], bump)]
    pub protocol_config: UncheckedAccount<'info>,
}
