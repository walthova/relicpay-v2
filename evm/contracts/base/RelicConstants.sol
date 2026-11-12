// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RelicConstants
/// @notice Protocol constants shared by the Base contracts. Every value here mirrors
///         programs/relicpay/src/constants.rs on Solana. docs/CHAIN_PARITY.md maps them one to one;
///         change both chains together or not at all.
library RelicConstants {
    // Installment bounds (constants.rs MIN_INSTALLMENTS / MAX_INSTALLMENTS)
    uint8 internal constant MIN_INSTALLMENTS = 2;
    uint8 internal constant MAX_INSTALLMENTS = 12;

    // String limits (product_id is part of the agreement id, as it is part of the PDA seed on Solana)
    uint256 internal constant MAX_PRODUCT_ID_LEN = 64;
    uint256 internal constant MAX_MERCHANT_NAME_LEN = 64;

    // Buyer cancellation fee paid to the merchant: 10%
    uint256 internal constant CANCEL_FEE_BPS = 1_000;

    // Grace period past a missed due date before anyone may trigger default
    uint256 internal constant GRACE_PERIOD_SECONDS = 7 days;

    // Simulated escrow yield and stake pool rates
    uint16 internal constant DEFAULT_YIELD_RATE_BPS = 300; // 3% APY
    uint16 internal constant MAX_YIELD_RATE_BPS = 2_000; // governance may never exceed 20%

    uint256 internal constant BPS = 10_000;
    uint256 internal constant SECONDS_PER_YEAR = 31_536_000;

    // Fixed-point scale for the stake pool yield index (same scale on Solana: YIELD_INDEX_SCALE)
    uint256 internal constant YIELD_INDEX_SCALE = 1e12;

    // Discount tiers (USDC, 6 decimals): 0 / 50 / 100 / 200 / 300 bps off at checkout
    uint256 internal constant TIER_1_MIN = 10_000_000; //  $10
    uint256 internal constant TIER_2_MIN = 50_000_000; //  $50
    uint256 internal constant TIER_3_MIN = 200_000_000; // $200
    uint256 internal constant TIER_4_MIN = 500_000_000; // $500

    // Agent mandates
    uint256 internal constant MAX_MANDATE_MERCHANTS = 8;
    uint256 internal constant SECONDS_PER_DAY = 86_400;

    // Collateralized credit line (feature flagged)
    uint256 internal constant MAX_LTV_BPS = 8_000; // draw up to 80% of collateral
    uint256 internal constant LIQUIDATION_LTV_BPS = 9_000; // liquidatable above 90%
    uint256 internal constant LIQUIDATION_PENALTY_BPS = 500; // 5% of debt, paid from collateral
    uint16 internal constant DEFAULT_CREDIT_RATE_BPS = 800; // 8% APR simple interest
    uint16 internal constant MAX_CREDIT_RATE_BPS = 3_000; // governance cap 30% APR

    // Trust score (repayment based, sybil damped)
    uint256 internal constant TRUST_MIN_DEBT_AGE = 1 days; // repaying debt younger than this earns nothing
    uint256 internal constant TRUST_EPOCH_SECONDS = 30 days;
    uint256 internal constant TRUST_POINTS_PER_EPOCH_CAP = 100; // most points one line can earn per epoch
    uint256 internal constant TRUST_UNIT = 1_000_000; // 1 point per 1 USDC of aged principal repaid

    /// @notice Simple interest, identical to math.rs calculate_yield (floor division).
    function calculateYield(uint256 principal, uint256 rateBpsAnnual, uint256 timeSeconds)
        internal
        pure
        returns (uint256)
    {
        return (principal * rateBpsAnnual * timeSeconds) / (BPS * SECONDS_PER_YEAR);
    }

    /// @notice Discount tier 0 to 4, identical to math.rs compute_tier.
    function computeTier(uint256 staked) internal pure returns (uint8) {
        if (staked >= TIER_4_MIN) return 4;
        if (staked >= TIER_3_MIN) return 3;
        if (staked >= TIER_2_MIN) return 2;
        if (staked >= TIER_1_MIN) return 1;
        return 0;
    }
}
