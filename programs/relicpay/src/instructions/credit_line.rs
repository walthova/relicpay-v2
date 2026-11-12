//! Collateralized USDC credit line, behind a feature flag (ProtocolConfigExt.credit_enabled,
//! off at init). Instruction-for-function port of evm/contracts/base/RelicCreditLine.sol.
//!
//! - Collateral and debt are both USDC: no price oracle, no depeg leg. LTV moves only with
//!   interest, draws, repayments and top-ups.
//! - Draw up to 80% LTV, straight from the lender pool to the payee's token account.
//! - Above 90% LTV anyone may liquidate: collateral covers debt plus a 5% penalty, half of the
//!   penalty pays the liquidator, the rest is protocol revenue.
//! - Trust score: points only for principal repaid on debt at least a day old, capped per 30-day
//!   epoch, reset on liquidation.
//! - With the flag off, new collateral and new draws are blocked; repay, withdraw and liquidate
//!   still work, so nobody is trapped by switching the feature off.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::RelicPayError;
use crate::events::{CollateralMoved, CreditDrawn, CreditLiquidated, CreditRepaid};
use crate::math::calculate_yield;
use crate::state::{CreditLine, CreditPool, LenderPosition, ProtocolConfigExt};

// ───────────────────────────── shared math ─────────────────────────────

pub(crate) fn accrue(line: &mut CreditLine, rate_bps: u16, now: i64) -> Result<()> {
    if line.principal > 0 && line.last_accrual > 0 && now > line.last_accrual {
        let interest = calculate_yield(line.principal, rate_bps, (now - line.last_accrual) as u64)?;
        line.interest = line
            .interest
            .checked_add(interest)
            .ok_or(RelicPayError::MathOverflow)?;
    }
    line.last_accrual = now;
    Ok(())
}

pub(crate) fn debt(line: &CreditLine) -> Result<u64> {
    line.principal
        .checked_add(line.interest)
        .ok_or(RelicPayError::MathOverflow.into())
}

/// debt / collateral <= limit_bps / 10_000, in u128 so nothing overflows.
fn within(debt: u64, collateral: u64, limit_bps: u128) -> bool {
    (debt as u128) * BPS_DIVISOR <= (collateral as u128) * limit_bps
}

/// Every check and book entry of a draw, before the token transfer. Base: RelicCreditLine._draw.
pub(crate) fn book_draw(
    line: &mut CreditLine,
    pool: &mut CreditPool,
    ext: &ProtocolConfigExt,
    amount: u64,
    now: i64,
) -> Result<u64> {
    require!(ext.credit_enabled, RelicPayError::CreditDisabled);
    require!(amount > 0, RelicPayError::InvalidAmount);
    accrue(line, ext.credit_rate_bps, now)?;
    let new_debt = debt(line)?
        .checked_add(amount)
        .ok_or(RelicPayError::MathOverflow)?;
    require!(
        within(new_debt, line.collateral, MAX_LTV_BPS),
        RelicPayError::LtvExceeded
    );
    require!(
        amount <= pool.available_liquidity,
        RelicPayError::InsufficientLiquidity
    );
    line.principal = line
        .principal
        .checked_add(amount)
        .ok_or(RelicPayError::MathOverflow)?;
    line.last_draw_at = now;
    pool.available_liquidity -= amount;
    pool.total_principal_out = pool
        .total_principal_out
        .checked_add(amount)
        .ok_or(RelicPayError::MathOverflow)?;
    Ok(new_debt)
}

pub(crate) fn pay_from_vault<'info>(
    token_program: &Program<'info, Token>,
    vault: &Account<'info, TokenAccount>,
    to: AccountInfo<'info>,
    pool: AccountInfo<'info>,
    pool_bump: u8,
    amount: u64,
) -> Result<()> {
    let seeds = &[SEED_CREDIT_POOL, &[pool_bump]];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: vault.to_account_info(),
                to,
                authority: pool,
            },
            &[&seeds[..]],
        ),
        amount,
    )
}

fn pull_into_vault<'info>(
    token_program: &Program<'info, Token>,
    from: AccountInfo<'info>,
    vault: &Account<'info, TokenAccount>,
    authority: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    token::transfer(
        CpiContext::new(
            token_program.to_account_info(),
            Transfer {
                from,
                to: vault.to_account_info(),
                authority,
            },
        ),
        amount,
    )
}

