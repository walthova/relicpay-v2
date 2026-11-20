# Mock x402-style BNPL flow

This is a loopback-only merchant demo using **existing instructions**, not a
standard x402 implementation, credit underwriting, or a collateral-backed loan.
The human owner supplies tokens and delegates a bounded allowance to a mandate
PDA. The agent opens a BNPL agreement; only the first installment enters escrow.
The merchant releases a mock resource after verifying that deposit, **before it
is paid**. The human must sign remaining installments. The merchant receives
payment only after completion, so this is not upfront merchant financing.

Use Node >=22.12 (e.g. `source ~/.nvm/nvm.sh && nvm use 22`), Anchor 0.32.1,
Agave 3.0.11 and the repo's installed dependencies. From the repo root:

```sh
anchor build
node -r ts-node/register scripts/x402-mock/localnet.ts
```

The standalone helper starts a reset, upgradeable validator at port **18999**,
loads `target/deploy/relicpay.so` under the fixed program ID
`5GPVYpyzdosbzWcdttcCdziJVqUCCARf98J857C3T6Gi`, uses the throwaway payer as
upgrade authority, invokes `run.ts`, then stops its validator. It does not use
port 8899 or the default Solana wallet. Validator output/ledger are under `out/`.
Do not run two standalone helpers simultaneously or against another process on
these ports (18999/19000 RPC, 18901 faucet, 18902 gossip, 19100–19150 dynamic).
For immutable loading, use a separate validator with
`--bpf-program <PROGRAM_ID> target/deploy/relicpay.so`; ProtocolConfig init will
be skipped unless already present. The upgradeable helper permits config init.

Against an already running validator/deployment:

```sh
npm run x402:mock -- --cluster localnet --rpc-url http://127.0.0.1:18999
npm run x402:mock -- --cluster devnet --rpc-url https://api.devnet.solana.com --keypair-dir scripts/x402-mock/keys
```

`--cluster` accepts only localnet/devnet and defaults to localnet; never point
this demo at mainnet. `--keypair-dir` defaults to this directory's ignored `keys/`.
It generates/reuses **throwaway** payer/owner/agent/merchant keys, mode 0600;
never put real keys there. It refuses `~/.config/solana/`, including directory
symlinks resolving there. Mint/account keys are fresh per run; the payer controls
the mock 6-decimal mint. Never use real USDC. Each run uses a fresh product nonce,
mint and token accounts, so repeated runs do not reuse closed agreements. Mock
mint and ordinary owner/merchant token accounts remain on chain for inspection.
If a failed run leaves a mandate for the same owner/agent pair, the next run
revokes it on every owner token account still delegating to that PDA, then closes
it before creating fresh limits. This also clears old allowances before the PDA
is reused. Recovery does not settle agreements left by an interrupted purchase;
those remain the owner's responsibility using the normal program instructions.

The payer requests 2 SOL if below 0.5 SOL. If devnet airdrops fail/rate-limit,
the error prints the throwaway address to fund manually; rerun after funding.
The CLI does **not** deploy. A missing program fails clearly. ProtocolConfig is
initialized only if absent and payer is upgrade authority; existing risk config
is never changed. A paused/restrictive deployment can reject the run.

The merchant issues a JSON 402 challenge at GET `/resource`; the agent parses
it, opens an agreement, then sends base64 JSON `{agreement, signature, nonce}`
in `X-PAYMENT`. Verification checks a successful confirmed purchase transaction
for that agreement signed by the agent, program ownership/PDA, buyer, merchant,
mint, total price, count, interval, nonce, Active state and first escrow deposit.
Malformed/mismatched proofs, unrelated transactions, wrong merchant/price and
replays return 402. Concurrent submissions are locked before RPC verification.
Replay state is **in memory and per server instance**, not production durable.
The mock challenge is single-use for one resource; no payment facilitator exists.

Two installments and the minimum valid 1-second interval keep runs short. The
script polls confirmed chain time (90-second deadline) rather than attempting
early payments. If simulated yield becomes nonzero, it calls `claim_yield`
before closing: that instruction clears accounting/emits an event, **not a
token payout**. Agreement+escrow are closed, mandate revoked and closed.

Every submitted transaction is logged by step with fetched program logs.
`out/run-<nonce>.json` and `.md` include signatures, explorer URLs (devnet links
use `?cluster=devnet`), checks and final token/SOL balances; partial failed runs
also produce reports. `out/` and `keys/` are gitignored. Never commit keys or
reports; custom key directories must also be outside tracked files.

## Tests

`tests/x402-mock-flow.ts` runs the reusable flow via `anchor test`, including
402→payment→200, malformed/mismatched proofs, concurrent/sequential replays,
repayment, merchant receipt, revocation and account closure. Run only one Anchor
suite at a time. To avoid the default wallet entirely, supply a dedicated
throwaway wallet explicitly:

```sh
anchor test --provider.wallet "$PWD/scripts/x402-mock/keys/payer.json"
```

Generate that wallet first by running the standalone helper or CLI.

## Future devnet deployment — approval required; NOT part of this demo

**Never deploy without Walter's explicit approval.** The guarded helper is:

```sh
node -r ts-node/register scripts/x402-mock/deploy-devnet.ts --approved-by-walter
```

At the current ~1.08 MB binary size, retained deployment rent is approximately
**5.51 SOL**, plus fees and potentially additional temporary buffer funding.
The helper uses a throwaway payer/upgrade authority and exact-size allocation.

**Fixed-ID blocker:** deploying this binary at its declared ID requires that
ID's corresponding program keypair. A newly generated throwaway program keypair
cannot match it. The helper therefore refuses a nonmatching `keys/program.json`
rather than silently rewriting IDs or deploying a broken program. Resolving
this requires a separately approved ID/key decision; do not copy real keys into
the demo or read the standard Solana key directory. No devnet helper was run.
