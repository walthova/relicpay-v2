//! v2.1: proves the manual-CPI mechanics end to end against a local mock
//! Kamino program (DEVELOPMENT_PLAN.md v2.1 items 1-3, "next" per
//! docs/progress/2026-07-14.md). See `docs/design/KAMINO_CPI_INTEGRATION.md`
//! and `kamino_cpi.rs`.
//!
//! CORRECTED 2026-08-05 (was wrong in the 2026-08-04 draft of this file):
//! **a failed CPI aborts the whole transaction.** There is no try/catch
//! across a CPI boundary on Solana — once `invoke_signed` actually executes
//! the target program and that program returns an error, the transaction is
//! done; the calling program never regains control to "catch" it and return
//! `Ok(())` instead. An earlier version of this module wrapped
//! `try_kamino_deposit`'s result in a `match` expecting to swallow a CPI
//! failure and emit a `...Fallback` event in its place. That code compiled
//! but does not do what its comments claimed — proven by a real test
//! failure: pausing the mock reserve and calling `kamino_probe_deposit`
//! surfaced the mock's `ReservePaused` `AnchorError` all the way to the
//! client, exactly like any other failed instruction. See
//! `KAMINO_CPI_INTEGRATION.md`'s "Runtime constraint" section for the full
//! writeup and the two ways to actually deliver "never block a purchase on
//! a DeFi dependency":
//!   (a) **preflight** — read state that predicts the failure *before*
//!       invoking, and skip the CPI entirely when it looks unusable. This
//!       is what this module now does, and it is inherently limited: it
//!       only catches failures you can predict by reading account state
//!       ahead of time, never a failure that only shows up once the CPI
//!       actually executes.
//!   (b) **off the critical path** — move yield deposits into a separate
//!       crank instruction/transaction, so a Kamino failure can never fail
//!       a purchase transaction. This is the architecturally correct
//!       answer and is NOT implemented here — flagged as the next step.
//!
//! DELIBERATE SCOPE: this is a standalone probe, not wired into
//! `create_agreement` / `pay_installment` / `merchant_withdraw` yet. Wiring
//! it into those would mean escrow's raw USDC balance no longer matches
//! `escrow_deposited` once a deposit succeeds — every instruction that reads
//! `escrow_usdc` directly (merchant_withdraw, trigger_default,
//! cancel_agreement, close_agreement) would need a redemption step first.
//! That's real, non-trivial design work of its own (and touches
//! money-moving paths covered by the frozen characterization suite), so
//! it's the explicit next step, not bundled into proving the CPI mechanics
//! work. This probe:
//!   - moves USDC that's *already* sitting in an agreement's escrow into
//!     the mock Kamino reserve, minting the escrow a kToken balance
//!     (`kamino_probe_deposit`), and back (`kamino_probe_redeem`)
//!   - skips the CPI (emitting a `...Fallback` event, no state change) when
//!     a preflight read of the reserve account shows it's paused — a real
//!     CPI failure that only shows up mid-invoke still fails the whole
//!     transaction, and correctly so
//!   - is entirely additive: no existing instruction or account layout
//!     changes, so the v1 characterization suite and all v2 tests are
//!     unaffected
//!
//! CALLER: the agreement's buyer (arbitrary gate — this is a proof
//! instruction, not a production money-flow entry point).

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::{
    KaminoDepositProbeFallback, KaminoDepositProbeSucceeded, KaminoRedeemProbeFallback,
    KaminoRedeemProbeSucceeded,
};
use crate::instructions::kamino_cpi::{
    try_kamino_deposit, try_kamino_redeem, KaminoDepositAccounts, KaminoRedeemAccounts,
};
use crate::state::{AgreementState, BnplAgreement};

/// Byte offset of `mock_kamino_lend::Reserve.paused` within its account
/// data: 8-byte Anchor discriminator + 4 * 32-byte pubkeys
/// (authority, liquidity_mint, collateral_mint, liquidity_supply).
///
/// MOCK-SPECIFIC AND FRAGILE BY DESIGN — see module doc, preflight option
/// (a). This is not a general "is this CPI target healthy" check: real
/// Kamino's reserve account has a completely different layout (oracle
/// price, cumulative borrow rate, obligation data, ...) that would need
/// Kamino's actual account schema to parse, which this proof-of-concept
/// deliberately does not take on. It exists only to demonstrate the
/// preflight pattern against our own mock, whose layout we control.
const MOCK_RESERVE_PAUSED_OFFSET: usize = 8 + 32 + 32 + 32 + 32;

