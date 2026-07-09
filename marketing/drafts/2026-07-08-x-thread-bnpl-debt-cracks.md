# X Thread — "The BNPL industry's real problem isn't fraud. It's the debt stack." (industry critique + build-in-public)

**Status:** DRAFT — not posted. Needs Walter's review + approval before it goes anywhere.
**Source material:**
- News hook: Bloomberg/Crypto Briefing reporting (week of 2026-07-08) that private credit
  firms are pouring billions into BNPL debt, and "the cracks are starting to show"; Illinois
  just enacted a licensing/supervisory framework for BNPL providers; Klarna is applying for a
  US bank charter, i.e. moving *closer* to being a bank, not further from consumer debt.
- Build hook: docs/progress/2026-07-08.md — `create_agreement` now enforces protocol pause
  and per-agreement deposit caps (commit `0687619`), 3 new tests, suite green.
**Platform notes:** X primary, same copy to Farcaster per MARKETING.md. Verify the three
news claims against original sources before posting — this draft was built from Google
News RSS headlines/snippets, not full-article verification. Links below are placeholders;
attach real article URLs before anything goes out.

---

1/
The only BNPL where your payment plan makes you money.

This week's BNPL news says the quiet part out loud: private credit firms are pouring billions into buy-now-pay-later debt, and analysts are already calling out the cracks. Illinois just passed a law to license and supervise BNPL providers. Klarna is applying for a US bank charter.

2/
Read those three things together. BNPL got big by looking like "four easy payments," not credit. Now it's attracting the same institutional debt investors as subprime auto loans, regulators are treating it like the credit product it always was, and the biggest player wants to become an actual bank.

3/
None of that is a scandal. It's what happens when a business model's only lever is extracting from the buyer — late fees, missed-payment penalties, merchant fees passed through, and now securitized consumer debt sold to private credit funds. The buyer is the product.

4/
Relic Pay inverts the one thing every other BNPL treats as fixed: what happens to your money while it's locked in escrow waiting to be paid out. Ours earns yield for the buyer. Nobody securitizes that — there's no debt to sell, because there's no debt.

5/
Shipped this week on the protocol side, while that news was breaking: `create_agreement` now enforces a protocol-wide pause switch and a hard per-agreement deposit cap, wired into account creation itself (not bolted on after). 3 new tests — pause blocks creation, cap blocks creation, resetting to permissive still works. Full suite green.

6/
Why this matters next to the private-credit story above: caps and a pause switch are the tools a protocol needs *before* it takes on real counterparty risk (real yield via Kamino is next on our roadmap). Traditional BNPL added consumer protection after the debt was already sold downstream. We're adding the equivalent before a dollar of real yield touches escrow.

7/
Repo's open, tests are the spec. Building the version of BNPL where "read the fine print" isn't the buyer's job.
[link: github repo]
[link: relicpay.app]

---

## Alt shorter version (single post)

This week: private credit funds are pouring billions into BNPL debt and "cracks are starting to show" (Bloomberg), Illinois just started licensing BNPL providers, and Klarna is applying for a US bank charter. Read together: BNPL is a credit product wearing a checkout button, and now it's getting securitized like one. Relic Pay doesn't have this problem — there's no debt to sell, because your installments earn yield instead of accruing it. Shipped this week: pause switch + deposit caps wired into agreement creation, before real yield lands. [relicpay.app] [repo link]

---

## Pre-publish checklist for Walter
- [ ] Verify the Bloomberg "private credit BNPL" piece and Crypto Briefing follow-up directly (this draft is built from RSS headlines, not full article text)
- [ ] Verify Illinois BNPL licensing law specifics (Consumer Finance Monitor / Payments Dive / PYMNTS covered it) — confirm effective date before citing as "just enacted"
- [ ] Verify Klarna bank-charter story (CNBC / Fast Company / Bloomberg all ran versions) — confirm this is a new filing, not a rehash of an older story
- [ ] Swap in real GitHub/relicpay.app links
