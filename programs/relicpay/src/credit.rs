//! Pure math for the proposed agent credit line backed by staked USDC.
//!
//! No Anchor accounts or instructions are wired to these helpers yet; see
//! `docs/CREDIT_PRIMITIVE.md` for the design. All intermediate arithmetic uses
//! checked `u128` operations, rounds credit limits down, and rounds required
//! collateral up so rounding always favors protocol solvency.

use anchor_lang::prelude::*;

use crate::constants::{BPS_DIVISOR, MAX_LTV_BPS};
use crate::errors::RelicPayError;

fn require_valid_ltv(ltv_bps: u16) -> Result<()> {
    require!(ltv_bps <= MAX_LTV_BPS, RelicPayError::LtvTooHigh);
    Ok(())
}

/// Maximum credit available against `collateral` at `ltv_bps` (rounded down).
///
/// Rejects any `ltv_bps` above [`MAX_LTV_BPS`] (8,000 bps).
pub fn credit_limit(collateral: u64, ltv_bps: u16) -> Result<u64> {
    require_valid_ltv(ltv_bps)?;

    let limit = (collateral as u128)
        .checked_mul(ltv_bps as u128)
        .ok_or(RelicPayError::MathOverflow)?
        .checked_div(BPS_DIVISOR)
        .ok_or(RelicPayError::MathOverflow)?;

    u64::try_from(limit).map_err(|_| RelicPayError::MathOverflow.into())
}

/// Remaining credit that can be drawn (`credit_limit - debt`, saturating at 0).
pub fn available_credit(collateral: u64, ltv_bps: u16, debt: u64) -> Result<u64> {
    let limit = credit_limit(collateral, ltv_bps)?;
    let available = (limit as u128).saturating_sub(debt as u128);
    u64::try_from(available).map_err(|_| RelicPayError::MathOverflow.into())
}

/// Validates a new draw of `amount` against the credit limit and returns the
/// updated debt.
///
/// Rejects zero-amount draws, invalid LTVs, and any draw that would push debt
/// above `credit_limit(collateral, ltv_bps)`.
pub fn check_draw(amount: u64, collateral: u64, ltv_bps: u16, debt: u64) -> Result<u64> {
    require!(amount > 0, RelicPayError::InvalidAmount);
    let limit = credit_limit(collateral, ltv_bps)?;

    let new_debt = (debt as u128)
        .checked_add(amount as u128)
        .ok_or(RelicPayError::MathOverflow)?;
    require!(new_debt <= limit as u128, RelicPayError::ExceedsCreditLimit);

    u64::try_from(new_debt).map_err(|_| RelicPayError::MathOverflow.into())
}

/// Largest collateral withdrawal that still satisfies
/// `credit_limit(collateral - withdrawn, ltv_bps) >= debt`.
///
/// Rounds required collateral up (`ceil(debt * 10_000 / ltv_bps)`). Returns `0`
/// when `debt > 0` and either `ltv_bps == 0` or the position is already at or
/// above its credit limit.
pub fn max_unstake(collateral: u64, ltv_bps: u16, debt: u64) -> Result<u64> {
    require_valid_ltv(ltv_bps)?;

    if debt == 0 {
        return Ok(collateral);
    }
    if ltv_bps == 0 {
        return Ok(0);
    }

    let ltv = ltv_bps as u128;
    let rounding = ltv.checked_sub(1).ok_or(RelicPayError::MathOverflow)?;
    let numerator = (debt as u128)
        .checked_mul(BPS_DIVISOR)
        .ok_or(RelicPayError::MathOverflow)?
        .checked_add(rounding)
        .ok_or(RelicPayError::MathOverflow)?;
    let required_collateral = numerator
        .checked_div(ltv)
        .ok_or(RelicPayError::MathOverflow)?;

    let withdrawable = (collateral as u128).saturating_sub(required_collateral);
    u64::try_from(withdrawable).map_err(|_| RelicPayError::MathOverflow.into())
}

