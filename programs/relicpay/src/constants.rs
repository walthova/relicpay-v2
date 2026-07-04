//! Protocol-wide constants. Economics here must stay in sync with the
//! whitepaper and the browser extension's tier table.

/// PDA seeds
pub const SEED_AGREEMENT: &[u8] = b"agreement";
pub const SEED_ESCROW: &[u8] = b"escrow";
pub const SEED_STAKE_POOL: &[u8] = b"stake_pool";
pub const SEED_POOL_VAULT: &[u8] = b"pool_vault";
pub const SEED_USER_STAKE: &[u8] = b"user_stake";

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