fn award_trust(line: &mut CreditLine, principal_paid: u64, now: i64) -> u64 {
    if principal_paid == 0 || now < line.last_draw_at.saturating_add(TRUST_MIN_DEBT_AGE) {
        return 0;
    }
    if now >= line.epoch_start.saturating_add(TRUST_EPOCH_SECONDS) {
        line.epoch_start = now;
        line.epoch_points = 0;
    }
    let room = TRUST_POINTS_PER_EPOCH_CAP.saturating_sub(line.epoch_points);
    let points = (principal_paid / TRUST_UNIT).min(room);
    line.epoch_points += points;
    line.trust_score = line.trust_score.saturating_add(points);
    points
}

// ───────────────────────────── init_credit_pool ─────────────────────────────

pub fn init_pool_handler(ctx: Context<InitCreditPool>) -> Result<()> {
    let pool = &mut ctx.accounts.credit_pool;
    pool.available_liquidity = 0;
    pool.total_principal_out = 0;
    pool.total_collateral = 0;
    pool.protocol_revenue = 0;
    pool.bad_debt = 0;
    pool.bump = ctx.bumps.credit_pool;
    Ok(())
}

#[derive(Accounts)]
pub struct InitCreditPool<'info> {
    #[account(
        seeds = [SEED_PROTOCOL_CONFIG_EXT],
        bump = ext.bump,
        constraint = ext.authority == authority.key() @ RelicPayError::Unauthorized,
        constraint = ext.accepted_mint == usdc_mint.key() @ RelicPayError::MintNotAccepted,
    )]
    pub ext: Account<'info, ProtocolConfigExt>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(init, payer = authority, space = CreditPool::SIZE, seeds = [SEED_CREDIT_POOL], bump)]
    pub credit_pool: Account<'info, CreditPool>,

    #[account(
        init,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = credit_pool,
        seeds = [SEED_CREDIT_VAULT],
        bump
    )]
    pub credit_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ───────────────────────────── lenders ─────────────────────────────

pub fn supply_handler(ctx: Context<SupplyLiquidity>, amount: u64) -> Result<()> {
    require!(amount > 0, RelicPayError::InvalidAmount);
    pull_into_vault(
        &ctx.accounts.token_program,
        ctx.accounts.supplier_usdc.to_account_info(),
        &ctx.accounts.credit_vault,
        ctx.accounts.supplier.to_account_info(),
        amount,
    )?;
    let pos = &mut ctx.accounts.lender_position;
    pos.supplier = ctx.accounts.supplier.key();
    pos.bump = ctx.bumps.lender_position;
    pos.supplied = pos.supplied.checked_add(amount).ok_or(RelicPayError::MathOverflow)?;
    let pool = &mut ctx.accounts.credit_pool;
    pool.available_liquidity = pool
        .available_liquidity
        .checked_add(amount)
        .ok_or(RelicPayError::MathOverflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct SupplyLiquidity<'info> {
    #[account(mut, seeds = [SEED_CREDIT_POOL], bump = credit_pool.bump)]
    pub credit_pool: Account<'info, CreditPool>,
    #[account(mut, seeds = [SEED_CREDIT_VAULT], bump)]
    pub credit_vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = supplier,
        space = LenderPosition::SIZE,
        seeds = [SEED_LENDER, supplier.key().as_ref()],
        bump
    )]
    pub lender_position: Account<'info, LenderPosition>,
    #[account(mut)]
    pub supplier: Signer<'info>,
    #[account(mut, token::mint = credit_vault.mint, token::authority = supplier)]
    pub supplier_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn withdraw_liquidity_handler(ctx: Context<WithdrawLiquidity>, amount: u64) -> Result<()> {
    let pos = &mut ctx.accounts.lender_position;
    require!(amount > 0 && amount <= pos.supplied, RelicPayError::InvalidAmount);
    let pool = &mut ctx.accounts.credit_pool;
    require!(
        amount <= pool.available_liquidity,
        RelicPayError::InsufficientLiquidity
    );
    pos.supplied -= amount;
    pool.available_liquidity -= amount;
    let bump = pool.bump;
    pay_from_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.credit_vault,
        ctx.accounts.supplier_usdc.to_account_info(),
        ctx.accounts.credit_pool.to_account_info(),
        bump,
        amount,
    )
}

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    #[account(mut, seeds = [SEED_CREDIT_POOL], bump = credit_pool.bump)]
    pub credit_pool: Account<'info, CreditPool>,
    #[account(mut, seeds = [SEED_CREDIT_VAULT], bump)]
    pub credit_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [SEED_LENDER, supplier.key().as_ref()],
        bump = lender_position.bump,
        has_one = supplier
    )]
    pub lender_position: Account<'info, LenderPosition>,
    pub supplier: Signer<'info>,
    #[account(mut, token::mint = credit_vault.mint, token::authority = supplier)]
    pub supplier_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ───────────────────────────── collateral ─────────────────────────────

