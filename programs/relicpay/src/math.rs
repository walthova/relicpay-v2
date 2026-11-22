//! Yield and tier math. Pure functions, unit-tested with `cargo test`.

use crate::constants::*;
use crate::errors::RelicPayError;
use anchor_lang::prelude::*;

/// Simple interest: yield = principal × (rate_bps / 10_000) × (t / 31_536_000)
///
/// u128 intermediate math; errors on overflow instead of silently saturating.
/// V2_KAMINO: replaced by kToken redemption math once escrow is deposited
/// into Kamino Lend.
pub fn calculate_yield(principal: u64, rate_bps_annual: u16, time_seconds: u64) -> Result<u64> {
    let numerator = (principal as u128)
        .checked_mul(rate_bps_annual as u128)
        .and_then(|n| n.checked_mul(time_seconds as u128))
        .ok_or(RelicPayError::MathOverflow)?;
    let denominator = BPS_DIVISOR * SECONDS_PER_YEAR;
    let result = numerator / denominator;
    u64::try_from(result).map_err(|_| RelicPayError::MathOverflow.into())
}

/// Discount tier from staked amount (USDC, 6 decimals).
pub fn compute_tier(staked_amount: u64) -> u8 {
    if staked_amount >= TIER_4_MIN {
        4
    } else if staked_amount >= TIER_3_MIN {
        3
    } else if staked_amount >= TIER_2_MIN {
        2
    } else if staked_amount >= TIER_1_MIN {
        1
    } else {
        0
    }
}

/// Installment `n` (1-based) is due `n - 1` intervals after `start_time`:
/// installment 1 is the upfront charge taken at creation.
pub fn installment_due_time(
    start_time: i64,
    interval_seconds: i64,
    installment: u8,
) -> Result<i64> {
    (installment as i64 - 1)
        .checked_mul(interval_seconds)
        .and_then(|offset| start_time.checked_add(offset))
        .ok_or_else(|| RelicPayError::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yield_100_usdc_30_days_at_3pct() {
        // $100 for 30 days at 3% APY ≈ $0.2466
        let y = calculate_yield(100_000_000, 300, 30 * 24 * 60 * 60).unwrap();
        assert_eq!(y, 246_575);
    }

    #[test]
    fn yield_zero_time_is_zero() {
        assert_eq!(calculate_yield(100_000_000, 300, 0).unwrap(), 0);
    }

    #[test]
    fn yield_zero_principal_is_zero() {
        assert_eq!(calculate_yield(0, 300, 999_999).unwrap(), 0);
    }

    #[test]
    fn yield_max_supply_one_year_does_not_overflow() {
        // u64::MAX principal at 3% for 1 year fits in u128 numerator
        let y = calculate_yield(u64::MAX, 300, 31_536_000).unwrap();
        let expected = (u64::MAX as u128 * 300 / 10_000) as u64;
        assert_eq!(y, expected);
    }

    #[test]
    fn tier_boundaries() {
        assert_eq!(compute_tier(0), 0);
        assert_eq!(compute_tier(9_999_999), 0);
        assert_eq!(compute_tier(10_000_000), 1);
        assert_eq!(compute_tier(49_999_999), 1);
        assert_eq!(compute_tier(50_000_000), 2);
        assert_eq!(compute_tier(199_999_999), 2);
        assert_eq!(compute_tier(200_000_000), 3);
        assert_eq!(compute_tier(499_999_999), 3);
        assert_eq!(compute_tier(500_000_000), 4);
        assert_eq!(compute_tier(u64::MAX), 4);
    }

    #[test]
    fn installments_fall_due_one_interval_apart_after_the_upfront_charge() {
        let thirty_days = 30 * 24 * 60 * 60;
        assert_eq!(installment_due_time(1_000, thirty_days, 1).unwrap(), 1_000);
        assert_eq!(
            installment_due_time(1_000, thirty_days, 2).unwrap(),
            1_000 + thirty_days
        );
        assert_eq!(
            installment_due_time(1_000, thirty_days, 3).unwrap(),
            1_000 + 2 * thirty_days
        );
    }

    #[test]
    fn installment_due_time_overflow_is_an_error() {
        assert!(installment_due_time(i64::MAX, 1, 3).is_err());
        assert!(installment_due_time(0, i64::MAX, 3).is_err());
    }
}
