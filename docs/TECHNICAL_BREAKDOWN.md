# Relic Pay — Technical Breakdown
### A First-Timer's Guide to How Every Piece Works

---

## What Is This Document?

This document traces exactly what happens — at the code level — when someone uses Relic Pay. If you have never touched a Solana smart contract before, this will teach you the core concepts using Relic Pay as the example. If you are a developer, this is a complete reference for the on-chain logic.

---

## Glossary

| Term | Plain English |
|------|---------------|
| **PDA** (Program Derived Address) | An account address that is "owned" by a smart contract, not a human wallet. No private key exists. Only the program can sign for it. |
| **Escrow** | A holding account that locks funds until conditions are met. In Relic Pay, the escrow holds USDC installments until the agreement completes. |
| **Anchor** | A framework for writing Solana smart contracts in Rust. It generates TypeScript bindings automatically. |
| **Instruction** | A function call on a Solana smart contract. Like calling a method in an API. |
| **USDC** | USD Coin — a stablecoin pegged to $1. Relic Pay uses USDC with 6 decimal places ($1.00 = 1,000,000 USDC lamports). |
| **APY** | Annual Percentage Yield — the interest rate earned over one year. 3% APY = $3 earned on $100 in one year. |
| **Basis Points (bps)** | 1 basis point = 0.01%. 300 bps = 3%. Used in yield math to avoid decimals. |
| **IDL** | Interface Definition Language — the JSON file Anchor generates that describes your program's instructions, accounts, and types. The frontend uses this to call the program. |
| **CPI** | Cross-Program Invocation — when one Solana program calls another. Relic Pay v2 uses this to call Kamino Lend. |

---

## Part 1: What Happens When You Click "Buy Now"

Let's trace a real purchase: a buyer buys a $300 IBG Collection item, split into 3 monthly payments.

### Step 1.1 — Frontend Builds the Transaction

The Next.js frontend calls:

```typescript
await program.methods
  .createAgreement(
    new BN(300_000_000),   // $300.00 in USDC lamports (6 decimals)
    3,                      // 3 installments
    new BN(2_592_000),     // 30 days in seconds
    "ibg-drop-001",        // product_id (used as PDA seed — must be unique per buyer+item)
    "IBG Collection"       // merchant_name (display only)
  )
  .accounts({
    agreement: agreementPDA,
    buyer: wallet.publicKey,
    merchant: merchantPublicKey,
    usdcMint: USDC_MINT,
    buyerUsdc: buyerUsdcAccount,
    escrowUsdc: escrowPDA,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

### Step 1.2 — PDA Derivation

Before the call, the frontend derives the two PDAs using the program's seeds:

```typescript
// Agreement PDA: uniquely identifies this buyer+item combination
const [agreementPDA] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("agreement"),
    wallet.publicKey.toBuffer(),
    Buffer.from("ibg-drop-001"),
  ],
  PROGRAM_ID
);

// Escrow PDA: token account owned by the agreement (not the buyer)
const [escrowPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("escrow"), agreementPDA.toBuffer()],
  PROGRAM_ID
);
```

**Why PDAs?** Because no human holds the private key for these accounts. Only the smart contract can sign transactions from them. This means no one — not even the Relic Pay team — can drain the escrow without going through the program's logic.

### Step 1.3 — On-Chain Execution (`create_agreement`)

When the transaction lands:

1. A new `BnplAgreement` account is allocated at the agreement PDA address. It costs ~0.003 SOL in rent (one-time, returned when the account is closed).

2. The account fields are set:
   ```
   buyer = wallet.publicKey
   merchant = IBG_WALLET
   total_price = 300_000_000
   installment_count = 3
   installment_amount = 100_000_000  ($100 per installment)
   interval_seconds = 2_592_000      (30 days)
   paid_installments = 0
   start_time = current_unix_timestamp
   last_yield_update = current_unix_timestamp
   state = Active
   yield_rate_bps_annual = 300
   yield_accrued = 0
   escrow_deposited = 0
   ```

3. An SPL token account (the escrow) is initialized at the escrow PDA address, with authority set to the agreement PDA.

4. First installment transferred: `$100 → escrow_usdc` via SPL token CPI.

5. `paid_installments = 1`, `escrow_deposited = 100_000_000`.

6. An `AgreementCreated` event is emitted on-chain. The frontend listener catches this and updates the UI.

---

## Part 2: How Yield Accrues

### The Math

```
yield = principal × (rate_bps / 10_000) × (elapsed_seconds / 31_536_000)
```

For $100 over 30 days at 3% APY:
```
yield = 100_000_000 × (300 / 10_000) × (2_592_000 / 31_536_000)
      = 100_000_000 × 0.03 × 0.08219
      = 246,575 USDC lamports
      = ~$0.25
