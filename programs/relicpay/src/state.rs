use anchor_lang::prelude::*;

/// Lifecycle of a BNPL agreement.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum AgreementState {
    Active,    // payments in progress
    Completed, // all installments paid; awaiting merchant_withdraw
    Defaulted, // buyer missed payment + grace period; merchant got escrow
    Cancelled, // buyer exited early; merchant got 10% fee
}

#[account]
pub struct BnplAgreement {
    pub buyer: Pubkey,              // buyer wallet
    pub merchant: Pubkey,           // merchant wallet
    pub usdc_mint: Pubkey,          // USDC mint address
    pub total_price: u64,           // full price in USDC lamports
    pub installment_count: u8,      // total number of payments
    pub installment_amount: u64,    // total_price / installment_count (remainder in final)
    pub interval_seconds: i64,      // seconds between payments
    pub paid_installments: u8,      // how many paid so far
    pub start_time: i64,            // unix timestamp of agreement creation
    pub last_yield_update: i64,     // last yield accrual timestamp (prevents double-count)
    pub state: AgreementState,      // Active | Completed | Defaulted | Cancelled
    pub yield_accrued: u64,         // total yield earned by buyer (USDC lamports)
    pub escrow_deposited: u64,      // USDC currently held in escrow PDA
    pub yield_rate_bps_annual: u16, // 300 = 3% APY
    pub product_id: String,         // merchant item reference (PDA seed, ≤64)
    pub merchant_name: String,      // display name, e.g. "IBG Collection" (≤64)
    pub bump: u8,                   // PDA bump seed
    // ── v2 fields ──
    pub merchant_withdrawn: bool, // blocks double merchant_withdraw
    pub version: u8,              // schema version (2)
    // ── v2.1 fields (DEVELOPMENT_PLAN.md v2.1 item 4) ──
    pub yield_source: u8, // 0 = Simulated (on-chain interest math), 1 = KaminoLend (real CPI yield)
}

impl BnplAgreement {
    pub const VERSION: u8 = 2;
    pub const SIZE: usize = 8      // discriminator
        + 32 + 32 + 32             // pubkeys
        + 8 + 1 + 8 + 8            // price fields
        + 1 + 8 + 8 + 1            // paid, start_time, last_yield_update, state
        + 8 + 8 + 2                // yield fields
        + 4 + 64                   // product_id
        + 4 + 64                   // merchant_name
        + 1                        // bump
        + 1 + 1                    // merchant_withdrawn, version
        + 1                        // yield_source
        + 29;                      // reserved for future fields

    pub const YIELD_SOURCE_SIMULATED: u8 = 0;
    pub const YIELD_SOURCE_KAMINO_LEND: u8 = 1;
}

#[account]
pub struct StakePool {
    pub authority: Pubkey,          // protocol admin
    pub usdc_mint: Pubkey,          // USDC mint
    pub total_staked: u64,          // sum of all user stakes
    pub yield_rate_bps_annual: u16, // 300 = 3% APY (governance-tunable)
    pub bump: u8,                   // PDA bump
}

impl StakePool {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 2 + 1 + 32; // +32 reserved
}

#[account]
pub struct UserStake {
    pub owner: Pubkey,        // staker wallet
    pub staked_amount: u64,   // current USDC in pool
    pub yield_accrued: u64,   // pending yield (paid on full unstake)
    pub last_update: i64,     // timestamp of last stake/unstake
    pub tier: u8,             // discount tier 0–4 (read by browser extension)
    pub bump: u8,             // PDA bump
}

impl UserStake {
    pub const SIZE: usize = 8 + 32 + 8 + 8 + 8 + 1 + 1 + 16; // +16 reserved
}

