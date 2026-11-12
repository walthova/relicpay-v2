# Agent instructions for this repo (Claude Code, Copilot, Codex)

Read `RELICPAY_V2.md` first: it is the product source of truth (Agent Buy Now, Pay Later). `SECURITY.md` is the source of truth for the security model and known limitations.

## Hard rules

- Never deploy anything (devnet or mainnet) without Walter's explicit approval.
- Never read, print, or move Solana keys (`~/.config/solana/**`).
- Never force-push. Do not push without Walter's explicit go.
- Never commit `.env` files or keys.
- `tests/characterization.ts` is the frozen v1 spec. Do not edit it. Any change that breaks it needs an explicit decision from Walter.
- New behavior lands with new tests (`tests/v2-features.ts`, `tests/agent-mandate.ts`, or a new file).
- Run `node scripts/test-guard.js` before every commit. It fails on edits to the frozen spec, deleted tests, removed assertions, `.skip`/`.only`/`#[ignore]`, silenced checkers, and unfinished code. Fix the code, not the tests. Overrides need Walter's agreement and a visible commit trailer (`Frozen-Change-Approved-By:` or `Test-Guard-Override:`). CI runs the same check.

## Build and test

```bash
cargo test --manifest-path programs/relicpay/Cargo.toml   # Rust unit tests
anchor test                                               # full localnet suite
```

`anchor test` runs every file in `tests/` against a local validator. Run only one suite at a time: two concurrent runs fight over port 8899 and cause confirmation timeouts.

## Code conventions

- Anchor 0.32.1. One instruction per file in `programs/relicpay/src/instructions/`.
- Checked arithmetic everywhere (`MathOverflow`), `has_one` and signer constraints on every privileged account, PDA seeds validated.
- New error variants are appended to the end of `RelicPayError` so existing error codes keep their numbers.
- Governance singletons are gated on the program upgrade authority (see `protocol_config.rs`).
- Agent spending goes through `AgentMandate` (`instructions/agent_mandate.rs`). Agreements an agent opens record `buyer = owner`.

## Security review focus

When reviewing, prioritize: money-moving instructions (destination accounts constrained to recorded parties), agent mandate limit checks, permissionless cranks, and anything that could let a non-owner key act on an owner's funds.
