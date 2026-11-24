//! Record a buyer's simulated yield claim after the agreement completes.
//!
//! This instruction does not transfer USDC. It clears `yield_accrued` and
//! emits a claim event. Per-agreement DeFi yield settlement is a follow-up.
//!
//! CALLER: the buyer's wallet only.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::YieldClaimed;
use crate::state::{AgreementState, BnplAgreement};

pub fn handler(ctx: Context<ClaimYield>) -> Result<()> {
    let agreement = &mut ctx.accounts.agreement;

    require!(
        agreement.state == AgreementState::Completed,
        RelicPayError::AgreementNotComplete
    );
    require!(
        ctx.accounts.buyer.key() == agreement.buyer,
        RelicPayError::Unauthorized
    );

    let yield_amount = agreement.yield_accrued;
    require!(yield_amount > 0, RelicPayError::NothingToWithdraw);

    // Zero out before anything else — blocks reentrancy/double-claim.
    agreement.yield_accrued = 0;

    emit!(YieldClaimed {
        agreement: agreement.key(),
        buyer: agreement.buyer,
        yield_amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimYield<'info> {
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, buyer.key().as_ref(), agreement.product_id.as_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Account<'info, BnplAgreement>,

    pub buyer: Signer<'info>,
}
