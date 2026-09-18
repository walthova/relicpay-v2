# Agentic Engineering Grant Draft

_Submit: https://superteam.fun/earn/grants/agentic-engineering_

_Status: Draft. Do not submit without Walter approval._

## Step 1: Basics

**Project Title**

> Relic Pay v2

**One Line Description**

> Yield-bearing BNPL on Solana: buyers split purchases into installments while locked USDC is modeled today as yield-bearing escrow, with Kamino Lend integration next.

**TG username**

> TODO: t.me/<walter-username>

**Wallet Address**

> TODO: <Solana wallet address>

## Step 2: Details

**Project Details**

> Relic Pay is a Solana-native buy-now-pay-later protocol for crypto holders and independent merchants. A buyer can choose an IBG Collection item, split the purchase into installments, and create an on-chain agreement without a bank account, credit bureau, or card network gate.
>
> The core inversion is simple: traditional BNPL extracts value from the buyer through late fees, credit damage, merchant fees, and securitized consumer debt. Relic Pay makes the locked payment capital productive. The current devnet demo uses transparent simulated yield; the next v2.1 milestone routes escrow USDC into Kamino Lend via CPI so the buyer's payment plan can earn real yield.
>
> The v2 rebuild is already grounded in production discipline: modular Anchor instructions, checked math, a frozen v1 characterization suite, v2 feature tests, rent-close paths, merchant withdrawal hardening, yield-source tracking groundwork, and protocol risk controls. The newest shipped controls add a governance-owned `ProtocolConfig` PDA with emergency pause and per-agreement deposit caps before real yield touches escrow. As of 2026-09-14, merchant payout is also fully Kamino-aware end to end: `merchant_withdraw_reconciled` collapses the prior two-transaction crank-then-withdraw flow into one, redeeming just enough Kamino collateral inline when plain escrow USDC can't cover the payout — closing the last gap between "yield accrues" and "merchant actually gets paid."
>
> The first proof surface is the IBG Collection pilot: an art/fashion merchant where the story is concrete enough for buyers, merchants, and Solana reviewers to understand quickly.

**Deadline**

> **Status change, confirmed 2026-09-11 via direct fetch of
> `superteam.fun/earn/grants/agentic-engineering/`: applications are currently PAUSED.** The page
> states "Applications Paused" with no active deadline or open window — this is a change from
> every prior pass (2026-07-13 through 2026-09-09), which found the grant open and rolling with no
> fixed deadline. Net effect: there is nothing to submit to right now regardless of the
> repo-visibility blocker below; this removes the false time-pressure implied by the "self-imposed
> Sep 12 target" referenced in the 2026-09-09 progress note (no such external deadline exists, and
> the program isn't even accepting applications). Keep this draft current so it's ready the moment
> applications reopen — re-check each pass.
>
> The repo-visibility blocker itself is unchanged and still gates the Colosseum packet
> independently of this grant's paused status: `git fetch origin main` still shows `origin/main` 2
> commits ahead of local `main` (the 2026-09-03 Walter + Devin AI merge, `f03fe03`) while local
> `main` is now 24 commits ahead of its own line (most recently `1552e0a`, the 2026-09-14
> single-transaction Kamino-aware `merchant_withdraw_reconciled`). Repo is still confirmed
> **private**, re-verified via `gh repo view` on 2026-09-17. See NEEDS-WALTER in
> `docs/reports/2026-09-11.md`. The Colosseum Fall Hackathon window (below) is now **11 days
> out**, re-confirmed unchanged (2026-09-28 to 2026-11-02) via live search on 2026-09-17.
>
> **Re-checked 2026-09-17: still PAUSED**, confirmed by direct fetch of
> `superteam.fun/earn/grants/agentic-engineering/` — page still shows "Applications Paused," cheque
> size $200 USDG, $62.2k approved across 311 recipients to date. No reopening signal found. Support
> contact for status questions: support@superteam.fun (not contacted — informational only).

**Proof of Work**

> - Canonical repo: https://github.com/walthova/relicpay-v2
> - Live site/demo surface: https://relicpay.app
> - v2 rebuild commit history includes modular Anchor rebuild, v1 characterization suite, v2 feature suite, risk controls, and public docs.
> - Recent shipped work (newest first, verified against `git log` 2026-08-05):
>   - `b004d7f` (2026-08-05) corrected the Kamino CPI fallback design — a real test proved a failed CPI cannot be caught mid-transaction on Solana (no try/catch across `invoke_signed`), so the design was reworked to a preflight guard that reads reserve-paused state before invoking. Fixed the claim in the design doc and the probe code to match.
>   - `83f4efd` (2026-08-05) shipped a local `mock_kamino_lend` program plus `kamino_cpi.rs`/`kamino_probe.rs` standalone probe instructions (deposit/redeem/pause) and the `KaminoConfig` governance PDA — first real CPI code against a mock reserve, not just design. 3 new tests (deposit, redeem, paused-reserve fallback); 48/48 `anchor test` green.
>   - `f23dcdc` (2026-07-13) enforced the protocol-wide TVL cap across every money-moving instruction (`create_agreement`, `pay_installment`, `merchant_withdraw`, `cancel_agreement`, `trigger_default`) — the last unwired risk-control path before real Kamino yield touches escrow. 5 new tests; 41/41 `anchor test` green.
>   - `0f1420e` wired `ProtocolConfig` pause into `pay_installment`, so an emergency stop halts payments on existing agreements, not just new ones.
>   - `8926da2` fixed frozen-suite timing by confirming airdrop signatures.
>   - `0687619` wired ProtocolConfig pause and deposit cap enforcement into `create_agreement`.
>   - `71c4501` added `yield_source` groundwork for simulated-now/Kamino-next clarity.
>   - `e701733` introduced ProtocolConfig PDA, pause switch, and risk caps.
> - Current suite status (2026-08-05): `anchor build` green, `cargo test` 6/6 green, `anchor test` 48/48 green.
> - Docs included: whitepaper, technical breakdown, development plan, marketing plan, terms, repo canonicalization, funding pipeline, and pitch packet.
> - AI-assisted proof files exported locally and intentionally ignored from git:
>   - `claude-session.jsonl`
>   - `codex-session.jsonl`

