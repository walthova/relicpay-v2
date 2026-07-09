# X Thread — "We just gave Relic Pay an off switch" (risk controls / build-in-public)

**Status:** DRAFT — not posted. Needs Walter's review + approval before it goes anywhere.
**Source material:** docs/progress/2026-07-06.md (ProtocolConfig PDA shipped this session)
**Platform notes:** post as-is to X; same copy works on Farcaster with no edits per MARKETING.md.

---

1/
The only BNPL where your payment plan makes you money.

That promise only means something if the protocol can't blow itself up. This week we shipped the seatbelt: a protocol-wide pause switch and hard risk caps, built before a single dollar of real yield touches the escrow.

2/
What shipped: a `ProtocolConfig` PDA that tracks four things —
- is the protocol paused (emergency stop, authority-gated)
- max USDC per single agreement
- max total value locked across the whole protocol
- current TVL, updated live

3/
Why now, before the flashy part (real yield via Kamino)? Because caps and a pause switch are useless bolted on after money is already at risk. We wanted the limits live and tested before the escrow ever touches a lending market.

4/
5 new tests went in with it: default config on init, pause toggle, risk-limit updates, and two rejection tests confirming a random signer can't touch any of it. Full suite: 29 passing. (1 pre-existing environment timing flake in an unrelated frozen test — not this change, verified against clean baseline.)

5/
This is the same discipline from day one of the rebuild: checked arithmetic everywhere (no silent overflow), a fix that closes the double-withdraw class of bug, and a characterization suite that's frozen — if new code breaks the old spec, that's a real conversation, not a test edit.

6/
None of this is the interesting part yet. The interesting part is next: escrow deposits routed into Kamino Lend via CPI, so "your payment plan makes you money" stops being simulated math and starts being real yield. The caps we shipped this week are the guardrail that ships before that does.

7/
Building in public because a BNPL protocol asking people to lock stablecoins should show its work. Repo's open, tests are the spec.
[link: github repo]
[link: relicpay.app]

---

## Alt shorter version (single post, if thread feels like too much this week)

Most BNPL protocols add risk controls after they've taken deposits. We added ours before: a pause switch + hard per-agreement and protocol-wide TVL caps, landed with 5 new tests, full suite at 29/30 (1 known pre-existing flake, unrelated). Real yield via Kamino is next — this is the guardrail that ships first.

[relicpay.app] [repo link]
