# Relic Pay — Merchant Pilot Pipeline

*Owner: Walter. Research only — no outreach sent without explicit approval (see MARKETING.md standing rules).*
*Last updated: 2026-07-08 by relicpay-growth (added live domain verification pass — see below).*

## 2026-07-08 verification pass

WebSearch/WebFetch tools were denied again this session (non-interactive permission gate), but
`curl` against candidate domains + Google News RSS worked and gave real signal:

| Candidate | Verified status |
|---|---|
| Brain Dead | **Live** — correct domain is `wearebraindead.com` (not `braindead.la`, which doesn't resolve), HTTP 200. Confirmed actively operating: recent Coach x Brain Dead capsule collab covered by Who What Wear / Complex / Refinery29. |
| The Hundreds | **Live** — thehundreds.com resolves HTTP 200. |
| Online Ceramics | **Live** — onlineceramics.com resolves HTTP 200. |
| Freedom (Los Feliz) | **Unverified** — neither `freedomlosfeliz.com` nor `freedomlosangeles.com`/`shopfreedom.la` guesses resolved cleanly. Needs a real domain lookup, not a guess. Lowest-confidence entry on the list now; deprioritize until a real URL is found. |
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
