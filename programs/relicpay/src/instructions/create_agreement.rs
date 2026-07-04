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
use crate::state::{AgreementState, BnplAgreement};

pub fn handler(
    ctx: Context<CreateAgreement>,
    total_price: u64,
    installment_count: u8,
    interval_seconds: i64,
    product_id: String,
    merchant_name: String,
) -> Result<()> {
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

    let agreement = &mut ctx.accounts.agreement;
    let clock = Clock::get()?;

    agreement.buyer = ctx.accounts.buyer.key();
    agreement.merchant = ctx.accounts.merchant.key();
    agreement.usdc_mint = ctx.accounts.usdc_mint.key();
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
    agreement.bump = ctx.bumps.agreement;
    agreement.merchant_withdrawn = false;
    agreement.version = BnplAgreement::VERSION;

    // Transfer first installment: buyer_usdc → escrow_usdc
    let first_installment = agreement.installment_amount;
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

    agreement.paid_installments = 1;
    agreement.escrow_deposited = first_installment;

    emit!(AgreementCreated {
        agreement: agreement.key(),
        buyer: agreement.buyer,
        merchant: agreement.merchant,
        total_price,
        installment_count,
        installment_amount: agreement.installment_amount,
        product_id: agreement.product_id.clone(),
        merchant_name: agreement.merchant_name.clone(),
    });

    Ok(())
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
}