/// v2.1: protocol-wide risk controls, laid down ahead of real Kamino CPI
/// yield (see DEVELOPMENT_PLAN.md v2.1 item 5). A singleton PDA
/// (seeds = ["protocol_config"]) governing an emergency pause switch and
/// deposit/TVL caps.
///
/// Wired into `create_agreement` and `pay_installment` as a constant-seed PDA
/// account (`UncheckedAccount`, no client-side change needed — Anchor's TS
/// client auto-derives constant-seed PDAs even when the caller's
/// `.accounts()` never mentions them, which is what keeps the frozen v1
/// characterization suite untouched). `create_agreement` enforces `paused`
/// and `max_agreement_deposit` (against `total_price`, the agreement's
/// maximum ever exposure); `pay_installment` enforces `paused` on every
/// subsequent payment too, so an emergency pause halts USDC moving into
/// escrow on existing agreements, not just new agreement creation. An
/// uninitialized (system-owned) PDA is treated as "no risk controls
/// configured."
///
/// `tvl_cap` / `current_tvl` are now enforced end-to-end: every path that
/// moves money in or out of escrow (create_agreement, pay_installment,
/// merchant_withdraw, cancel_agreement, trigger_default) calls
/// `apply_tvl_increase`/`apply_tvl_decrease` (protocol_config.rs) to keep
/// `current_tvl` accurate and reject deposits that would breach `tvl_cap`.
/// Not yet wired into `stake_usdc` (stake pool deposits are a separate token
/// flow from BNPL escrow TVL). Real Kamino CPI (v2.1 items 1-3) will need to
/// touch these same call sites again when escrow moves from raw USDC to
/// kTokens, but the bookkeeping itself no longer waits on that work.
#[account]
pub struct ProtocolConfig {
    pub authority: Pubkey,          // governance wallet
    pub paused: bool,               // emergency stop — blocks new agreement creation
    pub max_agreement_deposit: u64, // per-agreement escrow cap (vs total_price), 0 = unlimited
    pub tvl_cap: u64,               // protocol-wide escrow cap, 0 = unlimited
    pub current_tvl: u64,           // sum of USDC escrowed protocol-wide
    pub bump: u8,                   // PDA bump
}

impl ProtocolConfig {
    pub const SIZE: usize = 8 + 32 + 1 + 8 + 8 + 8 + 1 + 32; // +32 reserved
}

/// v2.1: landing pad for real Kamino Lend CPI (DEVELOPMENT_PLAN.md v2.1
/// items 1-3). See `docs/design/KAMINO_CPI_INTEGRATION.md` for the full
/// technical design (verified against Kamino's actual source, fetched
/// 2026-07-14) — account layout for `deposit_reserve_liquidity` /
/// `redeem_reserve_collateral`, the anchor-lang version-mismatch risk
/// (0.32.1 here vs 0.29.0 in klend, meaning we can't use their typed
/// `Program<'info, _>` wrappers and must build the CPI instruction
/// manually), and why a cloned-devnet-market localnet test can't validate
/// a real deposit (oracle staleness).
///
/// A singleton governance PDA (seeds = ["kamino_config"]), mirroring the
/// exact `ProtocolConfig` pattern already used in this codebase: shipped
/// ahead of the CPI code that will consume it, `enabled` defaults to
/// `false` so an uninitialized or disabled config is a pure no-op and
/// every code path today (raw-USDC escrow, simulated yield) is completely
/// unaffected. No instruction reads this account yet — it exists so the
/// next session's CPI call has a concrete place to source its target
/// reserve/market accounts from, set once via governance instead of
/// hardcoded per-instruction.
#[account]
pub struct KaminoConfig {
    pub authority: Pubkey,                 // governance wallet
    pub enabled: bool,                     // master switch — false until CPI code lands
    pub kamino_program: Pubkey,            // klend program id (mainnet or devnet)
    pub lending_market: Pubkey,            // the Kamino market holding the USDC reserve
    pub lending_market_authority: Pubkey,  // PDA: seeds = ["lma", lending_market]
    pub reserve: Pubkey,                   // the specific USDC reserve
    pub reserve_liquidity_supply: Pubkey,  // Kamino's USDC vault for that reserve
    pub reserve_collateral_mint: Pubkey,   // the kToken mint for that reserve
    pub bump: u8,                          // PDA bump
}

impl KaminoConfig {
    pub const SIZE: usize = 8 + 32 + 1 + 32 + 32 + 32 + 32 + 32 + 32 + 1 + 32; // +32 reserved
}