/// Deposit or top up collateral for `owner`. Anyone may top up someone else's line.
pub fn deposit_collateral_handler(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    require!(ctx.accounts.ext.credit_enabled, RelicPayError::CreditDisabled);
    require!(amount > 0, RelicPayError::InvalidAmount);
    let now = Clock::get()?.unix_timestamp;
    pull_into_vault(
        &ctx.accounts.token_program,
        ctx.accounts.payer_usdc.to_account_info(),
        &ctx.accounts.credit_vault,
        ctx.accounts.payer.to_account_info(),
        amount,
    )?;
    let line = &mut ctx.accounts.credit_line;
    if line.owner == Pubkey::default() {
        line.owner = ctx.accounts.owner.key();
        line.bump = ctx.bumps.credit_line;
    }
    accrue(line, ctx.accounts.ext.credit_rate_bps, now)?;
    line.collateral = line.collateral.checked_add(amount).ok_or(RelicPayError::MathOverflow)?;
    let pool = &mut ctx.accounts.credit_pool;
    pool.total_collateral = pool
        .total_collateral
        .checked_add(amount)
        .ok_or(RelicPayError::MathOverflow)?;
    emit!(CollateralMoved {
        owner: line.owner,
        deposit: true,
        amount,
        new_collateral: line.collateral,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(seeds = [SEED_PROTOCOL_CONFIG_EXT], bump = ext.bump)]
    pub ext: Account<'info, ProtocolConfigExt>,
    #[account(mut, seeds = [SEED_CREDIT_POOL], bump = credit_pool.bump)]
    pub credit_pool: Account<'info, CreditPool>,
    #[account(mut, seeds = [SEED_CREDIT_VAULT], bump)]
    pub credit_vault: Account<'info, TokenAccount>,
    /// CHECK: the line's owner; only used as a PDA seed and recorded on first deposit.
    pub owner: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = CreditLine::SIZE,
        seeds = [SEED_CREDIT_LINE, owner.key().as_ref()],
        bump
    )]
    pub credit_line: Account<'info, CreditLine>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, token::mint = credit_vault.mint, token::authority = payer)]
    pub payer_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn withdraw_collateral_handler(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let line = &mut ctx.accounts.credit_line;
    accrue(line, ctx.accounts.ext.credit_rate_bps, now)?;
    require!(amount > 0 && amount <= line.collateral, RelicPayError::InvalidAmount);
    let remaining = line.collateral - amount;
    require!(
        within(debt(line)?, remaining, MAX_LTV_BPS),
        RelicPayError::LtvExceeded
    );
    line.collateral = remaining;
    let pool = &mut ctx.accounts.credit_pool;
    pool.total_collateral -= amount;
    let bump = pool.bump;
    emit!(CollateralMoved {
        owner: line.owner,
        deposit: false,
        amount,
        new_collateral: remaining,
    });
    pay_from_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.credit_vault,
        ctx.accounts.owner_usdc.to_account_info(),
        ctx.accounts.credit_pool.to_account_info(),
        bump,
        amount,
    )
}

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(seeds = [SEED_PROTOCOL_CONFIG_EXT], bump = ext.bump)]
    pub ext: Account<'info, ProtocolConfigExt>,
    #[account(mut, seeds = [SEED_CREDIT_POOL], bump = credit_pool.bump)]
    pub credit_pool: Account<'info, CreditPool>,
    #[account(mut, seeds = [SEED_CREDIT_VAULT], bump)]
    pub credit_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [SEED_CREDIT_LINE, owner.key().as_ref()],
        bump = credit_line.bump,
        has_one = owner
    )]
    pub credit_line: Account<'info, CreditLine>,
    pub owner: Signer<'info>,
    #[account(mut, token::mint = credit_vault.mint, token::authority = owner)]
    pub owner_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ───────────────────────────── draw / repay / liquidate ─────────────────────────────

