# Relic Pay Positioning Reconciliation — wq-rp-002

*Date: 2026-08-05. Author: relicpay-growth agent. Trigger: Walter OS `ACTIVE_PRIORITIES.md`
P1 item — "Relic Pay: reconcile the completed wedge memo with Walter's approved consumer-BNPL
positioning" (queue item wq-rp-002).*

## The approved position (source: `/Users/w.m/walter-os/hub/ACTIVE_PRIORITIES.md`)

> Reframe the canonical story around intuitive everyday BNPL on crypto rails, with IBG provenance
> as the first demo and a founder-led keynote narrative.

Plain reading: **everyday BNPL is the product and the market position. IBG provenance is proof
material for the demo, not the identity.** This supersedes the earlier wedge memo's framing.

## Where the conflict actually lives

The wedge-recommendation memo at
`/Users/w.m/walter-os/businesses/relic-pay/wedge-recommendation.md` (2026-07-12, work item
wq-rp-001) recommends the opposite emphasis. Its own words:

> "Relic Pay becomes the ownership, provenance, and transfer layer for IBG Optic Relics... **the
> BNPL installment flow as the demo mechanic**."

That inverts the now-approved position: it makes IBG provenance the core identity and demotes
BNPL to "demo mechanic," where the approved position makes BNPL the core identity and IBG
provenance the demo. This is the specific document Walter OS flags as needing reconciliation —
I have not edited it. It lives outside this repo's scope (`walter-os/businesses/relic-pay/`, not
`~/relicpay/`) and was produced under a different work item (wq-rp-001) by what may be a
different agent session; per the Walter OS collaboration contract's collision rules, I'm
recording the conflict and a recommended resolution here rather than unilaterally overwriting
someone else's completed artifact. **This needs either Walter's direct edit/approval or a
claimed wq-rp-002 session with edit access to that file.**

## What's already correct and needs no change

Every public-facing and funding artifact inside `~/relicpay` already leads with BNPL, not IBG,
and already treats IBG as proof/demo rather than identity. Checked directly:

- `README.md` — "IBG Collection is the first merchant/pilot story" (demo language, not identity).
- `docs/MARKETING.md` — hook is "the only BNPL where your payment plan makes you money"; IBG
  appears only as merchant layer #3 and the Phase 1 pilot, never as the primary framing.
- `docs/WHITEPAPER.md` — IBG appears only as a worked example ("$600 piece of art from IBG
  Collection") and as "first live merchant," not as the protocol's identity.
- `docs/funding/PITCH_PACKET.md` — one-liner and plain-English pitch are pure BNPL; IBG appears
  under "Why Now" as "a real merchant story instead of a synthetic demo" — exactly the approved
  framing.
- `docs/funding/COLOSSEUM_PACKET.md`, `docs/funding/AGENTIC_ENGINEERING_GRANT.md`,
  `docs/funding/SOLANA_FOUNDATION_GRANT.md`, `docs/funding/LOVABLE_HOMEPAGE_UPDATE.md` — same
  pattern throughout: BNPL hook first, IBG named as first merchant/proof surface, never as core
  identity.

**Conclusion: no edits were needed inside `~/relicpay` for this reconciliation.** The gap is
entirely in the one Walter OS coordination file named above.

## Recommended resolution (for Walter or the wq-rp-002 owner)

Replace or annotate `wedge-recommendation.md`'s recommendation section with the approved framing:
BNPL is the product; the IBG Optic Relic purchase is the flagship demo of it, not a provenance
product with a BNPL feature bolted on. Concretely, the memo's "Recommendation" section should
read as "everyday BNPL, demonstrated first through an IBG Optic Relic purchase" rather than
"Relic Pay becomes the... provenance layer for IBG Optic Relics." The underlying demo mechanics
in the memo (three-installment purchase, yield while waiting, provenance record transfer on
completion) do not need to change — only which noun is the subject and which is the proof.

## NEEDS-WALTER

See `docs/progress/2026-08-05.md` for the full list. The item relevant to this reconciliation:
confirm whether I (or another agent under a claimed wq-rp-002) should directly edit
`/Users/w.m/walter-os/businesses/relic-pay/wedge-recommendation.md` to match this framing, since
that file lives outside this repo's normal write scope and was produced under a different queue
item.
