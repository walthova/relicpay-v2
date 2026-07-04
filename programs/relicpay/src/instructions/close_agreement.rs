//! v2: reclaim rent from a fully settled agreement.
//!
//! Requirements: agreement is in a terminal state, the escrow is empty, and
//! (for Completed agreements) the merchant has withdrawn and any yield has
//! been claimed. Closes both the escrow token account and the agreement PDA,
//! refunding all rent lamports to the buyer.
//!
//! CALLER: the buyer's wallet only.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::AgreementClosed;
use crate::state::{AgreementState, BnplAgreement};

pub fn handler(ctx: Context<CloseAgreement>) -> Result<()> {
    let agreement = &ctx.accounts.agreement;

    require!(
        agreement.state != AgreementState::Active,
        RelicPayError::AgreementNotSettled
    );
    require!(
        ctx.accounts.escrow_usdc.amount == 0,
        RelicPayError::AgreementNotSettled
    );
    if agreement.state == AgreementState::Completed {
        require!(agreement.merchant_withdrawn, RelicPayError::AgreementNotSettled);
        require!(agreement.yield_accrued == 0, RelicPayError::AgreementNotSettled);
    }

    // Close the escrow token account; its rent goes to the buyer.
    let seeds = &[
        SEED_AGREEMENT,
        agreement.buyer.as_ref(),
        agreement.product_id.as_bytes(),
        &[agreement.bump],
    ];
    let signer = &[&seeds[..]];

    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.escrow_usdc.to_account_info(),
            destination: ctx.accounts.buyer.to_account_info(),
            authority: agreement.to_account_info(),
        },
        signer,
    ))?;

    emit!(AgreementClosed {
        agreement: agreement.key(),
        buyer: agreement.buyer,
    });

    // The agreement account itself is closed by the `close = buyer` constraint.
    Ok(())
}

#[derive(Accounts)]
pub struct CloseAgreement<'info> {
    #[account(
        mut,
        close = buyer,
        seeds = [SEED_AGREEMENT, buyer.key().as_ref(), agreement.product_id.as_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Account<'info, BnplAgreement>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
