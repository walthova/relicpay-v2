//! Creates a BNPL agreement and pays the FIRST installment immediately.
//!
//! ON-CHAIN EFFECTS:
//!   - BnplAgreement PDA created (seeds: "agreement" + buyer + product_id)
//!   - Escrow token account created (seeds: "escrow" + agreement)
//!   - First installment (total_price / installment_count) moves buyer → escrow
//!   - State set to Active
//!
//! CALLER: the buyer's wallet.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::AgreementCreated;
use crate::instructions::protocol_config::{apply_tvl_increase, check_not_paused, read_config};
use crate::state::{AgreementState, BnplAgreement};

pub fn handler(
    ctx: Context<CreateAgreement>,
    total_price: u64,
    installment_count: u8,
    interval_seconds: i64,
    product_id: String,
    merchant_name: String,
) -> Result<()> {
    // Parity (audit C-4): only the pinned USDC mint, once governance has pinned one.
    crate::instructions::protocol_config_ext::check_accepted_mint(
        &ctx.accounts.protocol_config_ext.to_account_info(),
        ctx.program_id,
        &ctx.accounts.usdc_mint.key(),
    )?;
    let config_info = ctx.accounts.protocol_config.to_account_info();
    let buyer = ctx.accounts.buyer.key();
    let merchant = ctx.accounts.merchant.key();
    let usdc_mint = ctx.accounts.usdc_mint.key();
    let bump = ctx.bumps.agreement;
    let first_installment = init_agreement(
        &mut ctx.accounts.agreement,
        &config_info,
        ctx.program_id,
        AgreementParams {
            buyer,
            merchant,
            usdc_mint,
            total_price,
            installment_count,
            interval_seconds,
            product_id,
            merchant_name,
            bump,
        },
    )?;

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer_usdc.to_account_info(),
                to: ctx.accounts.escrow_usdc.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        first_installment,
    )?;

    let agreement_key = ctx.accounts.agreement.key();
    finish_agreement(
        &mut ctx.accounts.agreement,
        agreement_key,
        first_installment,
    );
    Ok(())
}

/// Inputs to [`init_agreement`], shared with `create_agreement_kamino`.
pub(crate) struct AgreementParams {
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub usdc_mint: Pubkey,
    pub total_price: u64,
    pub installment_count: u8,
    pub interval_seconds: i64,
    pub product_id: String,
    pub merchant_name: String,
    pub bump: u8,
}

/// Everything `create_agreement` does BEFORE moving USDC: argument
/// validation, pause + deposit-cap checks, agreement initialization, and the
/// TVL cap update. Shared with `create_agreement_kamino` so the two cannot
/// drift. Returns the first installment amount the caller must move into
/// escrow, then call [`finish_agreement`].
pub(crate) fn init_agreement(
    agreement: &mut BnplAgreement,
    config_info: &AccountInfo,
    program_id: &Pubkey,
    p: AgreementParams,
) -> Result<u64> {
    let AgreementParams {
        buyer,
        merchant,
        usdc_mint,
        total_price,
        installment_count,
        interval_seconds,
        product_id,
        merchant_name,
        bump,
    } = p;
    require!(total_price > 0, RelicPayError::InvalidAmount);
    require!(
        (MIN_INSTALLMENTS..=MAX_INSTALLMENTS).contains(&installment_count),
        RelicPayError::InvalidInstallments
    );
    require!(interval_seconds > 0, RelicPayError::InvalidInterval);
    require!(
        product_id.len() <= MAX_PRODUCT_ID_LEN,
        RelicPayError::InvalidProductId
    );
    require!(
        merchant_name.len() <= MAX_MERCHANT_NAME_LEN,
        RelicPayError::InvalidMerchantName
    );

    // v2.1: ProtocolConfig enforcement (DEVELOPMENT_PLAN.md v2.1 item 5).
    // The config PDA is a constant-seed singleton, so the Anchor TS client
    // auto-derives its address without callers needing to list it —
    // the frozen v1 characterization suite never mentions this account and
    // keeps working unchanged. Deployments that predate `init_protocol_config`
    // (or localnet test runs before that instruction has been called) see an
    // account owned by the System Program here, which read_config/
    // check_not_paused treat as "no risk controls configured" rather than an
    // error (see protocol_config.rs).
    check_not_paused(config_info, program_id)?;
    if let Some(config) = read_config(config_info, program_id)? {
        if config.max_agreement_deposit > 0 {
            require!(
                total_price <= config.max_agreement_deposit,
                RelicPayError::DepositCapExceeded
            );
        }
    }

    let clock = Clock::get()?;

    agreement.buyer = buyer;
    agreement.merchant = merchant;
    agreement.usdc_mint = usdc_mint;
    agreement.total_price = total_price;
    agreement.installment_count = installment_count;
    // Integer division: any remainder is absorbed into the final installment
    // so total_price is always fully collected.
    agreement.installment_amount = total_price / installment_count as u64;
    agreement.interval_seconds = interval_seconds;
    agreement.start_time = clock.unix_timestamp;
    agreement.last_yield_update = clock.unix_timestamp;
    agreement.state = AgreementState::Active;
    agreement.product_id = product_id;
    agreement.merchant_name = merchant_name;
    agreement.yield_accrued = 0;
    // V2_KAMINO: replaced by actual Kamino Lend supply APY.
    agreement.yield_rate_bps_annual = DEFAULT_YIELD_RATE_BPS;
    agreement.bump = bump;
    agreement.merchant_withdrawn = false;
    agreement.version = BnplAgreement::VERSION;
    // Starts simulated; `create_agreement_kamino` flips it to
    // YIELD_SOURCE_KAMINO_LEND after a successful deposit CPI.
    agreement.yield_source = BnplAgreement::YIELD_SOURCE_SIMULATED;

    let first_installment = agreement.installment_amount;

    // v2.1: enforce + update the protocol-wide TVL cap before the transfer
    // (checks-effects-interactions) — a cap violation must revert before any
    // USDC moves. No-op if the config PDA isn't initialized.
    apply_tvl_increase(config_info, program_id, first_installment)?;

    Ok(first_installment)
}

