# Colosseum Submission Packet

_Status: Ready-to-edit. Next submission window confirmed: **Sep 28 – Nov 2, 2026**._

## Current Colosseum Status

As of 2026-07-13, Frontier 2026 (Apr 6–May 11) is concluded and winners have
been announced (CrowdBrain grand champion; 2,857 final submissions from
10,000+ participants). Colosseum runs two global hackathons per year — the
next confirmed window is **Sep 28 – Nov 2, 2026**. Accelerator Cohort 5 (21
startups) was just pulled from Frontier + Eternal Sprint; Colosseum's
cofounder said the next accelerator cohort will double in size. Eternal was
paused as of 2026-07-09 status; Eternal Sprint appears to be running again
per the Cohort 5 pipeline mention (112 applications in H1 2026) — needs a
direct check of colosseum.com/eternal before relying on it as an open path.

This gives Relic Pay ~11 weeks from today (2026-07-13) to Sep 28 to have the
demo, repo, and video genuinely ready — not a rushed submission.

Sources:

- https://colosseum.com/hackathon
- https://colosseum.com/accelerator
- https://colosseum.com/eternal
- https://x.com/SuperteamBLKN/status/2011135917986140610
- https://solanacompass.com/news/colosseum-announces-26-winners-of-the-solana-frontier-hackathon-the-largest-crypto-hackathon-ever
- https://solanacompass.com/news/colosseum-admits-21-startups-to-its-5th-accelerator-cohort-drawn-from-the-frontier-hackathon-and-eternal-sprint

## Recommended Track

Primary: Consumer or Payments/Commerce, if available.

Fallback: DeFi only if the submission emphasizes escrow yield and Kamino
integration. Avoid leading with DeFi if the track is crowded and the judging
criteria reward consumer clarity.

## Project Name

Relic Pay

## Tagline

The only BNPL where your payment plan makes you money.

## Short Description

Relic Pay is yield-bearing BNPL on Solana. Buyers split an IBG Collection
purchase into installments while USDC locked for repayment is modeled today as
productive escrow, with Kamino Lend integration next for real yield.

## Full Description

Crypto holders often face a bad choice at checkout: sell assets to buy
something today, or skip the purchase. Traditional BNPL solves the timing
problem with consumer debt, late fees, card rails, and merchant fees that often
flow back to the buyer.

Relic Pay flips the model. A buyer chooses an item, creates a Solana agreement,
locks the first USDC installment into escrow, and pays over time. The merchant
gets a clearer path to settlement, while the buyer's locked repayment capital is
treated as productive. Today's devnet demo uses simulated yield so judges can
see the mechanic safely; v2.1 routes escrow USDC into Kamino Lend through CPI.

The current v2 codebase is a ground-up Anchor rebuild of the original MVP. It
uses modular instructions, typed errors/events, checked math, PDAs for agreement
and escrow state, a frozen v1 characterization suite, v2 feature tests, and
protocol risk controls. The newest shipped controls add an emergency pause flag
and per-agreement deposit cap before real yield integration increases the risk
surface.

The first merchant proof is IBG Collection: a real art/fashion checkout story
where the buyer benefit is concrete and visual. Relic Pay is not asking judges
to imagine a generic DeFi dashboard. It shows how Solana can turn checkout
escrow into programmable consumer finance without banks or credit bureaus.

## Demo Link

> TODO: https://relicpay.app or final Lovable preview URL

## Source Code

> TODO after repo visibility switch: https://github.com/walthova/relicpay-v2

## Demo Video Script

### 0:00-0:20 Hook

"Imagine you collect art or fashion, hold USDC, and want to buy a $300 IBG
piece without selling your crypto. Every normal BNPL product turns that into
debt. Relic Pay turns the payment plan into productive escrow."

### 0:20-0:40 Solution

"Relic Pay is yield-bearing BNPL on Solana. The buyer pays in installments, the
merchant gets a transparent settlement path, and the locked USDC is modeled now
as yield-bearing capital, with Kamino Lend next for real yield."

### 0:40-2:20 Live Demo

1. Open Relic Pay.
2. Show the v2 story cards: IBG pilot, simulated yield now, Kamino next, pause/caps.
3. Connect a devnet wallet.
4. Show stake/discount/yield card if available.
5. Select an IBG Collection item.
6. Choose Pay in 3 or Pay in 4.
7. Create the agreement.
8. Open Solscan/devnet transaction proof.
9. Show the repo README and tests briefly.

### 2:20-2:50 Technical Highlight

"The important technical detail is that risk controls shipped before real yield.
The ProtocolConfig PDA lets governance pause new agreements and set hard
per-agreement caps. That means Kamino CPI gets added behind guardrails, not
before them."

### 2:50-3:00 Wrap

"Relic Pay is building the checkout layer where buyers don't sell their crypto,
merchants get a new customer base, and payment plans can earn instead of
extract. Repo and demo are linked in the submission."

## Judge Setup Notes

- Use devnet only.
- Do not use real funds.
- Yield shown in the current demo is simulated.
- Kamino CPI is the next milestone, not a live production claim.

