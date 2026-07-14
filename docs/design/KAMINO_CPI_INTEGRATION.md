# Kamino Lend CPI Integration — Technical Design

*Written 2026-07-14. Satisfies the "Kamino CPI design" deliverable in
`docs/funding/SOLANA_FOUNDATION_GRANT.md` (due 2026-07-29). Covers
DEVELOPMENT_PLAN.md v2.1 items 1-3. Everything below is based on reading the
actual Kamino source (`github.com/Kamino-Finance/klend`, fetched today) —
not guessed from memory.*

## Why this doc exists before the code does

Every progress note from 2026-07-06 through 2026-07-13 lists "real Kamino
CPI" as the next item and defers it — each time citing the same unresolved
question: *which SDK, and how do we test it without devnet access or an
unaudited dependency decision.* That question needed research, not another
day of adjacent groundwork (ProtocolConfig, TVL caps, yield_source — all
already shipped). This doc answers it with verified facts so the next build
session can write CPI code against real account layouts instead of guessing.

## What Kamino actually exposes

Program: `Kamino-Finance/klend`, mainnet program ID
`KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` (a second `SLendK7...` ID is
also declared in their `lib.rs` — needs disambiguation before mainnet, not
blocking for design). **Not published to crates.io** (`publish = false` in
their `Cargo.toml`) — the only way to depend on it is a git dependency
against their repo, using the `cpi` feature they already expose
(`cpi = ["no-entrypoint"]` in `programs/klend/Cargo.toml`), the standard
Anchor pattern for one program calling another.

For a simple USDC supply position (no borrowing, no obligation/collateral
management), the two relevant instructions are `deposit_reserve_liquidity`
and `redeem_reserve_collateral` — confirmed by reading
`programs/klend/src/handlers/handler_deposit_reserve_liquidity.rs` and
`handler_redeem_reserve_collateral.rs` directly. Both call
`refresh_reserve` internally, so no separate refresh instruction is needed
in the same transaction (this was an open question — resolved).

### `deposit_reserve_liquidity` accounts (verified from source)

```
owner                      Signer                  — escrow PDA (agreement authority)
reserve                    AccountLoader<Reserve>   — the specific USDC reserve, mut
lending_market             AccountLoader<LendingMarket>
lending_market_authority   PDA (seeds: ["lma", lending_market])
reserve_liquidity_mint     Mint                     — USDC mint, must == reserve.liquidity.mint_pubkey
reserve_liquidity_supply   TokenAccount, mut        — Kamino's USDC vault for this reserve
reserve_collateral_mint    Mint, mut                — the kToken mint for this reserve
user_source_liquidity      TokenAccount, mut        — our escrow's USDC account
user_destination_collateral TokenAccount, mut       — our escrow's kToken account (must exist first)
collateral_token_program   Token/Token2022 interface
liquidity_token_program    Token/Token2022 interface
instruction_sysvar_account Sysvar (Instructions)
```

`redeem_reserve_collateral` uses the same account set with
`user_source_collateral`/`user_destination_liquidity` swapped (kTokens in,
USDC out).

### The blocking technical risk: anchor-lang version mismatch

Our program: `anchor-lang = "0.32.1"`. Kamino's workspace:
`anchor-lang = "0.29.0"` (from their root `Cargo.toml`, verified today).
Cargo can resolve two versions of the same crate simultaneously across
independent dependency trees, so this **is not automatically fatal** — but
it means we cannot use Kamino's `Program<'info, KaminoLending>` or
`AccountLoader<'info, Reserve>` typed wrappers directly in our own
`#[derive(Accounts)]` structs (their `anchor_lang::Accounts` trait impl is
tied to their anchor-lang version, ours to ours — they are different
types even with the same name). The correct pattern: accept Kamino's
accounts as plain `AccountInfo<'info>`/`UncheckedAccount<'info>` in our
instruction, do our own manual seed/owner checks, and build the CPI
instruction manually (via `anchor_lang::solana_program::instruction::Instruction`
with the correct discriminator + Borsh-encoded args) rather than calling
their generated `kamino_lending::cpi::deposit_reserve_liquidity(...)`
helper directly — that helper needs their `Program<'info, ...>` wrapper as
input, which we can't cheaply construct across the version boundary.
This is more manual than a same-version CPI call, but is a known, safe
pattern (Marginfi, Solend integrators do the same when anchor versions
drift) — just needs the discriminator (first 8 bytes = sighash of
`global:deposit_reserve_liquidity`) and Borsh-serialized `liquidity_amount: u64`.

