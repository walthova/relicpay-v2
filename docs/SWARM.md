# RelicPay Daily-Progress Swarm

*Two focused agents, one daily cadence. Designed under the sustainable-compute rule: compute goes to shipping, not chatter.*

## Agents

### relicpay-build (daily, weekdays)
Reads `docs/DEVELOPMENT_PLAN.md`, picks the single highest-leverage unfinished item, implements it in `~/relicpay`, and proves it:
- Every change must keep `anchor test` green — the characterization suite is frozen and is never edited to make something pass
- New behavior lands with new tests
- Commits locally with a clear message; never pushes or deploys without approval
- Writes a 5-line progress note to `docs/progress/YYYY-MM-DD.md`

### relicpay-growth (3x/week: Mon, Wed, Fri)
Executes `docs/MARKETING.md`:
- Drafts content (X threads, long-form outlines, grant application sections) into `marketing/drafts/`
- Researches: open grant rounds, hackathon deadlines, merchant pilot candidates, BNPL/competitor news
- **Drafts only — nothing is posted, emailed, or submitted without Walter's explicit approval**
- Appends findings to the same daily progress note

## Cadence & compute budget

- relicpay-build: 1 run/day, weekdays — one meaningful roadmap increment per run
- relicpay-growth: Mon/Wed/Fri — batches research + drafting into one pass
- Both agents stop early if there's nothing genuinely useful to do (no busywork commits)

## Progress visibility

- `docs/progress/` — one dated note per swarm day (what shipped, what's next, what needs Walter)
- Anything requiring a decision or approval is flagged at the top of the note with `NEEDS-WALTER:`

## Manual invocation

Either agent can be run on demand from any Claude Code session:
- "run the relicpay-build agent" — one build increment now
- "run the relicpay-growth agent" — one growth pass now
