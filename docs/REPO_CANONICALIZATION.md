# Relic Pay Repo Canonicalization

_Last updated: 2026-07-09_

## Decision

`walthova/relicpay-v2` is the canonical Relic Pay repository.

This repo is the only Relic Pay codebase that combines the v2 Anchor rebuild,
the frozen v1 characterization suite, v2 feature tests, public-facing docs,
marketing strategy, and active funding/pitch materials.

## Repo Scorecard

Scores are 1-5, where 5 means ready to support a public funding or hackathon
review with minimal additional work.

| Repo | Role | Code | Tests | Docs | Demo | Funding Use | Public Ready | Decision |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `relicpay-v2` | Canonical Solana v2 | 5 | 5 | 5 | 3 | 5 | 4 | Keep and polish |
| `relicpay-claude` | v1 MVP archive | 3 | 4 | 4 | 3 | 3 | 3 | Keep private/archive |
| `relicpay-codex-prototype` | early Codex prototype | 3 | 1 | 3 | 2 | 2 | 2 | Archive after mining docs |
| `relicpay-solana` | first Solana seed | 2 | 1 | 1 | 1 | 1 | 1 | Archive |
| `relicpay` | old Lovable-era Web3 BNPL | 1 | 1 | 1 | 2 | 2 | 1 | Keep private/legacy |
| `relicpay-demo` | Solidity/RWA concept | 2 | unknown | 1 | 1 | 2 | 1 | Keep private/legacy |

## What To Preserve From Legacy Repos

- `relicpay-claude`: v1 whitepaper language, terms, technical breakdown, and
  the fact that the v2 suite characterizes its behavior.
- `relicpay-codex-prototype`: any demo-script or architecture language that
  explains simulated yield clearly.
- `relicpay-demo`: RWA positioning only, if a partner pitch needs an
  Ethereum/Base history note. Do not use it as the active code story.
- Lovable `tokenlink-gateway`: current Relic Pay v2 website surface.
- Lovable old `relicpay`: legacy website surface. Do not use as the funding
  demo unless it is redirected or rewritten.

## Publicization Checklist

- [ ] Push local `relicpay-v2` commits to GitHub.
- [ ] Replace every stale `github.com/walthova/relicpay-claude` public link
      with `github.com/walthova/relicpay-v2`, except historical notes.
- [ ] Replace placeholder IBG merchant wallet before any mainnet claim.
- [ ] Keep `claude-session.jsonl` and `codex-session.jsonl` ignored; attach
      them to grant forms, do not commit them.
- [ ] Make `walthova/relicpay-v2` public only after final secret scan.
- [ ] Add a short legacy notice to old repos:

```md
# Relic Pay Legacy Repository

This repository is preserved for historical context. The active Solana v2
implementation, docs, and funding/demo materials live at:

https://github.com/walthova/relicpay-v2
```

## Canonical Public Story

Relic Pay is not "generic decentralized BNPL." It is:

> The only BNPL where your payment plan makes you money.

Current demo status:

- IBG Collection is the first merchant/pilot story.
- Devnet yield is simulated and visible for demo purposes.
- Kamino Lend CPI is the next milestone for real yield.
- Pause and per-agreement cap controls shipped before real-yield risk.