### License

`kamino_lending` is `BUSL-1.1` (Business Source License), not MIT/Apache.
BUSL restricts *running a competing service built from their source*, not
*calling their already-deployed program via CPI* — CPI doesn't copy or
redistribute their code, we'd just depend on their crate at compile time
for the instruction/account type definitions. This read is consistent with
how every other Kamino-integrating protocol operates, but **flagging for
Walter, not deciding it here** — worth a quick confirmation before mainnet,
not before a devnet prototype.

### The other blocking risk: oracle staleness on a local/cloned validator

`refresh_reserve` checks the reserve's price oracle (Scope or Pyth,
reserve-configured) for staleness and will reject a stale price. Cloning
Kamino's devnet market + reserve accounts into a local `solana-test-
validator` (via `--clone`) freezes their oracle account at deposit-time
data, which goes stale within seconds of validator startup — this is a
well-known problem for anyone testing Kamino locally, not specific to us.
**Consequence: a real deposit CPI cannot be integration-tested on localnet
by cloning devnet state.** The only reliable ways to test the real deposit
path are (a) live devnet transactions against Kamino's actual live devnet
market (needs a funded devnet wallet — Walter approval per this agent's
standing rules), or (b) a local mock program that mimics Kamino's
instruction interface without real oracle logic (proves our CPI-calling
code and fallback path are structurally correct; does not prove Kamino's
actual deposit math/oracle behavior). Recommend (b) first, (a) once (b) is
proven, to avoid burning devnet SOL on a broken account-passing bug.

## Fallback design (item 3)

The plan requires: *"never block a purchase on a DeFi dependency."*
Solana CPI failures are catchable in Rust — `invoke_signed` inside our own
handler returns a `Result`, so we can `match` on it and fall back to the
existing raw-USDC escrow path within the same instruction, rather than
letting a Kamino-side failure abort the whole `create_agreement` /
`pay_installment` transaction. Shape:

```
match try_kamino_deposit(&ctx, amount) {
    Ok(()) => agreement.yield_source = BnplAgreement::YIELD_SOURCE_KAMINO_LEND,
    Err(_) => {
        // raw USDC transfer, exactly today's path
        agreement.yield_source = BnplAgreement::YIELD_SOURCE_SIMULATED;
    }
}
```

This requires the Kamino-specific accounts (reserve, lending_market, etc.)
to be **optional** in the instruction's account list, since most callers
won't have them and the frozen v1 characterization suite must keep working
unmodified. A `KaminoConfig` governance PDA (shipped today, see below)
holds the target reserve/market pubkeys so the client can decide whether to
attempt the Kamino path at all, rather than trying and failing every time
Kamino integration is simply turned off.

## What ships today vs. what's next

**Shipped today (this session):** `KaminoConfig` PDA — governance-gated,
singleton, holds `enabled` + the six Kamino account pubkeys the CPI will
eventually need (`kamino_program`, `lending_market`,
`lending_market_authority`, `reserve`, `reserve_liquidity_supply`,
`reserve_collateral_mint`). Mirrors the exact `ProtocolConfig` groundwork
pattern already used in this codebase (PDA shipped ahead of enforcement,
governance-only setters, uninitialized-PDA-is-a-no-op semantics). No CPI
code yet — this is the landing pad, not the integration.

**Next session:** (1) stand up a local mock program matching the account
shapes above to prove the manual-CPI + fallback-on-failure code path
end-to-end without touching devnet; (2) once that's green, write the real
`try_kamino_deposit`/`try_kamino_redeem` using manually-built
`Instruction`s (per the version-mismatch note above) gated on
`KaminoConfig.enabled`; (3) get Walter's sign-off on a devnet wallet before
attempting a live devnet transaction against Kamino's actual market.
