//! Agent BNPL: an owner lets an AI agent buy now, pay later on their behalf,
//! inside limits the owner sets, with the owner keeping their own keys.
//!
//! ON-CHAIN SHAPE:
//!   - `AgentMandate` PDA (seeds: "agent_mandate" + owner + agent) records
//!     the limits and the running spend for the current period.
//!   - The owner's USDC account delegates a bounded SPL allowance to the
//!     mandate PDA. Funds never leave the owner's wallet until the agent
//!     actually buys, and `revoke_agent_mandate` pulls the allowance back in
//!     the same transaction that kills the mandate.
//!   - `agent_create_agreement` opens an ordinary `BnplAgreement` with
//!     `buyer = owner`, so pay_installment / cancel / default / close all
//!     work unchanged and stay in the owner's hands.
//!
//! LIMITS ENFORCED ON EVERY AGENT PURCHASE:
//!   per-purchase cap, per-period cap (on the full `total_price` the owner is
//!   committing to, not just the first installment), purchases per period,
//!   approved merchants, expiry, and an owner co-sign above a threshold.
//!
//! An SPL token account has a single delegate, so one owner USDC account
//! backs one live mandate at a time. A second mandate on the same account
//! replaces the first one's allowance.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token::{self, Approve, Revoke, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::{AgentMandateRevoked, AgentMandateSet, AgentPurchase};
use crate::instructions::create_agreement::{finish_agreement, init_agreement, AgreementParams};
use crate::state::{AgentMandate, BnplAgreement};

/// Owner-chosen limits, shared by create and update.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MandateLimits {
    pub per_purchase_cap: u64,
    pub period_cap: u64,
    pub period_seconds: i64,
    pub max_purchases_per_period: u16,
    pub approval_threshold: u64,
    pub expires_at: i64,
    pub delegated_allowance: u64,
    pub allowed_merchants: Vec<Pubkey>,
}

fn validate(limits: &MandateLimits, now: i64) -> Result<()> {
    require!(
        limits.per_purchase_cap > 0
            && limits.period_cap >= limits.per_purchase_cap
            && limits.period_seconds > 0
            && limits.max_purchases_per_period > 0
            && limits.delegated_allowance > 0
            // Fail closed: an empty list used to mean "any merchant", which let a
            // hijacked agent name itself as merchant (audit C-3).
            && !limits.allowed_merchants.is_empty()
            && limits.allowed_merchants.len() <= MAX_MANDATE_MERCHANTS
            && (limits.expires_at == 0 || limits.expires_at > now),
        RelicPayError::InvalidMandate
    );
    Ok(())
}

fn apply_limits(mandate: &mut AgentMandate, limits: MandateLimits) {
    mandate.per_purchase_cap = limits.per_purchase_cap;
    mandate.period_cap = limits.period_cap;
    mandate.period_seconds = limits.period_seconds;
    mandate.max_purchases_per_period = limits.max_purchases_per_period;
    mandate.approval_threshold = limits.approval_threshold;
    mandate.expires_at = limits.expires_at;
    mandate.delegated_allowance = limits.delegated_allowance;
    mandate.allowed_merchants = limits.allowed_merchants;
}

/// Points the owner's USDC allowance at the mandate PDA and emits the
/// resulting limits.
fn approve_and_emit<'info>(
    mandate: &AgentMandate,
    mandate_info: AccountInfo<'info>,
    owner: AccountInfo<'info>,
    owner_usdc: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
) -> Result<()> {
    token::approve(
        CpiContext::new(
            token_program,
            Approve {
                to: owner_usdc,
                delegate: mandate_info.clone(),
                authority: owner,
            },
        ),
        mandate.delegated_allowance,
    )?;

    emit!(AgentMandateSet {
        mandate: mandate_info.key(),
        owner: mandate.owner,
        agent: mandate.agent,
        per_purchase_cap: mandate.per_purchase_cap,
        period_cap: mandate.period_cap,
        delegated_allowance: mandate.delegated_allowance,
    });
    Ok(())
}

// ─── create_agent_mandate ────────────────────────────────────────────────────

pub fn create_handler(ctx: Context<CreateAgentMandate>, limits: MandateLimits) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    validate(&limits, now)?;

    let mandate = &mut ctx.accounts.mandate;
    mandate.owner = ctx.accounts.owner.key();
    mandate.agent = ctx.accounts.agent.key();
    apply_limits(mandate, limits);
    mandate.revoked = false;
    mandate.period_start = now;
    mandate.period_spent = 0;
    mandate.period_purchases = 0;
    mandate.total_purchases = 0;
    mandate.total_spent = 0;
    mandate.created_at = now;
    mandate.bump = ctx.bumps.mandate;

    approve_and_emit(
        &ctx.accounts.mandate,
        ctx.accounts.mandate.to_account_info(),
        ctx.accounts.owner.to_account_info(),
        ctx.accounts.owner_usdc.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
    )
}

