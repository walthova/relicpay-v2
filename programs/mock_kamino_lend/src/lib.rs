//! Mock Kamino Lend — a local stand-in for `Kamino-Finance/klend`'s
//! `deposit_reserve_liquidity` / `redeem_reserve_collateral` instructions.
//!
//! WHY THIS EXISTS: `docs/design/KAMINO_CPI_INTEGRATION.md` identified that
//! a real Kamino deposit cannot be integration-tested on localnet — cloning
//! Kamino's devnet market via `--clone` freezes their oracle account, which
//! goes stale within seconds, so `refresh_reserve` rejects every deposit.
//! The only ways to test the *real* path are live devnet transactions
//! (needs a funded wallet + Walter approval) or a mock program that mimics
//! Kamino's account/instruction shape without real oracle logic. This is
//! that mock — it proves Relic Pay's CPI-calling code and fallback path are
//! structurally correct. It does NOT prove Kamino's actual deposit math or
//! oracle behavior, and it is never deployed anywhere but localnet test
//! validators.
//!
//! Account order and instruction names deliberately mirror the real
//! `klend` interface documented in KAMINO_CPI_INTEGRATION.md (minus
//! oracle/obligation accounts this mock doesn't need), so the manual
//! CPI-instruction-building code in `relicpay`'s `kamino_cpi.rs` — the same
//! technique real Kamino integration will require, per the anchor-lang
//! 0.32.1 vs 0.29.0 version mismatch noted in the design doc — exercises
//! the identical discriminator + account-ordering mechanics it will need
//! against the real program later.
//!
//! Exchange rate is a fixed 1:1 (1 liquidity token in = 1 collateral token
//! out) — real Kamino's rate floats with accrued interest. Irrelevant to
//! what this mock proves (CPI plumbing + fallback), not modeled.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, Token, TokenAccount, Transfer};

declare_id!("7EJPUsw32Bkr5T1udjW6sZer4CTFZXSxmoD75RghhEr8");

#[program]
pub mod mock_kamino_lend {
    use super::*;

    /// Registers a reserve for a given liquidity mint. Mirrors real Kamino's
    /// reserve-per-market-per-asset model at a toy scale: one reserve per
    /// liquidity mint, PDA-derived so tests get a deterministic address.
    pub fn initialize_reserve(ctx: Context<InitializeReserve>, paused: bool) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        reserve.authority = ctx.accounts.authority.key();
        reserve.liquidity_mint = ctx.accounts.liquidity_mint.key();
        reserve.collateral_mint = ctx.accounts.collateral_mint.key();
        reserve.liquidity_supply = ctx.accounts.reserve_liquidity_supply.key();
        reserve.paused = paused;
        reserve.bump = ctx.bumps.reserve;
        Ok(())
    }

    /// Toggle the reserve's paused flag — the lever the fallback test
    /// suite uses to force a deposit failure and prove Relic Pay catches it
    /// instead of aborting the whole transaction.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.reserve.paused = paused;
        Ok(())
    }

    /// USDC in, kTokens out (1:1). Account order matches what
    /// `relicpay::instructions::kamino_cpi` builds manually:
    /// owner, lending_market, lending_market_authority, reserve,
    /// reserve_liquidity_supply, reserve_collateral_mint,
    /// user_source_liquidity, user_destination_collateral, token_program.
    pub fn deposit_reserve_liquidity(
        ctx: Context<DepositReserveLiquidity>,
        liquidity_amount: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.reserve.paused, MockKaminoError::ReservePaused);
        require!(liquidity_amount > 0, MockKaminoError::InvalidAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_source_liquidity.to_account_info(),
                    to: ctx.accounts.reserve_liquidity_supply.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            liquidity_amount,
        )?;

        let liquidity_mint_key = ctx.accounts.reserve.liquidity_mint;
        let seeds = &[
            b"reserve".as_ref(),
            liquidity_mint_key.as_ref(),
            &[ctx.accounts.reserve.bump],
        ];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.reserve_collateral_mint.to_account_info(),
                    to: ctx.accounts.user_destination_collateral.to_account_info(),
                    authority: ctx.accounts.reserve.to_account_info(),
                },
                &[&seeds[..]],
            ),
            liquidity_amount,
        )?;

        Ok(())
    }

    /// kTokens in, USDC out (1:1) — the redemption side of the deposit
    /// above.
    pub fn redeem_reserve_collateral(
        ctx: Context<RedeemReserveCollateral>,
        collateral_amount: u64,
    ) -> Result<()> {
        require!(collateral_amount > 0, MockKaminoError::InvalidAmount);

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.reserve_collateral_mint.to_account_info(),
                    from: ctx.accounts.user_source_collateral.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            collateral_amount,
        )?;

        let liquidity_mint_key = ctx.accounts.reserve.liquidity_mint;
        let seeds = &[
            b"reserve".as_ref(),
            liquidity_mint_key.as_ref(),
            &[ctx.accounts.reserve.bump],
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reserve_liquidity_supply.to_account_info(),
                    to: ctx.accounts.user_destination_liquidity.to_account_info(),
                    authority: ctx.accounts.reserve.to_account_info(),
                },
                &[&seeds[..]],
            ),
            collateral_amount,
        )?;

        Ok(())
    }
}

