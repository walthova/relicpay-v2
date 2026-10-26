//! v2.1: a single-transaction, Kamino-aware `merchant_withdraw`.
//!
//! CONTEXT: `kamino_probe.rs` proved the manual-CPI mechanics as a
//! standalone, permissionless crank — deliberately *not* wired into
//! `merchant_withdraw` itself (see that module's DELIBERATE SCOPE note).
//! The 2026-09-11 fix closed the *correctness* gap (an agreement whose
//! escrow got cranked into Kamino could get permanently stuck, unable to
//! ever pay its merchant) but left a *two-transaction* UX: a keeper/merchant
//! must call `kamino_probe_redeem` first, then `merchant_withdraw` second.
//!
//! This instruction collapses that into one: if `escrow_usdc` doesn't
//! already cover `total_price`, it redeems exactly enough
//! `escrow_kamino_collateral` (capped at the full balance) via the same
//! `try_kamino_redeem` CPI path `kamino_probe_redeem` uses, *then* does the
//! existing `merchant_withdraw` transfer — all in one instruction, so a
//! merchant with `RELICPAY_CLI`/a wallet adapter never needs to know a
//! crank step exists.
//!
//! ADDITIVE, NOT A REPLACEMENT: `merchant_withdraw` is untouched (its
//! `Accounts` struct is covered by the frozen characterization suite, which
//! never passes Kamino accounts — adding required accounts to it would
//! break every one of those calls). Agreements that never touched Kamino
//! (`escrow_kamino_collateral` uninitialized, `yield_source` still
//! Simulated) can still use either instruction; this one degrades to
//! exactly `merchant_withdraw`'s behavior when there's nothing to redeem
//! (the redeem step is skipped whenever `escrow_usdc` already covers
//! `total_price` or the collateral account holds zero).
//!
//! CALLER: any funded keypair may submit the transaction, but only the
//! recorded `agreement.merchant` receives funds (`merchant_usdc` is
//! constrained to `token::authority = agreement.merchant` — no signer
//! check on an arbitrary "merchant" field, unlike `merchant_withdraw`,
//! because the payout destination itself is the authorization).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::{KaminoRedeemProbeFallback, KaminoRedeemProbeSucceeded, MerchantPaid};
use crate::instructions::kamino_cpi::{try_kamino_redeem, KaminoRedeemAccounts};
use crate::instructions::protocol_config::apply_tvl_decrease;
use crate::state::{AgreementState, BnplAgreement, KaminoConfig};

/// Mirrors `kamino_probe::require_matches_kamino_config` — every Kamino
/// target account must match the governance-approved `KaminoConfig` before
/// anything is read or invoked.
pub(crate) fn require_matches_kamino_config(
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

pub(crate) fn mock_reserve_looks_paused(reserve_info: &AccountInfo) -> bool {
    match reserve_info.try_borrow_data() {
        Ok(data) if data.len() > MOCK_RESERVE_PAUSED_OFFSET => {
            data[MOCK_RESERVE_PAUSED_OFFSET] != 0
        }
        _ => false,
    }
}

pub fn handler(ctx: Context<MerchantWithdrawReconciled>) -> Result<()> {
    require!(
        ctx.accounts.agreement.state == AgreementState::Completed,
        RelicPayError::AgreementNotComplete
    );
    require!(
        !ctx.accounts.agreement.merchant_withdrawn,
        RelicPayError::AlreadyWithdrawn
    );

    let merchant_amount = ctx.accounts.agreement.total_price;
    let shortfall = merchant_amount.saturating_sub(ctx.accounts.escrow_usdc.amount);
    let collateral_balance = ctx.accounts.escrow_kamino_collateral.amount;

    // Reconcile step: only run if escrow_usdc alone can't cover the payout
    // and there's actually Kamino collateral to redeem. This is what makes
    // the instruction a strict superset of merchant_withdraw for agreements
    // that never touched Kamino — the CPI is skipped entirely.
    if shortfall > 0 && collateral_balance > 0 {
        require_matches_kamino_config(
            &ctx.accounts.config,
            &ctx.accounts.kamino_program.key(),
            &ctx.accounts.kamino_lending_market.key(),
            &ctx.accounts.kamino_lending_market_authority.key(),
            &ctx.accounts.kamino_reserve.key(),
            &ctx.accounts.kamino_reserve_liquidity_supply.key(),
            &ctx.accounts.kamino_reserve_collateral_mint.key(),
        )?;

        let redeem_amount = shortfall.min(collateral_balance);
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
                amount: redeem_amount,
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
            try_kamino_redeem(&accs, redeem_amount, signer_seeds)?;
            ctx.accounts.agreement.yield_source = BnplAgreement::YIELD_SOURCE_SIMULATED;
            emit!(KaminoRedeemProbeSucceeded {
                agreement: agreement_key,
                amount: redeem_amount,
            });
            ctx.accounts.escrow_usdc.reload()?;
        }
    }

    let config_info = ctx.accounts.protocol_config.to_account_info();
    let agreement = &mut ctx.accounts.agreement;

    require!(
        ctx.accounts.escrow_usdc.amount >= merchant_amount,
        RelicPayError::NothingToWithdraw
    );

    // Flag set before the transfer — checks-effects-interactions, same as
    // merchant_withdraw.
    agreement.merchant_withdrawn = true;
    agreement.escrow_deposited = agreement.escrow_deposited.saturating_sub(merchant_amount);

    apply_tvl_decrease(&config_info, ctx.program_id, merchant_amount)?;

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
        merchant_amount,
    )?;

    emit!(MerchantPaid {
        agreement: agreement.key(),
        merchant: agreement.merchant,
        amount: merchant_amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct MerchantWithdrawReconciled<'info> {
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, agreement.buyer.as_ref(), agreement.product_id.as_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Box<Account<'info, BnplAgreement>>,

    #[account(
        mut,
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Box<Account<'info, TokenAccount>>,

    /// The payout destination doubles as the authorization check — must be
    /// owned by `agreement.merchant`, same constraint `merchant_withdraw`
    /// uses (there it's expressed via a `Signer` + key-match; here there's
    /// no dedicated merchant signer since any keeper may submit the tx).
    #[account(
        mut,
        token::mint = agreement.usdc_mint,
        token::authority = agreement.merchant,
    )]
    pub merchant_usdc: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,

    /// CHECK: v2.1 risk controls — see merchant_withdraw.rs.
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
    /// account yet, and `Account<'info, TokenAccount>` deserialization would
    /// fail outright on a missing account before the handler ever runs. This
    /// is what lets the instruction degrade to plain `merchant_withdraw` —
    /// the account is created with a zero balance (so `collateral_balance ==
    /// 0`, the reconcile branch is skipped) rather than the whole call
    /// reverting.
    #[account(
        init_if_needed,
        payer = payer,
        token::mint = kamino_reserve_collateral_mint,
        token::authority = agreement,
        seeds = [SEED_KAMINO_COLLATERAL, agreement.key().as_ref()],
        bump
    )]
    pub escrow_kamino_collateral: Box<Account<'info, TokenAccount>>,

    /// Pays rent for `escrow_kamino_collateral`'s `init_if_needed` when it
    /// doesn't exist yet. Any funded keypair — same permissionless shape as
    /// `kamino_probe`'s crank; the payout destination (`merchant_usdc`), not
    /// this signer, is what's authorization-checked.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
