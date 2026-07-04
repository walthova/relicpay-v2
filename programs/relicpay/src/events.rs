//! On-chain events, indexed by the frontend via Anchor listeners.

use anchor_lang::prelude::*;

#[event]
pub struct AgreementCreated {
    pub agreement: Pubkey,
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub total_price: u64,
    pub installment_count: u8,
    pub installment_amount: u64,
    pub product_id: String,
    pub merchant_name: String,
}

#[event]
pub struct InstallmentPaid {
    pub agreement: Pubkey,
    pub buyer: Pubkey,
    pub installment_number: u8,
    pub amount: u64,
    pub yield_accrued_so_far: u64,
}

#[event]
pub struct AgreementCompleted {
    pub agreement: Pubkey,
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub total_paid: u64,
    pub yield_earned_by_buyer: u64,
}

#[event]
pub struct AgreementCancelled {
    pub agreement: Pubkey,
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub refund_to_buyer: u64,
    pub fee_to_merchant: u64,
}

#[event]
pub struct YieldClaimed {
    pub agreement: Pubkey,
    pub buyer: Pubkey,
    pub yield_amount: u64,
}

#[event]
pub struct AgreementDefaulted {
    pub agreement: Pubkey,
    pub buyer: Pubkey,
    pub paid_installments: u8,
    pub merchant_recovered: u64,
}

#[event]
pub struct MerchantPaid {
    pub agreement: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AgreementClosed {
    pub agreement: Pubkey,
    pub buyer: Pubkey,
}

#[event]
pub struct StakePoolInitialized {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub yield_rate_bps_annual: u16,
}

#[event]
pub struct Staked {
    pub user: Pubkey,
    pub amount: u64,
    pub new_total: u64,
    pub tier: u8,
}

#[event]
pub struct Unstaked {
    pub user: Pubkey,
    pub principal: u64,
    pub yield_paid: u64,
    pub remaining_staked: u64,
    pub tier: u8,
}

#[event]
pub struct PoolRateUpdated {
    pub pool: Pubkey,
    pub old_rate_bps: u16,
    pub new_rate_bps: u16,
}