/// Best-effort, mock-specific check: does this reserve account's data say
/// `paused = true`? Returns `false` (i.e. "looks usable, try it") on any
/// read failure — a preflight guard that can't prove unhealthiness should
/// not block the attempt.
fn mock_reserve_looks_paused(reserve_info: &AccountInfo) -> bool {
    match reserve_info.try_borrow_data() {
        Ok(data) if data.len() > MOCK_RESERVE_PAUSED_OFFSET => {
            data[MOCK_RESERVE_PAUSED_OFFSET] != 0
        }
        _ => false,
    }
}

pub fn probe_deposit_handler(ctx: Context<KaminoProbeDeposit>, amount: u64) -> Result<()> {
    require!(
        ctx.accounts.agreement.state == AgreementState::Active,
        RelicPayError::AgreementNotActive
    );
    require!(
        amount > 0 && amount <= ctx.accounts.escrow_usdc.amount,
        RelicPayError::InvalidAmount
    );

    let agreement_key = ctx.accounts.agreement.key();
    let buyer = ctx.accounts.agreement.buyer;
    let product_id = ctx.accounts.agreement.product_id.clone();
    let bump = ctx.accounts.agreement.bump;

    let owner_info = ctx.accounts.agreement.to_account_info();
    let kamino_program_info = ctx.accounts.kamino_program.to_account_info();
    let lending_market_info = ctx.accounts.kamino_lending_market.to_account_info();
    let lending_market_authority_info = ctx.accounts.kamino_lending_market_authority.to_account_info();
    let reserve_info = ctx.accounts.kamino_reserve.to_account_info();
    let reserve_liquidity_supply_info = ctx.accounts.kamino_reserve_liquidity_supply.to_account_info();
    let reserve_collateral_mint_info = ctx.accounts.kamino_reserve_collateral_mint.to_account_info();
    let user_source_liquidity_info = ctx.accounts.escrow_usdc.to_account_info();
    let user_destination_collateral_info = ctx.accounts.escrow_kamino_collateral.to_account_info();
    let token_program_info = ctx.accounts.token_program.to_account_info();

    let accs = KaminoDepositAccounts {
        kamino_program: &kamino_program_info,
        owner: &owner_info,
        lending_market: &lending_market_info,
        lending_market_authority: &lending_market_authority_info,
        reserve: &reserve_info,
        reserve_liquidity_supply: &reserve_liquidity_supply_info,
        reserve_collateral_mint: &reserve_collateral_mint_info,
        user_source_liquidity: &user_source_liquidity_info,
        user_destination_collateral: &user_destination_collateral_info,
        token_program: &token_program_info,
    };

    let seeds: &[&[u8]] = &[SEED_AGREEMENT, buyer.as_ref(), product_id.as_bytes(), &[bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    // Preflight (see module doc, option (a)): a predictable failure —
    // reserve paused — is caught here by reading state, BEFORE invoking.
    // Once we do invoke, a failure there is not catchable; we propagate it
    // with `?` and let the transaction fail, which is the only honest
    // option at that point.
    if mock_reserve_looks_paused(&reserve_info) {
        emit!(KaminoDepositProbeFallback {
            agreement: agreement_key,
            amount,
        });
        return Ok(());
    }

    try_kamino_deposit(&accs, amount, signer_seeds)?;
    emit!(KaminoDepositProbeSucceeded {
        agreement: agreement_key,
        amount,
    });

    Ok(())
}

pub fn probe_redeem_handler(ctx: Context<KaminoProbeRedeem>, amount: u64) -> Result<()> {
    require!(
        ctx.accounts.agreement.state == AgreementState::Active,
        RelicPayError::AgreementNotActive
    );
    require!(
        amount > 0 && amount <= ctx.accounts.escrow_kamino_collateral.amount,
        RelicPayError::InvalidAmount
    );

    let agreement_key = ctx.accounts.agreement.key();
    let buyer = ctx.accounts.agreement.buyer;
    let product_id = ctx.accounts.agreement.product_id.clone();
    let bump = ctx.accounts.agreement.bump;

    let owner_info = ctx.accounts.agreement.to_account_info();
    let kamino_program_info = ctx.accounts.kamino_program.to_account_info();
    let lending_market_info = ctx.accounts.kamino_lending_market.to_account_info();
    let lending_market_authority_info = ctx.accounts.kamino_lending_market_authority.to_account_info();
    let reserve_info = ctx.accounts.kamino_reserve.to_account_info();
    let reserve_liquidity_supply_info = ctx.accounts.kamino_reserve_liquidity_supply.to_account_info();
    let reserve_collateral_mint_info = ctx.accounts.kamino_reserve_collateral_mint.to_account_info();
    let user_source_collateral_info = ctx.accounts.escrow_kamino_collateral.to_account_info();
    let user_destination_liquidity_info = ctx.accounts.escrow_usdc.to_account_info();
    let token_program_info = ctx.accounts.token_program.to_account_info();

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

    let seeds: &[&[u8]] = &[SEED_AGREEMENT, buyer.as_ref(), product_id.as_bytes(), &[bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    // See probe_deposit_handler: preflight-only guard, real invoke failures
    // are not catchable and propagate via `?`.
    if mock_reserve_looks_paused(&reserve_info) {
        emit!(KaminoRedeemProbeFallback {
            agreement: agreement_key,
            amount,
        });
        return Ok(());
    }

    try_kamino_redeem(&accs, amount, signer_seeds)?;
    emit!(KaminoRedeemProbeSucceeded {
        agreement: agreement_key,
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct KaminoProbeDeposit<'info> {
    #[account(
        seeds = [SEED_AGREEMENT, agreement.buyer.as_ref(), agreement.product_id.as_bytes()],
        bump = agreement.bump,
        constraint = buyer.key() == agreement.buyer @ RelicPayError::Unauthorized,
    )]
    pub agreement: Account<'info, BnplAgreement>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    /// CHECK: CPI target program, passed straight through to
    /// `invoke_signed` — the target program is responsible for validating
    /// its own accounts. Not gated by `KaminoConfig` here (see module doc);
    /// governance gating lands with the real create_agreement/
    /// pay_installment wiring.
    pub kamino_program: UncheckedAccount<'info>,

    /// CHECK: passed straight through to the CPI, not interpreted by this
    /// program.
    pub kamino_lending_market: UncheckedAccount<'info>,

    /// CHECK: passed straight through to the CPI, not interpreted by this
    /// program.
    pub kamino_lending_market_authority: UncheckedAccount<'info>,

    /// CHECK: passed straight through to the CPI; the target program
    /// validates ownership/seeds on its side.
    #[account(mut)]
    pub kamino_reserve: UncheckedAccount<'info>,

    #[account(mut)]
    pub kamino_reserve_liquidity_supply: Account<'info, TokenAccount>,

    #[account(mut)]
    pub kamino_reserve_collateral_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(
        init_if_needed,
        payer = buyer,
        token::mint = kamino_reserve_collateral_mint,
        token::authority = agreement,
        seeds = [SEED_KAMINO_COLLATERAL, agreement.key().as_ref()],
        bump
    )]
    pub escrow_kamino_collateral: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct KaminoProbeRedeem<'info> {
    #[account(
        seeds = [SEED_AGREEMENT, agreement.buyer.as_ref(), agreement.product_id.as_bytes()],
        bump = agreement.bump,
        constraint = buyer.key() == agreement.buyer @ RelicPayError::Unauthorized,
    )]
    pub agreement: Account<'info, BnplAgreement>,

    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    /// CHECK: see KaminoProbeDeposit.
    pub kamino_program: UncheckedAccount<'info>,
    /// CHECK: see KaminoProbeDeposit.
    pub kamino_lending_market: UncheckedAccount<'info>,
    /// CHECK: see KaminoProbeDeposit.
    pub kamino_lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: see KaminoProbeDeposit.
    #[account(mut)]
    pub kamino_reserve: UncheckedAccount<'info>,

    #[account(mut)]
    pub kamino_reserve_liquidity_supply: Account<'info, TokenAccount>,

    #[account(mut)]
    pub kamino_reserve_collateral_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(
        mut,
        seeds = [SEED_KAMINO_COLLATERAL, agreement.key().as_ref()],
        bump
    )]
    pub escrow_kamino_collateral: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