#[account]
pub struct Reserve {
    pub authority: Pubkey,
    pub liquidity_mint: Pubkey,
    pub collateral_mint: Pubkey,
    pub liquidity_supply: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

impl Reserve {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 32 + 1 + 1 + 16;
}

#[error_code]
pub enum MockKaminoError {
    #[msg("Mock reserve deposits are paused — simulates a Kamino-side deposit failure")]
    ReservePaused,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Only the reserve authority may do this")]
    Unauthorized,
}

#[derive(Accounts)]
pub struct InitializeReserve<'info> {
    #[account(
        init,
        payer = authority,
        space = Reserve::SIZE,
        seeds = [b"reserve", liquidity_mint.key().as_ref()],
        bump
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub liquidity_mint: Account<'info, anchor_spl::token::Mint>,

    /// CHECK: mint authority ownership isn't enforced by this mock — real
    /// Kamino's reserve setup is far more involved (oracle config, interest
    /// curve, etc.) and irrelevant to what this mock proves.
    pub collateral_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(
        constraint = reserve_liquidity_supply.mint == liquidity_mint.key()
    )]
    pub reserve_liquidity_supply: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [b"reserve", reserve.liquidity_mint.as_ref()],
        bump = reserve.bump,
        constraint = reserve.authority == authority.key() @ MockKaminoError::Unauthorized
    )]
    pub reserve: Account<'info, Reserve>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositReserveLiquidity<'info> {
    /// The depositing authority — in Relic Pay's real usage, the
    /// `BnplAgreement` PDA, which signs via `invoke_signed` from
    /// `kamino_cpi.rs` rather than a real wallet.
    pub owner: Signer<'info>,

    /// CHECK: informational only in this mock — real Kamino reads market
    /// config from this account; not modeled here.
    pub lending_market: UncheckedAccount<'info>,

    /// CHECK: informational only in this mock, see above.
    pub lending_market_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"reserve", reserve.liquidity_mint.as_ref()],
        bump = reserve.bump,
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(mut, address = reserve.liquidity_supply)]
    pub reserve_liquidity_supply: Account<'info, TokenAccount>,

    #[account(mut, address = reserve.collateral_mint)]
    pub reserve_collateral_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(mut)]
    pub user_source_liquidity: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_destination_collateral: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RedeemReserveCollateral<'info> {
    pub owner: Signer<'info>,

    /// CHECK: informational only in this mock, see DepositReserveLiquidity.
    pub lending_market: UncheckedAccount<'info>,

    /// CHECK: informational only in this mock, see DepositReserveLiquidity.
    pub lending_market_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"reserve", reserve.liquidity_mint.as_ref()],
        bump = reserve.bump,
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(mut, address = reserve.liquidity_supply)]
    pub reserve_liquidity_supply: Account<'info, TokenAccount>,

    #[account(mut, address = reserve.collateral_mint)]
    pub reserve_collateral_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(mut)]
    pub user_source_collateral: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_destination_liquidity: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
