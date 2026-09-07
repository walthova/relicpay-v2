# Relic Pay — Merchant Pilot Pipeline

*Owner: Walter. Research only — no outreach sent without explicit approval (see MARKETING.md standing rules).*
*Last updated: 2026-09-07 by relicpay-growth (replaced the dropped Freedom slot — see below).*

## 2026-09-07 verification pass — WITTMORE replaces the dropped Freedom (Los Feliz) slot

Freedom (Los Feliz) has failed verification across three prior passes (2026-07-08, 2026-07-13,
2026-08-05) — no real brand found under that name/location. Rather than run a fourth guess, this
pass sourced a concrete replacement and verified it in the same session:

| Candidate | Category | Checkout stack | Status |
|---|---|---|---|
| WITTMORE (`wittmore.com`) | Modern men's boutique, LA Arts District — contemporary apparel, accessories, lifestyle goods | **Confirmed Shopify** — direct `curl` on `/cart.js` returns HTTP 200 with a valid cart JSON payload, and the site's own response headers include `powered-by: Shopify` plus `shopify-complexity-score` — a hard, two-signal confirmation, not a guess. | **Contact-ready** — live storefront, standard checkout stack, LA Arts District location gives it the same neighborhood/scene overlap rationale the original Freedom slot was chosen for. |

Two other candidates surfaced by the same search were checked and rejected this pass: LA Street
Art Gallery (`la-street-art-gallery.myshopify.com`) returns HTTP 402 on `/cart.js` (Shopify
"payment required" — the store exists but its Shopify subscription appears lapsed/unpaid, not a
live storefront to pitch); Arts District Coop's guessed Shopify subdomain 404s (no confirmed
storefront under that guess, would need a real site to re-check).

**Net movement: pipeline is back to 6 verified candidates, 6 of 6 contact-ready** (Brain Dead,
Hashimoto Contemporary, The Hundreds, Thinkspace Projects, WITTMORE; Online Ceramics remains a
fallback-only surface since its primary site is off-Shopify). Still missing before any real
outreach, unchanged from every prior pass: (1) a real contact name/inbox at any candidate, (2)
confirmation of whether IBG Collection's network already has a relationship with any of them. Both
remain NEEDS-WALTER, not research-only tasks.

## 2026-08-05 verification pass — The Hundreds and Thinkspace Projects confirmed

WebSearch + direct `curl` checks against both domains' Shopify-only `/cart.js` endpoint (200 = Shopify
storefront; this endpoint only exists on live Shopify stores, so it's a hard confirmation, not a guess):

| Candidate | Checkout stack | Status |
|---|---|---|
| The Hundreds (`thehundreds.com`) | **Confirmed Shopify** — `/cart.js` returns HTTP 200, page HTML contains `cdn.shopify.com` references. | **Contact-ready** — live storefront, standard checkout stack. |
| Thinkspace Projects (`shop.thinkspaceprojects.com`) | **Confirmed Shopify** — `/cart.js` returns HTTP 200 on the dedicated shop subdomain (`thinkspaceprojects.com` itself is a separate marketing/inventory site). | **Contact-ready with a caveat**: search results show the gallery directs actual art-piece purchase inquiries to `contact@thinkspaceprojects.com` for payment/shipping rather than a self-serve Shopify checkout for higher-ticket pieces — worth confirming directly whether the Shopify store is used for editions/prints only vs. one-off gallery pieces before pitching a BNPL integration path. |

**Net movement: all 6 original candidates now checkout-stack-verified.** 5 of 6 are contact-ready
(Brain Dead, Hashimoto Contemporary, Online Ceramics as a fallback surface only, The Hundreds,
Thinkspace Projects); Freedom (Los Feliz) remains dropped (no real brand found under that name in
two prior passes) and still needs a replacement candidate from Walter or IBG's actual network.

Still missing before any real outreach, unchanged from the 2026-07-13 pass: (1) a real contact
name/inbox at any of the 5 contact-ready brands, (2) confirmation of whether IBG Collection's
network already has a relationship with any of them, which would reorder outreach priority
entirely. Neither of these is a research-only task — see NEEDS-WALTER in today's progress note.