```

### Why `last_yield_update` Matters

A naive implementation might compute yield from `start_time` every time a payment is made. This double-counts:

**Bad (double-counting):**
- t=0: escrow=$100, no yield yet
- t=30d: `yield += $100 × 3% × (60d/365)` = $0.49 ← WRONG
  - (At t=30d it should be $100 × 3% × (30d/365) = $0.25)
- t=60d: `yield += $200 × 3% × (60d/365)` = $0.99 ← WRONG
  - (At t=60d it should be $200 × 3% × (30d/365) = $0.49)
- Total accrued: $0.25 + $0.99 = $1.24 — OVERCOUNTED

**Correct (per-window):**
- t=30d: `yield += $100 × 3% × (30d/365)` = $0.25 (30 days of $100)
- t=60d: `yield += $200 × 3% × (30d/365)` = $0.49 (30 days of $200)
- Total accrued: $0.25 + $0.49 = $0.74 — CORRECT

The fix: always compute yield only for `clock.unix_timestamp - last_yield_update`, then set `last_yield_update = clock.unix_timestamp`.

---

## Part 3: Payment Schedule

Each installment is due at a fixed time after the start:

```
Installment 1: paid at create_agreement (t=0)
Installment 2: due at start_time + (2 × interval_seconds) = t=30d
Installment 3: due at start_time + (3 × interval_seconds) = t=60d
```

The contract checks `clock.unix_timestamp >= due_time` and rejects early payments with `PaymentNotDue`.

### Integer Division and the Final Payment

`installment_amount = total_price / installment_count`

For $301 split into 3: `301_000_000 / 3 = 100_333_333`. The remainder of 1 USDC lamport is collected in the final installment:

```rust
let amount_due = if is_last {
    // final payment = total_price minus what's already been paid
    agreement.total_price.saturating_sub(
        agreement.installment_amount * (agreement.installment_count as u64 - 1),
    )
} else {
    agreement.installment_amount
};
```

This guarantees the merchant always receives exactly `total_price`.

---

## Part 4: How the Merchant Gets Paid

After the final installment, the agreement state is `Completed`.

The merchant calls `merchant_withdraw`:

```typescript
await program.methods
  .merchantWithdraw()
  .accounts({
    agreement: agreementPDA,
    merchant: wallet.publicKey,
    escrowUsdc: escrowPDA,
    merchantUsdc: merchantUsdcAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

On-chain:
1. Check `state == Completed`
2. Check `ctx.accounts.merchant.key() == agreement.merchant` (only the actual merchant)
3. Transfer `total_price` from escrow → merchant via PDA-signed CPI:

```rust
let seeds = &[
    b"agreement",
    agreement.buyer.as_ref(),
    agreement.product_id.as_bytes(),
    &[agreement.bump],
];
let signer = &[&seeds[..]];

token::transfer(
    CpiContext::new_with_signer(..., signer),
    merchant_amount,
)?;
```

The `new_with_signer` call is how a PDA signs a transaction. The seeds reconstruct the PDA's "signature" without a private key.

---

## Part 5: How the Default Works

If the buyer misses payment for 7+ days past the due date, anyone can call `trigger_default`.

```
Due date: start_time + (next_installment × interval_seconds)
Grace expiry: due_date + 604_800 seconds (7 days)

If clock.unix_timestamp > grace_expiry → default is legal
```

All escrowed USDC goes to the merchant. The buyer forfeits everything in escrow.

---

## Part 6: The Stake Pool

### Why Stake?

Two reasons:
1. Earn 3% APY on idle USDC
2. Unlock browser extension discount tiers (up to 3% off every purchase)

### How Staking Works

```typescript
await program.methods
  .stakeUsdc(new BN(50_000_000)) // $50
  .accounts({ ... })
  .rpc();
```

On-chain:
1. If user already has a stake: accrue yield on prior balance first
2. Transfer USDC: `user_wallet → pool_vault`
3. Update `staked_amount`, `last_update`, `tier`

`tier = compute_tier(staked_amount)`:
- $0–$9.99 → Tier 0 (0% discount)
- $10–$49.99 → Tier 1 (0.5% discount)
- $50–$199.99 → Tier 2 (1.0% discount)
- $200–$499.99 → Tier 3 (2.0% discount)
- $500+ → Tier 4 (3.0% discount)

The browser extension reads `UserStake.tier` directly from the Solana RPC to determine the user's current discount.

---

## Part 7: The Browser Extension Architecture

```
User visits e-commerce site
  ↓
Extension content script scans page DOM for price elements
  ↓
Connects to Phantom wallet (if installed) — reads wallet.publicKey
  ↓
Derives UserStake PDA: ["user_stake", wallet.publicKey]
  ↓
Fetches UserStake account via Solana RPC
  ↓
Reads tier field
  ↓
Computes: relic_price = original_price × (1 - tier_bps / 10_000)
  ↓
Injects "Pay with Relic Pay: $X" UI overlay next to original price
  ↓
User clicks → redirected to relicpay.app with pre-filled product + merchant data
```

---

## Part 8: Account Space Layout

When initializing the `BnplAgreement`, Anchor must know how many bytes to allocate. The `SIZE` constant calculates this exactly:

```rust
pub const SIZE: usize = 8          // 8 bytes: Anchor discriminator (unique account identifier)
    + 32 + 32 + 32                 // 3 Pubkeys: buyer, merchant, usdc_mint
    + 8 + 1 + 8 + 8               // total_price (u64), installment_count (u8),
                                   // installment_amount (u64), interval_seconds (i64)
    + 1 + 8 + 8 + 1               // paid_installments (u8), start_time (i64),
                                   // last_yield_update (i64), state (u8 enum)
    + 8 + 8 + 2                   // yield_accrued (u64), escrow_deposited (u64),
                                   // yield_rate_bps_annual (u16)
    + 4 + 64                      // product_id: 4 bytes length prefix + 64 bytes string
    + 4 + 64                      // merchant_name: same
    + 1;                          // bump (u8)
    // Total: ~307 bytes
```

Over-allocating is safe but wastes rent. Under-allocating crashes. This calculation must be exact.

---

## Part 9: Running It Locally (Step by Step)

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest && avm use latest

# Install Node.js (if not installed)
# https://nodejs.org — v18+ recommended
```

### Build and Test

```bash
git clone https://github.com/walthova/relicpay-claude.git
cd relicpay-claude

# Build the Anchor program
anchor build

# Start local Solana validator in a separate terminal
solana-test-validator

# Run tests (uses local validator)
anchor test --skip-local-validator
```

### Deploy to Devnet

```bash
# Switch to devnet
solana config set --url devnet

# Fund your wallet (devnet only — free test SOL)
solana airdrop 2

# Deploy
anchor deploy
```

---

## Part 10: Reading an Agreement from the Frontend

```typescript
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "./relicpay.json"; // generated by `anchor build`

const provider = AnchorProvider.env();
const program = new Program(idl, PROGRAM_ID, provider);

// Derive the agreement PDA
const [agreementPDA] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("agreement"),
    buyerPublicKey.toBuffer(),
    Buffer.from("ibg-drop-001"),
  ],
  program.programId
);

// Fetch the account
const agreement = await program.account.bnplAgreement.fetch(agreementPDA);

console.log({
  totalPrice: agreement.totalPrice.toNumber() / 1_000_000, // → $300.00
  paidInstallments: agreement.paidInstallments,            // → 2
  yieldAccrued: agreement.yieldAccrued.toNumber() / 1_000_000, // → $0.25
  state: agreement.state,                                  // → { active: {} }
});
```

---

*This document reflects the v1 architecture as of May 2026. See WHITEPAPER.md for the full protocol vision.*

*github.com/walthova/relicpay-claude*
