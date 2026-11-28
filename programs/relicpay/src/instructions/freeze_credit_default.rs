use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::state::{CreditDraw, CreditDrawState, CreditLine};

pub(super) fn grace_expiry(start: i64, interval_seconds: i64, installment: u8) -> Result<i64> {
    interval_seconds
        .checked_mul(i64::from(installment))
        .and_then(|offset| start.checked_add(offset))
        .and_then(|due| due.checked_add(GRACE_PERIOD_SECONDS))
        .ok_or_else(|| error!(RelicPayError::MathOverflow))
}

pub fn freeze_handler(ctx: Context<FreezeCreditDefault>) -> Result<()> {
    let draw = &mut ctx.accounts.credit_draw;
    let line = &mut ctx.accounts.credit_line;
    require!(
        draw.state == CreditDrawState::Active,
        RelicPayError::InvalidCreditDrawState
    );

    let installment_amount = draw.principal / u64::from(draw.installment_count);
    let first_unpaid = if installment_amount > 0 {
        (draw.amount_repaid / installment_amount).min(u64::from(draw.installment_count) - 1) as u8
            + 1
    } else {
        draw.installment_count
    };
    require!(
        Clock::get()?.unix_timestamp
            > grace_expiry(draw.start_time, draw.interval_seconds, first_unpaid)?,
        RelicPayError::GracePeriodNotExpired
    );
    let remaining = draw
        .principal
        .checked_sub(draw.amount_repaid)
        .ok_or(RelicPayError::MathOverflow)?;
    line.seizure_pending = line
        .seizure_pending
        .checked_add(remaining)
        .ok_or(RelicPayError::MathOverflow)?;
    line.frozen = true;
    draw.state = CreditDrawState::DefaultPending;
    Ok(())
}

#[derive(Accounts)]
pub struct FreezeCreditDefault<'info> {
    #[account(
        mut,
        seeds = [SEED_CREDIT_DRAW, credit_draw.owner.as_ref(), credit_draw.product_id.as_bytes()],
        bump = credit_draw.bump
    )]
    pub credit_draw: Account<'info, CreditDraw>,
    #[account(
        mut,
        seeds = [SEED_CREDIT_LINE, credit_draw.owner.as_ref()],
        bump = credit_line.bump
    )]
    pub credit_line: Account<'info, CreditLine>,
}