#[derive(Accounts)]
pub struct CreateAgentMandate<'info> {
    #[account(
        init,
        payer = owner,
        space = AgentMandate::SIZE,
        seeds = [SEED_AGENT_MANDATE, owner.key().as_ref(), agent.key().as_ref()],
        bump
    )]
    pub mandate: Account<'info, AgentMandate>,

    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: The agent's signing key. Stored only; it signs later purchases.
    pub agent: UncheckedAccount<'info>,

    #[account(mut, token::authority = owner)]
    pub owner_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ─── update_agent_mandate ────────────────────────────────────────────────────

pub fn update_handler(ctx: Context<UpdateAgentMandate>, limits: MandateLimits) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    validate(&limits, now)?;

    let mandate = &mut ctx.accounts.mandate;
    require!(!mandate.revoked, RelicPayError::MandateRevoked);
    apply_limits(mandate, limits);

    approve_and_emit(
        &ctx.accounts.mandate,
        ctx.accounts.mandate.to_account_info(),
        ctx.accounts.owner.to_account_info(),
        ctx.accounts.owner_usdc.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
    )
}

#[derive(Accounts)]
pub struct UpdateAgentMandate<'info> {
    #[account(
        mut,
        seeds = [SEED_AGENT_MANDATE, owner.key().as_ref(), mandate.agent.as_ref()],
        bump = mandate.bump,
        has_one = owner,
    )]
    pub mandate: Account<'info, AgentMandate>,

    pub owner: Signer<'info>,

    #[account(mut, token::authority = owner)]
    pub owner_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ─── revoke_agent_mandate ────────────────────────────────────────────────────

/// One-tap revoke: the mandate is dead and the SPL allowance is pulled back
/// in the same transaction. Terminal: create a new mandate to re-enable.
/// Agreements the agent already opened stay with the owner as normal.
pub fn revoke_handler(ctx: Context<RevokeAgentMandate>) -> Result<()> {
    let mandate = &mut ctx.accounts.mandate;
    mandate.revoked = true;
    mandate.delegated_allowance = 0;

    // Only clear the token delegate if it still points at this mandate, so
    // revoking an old mandate never kills a newer one's allowance.
    if ctx.accounts.owner_usdc.delegate == COption::Some(mandate.key()) {
        token::revoke(CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Revoke {
                source: ctx.accounts.owner_usdc.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ))?;
    }

    emit!(AgentMandateRevoked {
        mandate: mandate.key(),
        owner: mandate.owner,
        agent: mandate.agent,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RevokeAgentMandate<'info> {
    #[account(
        mut,
        seeds = [SEED_AGENT_MANDATE, owner.key().as_ref(), mandate.agent.as_ref()],
        bump = mandate.bump,
        has_one = owner,
    )]
    pub mandate: Account<'info, AgentMandate>,

    pub owner: Signer<'info>,

    #[account(mut, token::authority = owner)]
    pub owner_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ─── close_agent_mandate ─────────────────────────────────────────────────────

/// Reclaims rent from a revoked mandate.
pub fn close_handler(ctx: Context<CloseAgentMandate>) -> Result<()> {
    require!(
        ctx.accounts.mandate.revoked,
        RelicPayError::MandateNotRevoked
    );
    Ok(())
}

#[derive(Accounts)]
pub struct CloseAgentMandate<'info> {
    #[account(
        mut,
        close = owner,
        seeds = [SEED_AGENT_MANDATE, owner.key().as_ref(), mandate.agent.as_ref()],
        bump = mandate.bump,
        has_one = owner,
    )]
    pub mandate: Account<'info, AgentMandate>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

// ─── agent_create_agreement ──────────────────────────────────────────────────