/// Post-transfer bookkeeping + the `AgreementCreated` event. Call BEFORE any
/// Kamino deposit so the event reports the simulated source consistently
/// with plain `create_agreement`.
pub(crate) fn finish_agreement(
    agreement: &mut BnplAgreement,
    agreement_key: Pubkey,
    first_installment: u64,
) {
    agreement.paid_installments = 1;
    agreement.escrow_deposited = first_installment;

    emit!(AgreementCreated {
        agreement: agreement_key,
        buyer: agreement.buyer,
        merchant: agreement.merchant,
        total_price: agreement.total_price,
        installment_count: agreement.installment_count,
        installment_amount: agreement.installment_amount,
        product_id: agreement.product_id.clone(),
        merchant_name: agreement.merchant_name.clone(),
        yield_source: agreement.yield_source,
    });
}

#[derive(Accounts)]
#[instruction(total_price: u64, installment_count: u8, interval_seconds: i64, product_id: String)]
pub struct CreateAgreement<'info> {
    #[account(
        init,
        payer = buyer,
        space = BnplAgreement::SIZE,
        seeds = [SEED_AGREEMENT, buyer.key().as_ref(), product_id.as_bytes()],
        bump
    )]
    pub agreement: Account<'info, BnplAgreement>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Merchant's pubkey — stored for withdrawal authorization check.
    /// Not a signer; merchant is only needed at withdrawal time.
    pub merchant: AccountInfo<'info>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = buyer,
    )]
    pub buyer_usdc: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = buyer,
        token::mint = usdc_mint,
        token::authority = agreement, // PDA owns the escrow — no human key can drain it
        seeds = [SEED_ESCROW, agreement.key().as_ref()],
        bump
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    /// CHECK: v2.1 risk controls (see state.rs / protocol_config.rs).
    /// Constant PDA seed — no other account/instruction-arg dependency — so
    /// Anchor's TS client auto-derives and injects this address even when
    /// callers never list it in `.accounts()`. Deliberately `UncheckedAccount`,
    /// not `Account<ProtocolConfig>`: the PDA may not exist yet (pre-governance
    /// deployments, or any caller who hasn't called `init_protocol_config`),
    /// and an `Account<T>` wrapper would hard-fail deserialization in that
    /// case. The handler manually checks ownership and treats a
    /// system-owned (uninitialized) account as "no risk controls configured."
    /// `mut` so `apply_tvl_increase` can write the updated `current_tvl` back
    /// (a no-op write when the PDA is uninitialized — see protocol_config.rs).
    #[account(mut, seeds = [SEED_PROTOCOL_CONFIG], bump)]
    pub protocol_config: UncheckedAccount<'info>,

    /// CHECK: parity singleton at a constant-seed PDA; may be uninitialized (then ignored).
    #[account(seeds = [SEED_PROTOCOL_CONFIG_EXT], bump)]
    pub protocol_config_ext: UncheckedAccount<'info>,
}
