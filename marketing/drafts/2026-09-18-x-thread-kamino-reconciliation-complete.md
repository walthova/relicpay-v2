# X Thread Draft — Kamino reconciliation arc complete (buyer + merchant sides)

*Drafted 2026-09-18 by relicpay-growth. NOT reviewed, NOT approved, NOT posted.
Anchored on real shipped work: `merchant_withdraw_reconciled` (2026-09-14, commit `1552e0a`)
and `cancel_agreement_reconciled` (2026-09-18, commit `d169462`) — the two halves of the same
UX gap, now both closed. This is the first content drafted since the 2026-07-06/07-08 drafts
were flagged stale on 2026-09-17; those two still await Walter's reject/approve call and are
untouched by this draft.*

*Voice check: leads with buyer money, not chain names. No hype-speak, no unverified claims —
every number below is pulled directly from the build notes and test output, not rounded up.*

---

**Tweet 1**

Most BNPL fine print is about what happens when you want out early: late fees, penalty APR,
sometimes just "no."

Relic Pay's fine print is: you get every cent of your yield back, in one transaction, whether
you're the buyer canceling or the merchant getting paid.

**Tweet 2**

Here's the mechanic. Your installment payments sit in escrow. That escrow isn't idle — it's
working (currently modeled as yield-bearing escrow, with live Kamino Lend integration as the
next milestone).

If you cancel, or the merchant withdraws, that yield has to come back out cleanly. That used to
take two transactions.

**Tweet 3**

Not anymore. Two ships this month closed the loop:

Sep 14 — merchants can withdraw in one transaction even when the payout needs to pull from
Kamino-deposited collateral, not just raw escrow.

Sep 18 — buyers get the same thing on cancellation: the full collateral balance reconciles
inline, then the standard fee/refund split runs against the true balance. One transaction, no
separate crank.

**Tweet 4**

Why it matters: "your payment plan makes you money" only means something if the money actually
comes back to you without extra steps, extra gas, or a support ticket. This is that promise held
up under an edge case most BNPL products never publish a spec for.

**Tweet 5**

Both changes are purely additive — the original `merchant_withdraw` and `cancel_agreement`
paths are untouched and still covered by the frozen test suite. New behavior, zero regression
risk to what already worked. 63 tests green (cargo + anchor combined) as of today.

---

## Notes for review

- All test-count and mechanism claims traceable to `docs/progress/2026-09-14.md` and the
  2026-09-18 build commit `d169462` (`cancel_agreement_reconciled`) — verify against `git log`
  before posting if more commits land between drafting and review.
- Does NOT claim Kamino yield is live in production today — escrow yield is still simulated;
  only the reconciliation *mechanism* (redeem-then-settle) is real and shipped. Kept that
  distinction explicit in Tweet 2 rather than implying real yield already exists, since that
  would overstate the current state.
- Recommend reviewing this alongside the reject/archive decision on the two 2026-07 drafts
  (`marketing/drafts/2026-07-06-x-thread-risk-controls.md`,
  `marketing/drafts/2026-07-08-x-thread-bnpl-debt-cracks.md`) so the backlog moves as one batch
  rather than piling up a third unreviewed draft on its own.