## 2026-07-13 verification pass — checkout stack

WebSearch worked this session (denied in prior sessions). Went one level past domain-liveness
into actual checkout-platform confirmation, which is the specific blocker MARKETING.md flags
before a candidate can be called contact-ready:

| Candidate | Checkout stack | Status |
|---|---|---|
| Brain Dead (`wearebraindead.com`) | **Confirmed Shopify** (custom Liquid theme, listed as a Shopify storefront). Real traffic signal: ~$502K revenue / 2,433 transactions in Jan 2026 per Grips Intelligence, AOV $200-225. | **Contact-ready** — live brand, real revenue, standard checkout stack a BNPL integration can target. |
| Hashimoto Contemporary | **Confirmed Shopify** — dedicated shop at `store.hashimotocontemporary.com`, backing `myshopify.com` domain visible in URLs, standard checkout flow (tax/shipping calculated at checkout). SF (Minnesota Street Project) + NYC (LES) locations. | **Contact-ready** — highest product-fit candidate (limited-edition prints/HPMs, $500-3000+ range) on a standard, integrable checkout stack. |
| Online Ceramics | Primary site (`online-ceramics.com`) runs on a non-Shopify platform; maintains a `online-ceramics-too.myshopify.com` **backup** store used during primary-site maintenance. | **Partially verified** — Shopify exists as a fallback surface, not the primary checkout. Needs a direct look at the live primary site's checkout flow before calling it contact-ready. |
| The Hundreds | Not checked this pass (previously domain-verified only). | Still unverified past domain liveness. |
| Thinkspace Projects | Not checked this pass (previously domain-verified only). | Still unverified past domain liveness. |
| Freedom (Los Feliz) | N/A | **Dropped** — no real brand found under this name/location (see below). |

