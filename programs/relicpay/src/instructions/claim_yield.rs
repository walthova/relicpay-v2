//! Buyer claims earned yield after the agreement completes.
//!
//! v2.0: yield is tracked on-chain; USDC disbursement comes from the protocol
//! reserve off-chain. yield_accrued is zeroed first to block double-claims.
//!
//! V2_KAMINO: escrow will be deposited into Kamino Lend during the active
//! period; this instruction will redeem kTokens (principal + real yield) via
//! CPI instead.
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
