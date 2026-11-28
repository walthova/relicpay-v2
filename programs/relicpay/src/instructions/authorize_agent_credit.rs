use anchor_lang::prelude::*;

use crate::constants::SEED_AGENT_MANDATE;
use crate::errors::RelicPayError;
use crate::state::AgentMandate;

// The fixed tail of the reserved mandate space is outside the variable-length Borsh payload.
const CREDIT_AUTHORIZATION_OFFSET: usize = AgentMandate::SIZE - 1;

pub(super) fn credit_authorized(mandate: &AccountInfo<'_>) -> Result<bool> {
    Ok(mandate.try_borrow_data()?.get(CREDIT_AUTHORIZATION_OFFSET) == Some(&1))
}

pub fn authorize_agent_credit_handler(ctx: Context<AuthorizeAgentCredit>) -> Result<()> {
    let mandate = &ctx.accounts.mandate;
    require!(!mandate.revoked, RelicPayError::MandateRevoked);
    let account = mandate.to_account_info();
    let mut data = account.try_borrow_mut_data()?;
    *data
        .get_mut(CREDIT_AUTHORIZATION_OFFSET)
        .ok_or(ErrorCode::AccountDidNotSerialize)? = 1;
    Ok(())
}

#[derive(Accounts)]
pub struct AuthorizeAgentCredit<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_AGENT_MANDATE, mandate.owner.as_ref(), mandate.agent.as_ref()],
        bump = mandate.bump,
        has_one = owner
    )]
    pub mandate: Account<'info, AgentMandate>,
}
