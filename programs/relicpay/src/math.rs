//! Yield and tier math. Pure functions, unit-tested with `cargo test`.

use crate::constants::*;
use crate::errors::RelicPayError;
use anchor_lang::prelude::*;

/// Simulated simple interest: yield = principal × (rate_bps / 10_000) × (t / 31_536_000)
///
/// u128 intermediate math; errors on overflow instead of silently saturating.
pub fn calculate_yield(principal: u64, rate_bps_annual: u16, time_seconds: u64) -> Result<u64> {
    let numerator = (principal as u128)
        .checked_mul(rate_bps_annual as u128)
        .and_then(|n| n.checked_mul(time_seconds as u128))
        .ok_or(RelicPayError::MathOverflow)?;
    let denominator = BPS_DIVISOR * SECONDS_PER_YEAR;
    let result = numerator / denominator;
    u64::try_from(result).map_err(|_| RelicPayError::MathOverflow.into())
}

/// Split accrued rewards using vault balance and total principal before withdrawal.
pub fn payable_yield(accrued: u64, vault_balance: u64, total_staked: u64) -> Result<(u64, u64)> {
    let surplus = vault_balance.saturating_sub(total_staked);
    let paid = accrued.min(surplus);
    let deferred = accrued
        .checked_sub(paid)
        .ok_or(RelicPayError::MathOverflow)?;
    Ok((paid, deferred))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simulated_yield_prorates_an_example_rate() {
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
        // The example rate and maximum principal fit in the u128 numerator.
        let y = calculate_yield(u64::MAX, 300, 31_536_000).unwrap();
        let expected = (u64::MAX as u128 * 300 / 10_000) as u64;
        assert_eq!(y, expected);
    }

    #[test]
    fn payable_yield_preserves_all_accrued_when_surplus_is_zero() {
        assert_eq!(payable_yield(12, 100, 100).unwrap(), (0, 12));
    }

    #[test]
    fn payable_yield_pays_only_up_to_available_surplus() {
        assert_eq!(payable_yield(12, 105, 100).unwrap(), (5, 7));
    }

    #[test]
    fn payable_yield_pays_no_more_than_accrued() {
        assert_eq!(payable_yield(12, 120, 100).unwrap(), (12, 0));
        assert_eq!(payable_yield(0, 120, 100).unwrap(), (0, 0));
    }

    #[test]
    fn payable_yield_treats_a_principal_shortfall_as_zero_surplus() {
        assert_eq!(payable_yield(12, 99, 100).unwrap(), (0, 12));
    }

    #[test]
    fn payable_yield_handles_u64_boundaries() {
        let max = u64::MAX;
        assert_eq!(payable_yield(max, max, 0).unwrap(), (max, 0));
        assert_eq!(payable_yield(max, max, max - 1).unwrap(), (1, max - 1));
        assert_eq!(payable_yield(max, 0, max).unwrap(), (0, max));
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
}
