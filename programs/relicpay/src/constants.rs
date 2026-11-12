//! Protocol-wide constants. Economics here must stay in sync with the
//! whitepaper and the browser extension's tier table.

/// PDA seeds
pub const SEED_AGREEMENT: &[u8] = b"agreement";
pub const SEED_ESCROW: &[u8] = b"escrow";
pub const SEED_STAKE_POOL: &[u8] = b"stake_pool";
pub const SEED_POOL_VAULT: &[u8] = b"pool_vault";
pub const SEED_USER_STAKE: &[u8] = b"user_stake";
pub const SEED_PROTOCOL_CONFIG: &[u8] = b"protocol_config";
pub const SEED_KAMINO_CONFIG: &[u8] = b"kamino_config";
pub const SEED_KAMINO_COLLATERAL: &[u8] = b"kamino_collateral";
pub const SEED_AGENT_MANDATE: &[u8] = b"agent_mandate";

/// Installment bounds
pub const MIN_INSTALLMENTS: u8 = 2;
pub const MAX_INSTALLMENTS: u8 = 12;

/// String field limits (product_id is a PDA seed — must stay short)
pub const MAX_PRODUCT_ID_LEN: usize = 64;
pub const MAX_MERCHANT_NAME_LEN: usize = 64;

/// Buyer cancellation fee paid to the merchant: 10%
pub const CANCEL_FEE_BPS: u64 = 1_000;

/// Grace period past a missed due date before anyone may trigger default
pub const GRACE_PERIOD_SECONDS: i64 = 7 * 24 * 60 * 60;

/// Default yield rate: 3% APY, in basis points
pub const DEFAULT_YIELD_RATE_BPS: u16 = 300;

/// Governance may never set the stake pool APY above 20%
pub const MAX_YIELD_RATE_BPS: u16 = 2_000;

/// Yield math denominators
pub const BPS_DIVISOR: u128 = 10_000;
pub const SECONDS_PER_YEAR: u128 = 31_536_000;

/// Discount tier thresholds (USDC, 6 decimals).
/// Tier bps → browser extension price reduction: 0 / 50 / 100 / 200 / 300
pub const TIER_1_MIN: u64 = 10_000_000; //  $10 → 0.5% off
pub const TIER_2_MIN: u64 = 50_000_000; //  $50 → 1.0% off
pub const TIER_3_MIN: u64 = 200_000_000; // $200 → 2.0% off
pub const TIER_4_MIN: u64 = 500_000_000; // $500 → 3.0% off

/// Agent BNPL: most merchants an owner can allow-list on one mandate.
/// The list must be non-empty: an empty list never means "any merchant" (audit C-3).
pub const MAX_MANDATE_MERCHANTS: usize = 8;

// ── Two-chain parity (feat/base-parity). Every value below has the same name and
// ── value in evm/contracts/base/RelicConstants.sol. See docs/CHAIN_PARITY.md.

pub const SEED_PROTOCOL_CONFIG_EXT: &[u8] = b"protocol_config_ext";
pub const SEED_YIELD_RESERVE: &[u8] = b"yield_reserve";
pub const SEED_CREDIT_POOL: &[u8] = b"credit_pool";
pub const SEED_CREDIT_VAULT: &[u8] = b"credit_vault";
pub const SEED_CREDIT_LINE: &[u8] = b"credit_line";
pub const SEED_LENDER: &[u8] = b"lender";
pub const SEED_CHARGE_REF: &[u8] = b"charge_ref";

/// Fixed-point scale for the stake pool yield index (Base: YIELD_INDEX_SCALE)
pub const YIELD_INDEX_SCALE: u128 = 1_000_000_000_000;

pub const SECONDS_PER_DAY: i64 = 86_400;

/// Collateralized credit line (feature flagged, off by default)
pub const MAX_LTV_BPS: u128 = 8_000; // draw up to 80% of collateral
pub const LIQUIDATION_LTV_BPS: u128 = 9_000; // liquidatable above 90%
pub const LIQUIDATION_PENALTY_BPS: u128 = 500; // 5% of debt, half to the liquidator
pub const DEFAULT_CREDIT_RATE_BPS: u16 = 800; // 8% APR simple interest
pub const MAX_CREDIT_RATE_BPS: u16 = 3_000; // governance cap 30% APR

/// Trust score: repayment based and sybil damped
pub const TRUST_MIN_DEBT_AGE: i64 = 24 * 60 * 60; // repaying debt younger than a day earns nothing
pub const TRUST_EPOCH_SECONDS: i64 = 30 * 24 * 60 * 60;
pub const TRUST_POINTS_PER_EPOCH_CAP: u64 = 100;
pub const TRUST_UNIT: u64 = 1_000_000; // 1 point per 1 USDC of aged principal repaid