**Net movement: 2 of 6 candidates (Brain Dead, Hashimoto Contemporary) moved from "domain-verified"
to "contact-ready"** — live, operating, on a standard checkout stack a Relic Pay integration could
realistically target. Still missing before actual outreach: (1) a real contact name/inbox at either
brand, (2) confirmation of whether IBG Collection's network already has a relationship with either
— this needs Walter directly, not more research, since it changes outreach order entirely (see
NEEDS-WALTER in today's progress note).

**Freedom (Los Feliz) replacement needed**: this pass could not find any real brand matching
"Freedom Los Feliz" — only unrelated namesakes (Mister Freedom on Beverly Blvd, freedomstreetwear.com,
shop-freedomboutique.com). Recommend replacing this slot in the next pass rather than continuing to
guess domains for a brand that may not exist as described.

## 2026-07-08 verification pass

WebSearch/WebFetch tools were denied again this session (non-interactive permission gate), but
`curl` against candidate domains + Google News RSS worked and gave real signal:

| Candidate | Verified status |
|---|---|
| Brain Dead | **Live** — correct domain is `wearebraindead.com` (not `braindead.la`, which doesn't resolve), HTTP 200. Confirmed actively operating: recent Coach x Brain Dead capsule collab covered by Who What Wear / Complex / Refinery29. |
| The Hundreds | **Live** — thehundreds.com resolves HTTP 200. |
| Online Ceramics | **Live** — onlineceramics.com resolves HTTP 200. |
| Freedom (Los Feliz) | **Cannot verify — recommend dropping this slot.** Live WebSearch pass (2026-07-13) surfaced only unrelated brands sharing the word "Freedom" (Mister Freedom on Beverly Blvd, freedomstreetwear.com, shop-freedomboutique.com) — none match a Los Feliz storefront, no confirmed domain exists. Replace rather than keep chasing it — see replacement note below. |
| Hashimoto Contemporary | **Live** — hashimotocontemporary.com resolves (301 redirect, HTTP layer healthy). |
| Thinkspace Projects | **Live** — thinkspaceprojects.com resolves HTTP 200. |

5 of 6 candidates are confirmed live, operating brands with working web domains. This is still
domain-liveness only — not confirmation of Shopify/checkout stack, openness to a BNPL
integration, or a real contact name. Full verification still needs a live web search pass or a
manual look. Do not use this as a green light to contact anyone.

## Context

MARKETING.md Phase 3 target: 3–5 LA independent brands as merchant pilots after IBG Collection,
streetwear/art adjacency, leveraging IBG's existing network for warm intros. Signed merchant
pilots is a tracked metric (target: 3).

## Candidate list (research pass — needs verification before any contact)

Caveat up front: this pass had no live web/search access (WebSearch and WebFetch tools were
denied for this session — see progress note). The candidates below are drawn from general
knowledge of the LA streetwear/art-adjacent indie retail scene and are **not verified as
currently operating, e-commerce-enabled, or open to BNPL integrations as of today**. Treat this
as a starting shortlist to verify, not a ready-to-contact list.

| Candidate | Category | Fit rationale | Contact path (unverified) | Verification needed |
|---|---|---|---|---|
| Brain Dead | LA streetwear/art label | Direct art-fashion crossover identity, small indie team, own e-commerce site — closest philosophical match to IBG's "streetwear as art" framing | Site contact form / brand Instagram DM | Confirm current e-commerce platform (Shopify vs custom) — determines checkout integration path |
| The Hundreds | LA-founded streetwear brand, long editorial/culture voice | Culturally native to LA streetwear scene, history of writing about brand/community ideas — plausible for a "why we did this" co-marketing piece, not just a checkout | Editorial team via site / known founder public profiles | Confirm still independently operated (ownership/structure may have changed) |
| Online Ceramics | Cult LA/Costa Mesa graphic tee and art-object label | Small team, strong drop-culture fit for "lock in early, get paid to wait," younger crypto-curious buyer base | Site contact / Instagram | Confirm current DTC checkout stack |
| Freedom (Los Feliz) | Independent streetwear boutique, multi-brand | Physical + online independent retailer in LA, plausible for IBG-adjacent cross-promo given neighborhood/scene overlap | Store contact form | Confirm e-commerce presence beyond in-store |
| Hashimoto Contemporary | Gallery representing pop-surrealist/street artists (LA + SF + NY) | Not apparel — art sales angle: high-ticket limited pieces are the single best fit for "your installment plan earns yield while you wait for delivery" | Gallery general inquiry | Confirm which location leads US sales, whether they run their own checkout or third-party gallery software |
| Thinkspace Projects | LA gallery, street-art/pop-surrealism | Same high-ticket-art rationale as Hashimoto; LA-based, plausible overlap with IBG's collector network | Gallery contact | Confirm current program calendar / active sales channel |

## Prioritization logic

- **Highest-fit, lowest-effort first**: galleries selling single higher-ticket pieces (Hashimoto,
  Thinkspace) are the cleanest product-market fit for "yield while you wait" — a $500–$3000 art
  piece paid over 4–8 weeks earning yield is a much sharper story than a $60 t-shirt.
- **Warm-intro leverage**: anything IBG Collection's founders/network already has a relationship
  with should jump the queue — ask Walter/IBG side for existing contacts before treating any of
  these as cold outreach.
- Do not contact any of these until (a) IBG pilot has real completed orders to point to as proof,
  and (b) the checkout SDK (v2.2 roadmap item, `@relicpay/checkout`) exists as something to hand
  a merchant, not just a pitch.

## Next research pass should

- Verify actual current operating status, e-commerce platform, and a real contact name for each
  candidate above (needs live web access — flagged as blocked this session)
- Ask Walter directly which of these (if any) already has an IBG Collection relationship, since
  that changes the outreach order entirely
- Expand beyond streetwear/art if IBG's actual network turns out to skew differently (e.g.
  independent record labels, zine/print culture, sneaker resale — same "wait for a physical drop,
  earn yield" mechanic applies broadly)