**Personal X Profile**

> TODO: x.com/<handle>

**Personal GitHub Profile**

> https://github.com/walthova

**Colosseum Crowdedness Score**

> TODO: Visit https://colosseum.com/copilot, get the Relic Pay crowdedness score, upload the screenshot to a public Google Drive link, and paste it here.

**AI Session Transcript**

> Attach `claude-session.jsonl` or `codex-session.jsonl` from the repo root. These files are ignored by git and should not be committed to the public repo.

## Step 3: Milestones

**Goals and Milestones**

> 1. 2026-07-15: Public-readiness pass complete: canonical repo public, README polished, stale legacy links fixed, and build/test status documented. **STILL AT RISK as of 2026-08-05** (3+ weeks past target): local `main` is now 14 commits ahead of `origin/main` (last push 2026-07-04) and the repo is still private per `gh repo view` — pushing and flipping visibility needs Walter's explicit go-ahead per the secret-scan step in `docs/REPO_CANONICALIZATION.md`. README/docs polish itself has been done and committed since 2026-07-13; only the push/visibility decision is outstanding. This is the single blocking item for every other milestone below.
> 2. 2026-07-22: Production demo story aligned: Relic Pay v2 homepage and IBG pilot flow explain simulated yield today, Kamino next, and protocol risk controls. Content is drafted (`docs/funding/LOVABLE_HOMEPAGE_UPDATE.md`) but not yet applied to the live Lovable site pending Walter's approval.
> 3. 2026-07-29: Colosseum-ready packet complete: public repo, demo link, 3-minute demo script, screenshots, and project description. Packet content is drafted (`docs/funding/COLOSSEUM_PACKET.md`); blocked on the same repo-visibility item as milestone 1.
> 4. **Substantively complete as of 2026-08-05** (target was 2026-08-08): Kamino integration plan — account design, CPI sequence, fallback path, and test plan are done and go further than "plan": a working mock-CPI proof of concept (`mock_kamino_lend` program, `kamino_cpi.rs`/`kamino_probe.rs`, `docs/design/KAMINO_CPI_INTEGRATION.md`) is shipped and tested (3 new tests, 48/48 suite green). Risk-control extension plan (gating real CPI on `KaminoConfig.enabled`) is documented; not yet wired into `create_agreement`/`pay_installment` — that is the explicit next build increment.

**Primary KPI**

> One stranger can complete a Relic Pay devnet BNPL demo flow from the public README/site in under 3 minutes.

**Final Tranche Checkbox**

> To receive the final tranche, submit the Colosseum project link, GitHub repo, and AI subscription receipt if requested by the grant form.

## Submission Notes

- Do not claim real yield until Kamino CPI is implemented.
- Keep "simulated devnet yield today; Kamino Lend next" in every public artifact.
- Submit only after Walter approves the final text and public repo visibility.

## Related deadline (not this grant, but time-pressured)

> Colosseum Solana Fall Hackathon: **2026-09-28 to 2026-11-02**, re-confirmed 2026-09-11 via live
> web search (unchanged from every prior confirmation since 2026-07-13). Submission window opens
> in **17 days**. The same repo-visibility/merge blocker above holds back
> `docs/funding/COLOSSEUM_PACKET.md` — this is the only externally time-pressured deadline
> tracked for Relic Pay right now (the Agentic Engineering Grant above is paused; no fixed
> deadline was found for the Solana Foundation grant in `docs/funding/SOLANA_FOUNDATION_GRANT.md`).

## Competitive differentiation note (wq-rp-002 input, 2026-09-07)

> Direct competitor Yumi Finance (won Cypherpunk 2025, funded by Colosseum/Four Pillars/Very Early
> Ventures) charges merchants a flat 3% fee on its Pay-in-4 BNPL product and settles primarily on
> EVM chains (Solana wallets are accepted for underwriting signal only, not settlement). Relic Pay's
> two-line differentiation for any pitch, packet, or grant answer: **(1) merchants keep the full
> sale, no BNPL fee — Yumi still extracts from the merchant side; (2) Relic Pay is Solana-native
> end to end, not a multi-chain credit API that treats Solana as one data source among several.**
> Per the Colosseum winner-signal read (`walter-os/businesses/relic-pay/colosseum-bnpl-landscape-
> 2026-09-06.md`), frame this as a capital-inefficiency/fragmented-liquidity argument, not a
> "high fees" complaint — zero of 293 hackathon winners framed their problem as fees.

