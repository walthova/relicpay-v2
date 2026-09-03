//! Buyer cancels an Active agreement before it defaults.
//!
//! The merchant keeps a 10% cancellation fee from escrow; the buyer receives
//! the remainder. Gives an honest exit path while compensating the merchant
//! for the disruption.
//!
//! CALLER: the buyer's wallet only.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::AgreementCancelled;
use crate::state::{AgreementState, BnplAgreement};

pub fn handler(ctx: Context<CancelAgreement>) -> Result<()> {
    let agreement = &mut ctx.accounts.agreement;

    require!(
        agreement.state == AgreementState::Active,
        RelicPayError::AgreementNotActive
    );
    require!(
        ctx.accounts.buyer.key() == agreement.buyer,
        RelicPayError::Unauthorized
    );

    // 10% fee to merchant; buyer refunded the rest. u128 math avoids overflow.
    let escrow_balance = ctx.accounts.escrow_usdc.amount;
    let cancellation_fee =
        ((escrow_balance as u128) * (CANCEL_FEE_BPS as u128) / BPS_DIVISOR) as u64;
    let buyer_refund = escrow_balance
        .checked_sub(cancellation_fee)
        .ok_or(RelicPayError::MathOverflow)?;

    let seeds = &[
        SEED_AGREEMENT,
        agreement.buyer.as_ref(),
        agreement.product_id.as_bytes(),
        &[agreement.bump],
    ];
    let signer = &[&seeds[..]];

    if cancellation_fee > 0 {
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
            cancellation_fee,
        )?;
    }

    if buyer_refund > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_usdc.to_account_info(),
                    to: ctx.accounts.buyer_usdc.to_account_info(),
                    authority: agreement.to_account_info(),
                },
                signer,
            ),
            buyer_refund,
        )?;
    }

    agreement.state = AgreementState::Cancelled;
    agreement.escrow_deposited = 0;

    emit!(AgreementCancelled {
        agreement: agreement.key(),
        buyer: agreement.buyer,
        merchant: agreement.merchant,
        refund_to_buyer: buyer_refund,
        fee_to_merchant: cancellation_fee,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct CancelAgreement<'info> {
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, buyer.key().as_ref(), agreement.product_id.as_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Account<'info, BnplAgreement>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        token::mint = agreement.usdc_mint,
        token::authority = buyer,
    )]
    pub buyer_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    /// Cancellation-fee destination — must belong to the recorded merchant so
    /// the buyer cannot route the fee back to themselves.
    #[account(
        mut,
        token::mint = agreement.usdc_mint,
        token::authority = agreement.merchant,
    )]
    pub merchant_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
