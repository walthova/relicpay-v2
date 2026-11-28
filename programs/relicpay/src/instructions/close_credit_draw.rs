use anchor_lang::prelude::*;

use crate::constants::SEED_CREDIT_DRAW;
use crate::errors::RelicPayError;
use crate::state::{CreditDraw, CreditDrawState};

pub fn close_credit_draw_handler(ctx: Context<CloseCreditDraw>) -> Result<()> {
    require!(
        matches!(
            ctx.accounts.credit_draw.state,
            CreditDrawState::Repaid | CreditDrawState::Defaulted
        ),
        RelicPayError::InvalidCreditDrawState
    );
    Ok(())
}

#[derive(Accounts)]
pub struct CloseCreditDraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        close = owner,
        seeds = [SEED_CREDIT_DRAW, credit_draw.owner.as_ref(), credit_draw.product_id.as_bytes()],
        bump = credit_draw.bump,
        has_one = owner
    )]
    pub credit_draw: Account<'info, CreditDraw>,
}
