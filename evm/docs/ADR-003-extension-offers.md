# ADR-003: what the browser extension is allowed to offer

Status: accepted, 2026-09-27
Context: roadmap "Browser extension revival against v2 ABI". The v1 extension still exists
(`relicpay-demo-main/browser-extension`, manifest v3, 8 files, ~1500 lines) and the roadmap word is
"revival", which reads like a port: keep the flows, swap the mock calls for v2 ABI calls. This
decision is why that port cannot be written, and what replaces it.

## What v1 actually did

Nothing on a chain. `background.js` holds every flow in `chrome.storage.local`: `createAgreement`
builds an object with `Math.random()` for an id, `updateCreditInfo` writes a hardcoded
`availableCredit: 2500`, and `processPayment` increments a counter. `content.js` matches
`<all_urls>`, scrapes any element matching `.product` or `.price`, runs the text through
`parseFloat`, and injects "4 payments of $X" where X is `price / 4`.

So there is no v1 behavior to preserve. Every number it displayed was invented. The item is a
rewrite against real contract state, and the constraints below are what that state turns out to
allow.

## What v2 allows

Four readings of `contracts/RelicPay.sol`, each of which kills a v1 flow outright.

**1. A buyer cannot open an agreement.** `createAgreementWithRWA` is `onlyOwner`. There is no other
creation entry point on RelicPay: `createAgreementWithCredit` exists on EnhancedBnpl, not here. So
the v1 click-to-finance button, which ends in the buyer's wallet signing an agreement into
existence, has no transaction behind it in v2 and cannot be given one from the extension side.

**2. Every agreement is backed by a tokenized relic.** Creation requires
`authorizedNFTs[rwaAsset.nftContract]`, and the `RWAAsset` carries a `physicalId`, an `nftContract`
and a `tokenId`. There is no generic-merchandise path. v2 finances Optic Relics, not carts. An
extension matching `<all_urls>` is therefore offering a product the protocol cannot sell on every
page where it has nothing to say.

**3. The protocol does not price anything.** `_getCollateralValue` returns
`position.amount + position.stakingRewards` under a comment reading "assume 1:1 ratio for demo",
and RelicPay never calls PriceOracle at all. `depositERC20Collateral` adds raw `amount` with no
decimal normalization. So `creditLimit` is a raw integer sum across assets whose units differ, and
`totalPrice` is compared against it directly. There is no sound conversion from a merchant's dollar
price to a `totalPrice`, because the quantity on the other side of the comparison is not
denominated in dollars, or in anything.

**4. `maxAgreementDuration` is not enforced.** It is declared in `GovernanceParams`, initialized to
365 days, and read by nothing. `installmentCount * dueIntervalSeconds` is bounded only by uint32.

## The question

Given the above, what is the extension's terminal action, and where does it run?

## Decision

**The extension quotes. It never creates.** The furthest a buyer-side action goes is a signed
*request* for an agreement, carried to whoever holds owner. Agreement creation stays operator-side.

**Quotes are scoped to listings, not to pages.** A quote requires an `nftContract` that
`authorizedNFTs` returns true for. `<all_urls>` is replaced by seller-scoped matching.

**A fiat price is not an input to a quote unless a rate comes with it.** The quoter takes an
explicit `rate` and refuses without one. It does not consult PriceOracle, because RelicPay does not
either, and a quote derived from a price the settlement path ignores would be a number with no
relationship to the agreement it describes.

**All chain reads and all quoting run in the service worker.** The content script observes and
renders; it never reads state and never computes terms.

**The amount a buyer confirms is rendered by the extension, not by the page.**

**A quote never refuses what the chain would accept.** ADR-002's rule, carried over: where a gate
is checked against a value the contract recomputes on the way in, the quote softens rather than
rejects.

## Why

**Owner-gated creation is a fact about the protocol, not a gap to route around.** The alternative
would be relaying an unsigned intent to a hot owner key that signs whatever arrives, which is a
service that opens debt in a stranger's name on request. Owner is the protocol's admin key; it also
sets credit ratios and token allowlists. The gate is doing work. So the extension's job ends at a
request, and the thing that makes the request meaningful is that the buyer signed it: a signature
over the terms is checkable later against what was actually created, which is the property a buyer
needs when the agreement was opened by someone else.

