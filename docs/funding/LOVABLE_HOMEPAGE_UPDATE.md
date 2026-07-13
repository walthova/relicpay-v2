# Lovable Homepage Update Prompt

_Target project: Relic Pay v2 / `tokenlink-gateway`_

The Codex Lovable connector currently has read access but not `projects:write`,
so this prompt is ready to paste directly into Lovable.

```text
Update the Relic Pay v2 homepage so it matches the current funding/demo story.

Goal: first-time visitors, grant reviewers, hackathon judges, and Solana ecosystem partners should understand the current v2 story in under 30 seconds.

Use this exact positioning:
- Primary hook: "The only BNPL where your payment plan makes you money."
- Relic Pay is yield-bearing BNPL on Solana for crypto holders and independent merchants.
- First proof/pilot story: IBG Collection.
- Current demo status: devnet/simulated yield today; do not claim live real yield.
- Next milestone: Kamino Lend CPI for real in-protocol yield.
- Risk controls shipped before real yield: protocol pause and per-agreement deposit caps, shipped 2026-07-06.
- Canonical repo target: https://github.com/walthova/relicpay-v2 (if a GitHub link is shown, use this URL).

Content requirements:
1. Above the fold: Relic Pay name, the primary hook, one short paragraph explaining IBG pilot + simulated-now/Kamino-next, and a clear CTA to try/demo or learn more.
2. Add a 4-card status strip: IBG pilot, simulated yield now, Kamino next, pause/caps shipped.
3. Add a "How it works" section: choose item, lock first USDC payment in escrow, pay over time, yield is simulated now and Kamino next.
4. Add a "Risk controls" section: emergency pause, per-agreement caps, tests/spec discipline.
5. Add a clear disclaimer/current-status note: devnet demo, simulated yield only, not mainnet/audited, no real funds.
6. Keep the visual design polished and demo-friendly. Avoid overclaiming. Avoid generic DeFi jargon.

Do not add fake traction numbers. Do not say Kamino is live. Do not say mainnet is live. Keep copy concise and specific.
```