/// Applies `payment` to `debt` and returns the remaining debt.
///
/// Rejects zero-amount payments and any payment greater than `debt`
/// (overpayment is rejected rather than silently kept).
pub fn apply_repayment(debt: u64, payment: u64) -> Result<u64> {
    require!(payment > 0, RelicPayError::InvalidAmount);
    require!(payment <= debt, RelicPayError::RepaymentExceedsDebt);

    let remaining = (debt as u128)
        .checked_sub(payment as u128)
        .ok_or(RelicPayError::MathOverflow)?;

    u64::try_from(remaining).map_err(|_| RelicPayError::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    #[test]
    fn credit_limit_exact_80_percent_boundary() {
        assert_eq!(credit_limit(500 * USDC, 8_000).unwrap(), 400 * USDC);
        assert_eq!(credit_limit(10_000, 8_000).unwrap(), 8_000);
        // Floors down on non-exact divisions: 1 * 8_000 / 10_000 = 0, 2 * 8_000 / 10_000 = 1.
        assert_eq!(credit_limit(1, 8_000).unwrap(), 0);
        assert_eq!(credit_limit(2, 8_000).unwrap(), 1);
        assert_eq!(credit_limit(9_999, 8_000).unwrap(), 7_999);
    }

    #[test]
    fn draw_exact_available_succeeds_and_one_more_base_unit_fails() {
        let collateral = 500 * USDC;
        let debt = 180 * USDC;
        let avail = available_credit(collateral, 8_000, debt).unwrap();
        assert_eq!(avail, 220 * USDC);

        let full_debt = check_draw(avail, collateral, 8_000, debt).unwrap();
        assert_eq!(full_debt, 400 * USDC);
        assert_eq!(available_credit(collateral, 8_000, full_debt).unwrap(), 0);

        assert_eq!(
            check_draw(avail + 1, collateral, 8_000, debt).unwrap_err(),
            error!(RelicPayError::ExceedsCreditLimit)
        );
        assert_eq!(
            check_draw(1, collateral, 8_000, full_debt).unwrap_err(),
            error!(RelicPayError::ExceedsCreditLimit)
        );
        assert_eq!(
            check_draw(0, collateral, 8_000, debt).unwrap_err(),
            error!(RelicPayError::InvalidAmount)
        );
    }

    #[test]
    fn zero_collateral_has_zero_credit_and_blocks_draws() {
        assert_eq!(credit_limit(0, 8_000).unwrap(), 0);
        assert_eq!(available_credit(0, 8_000, 0).unwrap(), 0);
        assert_eq!(max_unstake(0, 8_000, 0).unwrap(), 0);
        assert_eq!(
            check_draw(1, 0, 8_000, 0).unwrap_err(),
            error!(RelicPayError::ExceedsCreditLimit)
        );
    }

    #[test]
    fn ltv_zero_blocks_draws_and_handles_unstake() {
        let collateral = 500 * USDC;
        assert_eq!(credit_limit(collateral, 0).unwrap(), 0);
        assert_eq!(available_credit(collateral, 0, 0).unwrap(), 0);
        assert_eq!(available_credit(collateral, 0, 10 * USDC).unwrap(), 0);
        assert_eq!(
            check_draw(1, collateral, 0, 0).unwrap_err(),
            error!(RelicPayError::ExceedsCreditLimit)
        );
        // With no debt, all collateral is withdrawable even at 0 LTV.
        assert_eq!(max_unstake(collateral, 0, 0).unwrap(), collateral);
        // With any debt at 0 LTV, no collateral can be withdrawn.
        assert_eq!(max_unstake(collateral, 0, 1).unwrap(), 0);
    }

    #[test]
    fn ltv_above_8000_rejected() {
        assert_eq!(
            credit_limit(500 * USDC, 8_001).unwrap_err(),
            error!(RelicPayError::LtvTooHigh)
        );
        assert_eq!(
            available_credit(500 * USDC, 8_001, 0).unwrap_err(),
            error!(RelicPayError::LtvTooHigh)
        );
        assert_eq!(
            check_draw(1, 500 * USDC, 8_001, 0).unwrap_err(),
            error!(RelicPayError::LtvTooHigh)
        );
        assert_eq!(
            max_unstake(500 * USDC, 8_001, 0).unwrap_err(),
            error!(RelicPayError::LtvTooHigh)
        );
        assert_eq!(
            credit_limit(500 * USDC, u16::MAX).unwrap_err(),
            error!(RelicPayError::LtvTooHigh)
        );
    }

    #[test]
    fn u64_max_collateral_does_not_overflow() {
        let expected_limit = ((u64::MAX as u128) * 8_000 / 10_000) as u64;
        assert_eq!(credit_limit(u64::MAX, 8_000).unwrap(), expected_limit);
        assert_eq!(
            available_credit(u64::MAX, 8_000, expected_limit).unwrap(),
            0
        );
        assert_eq!(
            check_draw(expected_limit, u64::MAX, 8_000, 0).unwrap(),
            expected_limit
        );
        // Drawing 1 more base unit past u64::MAX's credit limit fails cleanly.
        assert_eq!(
            check_draw(1, u64::MAX, 8_000, expected_limit).unwrap_err(),
            error!(RelicPayError::ExceedsCreditLimit)
        );
        // u64::MAX debt + u64::MAX draw does not panic or wrap.
        assert_eq!(
            check_draw(u64::MAX, u64::MAX, 8_000, u64::MAX).unwrap_err(),
            error!(RelicPayError::ExceedsCreditLimit)
        );
        // max_unstake at u64::MAX collateral and max debt leaves required collateral without overflow.
        let unstake = max_unstake(u64::MAX, 8_000, expected_limit).unwrap();
        let remaining = u64::MAX - unstake;
        assert!(credit_limit(remaining, 8_000).unwrap() >= expected_limit);
        assert!(credit_limit(remaining - 1, 8_000).unwrap() < expected_limit);
        // Under-collateralized at u64::MAX debt returns 0 cleanly without overflow.
        assert_eq!(max_unstake(u64::MAX, 1, u64::MAX).unwrap(), 0);
    }

    #[test]
    fn repay_restores_availability_and_rejects_overpayment() {
        let collateral = 500 * USDC;
        let debt = check_draw(180 * USDC, collateral, 8_000, 0).unwrap();
        assert_eq!(
            available_credit(collateral, 8_000, debt).unwrap(),
            220 * USDC
        );

        let after_partial = apply_repayment(debt, 60 * USDC).unwrap();
        assert_eq!(after_partial, 120 * USDC);
        assert_eq!(
            available_credit(collateral, 8_000, after_partial).unwrap(),
            280 * USDC
        );

        // Overpayment by 1 base unit is rejected.
        assert_eq!(
            apply_repayment(after_partial, after_partial + 1).unwrap_err(),
            error!(RelicPayError::RepaymentExceedsDebt)
        );
        // Zero payment is rejected.
        assert_eq!(
            apply_repayment(after_partial, 0).unwrap_err(),
            error!(RelicPayError::InvalidAmount)
        );

        let cleared = apply_repayment(after_partial, after_partial).unwrap();
        assert_eq!(cleared, 0);
        assert_eq!(
            available_credit(collateral, 8_000, cleared).unwrap(),
            400 * USDC
        );

        // Paying against zero debt is rejected as overpayment.
        assert_eq!(
            apply_repayment(0, 1).unwrap_err(),
            error!(RelicPayError::RepaymentExceedsDebt)
        );
    }

    #[test]
    fn max_unstake_leaves_exact_required_collateral() {
        // Exact division: 180 USDC debt at 80% LTV requires 225 USDC collateral, leaving 275 USDC withdrawable.
        let collateral = 500 * USDC;
        let debt = 180 * USDC;
        let withdrawable = max_unstake(collateral, 8_000, debt).unwrap();
        assert_eq!(withdrawable, 275 * USDC);
        let remaining = collateral - withdrawable;
        assert_eq!(credit_limit(remaining, 8_000).unwrap(), debt);
        assert!(credit_limit(remaining - 1, 8_000).unwrap() < debt);

        // Non-exact division: 1 base unit of debt at 80% LTV requires ceil(10_000 / 8_000) = 2 base units.
        let small_withdrawable = max_unstake(10, 8_000, 1).unwrap();
        assert_eq!(small_withdrawable, 8);
        assert!(credit_limit(10 - small_withdrawable, 8_000).unwrap() >= 1);
        assert!(credit_limit(10 - small_withdrawable - 1, 8_000).unwrap() < 1);

        // Odd LTV (7,501 bps) and odd debt (333 base units): verify tight boundary invariant.
        let odd_withdrawable = max_unstake(1_000, 7_501, 333).unwrap();
        let odd_remaining = 1_000 - odd_withdrawable;
        assert!(credit_limit(odd_remaining, 7_501).unwrap() >= 333);
        assert!(credit_limit(odd_remaining - 1, 7_501).unwrap() < 333);

        // Already under-collateralized (e.g. after LTV reduction): nothing can be unstaked.
        assert_eq!(max_unstake(500 * USDC, 5_000, 300 * USDC).unwrap(), 0);
        assert_eq!(available_credit(500 * USDC, 5_000, 300 * USDC).unwrap(), 0);
    }

    #[test]
    fn credit_demo_numbers_match_app() {
        // Mirrors app/src/lib/creditDemo.ts in 6-decimal USDC base units:
        // COLLATERAL = 500, CREDIT_LIMIT = 400 (80% LTV), PURCHASE_PRICE = 180,
        // three equal repayments of 60.
        let collateral = 500 * USDC;
        let ltv_bps = 8_000;
        let draw = 180 * USDC;
        let payment = 60 * USDC;

        // Open credit line: 500 USDC collateral -> 400 USDC limit, 400 available.
        assert_eq!(credit_limit(collateral, ltv_bps).unwrap(), 400 * USDC);
        assert_eq!(
            available_credit(collateral, ltv_bps, 0).unwrap(),
            400 * USDC
        );

        // Agent draws 180 USDC -> 180 debt, 220 available.
        let debt = check_draw(draw, collateral, ltv_bps, 0).unwrap();
        assert_eq!(debt, 180 * USDC);
        assert_eq!(
            available_credit(collateral, ltv_bps, debt).unwrap(),
            220 * USDC
        );

        // Installment 1 (day 30): repay 60 -> 120 debt, 280 available.
        let debt = apply_repayment(debt, payment).unwrap();
        assert_eq!(debt, 120 * USDC);
        assert_eq!(
            available_credit(collateral, ltv_bps, debt).unwrap(),
            280 * USDC
        );

        // Installment 2 (day 60): repay 60 -> 60 debt, 340 available.
        let debt = apply_repayment(debt, payment).unwrap();
        assert_eq!(debt, 60 * USDC);
        assert_eq!(
            available_credit(collateral, ltv_bps, debt).unwrap(),
            340 * USDC
        );

        // Installment 3 (day 90): repay 60 -> 0 debt, 400 available.
        let debt = apply_repayment(debt, payment).unwrap();
        assert_eq!(debt, 0);
        assert_eq!(
            available_credit(collateral, ltv_bps, debt).unwrap(),
            400 * USDC
        );
        assert_eq!(max_unstake(collateral, ltv_bps, debt).unwrap(), collateral);
    }
}
