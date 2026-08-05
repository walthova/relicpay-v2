//! Manual CPI instruction builders for Kamino Lend's
//! `deposit_reserve_liquidity` / `redeem_reserve_collateral`.
//!
//! WHY MANUAL (not a typed CPI call via a `cpi` feature dependency): per
//! `docs/design/KAMINO_CPI_INTEGRATION.md`, real Kamino (`klend`) is built
//! against `anchor-lang 0.29.0`; this program is on `0.32.1`. Anchor's
//! generated `Program<'info, T>` / `AccountLoader<'info, T>` wrappers are
//! tied to the anchor-lang version that generated them, so we cannot use
//! Kamino's typed `kamino_lending::cpi::deposit_reserve_liquidity(...)`
//! helper directly — it needs their `Program<'info, KaminoLending>` as
//! input, which we can't cheaply construct across the version boundary.
//! The documented, safe pattern other Kamino integrators use instead: build
//! the CPI `Instruction` by hand (8-byte Anchor sighash discriminator +
//! Borsh-serialized args), pass the target accounts as plain
//! `AccountInfo`s, and `invoke_signed` it directly.
//!
//! This module is deliberately CPI-target-agnostic: it takes whichever
//! program id the caller passes as `kamino_program` (real Kamino on devnet/
//! mainnet, or `mock_kamino_lend` locally) and builds the same instruction
//! shape against it. `instructions/kamino_probe.rs` is what exercises this
//! today, against the local mock — see that file and
//! `docs/design/KAMINO_CPI_INTEGRATION.md` for what's proven vs. still
//! open (real devnet deposit, real oracle behavior).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::program_error::ProgramError;
use sha2::{Digest, Sha256};

/// Anchor's discriminator scheme: first 8 bytes of SHA256("global:<name>").
/// Computing it ourselves (rather than depending on Kamino's crate for a
/// generated constant) keeps this program free of a BUSL-1.1-licensed git
/// dependency — the licensing question flagged for Walter in the design
/// doc stays unresolved-but-avoided, not silently decided here. We reach
/// for the `sha2` crate directly (not `anchor_lang::solana_program::hash`)
/// because anchor-lang 0.32's split-crate `solana_program` shim doesn't
/// re-export a hash module.
fn sighash(name: &str) -> [u8; 8] {
    let preimage = format!("global:{name}");
    let digest = Sha256::digest(preimage.as_bytes());
    let mut out = [0u8; 8];
    out.copy_from_slice(&digest[..8]);
    out
}

/// Account set for `deposit_reserve_liquidity`, matching the order
/// `mock_kamino_lend::DepositReserveLiquidity` expects (and the order real
/// Kamino's account list follows per KAMINO_CPI_INTEGRATION.md, modulo the
/// oracle/token-2022-interface accounts this mock doesn't model).
pub struct KaminoDepositAccounts<'a, 'info> {
    pub kamino_program: &'a AccountInfo<'info>,
    pub owner: &'a AccountInfo<'info>,
    pub lending_market: &'a AccountInfo<'info>,
    pub lending_market_authority: &'a AccountInfo<'info>,
    pub reserve: &'a AccountInfo<'info>,
    pub reserve_liquidity_supply: &'a AccountInfo<'info>,
    pub reserve_collateral_mint: &'a AccountInfo<'info>,
    pub user_source_liquidity: &'a AccountInfo<'info>,
    pub user_destination_collateral: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
}

/// Same account set, roles swapped for redemption (kTokens in, USDC out).
pub struct KaminoRedeemAccounts<'a, 'info> {
    pub kamino_program: &'a AccountInfo<'info>,
    pub owner: &'a AccountInfo<'info>,
    pub lending_market: &'a AccountInfo<'info>,
    pub lending_market_authority: &'a AccountInfo<'info>,
    pub reserve: &'a AccountInfo<'info>,
    pub reserve_liquidity_supply: &'a AccountInfo<'info>,
    pub reserve_collateral_mint: &'a AccountInfo<'info>,
    pub user_source_collateral: &'a AccountInfo<'info>,
    pub user_destination_liquidity: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
}

