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
    pub yield_source: u8, // 0 = Simulated, 1 = KaminoLend
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

#[event]
pub struct ProtocolConfigInitialized {
    pub config: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct ProtocolPauseUpdated {
    pub config: Pubkey,
    pub paused: bool,
}

#[event]
pub struct RiskLimitsUpdated {
    pub config: Pubkey,
    pub max_agreement_deposit: u64,
    pub tvl_cap: u64,
}

#[event]
pub struct KaminoConfigInitialized {
    pub config: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct KaminoConfigUpdated {
    pub config: Pubkey,
    pub enabled: bool,
    pub reserve: Pubkey,
}

// ── v2.1: Kamino CPI proof-of-concept (kamino_probe.rs) ──

#[event]
pub struct KaminoDepositProbeSucceeded {
    pub agreement: Pubkey,
    pub amount: u64,
}

#[event]
pub struct KaminoDepositProbeFallback {
    pub agreement: Pubkey,
    pub amount: u64,
}

#[event]
pub struct KaminoRedeemProbeSucceeded {
    pub agreement: Pubkey,
    pub amount: u64,
}

#[event]
pub struct KaminoRedeemProbeFallback {
    pub agreement: Pubkey,
    pub amount: u64,
}

// ── Agent BNPL (agent_mandate.rs) ──

#[event]
pub struct AgentMandateSet {
    pub mandate: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub per_purchase_cap: u64,
    pub period_cap: u64,
    pub delegated_allowance: u64,
}

#[event]
pub struct AgentMandateRevoked {
    pub mandate: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
}

/// The on-chain audit record of every agent purchase.
#[event]
pub struct AgentPurchase {
    pub mandate: Pubkey,
    pub agreement: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub merchant: Pubkey,
    pub total_price: u64,
    pub owner_cosigned: bool,
    pub period_spent: u64,
}

// ── Two-chain parity (feat/base-parity) ──

#[event]
pub struct ProtocolConfigExtUpdated {
    pub accepted_mint: Pubkey,
    pub credit_enabled: bool,
    pub credit_rate_bps: u16,
}

#[event]
pub struct YieldReserveFunded {
    pub from: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EscrowYieldPaid {
    pub agreement: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub still_owed: u64,
}

#[event]
pub struct CreditDrawn {
    pub owner: Pubkey,
    pub payee: Pubkey,
    pub via_agent: bool,
    pub amount: u64,
    pub new_debt: u64,
}

#[event]
pub struct CreditRepaid {
    pub owner: Pubkey,
    pub payer: Pubkey,
    pub interest_paid: u64,
    pub principal_paid: u64,
    pub trust_points: u64,
}

#[event]
pub struct CreditLiquidated {
    pub owner: Pubkey,
    pub liquidator: Pubkey,
    pub debt: u64,
    pub seized: u64,
    pub liquidator_reward: u64,
    pub bad_debt: u64,
}

#[event]
pub struct CollateralMoved {
    pub owner: Pubkey,
    pub deposit: bool,
    pub amount: u64,
    pub new_collateral: u64,
}

#[event]
pub struct AgentCharge {
    pub mandate: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
    pub payment_ref: [u8; 32],
    pub owner_cosigned: bool,
}
