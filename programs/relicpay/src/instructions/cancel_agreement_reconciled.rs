//! v2.1: a single-transaction, Kamino-aware `cancel_agreement`.
//!
//! CONTEXT: `cancel_agreement` (buyer-initiated exit from an Active
//! agreement) only ever reads `escrow_usdc.amount` when it computes the
//! merchant's cancellation fee and the buyer's refund. If some of that
//! escrow was cranked into Kamino via `kamino_probe_deposit` (a
//! permissionless crank — see `kamino_probe.rs`), `escrow_usdc` under-reports
//! the agreement's true value: the Kamino-held portion sits in
//! `escrow_kamino_collateral` as kTokens and is silently left behind.
//! `kamino_probe_redeem` already accepts `AgreementState::Active`, so there
//! IS a recovery path today — a buyer can crank a redeem first, then call
//! `cancel_agreement` — but that's the same two-transaction UX gap
//! `merchant_withdraw_reconciled` (2026-09-14) closed for the merchant side.
//! This is the buyer-side counterpart: redeem any Kamino collateral inline,
//! then run the existing fee/refund split against the now-complete balance,
//! all in one instruction.
//!
//! Unlike `merchant_withdraw_reconciled` (which redeems only enough to cover
//! a shortfall against `total_price`), this redeems the *entire* collateral
//! balance — cancellation is a full close-out, not a partial payout, so
//! nothing should be left behind in Kamino once the agreement is Cancelled
//! (recall `kamino_probe_redeem` deliberately excludes `Cancelled` — there
//! is no later window to reconcile a stray balance once this instruction
//! returns).
//!
//! ADDITIVE, NOT A REPLACEMENT: `cancel_agreement` is untouched (its
//! `Accounts` struct is covered by the frozen characterization suite, which
//! never passes Kamino accounts — adding required accounts to it would break
//! every one of those calls). Agreements that never touched Kamino
//! (`escrow_kamino_collateral` uninitialized) degrade to exactly
//! `cancel_agreement`'s behavior — the redeem step is skipped whenever the
//! collateral account holds zero.
//!
//! CALLER: the buyer's wallet only — same authorization model as
//! `cancel_agreement`. The buyer also pays any one-time rent for
//! `escrow_kamino_collateral`'s `init_if_needed`.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::{AgreementCancelled, KaminoRedeemProbeFallback, KaminoRedeemProbeSucceeded};
use crate::instructions::kamino_cpi::{try_kamino_redeem, KaminoRedeemAccounts};
use crate::instructions::protocol_config::apply_tvl_decrease;
use crate::state::{AgreementState, BnplAgreement, KaminoConfig};

/// Mirrors `kamino_probe::require_matches_kamino_config` — every Kamino
/// target account must match the governance-approved `KaminoConfig` before
/// anything is read or invoked.
fn require_matches_kamino_config(
    config: &KaminoConfig,
    kamino_program: &Pubkey,
    lending_market: &Pubkey,
    lending_market_authority: &Pubkey,
    reserve: &Pubkey,
    reserve_liquidity_supply: &Pubkey,
    reserve_collateral_mint: &Pubkey,
) -> Result<()> {
    require!(config.enabled, RelicPayError::KaminoConfigDisabled);
    require_keys_eq!(
        *kamino_program,
        config.kamino_program,
        RelicPayError::KaminoAccountMismatch
    );
    require_keys_eq!(
        *lending_market,
        config.lending_market,
        RelicPayError::KaminoAccountMismatch
    );
    require_keys_eq!(
        *lending_market_authority,
        config.lending_market_authority,
        RelicPayError::KaminoAccountMismatch
    );
    require_keys_eq!(*reserve, config.reserve, RelicPayError::KaminoAccountMismatch);
    require_keys_eq!(
        *reserve_liquidity_supply,
        config.reserve_liquidity_supply,
        RelicPayError::KaminoAccountMismatch
    );
    require_keys_eq!(
        *reserve_collateral_mint,
        config.reserve_collateral_mint,
        RelicPayError::KaminoAccountMismatch
    );
    Ok(())
}

/// Mirrors `kamino_probe::mock_reserve_looks_paused` — best-effort preflight
/// only; a real mid-invoke CPI failure still fails the whole transaction.
const MOCK_RESERVE_PAUSED_OFFSET: usize = 8 + 32 + 32 + 32 + 32;

fn mock_reserve_looks_paused(reserve_info: &AccountInfo) -> bool {
    match reserve_info.try_borrow_data() {
        Ok(data) if data.len() > MOCK_RESERVE_PAUSED_OFFSET => {
            data[MOCK_RESERVE_PAUSED_OFFSET] != 0
        }
        _ => false,
    }
}