/// The agent buys now, pay later for its owner. Same agreement and first
/// installment as `create_agreement`, but the agent signs, the mandate PDA
/// moves the first installment as the owner's SPL delegate, and every
/// mandate limit is checked first.
pub fn agent_purchase_handler(
    ctx: Context<AgentCreateAgreement>,
    total_price: u64,
    installment_count: u8,
    interval_seconds: i64,
    product_id: String,
    merchant_name: String,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let merchant = ctx.accounts.merchant.key();
    let owner_cosigned = ctx.accounts.owner.is_signer;

    let mandate = &mut ctx.accounts.mandate;
    require!(!mandate.revoked, RelicPayError::MandateRevoked);
    require!(
        mandate.expires_at == 0 || now < mandate.expires_at,
        RelicPayError::MandateExpired
    );
    require!(
        mandate.allowed_merchants.contains(&merchant),
        RelicPayError::MerchantNotApproved
    );
    require!(
        total_price <= mandate.per_purchase_cap,
        RelicPayError::AgentPurchaseCapExceeded
    );
    require!(
        mandate.approval_threshold == 0
            || total_price <= mandate.approval_threshold
            || owner_cosigned,
        RelicPayError::OwnerApprovalRequired
    );

    // Roll into a new period once the current one has elapsed.
    let period_end = mandate
        .period_start
        .checked_add(mandate.period_seconds)
        .ok_or(RelicPayError::MathOverflow)?;
    if now >= period_end {
        mandate.period_start = now;
        mandate.period_spent = 0;
        mandate.period_purchases = 0;
    }

    let period_spent = mandate
        .period_spent
        .checked_add(total_price)
        .ok_or(RelicPayError::MathOverflow)?;
    require!(
        period_spent <= mandate.period_cap,
        RelicPayError::AgentPeriodCapExceeded
    );
    require!(
        mandate.period_purchases < mandate.max_purchases_per_period,
        RelicPayError::AgentPurchaseLimitReached
    );

    mandate.period_spent = period_spent;
    mandate.period_purchases += 1;
    mandate.total_purchases = mandate
        .total_purchases
        .checked_add(1)
        .ok_or(RelicPayError::MathOverflow)?;
    mandate.total_spent = mandate
        .total_spent
        .checked_add(total_price)
        .ok_or(RelicPayError::MathOverflow)?;

    let config_info = ctx.accounts.protocol_config.to_account_info();
    let bump = ctx.bumps.agreement;
    let first_installment = init_agreement(
        &mut ctx.accounts.agreement,
        &config_info,
        ctx.program_id,
        AgreementParams {
            buyer: ctx.accounts.owner.key(),
            merchant,
            usdc_mint: ctx.accounts.usdc_mint.key(),
            total_price,
            installment_count,
            interval_seconds,
            product_id,
            merchant_name,
            bump,
        },
    )?;

    let mandate = &ctx.accounts.mandate;
    let seeds: &[&[u8]] = &[
        SEED_AGENT_MANDATE,
        mandate.owner.as_ref(),
        mandate.agent.as_ref(),
        &[mandate.bump],
    ];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.owner_usdc.to_account_info(),
                to: ctx.accounts.escrow_usdc.to_account_info(),
                authority: ctx.accounts.mandate.to_account_info(),
            },
            &[seeds],
        ),
        first_installment,
    )?;

    let agreement_key = ctx.accounts.agreement.key();
    finish_agreement(
        &mut ctx.accounts.agreement,
        agreement_key,
        first_installment,
    );

    let mandate = &ctx.accounts.mandate;
    emit!(AgentPurchase {
        mandate: mandate.key(),
        agreement: agreement_key,
        owner: mandate.owner,
        agent: mandate.agent,
        merchant,
        total_price,
        owner_cosigned,
        period_spent: mandate.period_spent,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(total_price: u64, installment_count: u8, interval_seconds: i64, product_id: String)]
pub struct AgentCreateAgreement<'info> {
    #[account(
        mut,
        seeds = [SEED_AGENT_MANDATE, owner.key().as_ref(), agent.key().as_ref()],
        bump = mandate.bump,
        has_one = owner,
        has_one = agent,
    )]
    pub mandate: Account<'info, AgentMandate>,

    /// The agent pays rent for the new accounts and signs the purchase.
    #[account(mut)]
    pub agent: Signer<'info>,

    /// CHECK: Bound to the mandate by `has_one = owner`. Signs only when a
    /// purchase is above the mandate's approval threshold.
    pub owner: UncheckedAccount<'info>,

    #[account(
        init,
        payer = agent,
        space = BnplAgreement::SIZE,
        seeds = [SEED_AGREEMENT, owner.key().as_ref(), product_id.as_bytes()],
        bump
    )]
    pub agreement: Account<'info, BnplAgreement>,

    /// CHECK: Merchant's pubkey, checked against the mandate's approved list
    /// in the handler and stored for withdrawal authorization.
    pub merchant: UncheckedAccount<'info>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = owner,
    )]
    pub owner_usdc: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = agent,
        token::mint = usdc_mint,
        token::authority = agreement,
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    /// CHECK: v2.1 risk controls, same constant-seed pattern as
    /// `CreateAgreement::protocol_config` (see create_agreement.rs).
    #[account(mut, seeds = [SEED_PROTOCOL_CONFIG], bump)]
    pub protocol_config: UncheckedAccount<'info>,
}