/// Draw on your own line, paid straight to the payee's USDC account.
pub fn draw_handler(ctx: Context<DrawCredit>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.payee_usdc.key() != ctx.accounts.credit_vault.key(),
        RelicPayError::InvalidPayee
    );
    let new_debt = book_draw(
        &mut ctx.accounts.credit_line,
        &mut ctx.accounts.credit_pool,
        &ctx.accounts.ext,
        amount,
        now,
    )?;
    let bump = ctx.accounts.credit_pool.bump;
    pay_from_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.credit_vault,
        ctx.accounts.payee_usdc.to_account_info(),
        ctx.accounts.credit_pool.to_account_info(),
        bump,
        amount,
    )?;
    emit!(CreditDrawn {
        owner: ctx.accounts.owner.key(),
        payee: ctx.accounts.payee_usdc.owner,
        via_agent: false,
        amount,
        new_debt,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct DrawCredit<'info> {
    #[account(seeds = [SEED_PROTOCOL_CONFIG_EXT], bump = ext.bump)]
    pub ext: Account<'info, ProtocolConfigExt>,
    #[account(mut, seeds = [SEED_CREDIT_POOL], bump = credit_pool.bump)]
    pub credit_pool: Account<'info, CreditPool>,
    #[account(mut, seeds = [SEED_CREDIT_VAULT], bump)]
    pub credit_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [SEED_CREDIT_LINE, owner.key().as_ref()],
        bump = credit_line.bump,
        has_one = owner
    )]
    pub credit_line: Account<'info, CreditLine>,
    pub owner: Signer<'info>,
    #[account(mut, token::mint = credit_vault.mint)]
    pub payee_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Repay `owner`'s line. Interest first, then principal. Anyone may repay.