**Scoping to authorized NFTs is the only way the quote can be about something.** An offer needs a
`totalPrice` and an asset. On an arbitrary retailer's page there is no asset: nothing has been
minted, no `physicalId` exists, and `createAgreementWithRWA` would revert on the authorization
check even if owner signed it. Injecting a financing button there advertises a flow that terminates
in a revert. Scoping also collapses the permission surface: v1 asked for `host_permissions` on
`https://*/*` plus `tabs` and `scripting` to read every page a user visits, to support a feature
that only functions on a seller's own site.

**Finding 3 is the one that shapes the module most, and the temptation is to fix it here.** The
oracle exists, `getUSDValue` works, and it would take one call to convert a scraped dollar price
into something. But that conversion would be fiction in the direction that matters: the credit
check is `creditLines[buyer].availableCredit < totalPrice`, and `availableCredit` comes from the
unpriced raw sum. Converting the price through an oracle the other side never consults produces a
number that compares against nothing. Worse, it would read as diligence. So the quoter takes the
rate as a declared input and reports which unit the answer is in, and the unsound-sum problem is
surfaced rather than papered over: when a buyer's positions span assets of differing decimals, the
quote carries a conservative figure counting only 18-decimal assets alongside the contract's own
figure, and says they disagree. Fixing the valuation itself is a contract change and belongs on the
roadmap as one, not smuggled into a UI layer.

**The trust boundary is what makes this different from the dashboard, and it is new.** ADR-001 could
put reads on a server because the dashboard renders pages the operator controls. A content script
runs in an isolated world but shares a DOM with a page that is free to write anything into it,
including a price. So a scraped figure is a *claim*, and the service worker's first job is to check
the claim against chain state before quoting from it. This is also why the confirmed amount must be
extension-rendered: a page that can put `$40.00` under a button while the request carries 4000 ETH
has defeated any amount of care taken further down. The page is where the buyer looks; it must not
be where the buyer agrees.

**Finding 4 becomes a warning, not a rejection.** A 40-year schedule is almost certainly a mistake,
but the contract accepts it, and ADR-002 forbids a preflight stricter than the chain. So the
duration bound is reported as policy, labeled as the quoter's own and not the protocol's.

## Consequences

The three parts this splits into, and the roadmap now carries them separately:

- **part a (this ADR, plus `extension/lib/offer.js`)**: the quote layer. Framework free, no
  `chrome.*`, provable against ganache in the existing suite.
- **part b**: the request channel. What a signed request is, how it reaches an operator, and the
  MV3 message plumbing between content script, service worker and popup.
- **part c**: the extension shell. A rewritten manifest with seller-scoped matches and the
  `host_permissions` reduction that follows, the injected surface, and the popup that renders the
  confirmation.

Two things are now owed to the contract roadmap rather than the extension:

- Collateral valuation is unsound across mixed decimals (finding 3). This is not in the V1-BUG-1..5
  list, so it was inherited from v1 without being characterized. It should be characterized and then
  fixed, and the fix is the PriceOracle wiring that `_getCollateralValue`'s own comment promises.
- `maxAgreementDuration` is dead (finding 4). Either enforce it in `createAgreementWithRWA` or
  remove it from `GovernanceParams`, since a governance parameter that governs nothing will be read
  by someone as a guarantee.

What this decision costs: the extension is no longer a BNPL button for the open web, which is what
the v1 prototype looked like and what a reader of "browser extension" probably pictures. It is a
financing surface on a relic seller's own storefront. That is a smaller product. It is also the only
one the contracts currently support, and the pilot next on the roadmap is a single seller's first
three relics, so the scoped version is what that pilot needs anyway.

## Amendment, 2026-09-27 (same day, on review before merge)

Two inputs in the first draft of `offer.js` came from the listing, which this ADR defines as a claim
from a hostile page, and both would have let the page steer a trust decision:

- `listing.isCreditDenominated` let the page skip the rate conversion. Whether a seller prices in the
  credit unit is now operator config, passed as `rate: { creditDenominated: true }`.
- `listing.tokenDecimals` let the page declare a collateral token 18-decimal and so suppress the
  unsound-units warning about it. Decimals now come from `createOfferQuoter({ tokenDecimals })`,
  sourced from the operator's token registry, and a token in neither place is counted as unknown.

A fiat rate must also name its `currency`, and a listing priced in any other currency is refused as
`RATE_CURRENCY_MISMATCH`. Without that, a USD rate would convert a euro price as if it were dollars.

The same review found three parser defects, each of which produced a confident wrong number rather
than a refusal: `$12345.67` read as $123.00, an ASCII space accepted as a thousands separator
(`$5 100 reviews` read as $5,100), and `$45 $89` read as $45 because the second `$` was consumed as
the first price's trailing marker. All three are fixed and pinned by tests.

