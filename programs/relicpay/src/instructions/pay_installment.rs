//! Pays the next scheduled installment (on or after its due date).
//!
//! Yield accrues on the escrow balance for the window since the LAST update
//! only — never from start_time — which is what prevents double-counting
//! across multiple payments. On the final installment the agreement
//! auto-completes and any integer-division remainder is collected so
//! total_price is exact.
//!
//! CALLER: the buyer's wallet (enforced by the agreement PDA seeds).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::{AgreementCompleted, InstallmentPaid};
use crate::math::calculate_yield;
use crate::state::{AgreementState, BnplAgreement};

pub fn handler(ctx: Context<PayInstallment>) -> Result<()> {
    let agreement = &mut ctx.accounts.agreement;
    let clock = Clock::get()?;

    require!(
        agreement.state == AgreementState::Active,
        RelicPayError::AgreementNotActive
    );
    require!(
        agreement.paid_installments < agreement.installment_count,
        RelicPayError::AlreadyCompleted
    );

    // Installment N is due at start_time + (N * interval_seconds).
    let next_installment = agreement.paid_installments + 1;
    let due_time = agreement
        .start_time
        .checked_add(
            (next_installment as i64)
                .checked_mul(agreement.interval_seconds)
                .ok_or(RelicPayError::MathOverflow)?,
        )
        .ok_or(RelicPayError::MathOverflow)?;
    require!(clock.unix_timestamp >= due_time, RelicPayError::PaymentNotDue);

    // Accrue yield only for the window since last update.
    let elapsed_since_last_update = (clock.unix_timestamp - agreement.last_yield_update) as u64;
    let new_yield = calculate_yield(
        agreement.escrow_deposited,
        agreement.yield_rate_bps_annual,
        elapsed_since_last_update,
    )?;
    agreement.yield_accrued = agreement
        .yield_accrued
        .checked_add(new_yield)
        .ok_or(RelicPayError::MathOverflow)?;
    agreement.last_yield_update = clock.unix_timestamp;

    // Final installment collects the integer-division remainder.
    let is_last = next_installment == agreement.installment_count;
    let amount_due = if is_last {
        agreement
            .total_price
            .checked_sub(agreement.installment_amount * (agreement.installment_count as u64 - 1))
            .ok_or(RelicPayError::MathOverflow)?
    } else {
        agreement.installment_amount
    };

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

    agreement.paid_installments = next_installment;
    agreement.escrow_deposited = agreement
        .escrow_deposited
        .checked_add(amount_due)
        .ok_or(RelicPayError::MathOverflow)?;

    emit!(InstallmentPaid {
        agreement: agreement.key(),
        buyer: agreement.buyer,
        installment_number: next_installment,
        amount: amount_due,
        yield_accrued_so_far: agreement.yield_accrued,
    });

    if is_last {
        agreement.state = AgreementState::Completed;
        emit!(AgreementCompleted {
            agreement: agreement.key(),
            buyer: agreement.buyer,
            merchant: agreement.merchant,
            total_paid: agreement.total_price,
            yield_earned_by_buyer: agreement.yield_accrued,
        });
    }

    Ok(())
}

#[derive(Accounts)]
pub struct PayInstallment<'info> {
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

    pub token_program: Program<'info, Token>,
}