pub fn handler(ctx: Context<CancelAgreementReconciled>) -> Result<()> {
    require!(
        ctx.accounts.agreement.state == AgreementState::Active,
        RelicPayError::AgreementNotActive
    );
    require!(
        ctx.accounts.buyer.key() == ctx.accounts.agreement.buyer,
        RelicPayError::Unauthorized
    );

    let collateral_balance = ctx.accounts.escrow_kamino_collateral.amount;

    // Reconcile step: redeem the FULL collateral balance (not just enough
    // to cover a shortfall — cancellation is a full close-out, and
    // kamino_probe_redeem cannot reconcile a stray balance after this
    // instruction moves the agreement to Cancelled). Skipped entirely when
    // there's nothing to redeem, which is what lets this degrade to plain
    // cancel_agreement for agreements that never touched Kamino.
    if collateral_balance > 0 {
        require_matches_kamino_config(
            &ctx.accounts.config,
            &ctx.accounts.kamino_program.key(),
            &ctx.accounts.kamino_lending_market.key(),
            &ctx.accounts.kamino_lending_market_authority.key(),
            &ctx.accounts.kamino_reserve.key(),
            &ctx.accounts.kamino_reserve_liquidity_supply.key(),
            &ctx.accounts.kamino_reserve_collateral_mint.key(),
        )?;

        let agreement_key = ctx.accounts.agreement.key();
        let buyer = ctx.accounts.agreement.buyer;
        let product_id = ctx.accounts.agreement.product_id.clone();
        let bump = ctx.accounts.agreement.bump;

        let owner_info = ctx.accounts.agreement.to_account_info();
        let kamino_program_info = ctx.accounts.kamino_program.to_account_info();
        let lending_market_info = ctx.accounts.kamino_lending_market.to_account_info();
        let lending_market_authority_info =
            ctx.accounts.kamino_lending_market_authority.to_account_info();
        let reserve_info = ctx.accounts.kamino_reserve.to_account_info();
        let reserve_liquidity_supply_info =
            ctx.accounts.kamino_reserve_liquidity_supply.to_account_info();
        let reserve_collateral_mint_info =
            ctx.accounts.kamino_reserve_collateral_mint.to_account_info();
        let user_source_collateral_info = ctx.accounts.escrow_kamino_collateral.to_account_info();
        let user_destination_liquidity_info = ctx.accounts.escrow_usdc.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();

        let seeds: &[&[u8]] = &[SEED_AGREEMENT, buyer.as_ref(), product_id.as_bytes(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        if mock_reserve_looks_paused(&reserve_info) {
            emit!(KaminoRedeemProbeFallback {
                agreement: agreement_key,
                amount: collateral_balance,
            });
        } else {
            let accs = KaminoRedeemAccounts {
                kamino_program: &kamino_program_info,
                owner: &owner_info,
                lending_market: &lending_market_info,
                lending_market_authority: &lending_market_authority_info,
                reserve: &reserve_info,
                reserve_liquidity_supply: &reserve_liquidity_supply_info,
                reserve_collateral_mint: &reserve_collateral_mint_info,
                user_source_collateral: &user_source_collateral_info,
                user_destination_liquidity: &user_destination_liquidity_info,
                token_program: &token_program_info,
            };
            try_kamino_redeem(&accs, collateral_balance, signer_seeds)?;
            ctx.accounts.agreement.yield_source = BnplAgreement::YIELD_SOURCE_SIMULATED;
            emit!(KaminoRedeemProbeSucceeded {
                agreement: agreement_key,
                amount: collateral_balance,
            });
            ctx.accounts.escrow_usdc.reload()?;
        }
    }

    // From here down: identical to cancel_agreement's handler, just against
    // the (now fully reconciled) escrow_usdc balance.
    let config_info = ctx.accounts.protocol_config.to_account_info();
    let agreement = &mut ctx.accounts.agreement;

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

    apply_tvl_decrease(&config_info, ctx.program_id, escrow_balance)?;

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
pub struct CancelAgreementReconciled<'info> {
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, buyer.key().as_ref(), agreement.product_id.as_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Box<Account<'info, BnplAgreement>>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        token::mint = agreement.usdc_mint,
        token::authority = buyer,
    )]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Box<Account<'info, TokenAccount>>,

    /// Cancellation-fee destination — must belong to the recorded merchant so
    /// the buyer cannot route the fee back to themselves (see cancel_agreement.rs).
    #[account(
        mut,
        token::mint = agreement.usdc_mint,
        token::authority = agreement.merchant,
    )]
    pub merchant_usdc: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,

    /// CHECK: v2.1 risk controls — see cancel_agreement.rs.
    #[account(mut, seeds = [SEED_PROTOCOL_CONFIG], bump)]
    pub protocol_config: UncheckedAccount<'info>,

    /// See kamino_probe.rs — governance-approved Kamino target set.
    #[account(
        seeds = [SEED_KAMINO_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, KaminoConfig>>,

    /// CHECK: checked against `config.kamino_program` before use whenever a
    /// reconcile is actually attempted.
    pub kamino_program: UncheckedAccount<'info>,
    /// CHECK: checked against `config.lending_market` before use.
    pub kamino_lending_market: UncheckedAccount<'info>,
    /// CHECK: checked against `config.lending_market_authority` before use.
    pub kamino_lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: checked against `config.reserve` before use.
    #[account(mut)]
    pub kamino_reserve: UncheckedAccount<'info>,

    #[account(mut)]
    pub kamino_reserve_liquidity_supply: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub kamino_reserve_collateral_mint: Box<Account<'info, anchor_spl::token::Mint>>,

    /// `init_if_needed`, same as `kamino_probe`'s collateral account: an
    /// agreement that never touched Kamino has no `escrow_kamino_collateral`
    /// account yet. This is what lets the instruction degrade to plain
    /// `cancel_agreement` — the account is created with a zero balance (so
    /// `collateral_balance == 0`, the reconcile branch is skipped) rather
    /// than the whole call reverting.
    #[account(
        init_if_needed,
        payer = buyer,
        token::mint = kamino_reserve_collateral_mint,
        token::authority = agreement,
        seeds = [SEED_KAMINO_COLLATERAL, agreement.key().as_ref()],
        bump
    )]
    pub escrow_kamino_collateral: Box<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