pub fn repay_handler(ctx: Context<RepayCredit>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let line = &mut ctx.accounts.credit_line;
    accrue(line, ctx.accounts.ext.credit_rate_bps, now)?;
    let owed = debt(line)?;
    require!(owed > 0, RelicPayError::NothingToRepay);
    require!(amount > 0, RelicPayError::InvalidAmount);
    let paid = amount.min(owed);
    let interest_paid = paid.min(line.interest);
    let principal_paid = paid - interest_paid;
    line.interest -= interest_paid;
    line.principal -= principal_paid;
    line.total_repaid = line.total_repaid.checked_add(paid).ok_or(RelicPayError::MathOverflow)?;
    let points = award_trust(line, principal_paid, now);

    let pool = &mut ctx.accounts.credit_pool;
    pool.protocol_revenue = pool
        .protocol_revenue
        .checked_add(interest_paid)
        .ok_or(RelicPayError::MathOverflow)?;
    pool.total_principal_out -= principal_paid;
    pool.available_liquidity = pool
        .available_liquidity
        .checked_add(principal_paid)
        .ok_or(RelicPayError::MathOverflow)?;

    pull_into_vault(
        &ctx.accounts.token_program,
        ctx.accounts.payer_usdc.to_account_info(),
        &ctx.accounts.credit_vault,
        ctx.accounts.payer.to_account_info(),
        paid,
    )?;
    emit!(CreditRepaid {
        owner: ctx.accounts.credit_line.owner,
        payer: ctx.accounts.payer.key(),
        interest_paid,
        principal_paid,
        trust_points: points,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RepayCredit<'info> {
    #[account(seeds = [SEED_PROTOCOL_CONFIG_EXT], bump = ext.bump)]
    pub ext: Account<'info, ProtocolConfigExt>,
    #[account(mut, seeds = [SEED_CREDIT_POOL], bump = credit_pool.bump)]
    pub credit_pool: Account<'info, CreditPool>,
    #[account(mut, seeds = [SEED_CREDIT_VAULT], bump)]
    pub credit_vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [SEED_CREDIT_LINE, credit_line.owner.as_ref()], bump = credit_line.bump)]
    pub credit_line: Account<'info, CreditLine>,
    pub payer: Signer<'info>,
    #[account(mut, token::mint = credit_vault.mint, token::authority = payer)]
    pub payer_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Permissionless. Above 90% LTV the line is closed out against its collateral.
pub fn liquidate_handler(ctx: Context<LiquidateCredit>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let line = &mut ctx.accounts.credit_line;
    accrue(line, ctx.accounts.ext.credit_rate_bps, now)?;
    let owed = debt(line)?;
    require!(
        owed > 0 && !within(owed, line.collateral, LIQUIDATION_LTV_BPS),
        RelicPayError::NotLiquidatable
    );
    let penalty = ((owed as u128) * LIQUIDATION_PENALTY_BPS / BPS_DIVISOR) as u64;
    let seized = owed.saturating_add(penalty).min(line.collateral);

    // Waterfall: interest, then principal, then penalty.
    let mut left = seized;
    let to_interest = left.min(line.interest);
    left -= to_interest;
    let to_principal = left.min(line.principal);
    left -= to_principal;
    let penalty_paid = left;
    let reward = penalty_paid / 2;
    let lost = line.principal - to_principal;

    let pool = &mut ctx.accounts.credit_pool;
    pool.protocol_revenue = pool
        .protocol_revenue
        .checked_add(to_interest + (penalty_paid - reward))
        .ok_or(RelicPayError::MathOverflow)?;
    pool.available_liquidity = pool
        .available_liquidity
        .checked_add(to_principal)
        .ok_or(RelicPayError::MathOverflow)?;
    pool.total_principal_out -= line.principal;
    pool.bad_debt = pool.bad_debt.checked_add(lost).ok_or(RelicPayError::MathOverflow)?;
    pool.total_collateral -= seized;

    line.collateral -= seized;
    line.principal = 0;
    line.interest = 0;
    line.liquidations = line.liquidations.saturating_add(1);
    line.trust_score = 0;
    line.epoch_points = 0;
    let owner = line.owner;

    let bump = pool.bump;
    if reward > 0 {
        pay_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.credit_vault,
            ctx.accounts.liquidator_usdc.to_account_info(),
            ctx.accounts.credit_pool.to_account_info(),
            bump,
            reward,
        )?;
    }
    emit!(CreditLiquidated {
        owner,
        liquidator: ctx.accounts.liquidator.key(),
        debt: owed,
        seized,
        liquidator_reward: reward,
        bad_debt: lost,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct LiquidateCredit<'info> {
    #[account(seeds = [SEED_PROTOCOL_CONFIG_EXT], bump = ext.bump)]
    pub ext: Account<'info, ProtocolConfigExt>,
    #[account(mut, seeds = [SEED_CREDIT_POOL], bump = credit_pool.bump)]
    pub credit_pool: Account<'info, CreditPool>,
    #[account(mut, seeds = [SEED_CREDIT_VAULT], bump)]
    pub credit_vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [SEED_CREDIT_LINE, credit_line.owner.as_ref()], bump = credit_line.bump)]
    pub credit_line: Account<'info, CreditLine>,
    pub liquidator: Signer<'info>,
    #[account(mut, token::mint = credit_vault.mint, token::authority = liquidator)]
    pub liquidator_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line() -> CreditLine {
        CreditLine {
            owner: Pubkey::default(),
            collateral: 1_000_000_000,
            principal: 0,
            interest: 0,
            total_repaid: 0,
            last_accrual: 1,
            last_draw_at: 0,
            trust_score: 0,
            epoch_start: 0,
            epoch_points: 0,
            liquidations: 0,
            agent_identity: Pubkey::default(),
            bump: 0,
        }
    }

    #[test]
    fn ltv_bounds_match_base() {
        assert!(within(800_000_000, 1_000_000_000, MAX_LTV_BPS));
        assert!(!within(800_000_001, 1_000_000_000, MAX_LTV_BPS));
        assert!(within(900_000_000, 1_000_000_000, LIQUIDATION_LTV_BPS));
        assert!(!within(900_000_001, 1_000_000_000, LIQUIDATION_LTV_BPS));
    }

    #[test]
    fn interest_is_simple_apr() {
        let mut l = line();
        l.principal = 500_000_000;
        accrue(&mut l, 800, 1 + 31_536_000).unwrap();
        assert_eq!(l.interest, 40_000_000);
    }

    #[test]
    fn trust_needs_aged_debt_and_caps_per_epoch() {
        let mut l = line();
        l.last_draw_at = 100;
        assert_eq!(award_trust(&mut l, 50_000_000, 100), 0); // same moment as the draw
        let day = 100 + TRUST_MIN_DEBT_AGE;
        assert_eq!(award_trust(&mut l, 50_000_000, day), 50);
        assert_eq!(award_trust(&mut l, 500_000_000, day), 50); // capped at 100 per epoch
        assert_eq!(l.trust_score, 100);
        assert_eq!(award_trust(&mut l, 10_000_000, day + TRUST_EPOCH_SECONDS), 10);
    }
}