/// Builds and invokes the deposit CPI, signed by `signer_seeds` (the
/// `BnplAgreement` PDA's seeds — the escrow's token account authority).
///
/// RUNTIME CONSTRAINT (corrected 2026-08-05 — an earlier draft of this doc
/// was wrong here): the `Err` this function can return only covers failures
/// detected *before* `invoke_signed` runs (bad serialization, etc.). Once
/// `invoke_signed` actually invokes the target program and that program
/// returns an error, the whole transaction is done — there is no try/catch
/// across a CPI boundary on Solana. A caller cannot receive that `Err` back
/// and decide to fall back to holding raw USDC instead; the transaction has
/// already failed. Confirmed empirically: `kamino_probe.rs`'s original
/// "catch the Err, emit a Fallback event, return Ok" pattern compiled fine
/// but the mock's `ReservePaused` error still surfaced as the top-level
/// transaction failure in tests. See `kamino_probe.rs` and
/// `docs/design/KAMINO_CPI_INTEGRATION.md` for what "never block a purchase
/// on a DeFi dependency" (DEVELOPMENT_PLAN.md v2.1 item 3) actually
/// requires: predicting failures via a preflight state read before calling
/// this function, or moving the CPI off the critical path entirely.
pub fn try_kamino_deposit(
    accs: &KaminoDepositAccounts,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut data = sighash("deposit_reserve_liquidity").to_vec();
    amount
        .serialize(&mut data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let ix = Instruction {
        program_id: *accs.kamino_program.key,
        accounts: vec![
            AccountMeta::new_readonly(*accs.owner.key, true),
            AccountMeta::new_readonly(*accs.lending_market.key, false),
            AccountMeta::new_readonly(*accs.lending_market_authority.key, false),
            AccountMeta::new(*accs.reserve.key, false),
            AccountMeta::new(*accs.reserve_liquidity_supply.key, false),
            AccountMeta::new(*accs.reserve_collateral_mint.key, false),
            AccountMeta::new(*accs.user_source_liquidity.key, false),
            AccountMeta::new(*accs.user_destination_collateral.key, false),
            AccountMeta::new_readonly(*accs.token_program.key, false),
        ],
        data,
    };

    let account_infos = [
        accs.owner.clone(),
        accs.lending_market.clone(),
        accs.lending_market_authority.clone(),
        accs.reserve.clone(),
        accs.reserve_liquidity_supply.clone(),
        accs.reserve_collateral_mint.clone(),
        accs.user_source_liquidity.clone(),
        accs.user_destination_collateral.clone(),
        accs.token_program.clone(),
        accs.kamino_program.clone(),
    ];

    invoke_signed(&ix, &account_infos, signer_seeds)?;
    Ok(())
}

/// Redemption counterpart of `try_kamino_deposit`. Same runtime constraint:
/// an `Err` from an actual `invoke_signed` failure cannot be caught by the
/// caller to recover the transaction — see `try_kamino_deposit`'s doc.
pub fn try_kamino_redeem(
    accs: &KaminoRedeemAccounts,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut data = sighash("redeem_reserve_collateral").to_vec();
    amount
        .serialize(&mut data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let ix = Instruction {
        program_id: *accs.kamino_program.key,
        accounts: vec![
            AccountMeta::new_readonly(*accs.owner.key, true),
            AccountMeta::new_readonly(*accs.lending_market.key, false),
            AccountMeta::new_readonly(*accs.lending_market_authority.key, false),
            AccountMeta::new(*accs.reserve.key, false),
            AccountMeta::new(*accs.reserve_liquidity_supply.key, false),
            AccountMeta::new(*accs.reserve_collateral_mint.key, false),
            AccountMeta::new(*accs.user_source_collateral.key, false),
            AccountMeta::new(*accs.user_destination_liquidity.key, false),
            AccountMeta::new_readonly(*accs.token_program.key, false),
        ],
        data,
    };

    let account_infos = [
        accs.owner.clone(),
        accs.lending_market.clone(),
        accs.lending_market_authority.clone(),
        accs.reserve.clone(),
        accs.reserve_liquidity_supply.clone(),
        accs.reserve_collateral_mint.clone(),
        accs.user_source_collateral.clone(),
        accs.user_destination_liquidity.clone(),
        accs.token_program.clone(),
        accs.kamino_program.clone(),
    ];

    invoke_signed(&ix, &account_infos, signer_seeds)?;
    Ok(())
}
