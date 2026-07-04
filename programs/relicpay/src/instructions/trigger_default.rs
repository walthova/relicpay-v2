//! Permissionless default: anyone may call once the 7-day grace period past a
//! missed due date expires. The merchant receives all escrowed USDC as
//! partial recovery; the buyer forfeits it.
//!
//! CALLER: anyone (liquidator bots, merchants, other users).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::AgreementDefaulted;
use crate::state::{AgreementState, BnplAgreement};

pub fn handler(ctx: Context<TriggerDefault>) -> Result<()> {
    let agreement = &mut ctx.accounts.agreement;
    let clock = Clock::get()?;

    require!(
        agreement.state == AgreementState::Active,
        RelicPayError::AgreementNotActive
    );

    let next_installment = agreement.paid_installments + 1;
    let due_time = agreement
        .start_time
        .checked_add(
            (next_installment as i64)
                .checked_mul(agreement.interval_seconds)
                .ok_or(RelicPayError::MathOverflow)?,
        )
        .ok_or(RelicPayError::MathOverflow)?;
    let grace_expiry = due_time
        .checked_add(GRACE_PERIOD_SECONDS)
        .ok_or(RelicPayError::MathOverflow)?;

    require!(
        clock.unix_timestamp > grace_expiry,
        RelicPayError::GracePeriodNotExpired
    );

    agreement.state = AgreementState::Defaulted;

    let escrow_balance = ctx.accounts.escrow_usdc.amount;
    if escrow_balance > 0 {
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
            escrow_balance,
        )?;
    }
    agreement.escrow_deposited = 0;

    emit!(AgreementDefaulted {
        agreement: agreement.key(),
        buyer: agreement.buyer,
        paid_installments: agreement.paid_installments,
        merchant_recovered: escrow_balance,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct TriggerDefault<'info> {
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, agreement.buyer.as_ref(), agreement.product_id.as_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Account<'info, BnplAgreement>,

    /// CHECK: Permissionless — any account can trigger default after grace period
    pub caller: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    /// Merchant recovery destination — must belong to the recorded merchant
    /// so a hostile caller cannot redirect escrow to themselves.
    #[account(
        mut,
        token::mint = agreement.usdc_mint,
        token::authority = agreement.merchant,
    )]
    pub merchant_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
