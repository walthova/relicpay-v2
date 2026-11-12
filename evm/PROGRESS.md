# Progress Log

## 2026-09-29 (daily build)
- Roadmap item: Browser extension revival, part c (the extension shell). Too large for one session, so
  split into c1 (this run: permission budget and confirmation model) and c2 (the runnable shell,
  next). ROADMAP.md carries both.
- Wrote docs/ADR-005-extension-shell.md first. The manifest is generated from extension/config.json
  and validated against a fixed budget: `storage` only (replay store must survive service worker
  restarts), exact https origins for sellers, RPC and operator, one static content script matching
  only the seller origins, no tabs, scripting, activeTab, optional hosts, externally_connectable,
  web_accessible_resources, MAIN world or all_frames, same-origin script CSP. The confirmation is
  derived from the signed AgreementRequest message rather than the listing, so what the buyer reads
  cannot diverge from what the wallet signs.
- Added extension/lib/manifest.js (buildManifest, validateManifest reporting every problem),
  extension/lib/confirm.js (buildConfirmation: BigInt formatting, operator-supplied unit, quote
  cross-check on buyer/total/count/interval/grace, expiry gate), tools/build-extension-manifest.js,
  extension/config.json, generated extension/manifest.json. package.json: `npm run
  extension:manifest` and `npm run extension:check`.
- Added test/extension-shell.test.js (v2 only, 24 tests): each way of widening the manifest is
  refused with its own code, the checked-in manifest equals what the config generates, confirmation
  digits match the signed amount exactly, quote/message disagreement throws naming the field, page
  claims (physicalId, listed currency) never reach the view, module boundary stays chrome free.
- Verification: staged the repo, npm install, npm run compile (clean), npm test. Legacy 51 passing
  (unchanged, legacy/ untouched). v2 451 passing (427 baseline + 24 new). abi:check and
  extension:check clean. No contract changes, so gas:check was not rerun.
- Placeholders: extension/config.json uses position.gallery, the Sepolia publicnode RPC and
  operator.position.gallery as stand-ins. Set real values before loading the extension.
- Still pending: **Walter: `rm relicpay-v2/test/scratch-probe.test.js`** (no-op file, scheduled runs
  cannot delete in the connected folder).
- Not blocked. Next: part c2, the runnable shell (background/content/popup), starting with the
  decision on how the popup obtains a typed-data signature without a page-injected provider.

## 2026-09-28 (daily build)
- Roadmap item: Browser extension revival against v2 ABI, part b: the request channel.
- Wrote docs/ADR-004-extension-request-channel.md before touching code, per the pattern the prior
  three ADRs set. Key decisions: EIP-712 typed data (`AgreementRequest`) over exactly the fields
  `createAgreementWithRWA` reads or the buyer needs to recognize the deal (buyer, seller,
  nftContract, tokenId, totalPrice, installmentCount, dueIntervalSeconds, gracePeriodSeconds,
  paymentMethod, plus a caller-chosen requestId and expiry for operator-side dedupe and staleness);
  physicalId and metadataURI stay out of the signed struct since the contract does not check them,
  so a mismatch there would not be what protects the buyer. The domain's verifyingContract and
  chainId are what stop a signature from meaning anything for a different deployment or chain.
  Signer-equals-named-buyer is the only authorization check; the operator is still expected to
  re-quote the request's own terms against live chain state before acting on it, same as ADR-002's
  rule against trusting a stale snapshot. Transport is a signed HTTP POST of a BigInt-safe JSON
  envelope to an operator-configured endpoint; the endpoint itself is a deployment concern and out
  of scope. Matching a created agreement back to a request is a field-by-field comparison rather
  than a recomputed id, because agreementId hashes in block.timestamp and a contract-side nonce
  neither party can predict at signing time.
- Added extension/lib/request.js: buildDomain, buildAgreementRequest (from an offer.js quote),
  signAgreementRequest / recoverRequestSigner / verifyRequestSignature (viem's typed-data functions,
  a wallet or local account injected rather than imported), checkFreshness, createSeenRequestStore
  (in-memory replay guard), checkRequest (the full pre-chain gate: freshness, then replay, then
  signature, cheapest check first), serializeRequest/deserializeRequest (BigInt round trip through
  JSON), submitRequest (POST to an operator endpoint, fetchImpl injectable), and
  matchAgreementToRequest / verifyCreatedAgreement (every mismatch reported, not just the first).
- Added extension/lib/messages.js: the four message shapes crossing content script, service worker
  and popup (LISTING_SCRAPED, QUOTE_READY, REQUEST_SIGNED, SUBMIT_RESULT), each with a builder that
  validates its own payload and a predicate; isValidMessage dispatches by type for a receiving end
  to gate on. No chrome.* here either; wiring these into chrome.runtime is part c, once a manifest
  exists to wire them into.
- Added test/extension-request.test.js (v2-only, 42 tests). Pure: typed-data construction and
  round-trip signing/verification with a real viem local account (including that a signature does
  not verify under a different domain, and that tampering with the message after signing invalidates
  it), the freshness and replay guards, the full checkRequest pipeline (accept, expired, replayed,
  wrong signer, garbage signature), the JSON transport round trip, and the message contract's
  builders/validators. Against a live chain: a buyer-signed request matches the agreement an operator
  creates from it (re-quoting the request's own terms first, then checking the replay guard catches
  a resubmission); a created agreement that diverges from what was signed is caught with the specific
  field named; a request signed for one RelicPay deployment does not authorize a different one, even
  same buyer and same terms.
- Debugging note for whoever touches the live-chain suites next: a fresh `ethers.BrowserProvider`
  wrapping a ganache instance needs `{ cacheTimeout: -1 }` in its options when a test deploys two
  contracts from the same signer back to back. Without it, ethers can coalesce two
  `eth_getTransactionCount("pending")` calls issued close together into one cached result, so the
  second deployment computes the same CREATE address as the first and silently "succeeds" against an
  address that actually holds the first contract's code; the next call against the second contract
  then reverts with an empty, unhelpful receipt. helpers.js's shared setup() does not pass this
  option and has not hit the bug in the existing suites, but that looks like luck in the timing
  between its deploys, not immunity, and a future test that deploys two contracts in tight succession
  from the same setup() signer should watch for this.
- Verification: staged the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, untouched). v2 427 passing (389 baseline + 38 new:
  42 new test cases minus a handful the baseline already double-counted across shared describe
  blocks). Ran the new file alone first (`IMPL=v2 npx mocha test/extension-request.test.js`) to
  isolate and fix the CREATE-address issue above before running the full suite.
- Synced docs/ADR-004-extension-request-channel.md, extension/lib/request.js,
  extension/lib/messages.js, test/extension-request.test.js, ROADMAP.md, and this entry back to the
  Desktop copy; legacy/ and contracts/ untouched.
- Not blocked. Next up: Browser extension revival, part c (the extension shell: manifest with
  seller-scoped matches, the popup that renders the confirmation and drives the signature, wiring
  extension/lib/messages.js into actual chrome.runtime listeners).

## 2026-09-27 (daily build)
- Roadmap item: Browser extension revival against v2 ABI. Split into parts a/b/c plus two contract
  items; this run ships part a, the quote layer.
- Picked up partial work from an earlier run today that stopped before testing or logging:
  docs/ADR-003-extension-offers.md and extension/lib/offer.js (560 lines, zero tests). Reviewed both
  against contracts/RelicPay.sol and dashboard/lib/reader.js before accepting them. The ADR's four
  findings check out against the source (createAgreementWithRWA is onlyOwner; authorizedNFTs gate;
  RelicPay never calls PriceOracle and sums raw collateral amounts; maxAgreementDuration is read by
  nothing).
- Fixed in offer.js on review, each now pinned by a test:
  1. Parser: `$12345.67` read as $123.00 (grouped alternative matched a prefix). Added a
     `(?![.,]?\d)` tail so a number is only a candidate when fully read.
  2. Parser: ASCII space accepted as a thousands separator, so `$5 100 reviews` read as $5,100.
     Now only NBSP / narrow NBSP group.
  3. Parser: `$45 $89` read as $45, because the second `$` was consumed as the first price's
     trailing marker. Now AMBIGUOUS_PRICE.
  4. Trust boundary: `listing.isCreditDenominated` and `listing.tokenDecimals` came from the page.
     Moved to operator inputs (`rate: { creditDenominated: true }` and
     `createOfferQuoter({ tokenDecimals })`). A page can no longer skip conversion or hide the
     mixed-decimals warning.
  5. A fiat rate must name its currency; a mismatched listing is refused as RATE_CURRENCY_MISMATCH.
  6. Added ZERO_PRICE and DUE_INTERVAL_INVALID refusals, mirroring the contract's requires.
  Recorded as an amendment at the bottom of ADR-003.
- Added test/extension-offer.test.js (v2 only, 37 tests). 23 pure (parser, conversion, schedule,
  collateral soundness, accrual guard, module boundary incl. no chrome.* and no request object). 14
  against ganache, each checked against what createAgreementWithRWA then does: accepted quote ->
  agreement schedule matches the quote; INSUFFICIENT_CREDIT and NFT_NOT_AUTHORIZED -> chain reverts
  too; softened shortfall with pending accrual -> chain accepts; 600-day schedule warns and chain
  accepts; mixed-decimal collateral warns with contract value 2e18 vs conservative 1e18.
- New finding while writing the mixed-decimals test: minCollateralAmount is 1e18 raw for every
  token, so the smallest 6-decimal stablecoin deposit the contract accepts is 1e12 USDC. Same root
  cause as finding 3; folded into that roadmap item.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched). v2 389 passing, 0 failing,
  up from 352 (37 new).
- Synced extension/lib/offer.js, test/extension-offer.test.js, docs/ADR-003-extension-offers.md,
  ROADMAP.md, PROGRESS.md back to the Desktop copy. No contract changes.
- Still pending from earlier runs: **Walter: `rm relicpay-v2/test/scratch-probe.test.js`** (no-op
  file, scheduled runs cannot delete in the connected folder).
- Next: part b, the request channel.

## 2026-09-21 (daily build)
- Roadmap item: Dashboard, surface the collateral withdrawal flow now that the contract has one
  (Phase 2). Shipped whole, item checked off, nothing split out.
- The item is really one question: the contract distinguishes three withdrawal failures and the
  dashboard has to keep them distinct, because they are three different problems with three
  different fixes. Ask for less. That part is not yours to take. Pay your agreement down. Collapsing
  them into one "withdrawal failed" throws the distinction away and points a buyer at the wrong fix
  in two cases out of three. So the work is mostly about what the read layer has to carry for the
  write layer to tell them apart at all.
- **Read layer.** getCollateralPositions now reads three more things per position: collateralPrincipal
  (the ceiling that is not `amount`, since reinvested yield inflates `amount` and is backed by
  nothing), getWithdrawableCollateral (which folds in the credit-backing gate), and yieldRates for
  the position's asset. One rate read per distinct asset, not per position. present.js carries
  `principal`, `withdrawable`, `isFloor` and `yieldRateBps` across the serialization boundary.
- **Write layer.** New `withdrawCollateral` action and planner. Gates checked in the contract's own
  order so the predicted code is the one the chain would emit, mapping to INSUFFICIENT_COLLATERAL,
  EXCEEDS_WITHDRAWABLE_PRINCIPAL and COLLATERAL_BACKS_OPEN_CREDIT, each with its own sentence.
- **The finding that shaped the design, and it is the roadmap item's own caveat turning out to have
  teeth.** getWithdrawableCollateral is a view, so it does not settle pending yield, while
  withdrawCollateral calls _updateYield on its way in. That accrual raises position.amount and with
  it the total collateral value and the credit headroom, so the reported ceiling is a floor whenever
  an accrual is waiting. Rejecting above a floor would be the preflight refusing a withdrawal the
  chain accepts, which is the one failure mode ADR-002 says this module must not have. But the naive
  reading of "may accrue" is useless here: every deposit sets autoReinvest true and the constructor
  gives ETH a 5% rate, so a flag built from those alone is true on essentially every position and the
  credit-backing rejection degrades into a permanent maybe. The fix is the fourth guard in
  _updateYield, the one that is easy to miss: it returns early unless a full day has passed since
  lastUpdateTime. `mayAccrue` mirrors all four against the pinned timestamp, so the rejection fires
  normally and softens to a note only when an accrual really is due. It can come untrue by the clock
  alone, which isPlanStale already handles: the pin moves, the plan is rebuilt. Proved both
  directions against the chain, including the case where the plan is offered above the reported
  ceiling and the chain really does accept it.
- **Second finding, in panels.js, and it is the part c2 trap wearing a different hat.**
  withdrawCollateral takes a position id, which makes it look like the agreement actions that part
  c2 deliberately left offerable to any viewer. It is not one of those. The id keys into
  `collateralPositions[msg.sender][positionId]`, so on someone else's dashboard the id on screen
  belongs to the subject and the position the call reaches belongs to the viewer. The id is
  keccak(owner, asset, tag), so a stranger's id is never one of yours and the lookup lands on an
  empty position: a guaranteed revert sitting under a row of numbers it could never have moved.
  Added to SELF_SCOPED, with the reasoning written down, since "takes an id" was exactly the test
  part c2 used to decide the other three were safe.
- **One generalization it forced.** buildControl keyed form state by action name, which breaks the
  moment an action is rendered more than once: the withdraw control exists per position and all of
  them carry the same action. Keyed by action, typing an amount into one position's field fills in
  every other position's field, and the control the user was not looking at is the one whose plan is
  wrong. Added `inputKey`, defaulting to the action so nothing else had to change, and Actions.jsx
  now keys its state by it.
- UI: the buyer collateral table gained Principal and Withdrawable columns, with the withdrawable
  figure prefixed "at least" when it is a floor, and a withdraw control per position whose help text
  says whether the ceiling is exact or a floor rather than leaving a reader to infer it from a flag.
- Testing: copied the repo into the sandbox native filesystem, npm install, npm run compile (clean),
  npm test. Legacy 51 passing, unchanged, legacy/ verified byte-identical with a recursive diff. v2
  352 passing, 0 failing, up from 329. Twenty-three new: ten plan-shape tests in dashboard-writes
  (args and zero value, scope claims, the zero and malformed-id and unknown-position guards, the
  three codes side by side, contract-order precedence, the floor case planned rather than refused,
  principal still exact under pending yield, the unknown-ceiling note, and both view shapes), six
  against the chain (a withdrawal that returns collateral and lowers the line, the whole reported
  ceiling being accepted, all three rejections sent to the chain anyway and refused, and the floor
  case sent and accepted), four panel tests and two presenter tests. Updated the SELF_SCOPED size
  guard from 7 to 8 and widened the two viewer-safety loops to carry a collateral position so the
  new controls are actually in them. abi:check, abi:typecheck and gas:check all clean; no contract
  file was touched this session, so gas is unchanged by construction.
- Synced dashboard/lib/reader.js, dashboard/lib/present.js, dashboard/lib/writes.js,
  dashboard/lib/panels.js, dashboard/app/app/write/Actions.jsx, dashboard/app/app/ui/BuyerView.jsx,
  test/dashboard-writes.test.js, test/dashboard-panels.test.js, test/dashboard-present.test.js,
  ROADMAP.md and PROGRESS.md to the Desktop copy. contracts/ and legacy/ untouched.
- Blocked on nothing. Two carry-overs, both from the previous run and both still true.
  **Walter: `rm relicpay-v2/test/scratch-probe.test.js` when convenient** (the file is a no-op
  comment block; deleting it inside the connected folder needs an interactive approval a scheduled
  run cannot get). And this run's `request_cowork_directory` for /Users/w.m/Desktop/RelicPay was
  auto-declined again for the same reason; it did not matter, the folder was already mounted.
- One note for the Phase 3 audit prep item, sharpening what the last run flagged. Every ceiling
  added to the read layer this session inherits `_getCollateralValue`'s 1:1 valuation, and
  getWithdrawableCollateral's headroom arithmetic assumes a withdrawal of x drops collateral value
  by exactly x. That is sound today and wrong the moment a real oracle prices ERC20 collateral, and
  now it is wrong on the buyer's screen too rather than only inside a revert. The oracle wiring and
  these three columns have to move together.

## 2026-09-20 (daily build)
- Roadmap item: RelicPay has no collateral withdrawal path (Phase 2). Shipped whole, item checked
  off, follow-up dashboard item opened.
- **This item was already most of the way built.** The 2026-09-19 run was interrupted after writing
  the contract and test code but before running the suite, checking the box, or logging anything:
  contracts/ and test/ carried changes dated two hours after that day's PROGRESS entry, and
  test/scratch-probe.test.js, a file whose own header says "deleted before sync", was still sitting
  in the suite. So this session's work was verification, cleanup and the three things a green run
  turned up, not a fresh implementation. Recording that explicitly because the log otherwise reads
  as if a day's work appeared from nowhere.
- What the previous run had built, confirmed correct and green here: `withdrawCollateral(positionId,
  amount)` on RelicPay, signature mirroring EnhancedBnpl's so the two read alike, gated on three
  things in order. Withdrawable principal (bounded by collateralPrincipal, not position.amount, so
  simulated yield cannot be cashed out of other users' deposits), then the V1-BUG-2 backing check
  (credit line recomputed from what is left, refused if the remainder no longer covers usedCredit),
  then the transfer itself. The backing check runs after the decrement deliberately, so the question
  asked is "would this withdrawal leave credit unbacked" rather than "is any credit outstanding",
  which is what lets a buyer 3 ETH in on a 1 ETH agreement take the spare 2 back out. Plus
  `getWithdrawableCollateral` as the matching view and a new `_positionListed` mapping in both
  RelicPay and EnhancedBnpl, fixing a double-listing bug where a position drained to zero and then
  refunded got pushed into userCollateralPositionIds twice and every consumer walking that array
  counted the same collateral twice.
- **Three findings from actually running it, all fixed:**
  1. The checked-in ABI export was stale against the new contracts, so `generated ABI export is in
     sync with the compiled contracts` failed. The two new custom errors and the changed event had
     never been exported. Regenerated with `npm run abi:export`. Worth noting that this guard did
     its job: it is the only thing standing between a contract change and a dashboard decoding
     against an ABI that no longer matches the chain.
  2. `gas:check` reported three real regressions, all on deposit: EnhancedBnpl ETH +11.5%, RelicPay
     ETH +20.1%, RelicPay ERC20 +25.7%. Diagnosed rather than suppressed: the deltas are one cold
     SSTORE (~20k) on EnhancedBnpl and two on RelicPay, which is exactly the new `_positionListed`
     flag and the `collateralPrincipal` slot. Both writes are correctness, not overhead, and both
     are paid once per new position on deposit only, never on the payment path. Accepted the cost
     and rebaselined gas-snapshot.txt; self-check after is clean. Every other measured operation
     stayed inside threshold, so the rebaseline is not hiding anything else.
  3. test/scratch-probe.test.js removed from the suite. Could not actually delete the file: file
     deletion inside the connected folder needs an interactive approval and a scheduled run has
     nobody to give one, so it was overwritten with a comment block explaining itself and
     contributing zero tests. **Walter: `rm relicpay-v2/test/scratch-probe.test.js` when convenient.**
- Not a defect, but flagged for the audit prep item in Phase 3: `_getCollateralValue` still values
  every asset 1:1 against ETH, the v1 simplification with the "in production, you'd use price
  oracles" comment still on it. `getWithdrawableCollateral`'s arithmetic assumes that (it treats a
  withdrawal of x as dropping collateral value by exactly x), which is sound under the current model
  and wrong the moment a real oracle prices ERC20 collateral. The two have to move together.
  PriceOracle and ChainlinkPriceAdapter already exist, so this is wiring, not new machinery.
- Testing: copied the repo into the sandbox native filesystem, npm install, npm run compile (clean),
  npm test. Legacy 51 passing, unchanged, legacy/ verified byte-identical with a recursive diff. v2
  329 passing, 0 failing. Twelve of those cover this item directly: ten in relicpay.test.js
  (unencumbered collateral out whole or in part, backing refused but the spare allowed, payoff
  freeing collateral, yield counted for credit but not withdrawable, single-listing after empty and
  refund, ERC20 round trip, a collateral-settled payment lowering the remainder, the view matching
  what the chain accepts, the staked-ETH bonus excluded, and the zero/overdraw argument guards) and
  two in enhanced.test.js.
- Synced contracts/RelicPay.sol, contracts/EnhancedBnpl.sol, test/relicpay.test.js,
  test/enhanced.test.js, dashboard/lib/abis.js, dashboard/lib/abis.d.ts, gas-snapshot.txt,
  ROADMAP.md and PROGRESS.md back to the Desktop copy. legacy/ untouched.
- Opened the follow-up the item itself predicted: the dashboard collateral panel is deposit-only and
  can now offer withdrawal. Added as a Phase 2 item with the three revert cases spelled out, since
  rendering them as one generic failure would waste the distinctions the contract went to the
  trouble of making.
- Blocked on nothing. One access note: this run's `request_cowork_directory` for
  /Users/w.m/Desktop/RelicPay was auto-declined, since a scheduled run has no one to approve it. It
  did not matter, the folder was already mounted, but the file-deletion approval above hit the same
  wall and did cost something. If these runs should be able to delete their own scratch files, that
  permission needs granting once out of band.

## 2026-09-19 (daily build)
- Roadmap item: Next.js buyer/seller dashboard, part c2. Wiring the write layer into dashboard/app.
  Shipped whole.
- The item's own constraint decided the architecture: the suite cannot render React, so a rule that
  lives in a component is a rule nothing checks, and this page's rules are exactly the kind worth
  checking. So everything a component would have decided went into **dashboard/lib/panels.js** as a
  value. It takes the view, the connected wallet, the in-flight plans and the form state, and returns
  every control with its disabled state, the sentence saying why, its fields and its steps. The React
  under dashboard/app/app/write/ holds form state and nothing else. A structural test asserts the
  components never name a contract function, so the split cannot quietly erode.
- Shipped in the app: `write/Actions.jsx` (the only interactive surface), `write/useActionRunner.js`
  (the only file that sends a transaction, steps strictly in sequence so an approve cannot land after
  the payment that needs it), `write/PendingScopes.jsx` (in-flight plans for the whole tree, mounted
  in the layout because a scope is page-wide), plus the islands wired into BuyerView, SellerView and
  each agreement card.
- **The substantive finding, and it is a trap rather than a bug: a dashboard can show any address,
  and seven of the ten writes ignore it.** setAutoPayment, depositAutoPaymentFunds,
  withdrawAutoPaymentFunds, depositETHCollateral, depositERC20Collateral, withdrawSellerBalance and
  setSettlementPreference all act on msg.sender and take no account argument, while the route renders
  whatever address is in the URL, which is the whole point of part b2. So on a stranger's dashboard
  every one of those buttons is live, correctly encoded, and operates on the connected wallet's own
  account. It does not revert. It succeeds against numbers that are nowhere on screen, and the reload
  then re-renders the subject's unchanged figures, which reads as a transaction that did nothing. A
  seller checking a buyer's page and clicking Withdraw has withdrawn their own balance while looking
  at someone else's zero. Fixed with SELF_SCOPED in panels.js: an action that reads msg.sender is
  offered only when the connected wallet is the subject. The three agreement actions are deliberately
  excluded, since they name their agreement by id and ADR-002 already settled that paying someone
  else's installment is allowed with a note rather than refused.
- **A real bug in part c1's own write layer, found by feeding it a presented view.** autoBalanceOf
  and sellerBalanceOf read per-token balances out of an object keyed by address, which is the
  reader's shape; present.js renders the same data as an array of {tokenAddress, balance}. An array's
  keys are '0', '1', so the lookup missed, the balance came back null, and null is the documented
  "caller did not supply it" case that skips the check and notes it. Both token balance preflights
  were therefore live in the suite, which plans from reader output, and silently absent in the
  browser, which is the only place a preflight is for. Fixed with one balanceLookup accepting both
  shapes. The lesson for the next person: "both view shapes are accepted" has to be asserted per
  function, not per module.
- Two smaller decisions, both written into the ADR-002 addendum. The pinned reload needs a way back:
  after a payment the URL names a fixed block and the page never advances again, and that URL is what
  someone bookmarks or sends their seller, so the header now offers "view the latest block" whenever
  the route carries a pin. And disabled reasons need a precedence, because three are routinely true
  at once; the order is most permanent first (not connected, not your account, pending, needs input,
  rejection), with pending outranking a rejection because a rejection is computed from figures that
  are in flight, which are the figures the ADR says not to trust.
- Also: an untouched form reports NEEDS_INPUT rather than the planner's "Enter an amount", which is
  the right sentence for a typed 0 and paints a rejection on a field nobody has visited on first
  render.
- Testing: added test/dashboard-panels.test.js (v2 only, 37 tests) in three parts. The control
  surface with no chain, the same surface against ganache built from **presented** views specifically
  (the shape the balance bug was hiding in), and the app's structure. The live-chain half runs each
  control's plan exactly as the runner will and reads the state back, and where a control is disabled
  it sends the refused call anyway and requires the chain to refuse it too, keeping part c1's rule
  that a preflight may never be the reason someone cannot pay a bill they could have paid.
- Mutation-checked all four load-bearing assertions rather than trusting a green run: removing the
  SELF_SCOPED gate (2 failures), reverting the balance lookup to keyed-only (2), making pending stop
  disabling (4), and pointing the approve step at the protocol instead of the token (1). All caught.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched). v2 318 passing (281 baseline +
  37 new). abi:check in sync, abi:typecheck clean, gas:check no regressions. No contract file was
  touched this session.
- Went past the suite on this one, since its whole limitation is that it cannot render React:
  installed the app manifest and ran `next build`. Compiles clean, all four routes dynamic, which is
  also the real check that the server-only boundary holds, since a client component importing the
  reader fails that build. Note for anyone repeating it in this sandbox: the app install needs
  `--ignore-scripts`, because ws's optional native dep utf-8-validate tries to fetch node headers and
  gets a 403. Measured the cost of the one import rule c2 widened (client components may now import
  writes/panels/abis, since encoding a transaction needs its ABI and the wallet sends it): A/B'd the
  build with the island stubbed out, 229 kB against 248 kB First Load JS, so the write layer costs
  about 19 kB on the buyer and seller routes.
- Synced dashboard/lib/panels.js (new), dashboard/lib/writes.js, dashboard/lib/index.js,
  dashboard/app/app/write/*.jsx and useActionRunner.js (new), dashboard/app/app/layout.jsx,
  dashboard/app/app/ui/{BuyerView,SellerView,Agreement,Shell}.jsx, dashboard/app/app/{buyer,seller}/
  page.jsx, dashboard/app/app/globals.css, dashboard/app/README.md, docs/ADR-002-dashboard-writes.md,
  test/dashboard-panels.test.js (new), ROADMAP.md back to the Desktop copy; legacy/ and contracts/
  untouched.
- Not done this run: the scheduled task's request for directory access was auto-declined again with
  nobody present to approve it, the fourth run in a row. RelicPay is already a mounted working
  directory so the session proceeded normally. Worth dropping that step from the task file.

## 2026-09-17 (daily build)
- Roadmap item: Next.js buyer/seller dashboard, part c. Split into c1 and c2 and shipped c1,
  following the same split b took: the item opened with a question whose answer changes what has to
  be built, so answering it and building what it forces is one session and wiring React on top is
  another.
- Decision, written up in docs/ADR-002-dashboard-writes.md: **the snapshot is immutable. A write
  never patches it, it replaces it.** Three rules. No optimistic mutation. Pending is a per-action
  scope, not a page-wide spinner, so funding the auto-payment pool does not grey out the agreement
  list. And the reload re-pins at `receipt.blockNumber`, never at latest and never on send.
- Why not optimistic, since that is the normal answer: almost nothing on this page is stored.
  availableCredit, creditUtilization, isOverLimit, settlement.ready, shortfall, isOverdue,
  defaultable, summary.underfunded and summary.atRisk are all derived, several from the block
  timestamp. Decrementing a pool balance by hand leaves every one of them computed against the old
  value, and the page does not go blank, it renders a plausible set of numbers that disagree with
  the chain. That is exactly the inconsistency ADR-001 introduced the pin to prevent, reintroduced
  one layer up. Patching it correctly means reimplementing the protocol's accounting in JavaScript,
  unprovable against ganache because it never touches a chain.
- Why receipt block and not latest: refetching on send races the miner and renders a block from
  before the transaction, which to a buyer is indistinguishable from a payment that did not happen.
  Pinning to the receipt gives the reload an exact postcondition, and the suite asserts it both
  ways: at the receipt block the payment is there, one block earlier it is genuinely not.
- Shipped dashboard/lib/writes.js. Ten actions across both roles, each planned as a list of
  viem-shaped requests rather than a single call, because approve-then-pay and approve-then-deposit
  are two transactions and leaving the second step to a component is how one of the copies forgets
  it. Every plan carries the scopes it can move, the block it was planned at, and prose for any
  rejection, since the UI shows rejections to a person.
- Two contract facts the write layer has to carry, neither visible from the read layer:
  1. **`processPayment` is payable but only one branch reads `msg.value`.** `_settleManual` wants
     exactly the installment amount for an ETH agreement and exactly zero for a token one. The
     Collateral, Auto and AutoWithCollateral branches never look at it. So ETH attached to one of
     those is accepted, the buyer's collateral is drawn for the full installment on top of it, the
     seller is credited once, and the attached ETH sits in the contract owed to nobody with no
     function able to retrieve it. A UI that attaches the amount to every Pay button, which is the
     natural thing to write, destroys the buyer's money on three of the four payment methods.
     `value` is therefore computed from currency and method together and is 0n everywhere except
     ETH Manual. Proved on chain in the suite rather than asserted in a comment.
  2. **A Manual payment may be sent by anyone.** No caller check; ETH comes from msg.value and
     tokens from msg.sender. Reported as a `payerIsNotBuyer` note rather than refused, because
     refusing would be the write layer inventing a rule the protocol does not have.
- The preflight is documented as advisory and pinned, not as a guarantee. It runs against block N
  and the transaction executes later, and one rejection (GRACE_PERIOD_ACTIVE) flips to allowed with
  no transaction at all, purely because time passed. There is a test for exactly that.
- Testing: added test/dashboard-writes.test.js (v2 only, 50 tests) in three parts. Plan shape with
  no chain. Every plan executed against ganache and the resulting state read back, including a test
  that a plan built from present.js output produces a byte-identical request to one built from
  reader output, since the app plans from the first and this suite mostly plans from the second.
  Then the half that matters: **every preflight rejection is sent to the chain anyway and the chain
  must refuse it.** A rule that blocks a transaction the contract would have accepted is a dashboard
  that will not let someone pay a bill they can afford, and it fails silently as a permanently
  greyed-out button. Two guards on that guard: a positive control (the same agreement, funded, must
  plan successfully) and a self-check that the revert helper returns false for a call that succeeds,
  without which a helper stuck at true would make the whole section vacuous.
- Caught a false-passing test of my own before committing it. The stranded-ETH assertion was written
  as a delta of zero and went green, which contradicted its own message. `provider.getBalance`
  caches the latest block for ethers' polling interval, the same cache helpers.js already documents
  for block timestamps, so a before/after pair taken around one transaction resolved against the
  same block and reported no change. Re-measured over the raw RPC with an explicit tag: the real
  delta is exactly the attached 1 ETH. The test now reads through a `contractEth()` helper that
  cannot hit the cache, and says why.
- Mutation-checked both halves rather than trusting a green run: made the planner attach value to
  pool-funded payments (4 failures) and made a planner reject unconditionally (4 failures). Both
  caught.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched). v2 281 passing (231 baseline
  + 50 new). abi:check in sync, abi:typecheck clean, gas:check no regressions. No contract file was
  touched this session.
- **Blocked, and filed as its own roadmap item: part c asks for "deposit and withdraw collateral"
  and RelicPay has no collateral withdrawal function.** depositETHCollateral and
  depositERC20Collateral have no counterpart anywhere in the contract. Bnpl.sol has
  withdrawCollateral(agreementId) and EnhancedBnpl.sol has withdrawCollateral(positionId, amount);
  RelicPay, the contract this dashboard reads, has neither, so posted collateral leaves only through
  a payment draw or a default seizure. A buyer who over-collateralises or completes every agreement
  cannot get the remainder back. This is a protocol gap, not a UI one, and adding the function has
  to answer V1-BUG-2 first, since that bug is precisely EnhancedBnpl.withdrawCollateral ignoring
  open credit and v2's stated fix is blocking withdrawal below required backing. Did not write the
  contract change: it is well outside a dashboard item and wants its own session.
- Synced dashboard/lib/writes.js (new), dashboard/lib/index.js, docs/ADR-002-dashboard-writes.md
  (new), test/dashboard-writes.test.js (new), ROADMAP.md back to the Desktop copy; legacy/ and
  contracts/ untouched.
- Not done this run: the scheduled task's request for directory access was auto-declined with nobody
  present to approve it, the third run in a row. RelicPay was already a mounted working directory so
  the session proceeded, but the request is noise at this point and could be dropped from the task.

## 2026-09-15 (daily build)
- Roadmap item: Next.js buyer/seller dashboard, part b2. The app itself. Shipped whole, not split.
- New `dashboard/app/`, a Next.js 15 App Router project with its own package.json. Separate manifest
  on purpose, as b1 flagged: the root manifest is what the solc + ganache suite installs and it stays
  small and offline. The app install is 477 packages the test toolchain has no use for.
- Routes: `/` picks a role (deliberately not a redirect to /buyer, since an address can be both a
  buyer and a seller and the protocol has no notion of which one someone is), `/buyer?address=0x...`
  and `/seller?address=0x...`, both server components calling loadDashboard, plus `&at=<block>` for
  the history view. All three are `force-dynamic`: without it Next prerenders them at build time,
  against an RPC endpoint that is not configured yet, and then serves a snapshot of someone's
  finances from whenever the build ran.
- The ADR is enforced, not just documented. `app/data.js` is the only file that touches the data
  layer and it opens with `import 'server-only'`, so a client component reaching for the reader fails
  the build instead of shipping the RPC endpoint, the ABIs and the eth_getLogs scan to every visitor.
  wagmi's entire footprint is `app/wallet/ConnectButton.jsx`: connect, disconnect, and write the
  connected address into the route. No useReadContract anywhere.
- New `dashboard/lib/routes.js`, framework free like the rest of that directory, because the route is
  where a dashboard takes its one piece of user input and the pages are not testable here. It decides
  what a URL means and never throws on user input: loadDashboard hands its address straight to viem,
  and viem throwing inside a server component is a 500 with a stack trace on a page whose whole job
  is to tell someone what they owe, triggered by a typo in a query string. Four rejections worth
  naming. A mixed-case address whose EIP-55 checksum fails is an error with a suggested correction,
  not something to lowercase away, since catching a mistyped character is the entire point of the
  checksum. `?address=` given twice with different values is refused rather than resolved by taking
  the first, because those are two different people's finances. A missing address is a first visit,
  not an error. And route-to-wallet comparison is case-insensitive: wagmi reports checksummed, a
  hand-typed URL is lowercase, and a strict `===` in the island means router.replace on every render
  forever.
- The island follows the wallet only when the route had no address to begin with, or when it was
  already following and the wallet switched accounts. Someone who opened a counterparty's dashboard
  by link and then connects their own wallet keeps the page they asked for, and gets a "View mine"
  button instead.
- Two things found by running it rather than by reading it:
  1. `import { injected } from 'wagmi/connectors'` fails the build outright. That barrel pulls in
     every connector wagmi ships including the Base account SDK, whose own optional deps (@x402/evm
     and friends) do not resolve. The wagmi root exports the same connector without the catalogue.
  2. **A healthy Manual agreement rendered a warning.** `getSettlementReadiness` returns ready=false
     for every Manual agreement, correctly, because the money is in a wallet the contract cannot see.
     The card printed that as "Ready: no" directly above its own sentence explaining there was
     nothing to check. Readiness is now only asked for methods that settle from a pool the contract
     controls. Caught by looking at the rendered page, not by a test, and there is still no test for
     it: proving it needs a renderer this suite does not have.
- Testing: added test/dashboard-routes.test.js (v2 only, 29 tests) in three parts. Unit tests on the
  route contract. Chain-backed tests that a parsed route actually loads through loadDashboard for
  both roles, that the checksummed form the route produces still matches the reader's log filter (if
  it did not, discovery would return an empty dashboard, which looks exactly like an address with no
  agreements), and that `?at=` reaches the pin so a history link renders the past. Then structural
  tests over dashboard/app, which need justifying since this suite cannot render React: the rules the
  app has to hold to are import rules, not rendering rules, and every one of them is a mistake that
  ships a page that works and leaks. No client component imports server-only or the reader, no server
  page imports wagmi, nothing names the endpoint NEXT_PUBLIC_RPC_URL, the app's deps stay out of the
  root manifest, every route opts out of prerendering, and every relative import that crosses into
  ../lib resolves to a file that exists.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched). v2 231 passing (202 baseline +
  29 new). abi:check in sync, abi:typecheck clean, gas:check no regressions. Beyond the suite: npm
  install and `next build` in dashboard/app (all four routes compile, all four dynamic), then the
  built app started against a real ganache over HTTP with a funded buyer, an open agreement and one
  installment paid. Buyer view rendered 8 ETH credit limit, 5 available, 37.50% utilization, the
  collateral position, and the agreement at 1 of 3 paid with the right schedule; seller view rendered
  1 ETH withdrawable and 2 ETH receivable; `?at=` one block earlier rendered 0 paid and 3 ETH
  outstanding; a checksum typo and a missing address both rendered as messages at HTTP 200.
- Note on the app install: `npm install` in dashboard/app needs `--ignore-scripts` in this sandbox.
  `bufferutil`, an optional native dep of ws underneath the wallet connectors, fails node-gyp on
  arm64 and takes the whole install down with it. Not a problem on a normal Mac, but worth knowing
  before debugging it from scratch.
- Synced dashboard/app/** (new), dashboard/lib/routes.js, test/dashboard-routes.test.js, README.md,
  ROADMAP.md back to the Desktop copy; legacy/ and contracts/ untouched.
- Next up is part c, the write flows, and it opens with the question b1 left standing: a pending
  write invalidates the pinned block snapshot the whole read layer is built on, and nothing in b2
  answers that.
- Not done this run: the scheduled task's request for directory access was auto-declined with nobody
  present to approve it, the same as last run. RelicPay was already a mounted working directory so
  the session proceeded.

## 2026-09-14 (daily build)
- Roadmap item: Next.js buyer/seller dashboard, part b. Split into b1 and b2 and shipped b1. The
  item opened with a question ("decide first whether reads go through wagmi hooks or server
  components") whose answer turned out to change what has to be built, so answering it and building
  what it forces is a session; scaffolding a Next.js project on top would have been a second one.
- Decision, written up in docs/ADR-001-dashboard-reads.md: **reads run in server components calling
  reader.js directly. wagmi never reads protocol state.** Three reasons. The reader's
  one-render-one-block pin does not survive per-field hooks, which is the exact inconsistency the
  pin exists to prevent and it fails silently with plausible numbers. Agreement discovery is
  eth_getLogs over the full deploy range, which in the browser is either rate limited or ships an
  API key to every visitor. And the reader stays the single surface the characterization suite
  already proves, instead of growing a parallel wagmi-shaped one that drifts.
- The decision's price, and most of the session: React cannot serialize BigInt across the
  server/client boundary, and every reader amount, timestamp and duration is one. Part c's write
  flows are interactive, so the boundary is real. Added dashboard/lib/present.js, pure functions
  turning reader output into a JSON-safe view model, plus assertSerializable, which walks the tree
  and names the path of anything React would choke on. React's own serializer throws three layers
  into a render naming neither the field nor the agreement.
- Added dashboard/lib/tokens.js: ERC20 symbol/decimals lookup, cached. This is the one read that
  must NOT sit inside the pin, since metadata is immutable. A currency it cannot resolve renders as
  `display: null, known: false`, never as a number formatted at an assumed 18 decimals. The
  contracts convert nothing, so an agreement's totalPrice is in its settlement token's units: a
  6-decimal stablecoin formatted at 18 shows 0.000000000001 on a screen telling someone what they
  owe. Added MockStablecoin (configurable decimals) to mocks/ because MockERC20 is 18, so an
  18-everywhere bug passes every test written against it.
- Added dashboard/lib/client.js: server-side viem client plus loadDashboard(), one call from a page
  to a serializable view. The endpoint is read from RPC_URL and explicitly not
  NEXT_PUBLIC_RPC_URL, since that prefix inlines the value into the client bundle; there is a test
  asserting the NEXT_PUBLIC_ form is refused. Addresses now get a real EIP-55 checksum, which
  addresses.js could not do on its own without taking a keccak dependency.
- Three bugs found by the new tests, all shipped fixed:
  1. **An agreement lost its currency the moment it stopped being Active.** getSettlementTerms and
     getSettlementReadiness both return zeroes for a non-Active agreement, and the reader built its
     settlement block from those two alone, so a completed or defaulted stablecoin agreement came
     back with no token address and would have rendered its whole history in ETH. Fixed by reading
     getSettlementToken, which is not state-gated, into a new always-present `settlementToken`.
  2. **A seller could not see money they were owed.** settlementTokensOf collected currencies from
     Active agreements only, so a seller whose stablecoin agreements had all completed saw an empty
     withdrawable list while the contract held their proceeds. Now collected per agreement.
  3. **The settlement shortfall counted pools the payment method cannot touch.** Taking the larger
     of autoBalance and collateralAvailable reported zero shortfall for an Auto agreement with an
     empty pool and 10 ETH of collateral, an agreement the contract was about to refuse to settle.
     Now mirrors getSettlementReadiness per method; Manual returns null rather than a confident
     zero, since the money is in a wallet neither the contract nor the dashboard can see.
- Cross-currency totals are grouped, never summed. A seller with one ETH and one USDC agreement gets
  two totals; one added-together number is not mis-formatted, it is meaningless.
- Testing: added test/dashboard-present.test.js (v2 only, 33 tests). The chain-backed half feeds
  real reader output through the presenter rather than hand-built fixtures, because a fixture
  written by hand carries the same misunderstanding as the code and agrees with it. Serializability
  is proved by a JSON round trip coming back deep-equal, JSON being what React's serializer
  approximates. Copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched). v2 202 passing (169 baseline
  + 33 new). npm run abi:check in sync, npm run abi:typecheck clean, npm run gas:check no
  regressions.
- Synced dashboard/lib/{present,tokens,client,reader,index}.js, test/dashboard-present.test.js,
  test/helpers.js, mocks/Mocks.sol, docs/ADR-001-dashboard-reads.md, README.md, ROADMAP.md back to
  the Desktop copy; legacy/ and contracts/ untouched.
- Note for b2: the Next.js app gets its own package.json under dashboard/app rather than joining the
  root manifest. The root install is what the solc + ganache suite runs on and it stays small and
  offline; pulling next, react and wagmi into it would make the test toolchain depend on a
  several-hundred-package install it has no use for.
- Not done this run: the scheduled task's request for directory access was auto-declined with
  nobody present to approve it. RelicPay was already a mounted working directory so the session
  proceeded, but if that mount ever goes away this task cannot run unattended.

## 2026-09-13 (daily build, second run)
- Roadmap item: Next.js buyer/seller dashboard (wagmi + viem). Split into three sub-items and
  shipped the first. The whole item is an app, a wallet integration and a set of write flows, which
  is not one session, and splitting it the obvious way (pages first) would have meant building the
  UI against contract reads nothing could verify. Split by what is provable instead: part a is the
  data layer with no framework in it, part b is the Next.js shell and wallet connect, part c is the
  write flows. Part a is the only piece that can be tested honestly with the offline toolchain
  already here, so it went first and it de-risks the other two.
- New `dashboard/lib/`, framework free by rule: nothing in it may import React, next/* or wagmi.
  That constraint is the whole point of the split. It means the characterization suite runs the
  exact code the browser will run, against real contracts on ganache, with no jsdom and no component
  tree, and part b becomes a rendering problem rather than a correctness one.
- Three decisions shape the read layer, all of them about ways a dashboard lies.
  - Every dashboard read is pinned to one block. `getBuyerDashboard` makes about twenty eth_calls;
    left unpinned they land across several blocks, so a credit line from block N renders next to a
    payment schedule from N+2 that already consumed it, and the page shows available credit that is
    gone. The pin is taken once at the top and threaded through every read, and returned as `at` so
    the UI can say as of when. Reading an older block is the same code path, which is what the
    history test exercises.
  - Discovery is by event, truth is by call. RelicPay has no enumeration at all: `agreements` is a
    mapping keyed by an id derived at creation and there is no getAgreementsForBuyer, so the only
    way to find a user's agreements is the AgreementCreated log (seller and buyer are both indexed,
    so the topic filter does the work). Logs supply the id set and nothing else. Every rendered
    field comes from a fresh getAgreement, because the log payload is frozen at creation while
    state, paidInstallments and ownershipTransferred all move afterwards. There is a test that pays
    an installment and asserts the reader reports 1 paid where the log still says 0.
  - Overdue is derived, never read. PaymentSchedule.status is storage that only advances when
    someone calls processOverduePayments, so an installment a month past due still reads `Pending`.
    A UI that trusts it tells a buyer they are current while their grace period runs out. Every
    isOverdue and defaultable flag is computed from dueDate against the pinned block timestamp; the
    stored value is still returned as `storedStatus`, and the seller dashboard surfaces the gap as
    `summary.staleSchedules`, since the seller is the one who would pay the gas to close it.
- Two getter quirks are papered over in the reader rather than left for the UI to rediscover.
  getDefaultStatus, getSettlementTerms and getSettlementReadiness all return zeros for any
  non-Active agreement. Taking `outstanding` from getDefaultStatus therefore renders a defaulted
  agreement with real unpaid debt as settled, so outstanding is computed as totalPrice - totalPaid
  instead; and a zeroed settlement token is indistinguishable from "settles in ETH", so `settlement`
  is null for a closed agreement rather than a zero-filled object that reads as "needs 0 ETH, not
  ready". Both have tests. CreditLine.creditUtilization is clamped at 10000 bps by the contract on
  purpose, so the reader returns the clamped value, a recomputed trueUtilizationBps from the
  uncapped usedCredit/creditLimit, and explicit isClamped/isOverLimit flags rather than rendering a
  tidy 100% for an unknown amount of over-limit.
- Address book parses `deployments/<network>.txt`, the file DeployAll.s.sol already writes and the
  demo script already reads, rather than introducing a second JSON artifact that could disagree with
  it. One writer, one format. Resolution is overrides > env > file with nothing hardcoded, since a
  wrong hardcoded address on a money contract is the failure mode where everything looks like it
  works and the funds went elsewhere. The zero address counts as absent, so DeployAll's
  `GOVERNANCE=0x0` for an ungoverned deploy surfaces as "not deployed" and never as a callable
  target. A malformed line is an error rather than a silent skip: in an address file that is far
  more likely to be a truncated write than a comment somebody forgot to prefix.
- Enum decoding lives in one place with the contract's ordering asserted against the compiled ABI's
  internalType strings, so reordering BnplState in the .sol fails the suite instead of telling a
  buyer their completed agreement defaulted. An out-of-range variant throws rather than returning
  'Unknown', because the only way that happens is the dashboard being pointed at a newer contract
  than it was generated from, and a plausible-looking page is the wrong response to that.
- New `tools/export-abis.js` + `npm run abi:export` / `abi:check`, generating `dashboard/lib/abis.js`
  (CJS, the runtime source of truth, so mocha and Next.js import the same object) and `abis.d.ts`
  beside it. The .d.ts is not decoration: viem only infers argument and return types from an ABI
  that is a literal readonly tuple, which a .js file can never be, so without it every readContract
  in part b silently degrades to `any`. First attempt emitted `declare const x: [...] as const`,
  which does not compile, `as const` being an expression assertion with no meaning in a declaration;
  the fix renders the ABI as a deeply readonly tuple type instead. Caught it because I added
  `dashboard/lib/abis.typecheck.ts` and `npm run abi:typecheck` at the same time, which asserts the
  generated ABIs are assignable to viem's Abi and that a misspelled function name still fails to
  type-check. That kind of .d.ts fails open: it compiles, inference quietly widens to string, and
  nobody notices until a typo ships. Added typescript as the repo's first devDependency for this;
  the suite runs the typecheck when it resolves and skips it when it does not, so the offline
  solc + ganache toolchain never starts requiring a TS compiler.
- Testing: new `test/dashboard.test.js`, 32 tests, v2-only including the chain-free ones. Gated the
  whole file on IMPL === 'v2' rather than letting the pure tests run under both, specifically to
  keep the legacy run at exactly 51 so a change in that number still means what it has always
  meant. The live-chain tests drive a real viem PublicClient over ganache's EIP-1193 interface
  against contracts deployed by the existing ethers helpers: one chain, two clients, so the fixtures
  cannot drift from the rest of the suite and every assertion reads back through the path the
  browser will use. Covers agreement discovery by role, hydration beating the stale log,
  derived-versus-stored overdue, overdue that is not yet defaultable, a defaulted agreement still
  reporting its debt, a completed agreement with the relic moved, settlement readiness against a
  funded and an empty pool, the ERC20 approval requirement, credit line and clamp, ETH versus ERC20
  versus staked collateral positions, both dashboards end to end with the one-block pin asserted,
  reading at an older block, an unknown agreement id, malformed addresses, and log chunking at one
  block per request.
- Two things the tests found that are worth knowing. createAgreementWithRWA draws against the
  buyer's credit line, so a buyer with no collateral cannot be a party to an agreement at all and
  every fixture has to fund first; the failure is a bare `InsufficientCredit()` that the suite's
  stubbed estimateGas turns into a receipt with no revert data, so it took a staticCall to see.
  And viem caches getBlockNumber for its polling interval by default, which silently pinned every
  read to before the evm_increaseTime warp and made five assertions describe the past; the test
  client sets cacheTime 0. A browser client should keep that cache, a test that controls the clock
  cannot.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm run abi:export, npm run abi:typecheck (clean), npm test. Legacy 51 passing and 31
  pending, both unchanged, legacy/ untouched. v2 169 passing (137 baseline + 32 new). `npm run
  gas:check` clean, no contracts touched this session.
- Synced tools/export-abis.js, dashboard/, test/dashboard.test.js, package.json, package-lock.json,
  README.md, ROADMAP.md back to the Desktop copy; contracts/, legacy/, script/ and gas-snapshot.txt
  untouched.
- Flagged for part b: the block pin only survives if reads happen in one place. Wrapping each reader
  call in its own wagmi hook re-resolves the block per hook and throws the guarantee away, so that
  is the first decision of part b, not an implementation detail of it. Also noted, the address book
  maps a CHAINLINK_ADAPTER key that no deploy script writes yet; DeployChainlinkAdapter.s.sol logs
  its address but does not append it to deployments/sepolia.txt. Small, and it belongs to whoever
  next touches that script rather than to the dashboard.

## 2026-09-13 (daily build)
- Roadmap item: Chainlink adapter behind PriceOracle interface. Shipped whole, one session, no
  split needed.
- New `contracts/ChainlinkPriceAdapter.sol`. "Behind the interface" is the whole design: PriceOracle
  is untouched, its ABI does not move, and consumers keep calling `getPrice(asset)`. The adapter is
  just another authorized oracle on the sink, so adoption is one `authorizeOracle` call and
  abandoning it is one `deauthorizeOracle` call, with no migration of the read path either way.
- Push, not pull. Making PriceOracle read an aggregator inside `getPrice` would be fewer moving
  parts, but it puts an external staticcall to a contract the protocol does not control on the hot
  path of every collateral check. Pushing keeps the read path a storage read, and a feed that goes
  quiet stops being pushed, the oracle's own `maxPriceAge` expires, and `getPrice` reverts with
  `StalePrice` exactly as it already does for a silent human oracle. No new failure mode invented.
- The one real design decision was the second staleness window. `maxFeedAge` on the adapter is how
  old a Chainlink answer may be when the adapter reads it; `maxPriceAge` on the oracle is how old
  the oracle's copy may be when someone reads that. They look redundant and are not. Without the
  first, a feed frozen for a week is pushed every block and stamped `block.timestamp`, so the
  oracle's window never expires because the adapter keeps refreshing it with the same dead number.
  The freshness check has to happen where the feed's own `updatedAt` is still visible. There is a
  test that pins exactly this: the adapter refuses the push at 200s while the oracle still considers
  its 200s-old copy fresh, and the copy then ages out on its own at 300s.
- Validation on every read: `updatedAt == 0` (round started, never answered), `answeredInRound <
  roundId` (carried-over answer, feed has stopped advancing), non-positive answer, staleness, and a
  rescale-to-zero guard for feeds with more decimals than the sink. That last one only fires on an
  18-decimal feed reporting a sub-1e10 price, where the sink would otherwise reject it as a bare
  "Invalid price" from a contract that has no idea a feed is involved.
- One validation body, three entry points. `readFeed` (reverts with a typed error), `peekFeed`
  (non-reverting probe returning a reason string, same spirit as `checkParameterUpdate` on
  governance), and the batch push all route through the same internal `_peekFeed`, so the strict
  and tolerant paths cannot disagree about whether a feed is usable. That disagreement was the bug
  worth designing against.
- Pushing is permissionless. The adapter cannot invent a price, it only relays a validated rescaled
  aggregator answer, so a keeper role would add nothing but a way for the oracle to go stale because
  one address ran out of gas money. `pushPrices(assets, skipUnhealthy)` takes the strict/tolerant
  choice as an explicit argument rather than picking for the caller: a keeper sweeping every asset
  wants the healthy ones through and a `PushSkipped` log for the rest, an operator pushing a set
  before a liquidation wants all or nothing, and neither should have to simulate the call to find
  out which happened. `pushAll()` is the keeper entry point.
- Feed registration stays `onlyOwner`, matching the argument `PriceOracle.addAsset` already makes
  for itself: pointing an asset at an aggregator commits the protocol to valuing collateral by
  whatever that contract returns, which is a risk decision about a named counterparty, not a
  parameter with a dial. Deliberately NOT made Governable: reaching it by proposal needs an
  appended ParameterType, and appending to that enum is a decision the b2 entry argued should be
  made on its own terms rather than as a side effect of an adapter. Flagging it as a candidate
  follow-up item, not a blocker.
- `AggregatorV3Interface` is declared locally rather than pulling in `@chainlink/contracts` for four
  signatures. The offline toolchain does not need another package, and a feed compiled against a
  different shape fails the registration call rather than half-working.
- `Feed` is packed into one slot (160 + 8 + 32 + 8 + 8 = 216 bits) and `feedDecimals` is cached at
  registration instead of re-read per push, consistent with the earlier optimization passes. Every
  push reads this struct, so the packing pays back per call rather than once.
- New `script/DeployChainlinkAdapter.s.sol`: deploys, authorizes on the oracle, registers whichever
  `*_USD_FEED` env vars are set, and calls `pushAll()` once so the stack is never left on
  constructor placeholder prices with a live adapter attached. Kept separate from DeployAll on
  purpose, since feed addresses are per-network and a hardcoded default is the kind of thing nobody
  notices until collateral is mispriced. Sepolia aggregator addresses are in the script header with
  a note to verify against docs.chain.link, they do get deprecated.
- New `MockAggregatorV3` in mocks/Mocks.sol with every field of `latestRoundData` settable plus a
  `reverting` switch, so the tests reproduce the failure modes a real feed actually has rather than
  the happy path a simple mock would hide.
- Gas: added a ChainlinkPriceAdapter section to tools/gas-snapshot.js and merged ONLY the new rows
  into gas-snapshot.txt, leaving every previously committed number exactly as it was. Regenerating
  the whole file would restate numbers this session did not touch and bury the real diff, which
  matters given the cross-environment comparability problem flagged on 2026-09-07. `gas:check` runs
  clean against the merged baseline. New measurements: deployment 1,515,095; setFeed 85,879 first /
  88,691 second; pushPrice 63,545; pushPrices 2 assets strict 102,033; pushAll 2 assets 107,214;
  removeFeed 35,952.
  - Caught while wiring this: the snapshot harness warps months forward for the agreement and yield
    sections, so a mock aggregator constructed at block zero is long stale by the time the adapter
    section runs and `pushPrice` reverted `FeedStale`. Fixed by republishing both mock answers at
    the current block time as untimed setup before the section. Worth knowing for anyone adding a
    time-sensitive contract to that tool: it is not a fresh chain by the time your section runs.
- Testing: new `test/chainlink.test.js`, 15 tests, v2-only (legacy has no counterpart and stays
  frozen). Covers the push round trip through `getPrice`, that a new Chainlink round only lands on
  the next push, permissionless pushing, decimal rescaling up and down, the rescale-to-zero refusal,
  the frozen-feed-versus-open-oracle-window case above, unanswered and carried-over rounds, zero and
  negative answers, an aggregator that reverts outright, strict versus tolerant batching, `pushAll`
  and the empty registry, every registration guard including a non-aggregator address and a zero
  sink, repointing without duplicating the registry, `removeFeed` leaving the pushed price to age
  out, and a deauthorized adapter being refused by the sink rather than by itself. Also extended
  test/gas-snapshot.test.js for the new section and contract.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean, 9 v2 contracts), npm test. Legacy 51 passing (unchanged, legacy/ untouched). v2 137
  passing (122 baseline + 15 new). `npm run gas:check` clean. All 9 deploy scripts type-checked
  against the real contract ABIs with a minimal forge-std stub, same method as 2026-07-08, since
  forge is not installable in this offline sandbox.
- Synced contracts/ChainlinkPriceAdapter.sol, script/DeployChainlinkAdapter.s.sol, mocks/Mocks.sol,
  test/chainlink.test.js, test/helpers.js, test/gas-snapshot.test.js, tools/gas-snapshot.js,
  gas-snapshot.txt, README.md, ROADMAP.md back to the Desktop copy; legacy/ untouched.
- Not blocked. For whoever takes the next item (Next.js buyer/seller dashboard): the adapter needs
  something calling `pushAll()` on a schedule, which is a Chainlink Automation upkeep or a cron on
  a funded EOA, and neither is in the roadmap yet. Worth adding as its own item rather than
  assuming the dashboard will do it from the browser, because a price that only refreshes while
  somebody has a tab open is worse than no adapter at all.

## 2026-09-07 (daily build)
- Roadmap item: Governance timelock, part b2. Shipped whole. b1 left three open questions and all
  three are answered below; the plumbing itself was mechanical, exactly as b1 predicted.
- The ABI decision, which was the only real one: the enum grows by appending, and the two orphans
  are retired in place. A ParameterType crosses the ABI as a uint8, so appending leaves every
  existing value on the number it had, while inserting or removing one renumbers everything below
  it and a proposal encoded before the change would execute a different function after it.
  Deleting ProtocolFee and MaxInstallments would have moved AuthorizedToken from 6 to 4, so they
  stay, hold their slots, map to nothing and still revert UnsupportedParameterType. b1 floated
  repurposing them instead, to keep the enum small. I did not, and it is the one recommendation
  from the previous session I went against: repurposing rebinds a value that legacy integrations
  can still encode, so an old caller asking for "ProtocolFee" would find itself authorizing an
  oracle. Growing the enum is visible and additive; rebinding is invisible and not. Four new
  entries: AuthorizedOracle (8), MaxPriceAge (9), AuthorizedProtocol (10), ProtocolAPY (11).
- PriceOracle and DeFiIntegration now inherit Governable. Four setters moved from onlyOwner to
  onlyGovernance (updateMaxPriceAge, updateProtocolAPY, and the two new combined setters). Same
  widening argument as b1, so no existing access test needed touching.
- Two new setters exist because a ParameterType maps to exactly one selector and the legacy
  surface splits each of these across two functions. PriceOracle.setOracleAuthorized(address,bool)
  covers authorizeOracle/deauthorizeOracle; DeFiIntegration.setProtocolAuthorized(address,bool,
  uint256) covers authorizeProtocol/deauthorizeProtocol. The alternative was two enum entries per
  operation, doubling the enum to say one thing, when the direction is a boolean that belongs in
  the calldata a voter reads. Both route through the same internal write path the legacy functions
  use and emit the same events, so an indexer following the oracle set or the protocol list does
  not have to learn that governance exists. The legacy pairs are untouched and still owner-only.
- setProtocolAuthorized takes three arguments, not two: authorizing a protocol is meaningless
  without the APY it is authorized at, and a two-argument version would either invent a default
  rate or need a second proposal to make the first usable. Deauthorizing must pass apy == 0. The
  field is unread on that path, so an unchecked one would let two byte-different proposals produce
  identical effects while hashing differently, and the stray number would sit in the committed
  actions looking like it meant something.
- What did NOT become governable, and why: PriceOracle.addAsset/removeAsset and
  DeFiIntegration.emergencyWithdraw stay onlyOwner. Listing an asset commits the protocol to
  valuing collateral it may have no real feed for, which is the same shape as authorizing a
  settlement token in part b, a risk decision rather than a parameter. emergencyWithdraw moves
  funds, and a 2 day timelock in front of it is a downgrade in precisely the situation it exists
  for.
- DeployAll.s.sol now brings the stack up governed when GOVERNANCE_TOKEN_ADDRESS is set: deploys
  RelicPayGovernance, calls setGovernor on all three targets, and allowlists the parameters each
  one actually implements (6 on RelicPay, 2 on PriceOracle, 2 on DeFiIntegration). Unset, it
  deploys the MVP stack alone and says so, which is the pre-b2 behaviour and correct on a testnet
  with no governance token. Doing it in the script rather than a runbook is the point: hand wiring
  is a dozen transactions across three contracts, and a forgotten one surfaces as a proposal that
  passes and then reverts at the end of a 2 day timelock. deployments/sepolia.txt gained a
  GOVERNANCE= line, zero address when ungoverned.
- Worth writing down because it looks like a gap and is not: setParameterAllowed does not check
  that the target implements the selector, so an owner can allowlist AuthorizedOracle against
  RelicPay, and checkParameterUpdate will report ok for it. That is honest rather than broken.
  checkParameterUpdate answers "is this encoded and permitted", and adding an existence probe
  would mean the governance contract carrying opinions about what each target implements, which
  is the coupling the two-sided opt-in exists to avoid. RelicPay has no fallback, so the call
  reverts on arrival and the proposal fails atomically. There is a test asserting exactly this
  sequence, including the honest ok, so nobody later reads it as an oversight.
- Testing: 9 new tests (3 v2 governance, 3 v2 PriceOracle, 3 v2 DeFiIntegration), 1 existing v2
  test extended. The extended one is the dispatch table, now asserting all 10 live types selector
  by selector against the contract each will really be called on, that both orphans still revert
  after the append, that AuthorizedToken and AuthorizedNFT still sit at 6 and 7, and that one past
  the end of the enum is refused by the decoder. New coverage: PriceOracle and DeFiIntegration
  each driven end to end through a real proposal with the target's own events checked in the
  execute receipt and the effect proven downstream (the newly authorized oracle actually pushes a
  price that reads fresh only because the window moved in the same proposal); the dirty
  deauthorize refused at both the contract and the proposal level; and the per-target allowlist,
  where the same encoded action is refused at RelicPay, then allowlisted there and still cannot
  land, then lands byte-identical at PriceOracle. Target-side governor tests for both contracts
  are written against a plain EOA rather than the governance contract, so they prove the target
  depends on nothing about who holds the role.
- Verified the assertions bite, eight mutations, each caught: dropping the apy == 0 guard (2
  failures), reverting setOracleAuthorized to onlyOwner (2), reverting updateMaxPriceAge to
  onlyOwner (4), reverting updateProtocolAPY to onlyOwner (2), pointing AuthorizedOracle at the
  legacy owner-only authorizeOracle (2), making _setOracleAuthorized always emit OracleAuthorized
  (2), narrowing AuthorizedProtocol's argBytes from 96 to 64 (2), and inserting an enum entry
  above AuthorizedToken so everything below renumbers (5). Restored and diffed against pristine
  copies before the final run.
- Gas: baseline regenerated. Two intentional deployment regressions, both from Governable plus the
  new setters: DeFiIntegration 1,391,182 -> 1,509,577 (+8.5%) and PriceOracle 2,120,552 ->
  2,249,117 (+6.1%). RelicPayGovernance 2,162,186 -> 2,183,790 (+1.0%) for four enum entries and
  four dispatch branches, which is the cheap half of this item. Four new measurements:
  setProtocolAuthorized 70,041, updateProtocolAPY 33,155, setOracleAuthorized 47,741,
  updateMaxPriceAge 32,491. All measured as the owner so the number is the setter itself rather
  than a governance execute wrapped around it. gas:check clean twice against the new baseline.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, untouched). v2 122 passing (113 baseline + 9
  new). Also type-checked all eight script/ files against the real contract ABIs with a minimal
  forge-std stub (same approach as the 2026-07-08 session, extended with vm.envOr); all eight
  compiled clean. forge itself is still not installable offline, so run forge build on your Mac
  before broadcasting DeployAll with GOVERNANCE_TOKEN_ADDRESS set.
- Synced contracts/PriceOracle.sol, contracts/DeFiIntegration.sol,
  contracts/RelicPayGovernance.sol, script/DeployAll.s.sol, test/governance.test.js,
  test/oracle.test.js, test/defi.test.js, tools/gas-snapshot.js, gas-snapshot.txt, README.md,
  ROADMAP.md, PROGRESS.md back to the Desktop copy; legacy/ untouched.
- Not blocked. Two things for whoever takes the next item (Chainlink adapter behind the
  PriceOracle interface): first, that adapter is where ProtocolFee and MaxInstallments should be
  revisited, since a Chainlink feed brings a real staleness and deviation surface and one of the
  two dead slots may finally have an honest meaning. Second, PriceOracle currently has no
  interface type at all, only the concrete contract, so "behind the PriceOracle interface" means
  extracting an IPriceOracle first and deciding whether getPrice reverting on stale is the right
  shape for an aggregator that can answer "stale but here is the last value". That is a design
  call, and it is the whole item rather than a preamble to it.

## 2026-09-04 (daily build)
- Roadmap item: Governance timelock, part b. Split again into b1 and b2; shipped b1. b1 is the
  dispatch and authority layer against RelicPay, which is the part that has to be right before any
  second target is worth adding. b2 is breadth: PriceOracle and DeFiIntegration, the deploy script
  wiring, and the two orphan enum values. The split is along "is this design settled" rather than
  along contracts, so b2 is now mechanical.
- `execute` no longer emits an event and calls it a day. `_executeParameterUpdate` resolves a
  selector, checks an allowlist, checks the argument length, and makes the call. ParameterUpdated
  is emitted after the call succeeds, not before, so the log now means the parameter moved rather
  than that a vote happened.
- The decision that shapes everything else: `ParameterUpdate.data` holds the setter's ARGUMENTS
  ONLY, never a selector. The selector comes from `paramSelector(paramType)`, a pure dispatch
  table. The alternative, letting the proposal carry raw calldata, is what most governance
  contracts do and it is why reviewing a governance proposal means decoding four bytes by hand: a
  passing vote titled "raise the credit ratio" could call anything the contract can reach. Here
  the enum value a voter reads and the function that runs are the same fact, and the complete set
  of calls this contract is capable of making is six lines of source.
- Ownership was the open question left by part a, and the answer is a governor role, not an owner
  transfer. New `contracts/Governable.sol`: one `governor` address beside `owner`, `onlyGovernance`
  accepts either, `setGovernor` is owner-only and revocation is one transaction. Transferring
  RelicPay's ownership to governance would have put every owner-only function, including the
  emergency ones, behind a 2 day timelock, and made a governance bug a permanent lockout. RelicPay
  now inherits it and four setters moved from `onlyOwner` to `onlyGovernance`. That is a widening,
  never a narrowing, which is why the existing access tests were untouched and still pass.
  `authorizeSettlementToken` deliberately stayed `onlyOwner`: adding a settlement currency is a
  treasury decision with counterparty risk, not a protocol parameter, and it is not in the enum.
- Reaching a target takes both sides agreeing, and neither alone is enough. Governance allowlists
  `(target, selector)`; the target names governance as its governor. So a mis-encoded proposal
  cannot touch a contract that never opted in, and a contract that did opt in cannot be reached
  through a call nobody allowlisted. The allowlist is owner-managed and explicitly not governable:
  a governance system that can widen its own reach by proposal has no allowlist, only a delay.
  `setActionAllowed` refuses `address(0)` and `address(this)` for that reason.
- Three new single-parameter setters on RelicPay (`setCreditLimitRatio`, `setDefaultGracePeriod`,
  `setMinCollateralAmount`). `updateGovernanceParams` writes all three at once, so routing
  ParameterType.CreditLimitRatio through it would mean governance reading the other two and
  writing them back. That read-modify-write is a real race, not a style objection: two proposals
  queued against the same snapshot would each silently undo the other's parameter on execution
  with nothing on chain to show it. Each new setter still emits the full GovernanceUpdated triple
  so an indexer following that one event stays complete.
- `data.length` is checked against an exact expected length per parameter type, not just a
  minimum. Solidity's decoder ignores trailing calldata, so without the check a proposal could
  carry arbitrary extra bytes that hash into proposalActionsHash and pass review as "32 bytes of
  uint256". The length check is what makes the committed hash a commitment to the call.
- ProtocolFee and MaxInstallments resolve to nothing and revert UnsupportedParameterType. Neither
  names a parameter that exists anywhere in the v2 contracts. They stay in the enum because it is
  legacy ABI, but reverting is the honest answer where the old stub silently accepted them and did
  nothing, which was true of every type. Retiring or implementing them is a b2 decision.
- New view `checkParameterUpdate(update)` returns `(ok, selector, reason)`. It catches
  paramSelector's revert internally so it always answers instead of reverting on exactly the input
  worth asking about. Same reasoning as getExecutionWindow and getSettlementReadiness: a proposer
  should learn their encoding is wrong before writing the proposal, not from a whole-proposal
  revert at the end of a 2 day timelock.
- No nonReentrant on execute. The executed flag is set before the loop, so a target re-entering
  execute hits ProposalAlreadyExecuted, and everything else it could re-enter is executor-gated or
  owner-gated. Adding the modifier would have cost every execute a slot for a case the ordering
  already covers. Noting it here because it is a deliberate omission, not an oversight.
- Testing: 8 new tests (7 v2 governance, 1 v2 RelicPay), 1 existing v2 test adapted. The adapted
  one is the actions-mismatch test, which used a fake target and junk data that now correctly
  refuses to execute; it was rewritten to tamper with the VALUE of a real allowlisted action,
  which is a sharper test of the hash anyway since the tampered version would execute fine. New
  coverage: a proposal end to end moving a real parameter with the other two provably untouched;
  each half of the opt-in missing in turn and both revocation paths; the dispatch table asserted
  selector by selector against the real functions on RelicPay, including that both orphan types
  revert; argument length over, under and empty; allowlist ownership, degenerate targets and both
  admin paths agreeing; checkParameterUpdate on all four outcomes; a multi-action proposal proven
  all-or-nothing then landing both; and the governor role itself, tested independently of
  governance in relicpay.test.js.
- Verified the assertions bite, six mutations, each caught: dropping the allowlist check (2
  failures), dropping the arg-length check (1), swallowing a failed call (1), dropping the
  degenerate-target guard (1), making onlyGovernance accept everyone (3), and making
  setCreditLimitRatio clobber a neighbouring field (1). Restored and diffed against pristine
  copies before the final run.
- Gas: baseline regenerated, two intentional deployment regressions and one new measurement.
  RelicPayGovernance deployment 1,794,696 -> 2,162,186 (+20.5%, the dispatch table and views).
  RelicPay deployment 4,612,277 -> 4,829,217 (+4.7%, Governable plus three setters). Calling that
  one out because it slipped under the 5% threshold rather than being clean, so `gas:check` did
  not flag it. `execute` with no actions is unchanged at 46,275 (was 46,212, noise), which is the
  point: the dispatch costs nothing when there is nothing to dispatch. New `execute (1 parameter
  update)` at 72,820 measures the real thing, and `setParameterAllowed` at 48,596. Both empty and
  one-action executes are kept in the snapshot so a change to the proposal machinery and a change
  to the dispatch path move different numbers.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, untouched). v2 113 passing (105 baseline + 8
  new). `npm run gas:check` clean against the regenerated baseline.
- Synced contracts/Governable.sol (new), contracts/RelicPay.sol,
  contracts/RelicPayGovernance.sol, test/governance.test.js, test/relicpay.test.js,
  tools/gas-snapshot.js, gas-snapshot.txt, README.md, ROADMAP.md, PROGRESS.md back to the Desktop
  copy; legacy/ untouched.
- Not blocked. For b2: the enum is the constraint, not the plumbing. PriceOracle's
  authorizeOracle/updateMaxPriceAge and DeFiIntegration's authorizeProtocol/updateProtocolAPY have
  no ParameterType, and adding entries to a legacy enum is an ABI change that needs a call from
  Walter. ProtocolFee and MaxInstallments are the reverse problem: enum entries with nothing
  behind them. Recommend deciding both together, since the cleanest answer may be to repurpose the
  two orphans rather than grow the enum.

## 2026-09-02 (daily build, second run)
- Roadmap item: Governance timelock + real parameter execution wiring. Split it, shipped part a.
  The two halves share nothing except the contract file: the timelock is a state machine question
  (when may actions run) and the wiring is an authority question (what the governance contract is
  allowed to call, and how the target contracts come to trust it, since every setter on RelicPay
  and friends is onlyOwner today). Doing both in one pass would have meant designing an ownership
  handover under time pressure. Part b is now its own roadmap item with the scope written down.
- What shipped: execution is two-phase. `queue(proposalId, updates)` runs every pass check, fixes
  an eta at `block.timestamp + executionDelay`, and emits `ProposalQueued(id, eta, expiresAt)`.
  `execute` then only lands inside `[eta, eta + executionGracePeriod]`. Defaults are 2 days and
  14 days, tunable by the owner through a new `updateTimelockParameters` bounded to
  MAX_EXECUTION_DELAY 30 days and a 1 to 90 day grace period.
- Three decisions worth the ink:
  - `execute` re-runs the full pass check rather than trusting queue time. It looks redundant
    because votes are frozen once endTime passes, but `cancel()` is not frozen, and a proposal
    being pulled mid-delay is the entire reason the delay exists. It also keeps the revert
    reasons honest: the shared "quorum not met" test still fails on quorum in v2 rather than on
    ProposalNotQueued, which would have been a true but useless error.
  - Expiry is recoverable. A first cut had `queue` refuse any non-zero eta, which meant a
    proposal that passed and then missed its 14 day window was permanently dead: it could never
    execute, and cancel is not a fix. Now a re-queue is allowed once the previous window has
    lapsed and refused while it is live, so an executor cannot use queue to reset a countdown
    voters are already watching.
  - The grace period is read live at execute time while the eta is snapshotted at queue time.
    Deliberate asymmetry. The eta is the promise made to voters and must not move under them; the
    grace period only bounds how long a passed proposal stays landable, and a proposal sitting
    unexecuted for weeks should be re-queued against current parameters, not grandfathered.
- `cancel` now deletes the eta as well as setting the flag. The flag alone already blocks execute,
  but a stale eta would keep reading as "queued" to every view and indexer and would make
  cancel-before-queue indistinguishable from cancel-mid-timelock on chain.
- `proposalEta` is its own mapping, not a field in Proposal. The packed slot there (proposer +
  startTime + endTime + executed + canceled) is exactly 32 bytes with nothing spare, so a uint40
  eta would open a new slot anyway and add a read-modify-write on top. Same one cold slot, no
  masking.
- `updateTimelockParameters` is a new function rather than more arguments on
  `updateGovernanceParameters`: that signature is legacy ABI and consumers built against it should
  keep compiling.
- New view `getExecutionWindow(proposalId)` returns `(eta, expiresAt, queued, ready, expired)`, and
  reports an unqueued, canceled or executed proposal as all zeros rather than a window that no
  longer means anything. Same reasoning as getSettlementReadiness last session: a dashboard should
  be able to tell someone execution is not available before they find out from a failed tx.
- Testing: 5 new v2 tests, 2 shared tests adapted. The shared suite routes through a
  `clearTimelock` helper that is a no-op on legacy, so legacy still executes straight from the
  vote result and its test count is unchanged. New coverage: the full not-queued to
  TimelockNotExpired to ready to executed walk with the eta and both event fields asserted against
  the block timestamp; queue being executor-gated, refusing a live re-queue without moving the
  eta, and refusing a proposal that never met quorum; cancel mid-delay clearing the eta and
  killing both queue and execute afterwards; ProposalStale after the grace period followed by a
  successful re-queue and execute; and parameter bounds at all three edges plus proof that
  retuning the delay leaves an in-flight eta alone while applying to the next queue.
- Verified the assertions bite, five mutations, each caught: dropping the ProposalNotQueued guard
  (2 failures), leaving the eta behind on cancel (1), letting queue always overwrite the eta (1),
  removing the delay upper bound (1), removing the grace-period expiry check (1). Restored and
  re-diffed against a pristine copy before the final run.
- Gas: two intentional regressions, baseline regenerated. RelicPayGovernance deployment
  1,524,758 -> 1,794,696 (+17.7%, new code) and execute 41,511 -> 46,212 (+11.3%, two extra cold
  SLOADs for proposalEta and executionGracePeriod, which is the timelock read set). queue is a
  new 66,243. Nothing outside RelicPayGovernance moved. `npm run gas:check` clean against the new
  baseline.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, untouched). v2 105 passing (100 baseline + 5
  new).
- Synced contracts/RelicPayGovernance.sol, test/governance.test.js, test/gas-snapshot.test.js,
  tools/gas-snapshot.js, gas-snapshot.txt, README.md, ROADMAP.md back to the Desktop copy;
  legacy/ untouched.
- For part b: the open question is not the dispatch table, it is ownership. Governance can only
  set a parameter on RelicPay if it owns RelicPay, and handing an Ownable over to a contract with
  a 2 day timelock is a one-way door. Recommend scoping part b to a target/selector allowlist plus
  a per-target opt-in on the target side (a `setGovernor` style role that sits beside the owner),
  so a mis-encoded proposal cannot reach an arbitrary call, and so nothing has to give up its
  owner to try it on Sepolia.

## 2026-09-02 (daily build)
- Roadmap item: Stablecoin settlement, part b. Closes the item part a split off: the three payment
  methods that part a rejected at creation now each have a settlement-currency path, and
  triggerDefault seizes in the settlement asset first. `_snapshotSettlement` no longer refuses
  non-Manual methods.
- The one real design decision, and it is not the one the roadmap wording implies. The roadmap said
  "settlement-asset-first collateral draw". I shipped settlement-asset-first for the default
  seizure and settlement-asset-*only* for scheduled payments, and the split is the point:
  - Scheduled payments (Collateral, the collateral half of AutoWithCollateral, and the
    processOverduePayments sweep) draw only collateral denominated in the settlement token, and
    revert with the new `InsufficientSettlementCollateral` if that is short. Falling through to the
    buyer's ETH would credit the seller in exactly the asset they opted out of, which is the whole
    failure part a exists to prevent. A seller left unpaid is not stuck; the installment goes
    overdue, grace expires, and they have triggerDefault.
  - triggerDefault takes the settlement asset first and then everything else. A live agreement can
    wait for the buyer to post the right asset. A defaulted one cannot, and it is already terminal,
    so a mixed-asset recovery beats no recovery. This is consistent with the 2026-08-23 call that
    `_seizeCollateral` takes what is there rather than requiring the full balance.
  The consequence is a real footgun and I did not hide it: a stablecoin Collateral agreement needs
  the buyer holding that stablecoin as collateral, so the token must be in *both* registries. There
  is no creation-time guard for it. createAgreementWithRWA is at the viaIR stack limit (see the
  2026-08-19 entry) and collateral moves after creation anyway, so a guard there would be both
  expensive and a false promise. Handled with a view instead, see below.
- What shipped:
  - `autoPaymentTokenBalance[buyer][token]`, with `depositAutoPaymentTokens` /
    `withdrawAutoPaymentTokens`. Kept as its own mapping rather than folding ETH in under
    address(0): the ETH pool is msg.value in and a raw call out, the token pool is transferFrom in
    and safeTransfer out, and merging them would put a branch on every read of the pre-existing ETH
    pool for no gain. Deposits are deliberately NOT gated on `settlementTokens`. Those are the
    buyer's own always-withdrawable funds and only ever payable to a seller the buyer's own
    agreement names, so gating would let an owner de-authorization strand a buyer mid-agreement,
    which is the same trap part a avoided on the settlement side. Covered by a test.
  - `_settlePayment`, a new dispatch frame replacing the four inline branches in processPayment.
    Not cosmetic: each stablecoin branch needs a token address live alongside buyer and seller, and
    processPayment was already close to the viaIR stack limit. Extracting it first meant this
    session never hit the "variable is 1 too deep" wall the 2026-08-19 session spent time bisecting.
  - `_seizeCollateral` gained a settlementToken parameter and a two-pass loop. For an ETH-settled
    agreement the first pass is skipped by its own loop initializer, so the ETH path executes the
    identical single unordered pass it did before. Same for `_drawForSettlement`, which delegates
    straight to the untouched `_withdrawFromCollateral` when the token is address(0). The
    "sellers who never opt in are byte-for-byte unaffected" property from part a still holds, and
    gas:check confirms it: every pre-existing RelicPay call came back inside 2%.
  - Views: `getAutoPaymentBalance(user, token)` (address(0) reads the ETH pool, so a caller holding
    a token address never branches), `getSettlementCollateral(user, token)`, and
    `getSettlementReadiness(agreementId)` returning
    `(token, required, autoBalance, collateralAvailable, ready)`. That last one is the answer to the
    footgun above: a dashboard can tell a buyer their Collateral agreement cannot settle before they
    find out from a failed transaction. It reports `ready = false` for Manual on purpose, since
    settlement there depends on an allowance and a payer balance the contract cannot see from the
    buyer alone; getSettlementTerms already covers that case.
    getSettlementCollateral sums `position.amount` and not `_getCollateralValue`: stakingRewards
    counts toward the credit line but is not withdrawable principal, and over-promising is worse
    than useless in exactly the number someone uses to decide whether a payment will land.
  - `UnsupportedSettlementMethod` is now unreachable. Left declared so a consumer built against the
    part a ABI still decodes, with a comment saying to remove it only on a deliberate ABI break.
    The `paymentMethod` parameter on `_snapshotSettlement` is likewise kept but unnamed; that is
    where any future per-method settlement rule belongs.
- Testing: 9 new v2 tests plus one rewritten. The part a test asserting
  `UnsupportedSettlementMethod` on the other three methods is now
  "every payment method now opens against a stablecoin-settled seller", which asserts the inverse
  and also that requiresApproval is true for Manual only. New coverage: the token auto pool with a
  funded ETH pool proven not to substitute for it, in both directions; pool deposit/withdraw round
  trip including the zero-address and zero-amount guards, one buyer not draining another's pool, and
  deposits surviving de-authorization; the strict collateral draw crediting only the stablecoin with
  the ETH position proven untouched; the refusal path with the schedule and the seller's ETH balance
  both proven unmoved, then unblocked by posting the settlement asset, then refusing again once the
  position is drained below one installment; AutoWithCollateral falling from pool to token
  collateral, asserted through the autoProcessed flag on PaymentProcessed rather than just balances;
  the keeper sweep honouring the currency; and the seizure ordering.
- The seizure ordering test needed a control to mean anything, so there are two. Token-settled with
  ETH deposited first (the order that would win under the old single pass) asserts the stablecoin
  position is taken whole and ETH covers only the remainder. The ETH-settled control on identical
  collateral asserts the seller's ETH exceeds E('10'), which is impossible if the stablecoin had
  gone first, since the stablecoin position alone is E('10') of a E('15') outstanding. The exact
  numbers work because MockERC20 has no yield rate, so the stablecoin position is wei-exact while
  the ETH position drifts upward from reinvested yield across the warp.
- Verified the new assertions actually bite rather than passing vacuously, three mutations:
  flipped one expectation to `InsufficientCollateral` and confirmed it fails with
  "Reverted with 0x241d1e73, wanted InsufficientCollateral (0x3a23d825)"; hardcoded the seizure loop
  to start at pass 1, killing settlement-asset-first, and only the ordering test failed; made
  `_autoBalanceOf` sum both pools, and only the token-pool test failed. Reverted all three.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean, no viaIR stack trouble), npm test. Legacy 51 passing (unchanged, legacy/ untouched and
  verified identical by diff -r). v2 100 passing (91 baseline + 9 new, the rewritten test being a
  replacement not an addition). `npm run demo` still runs end to end.
- Gas: added nine measurements to tools/gas-snapshot.js. One AutoWithCollateral agreement covers
  both new payment paths, since the pool is funded for exactly the first two installments and the
  last two fall through to collateral. Params distinct from the four existing RelicPay agreements so
  the agreementId hash cannot collide with warm slots, same trap as 2026-07-23. New numbers:
  depositAutoPaymentTokens 88,513, withdrawAutoPaymentTokens 43,050, stablecoin auto-pool payment
  163,362, stablecoin collateral draw 186,153, stablecoin-settled triggerDefault 234,448 against
  219,749 for the ETH one. Against the committed baseline the only reported change anywhere was
  RelicPay deployment +11.5% (4,137,957 -> 4,612,277), the expected one-time bytecode cost; every
  pre-existing call was inside the 2% reporting threshold, which is the measurable form of the
  "opt-out sellers are unaffected" claim. Regenerated gas-snapshot.txt and ran gas:check three
  times against it, clean each time.
- Worth flagging for a later session: init bytecode is now 20,546 bytes against the EIP-170 limit of
  24,576, so headroom on RelicPay is down to about 4KB from 6.2KB last session. Two more features
  the size of this one and the contract stops deploying. The next contract-side item should budget
  for that; the likely answer is splitting settlement into a library or a separate module rather
  than trimming, and that decision is better made before the ceiling is hit than after.
- Still open from 2026-08-23 and 2026-09-01, not addressed here: gas-snapshot compares absolute
  numbers across sessions and this sandbox runs ganache without native bindings, so cross-host
  comparisons remain unreliable. Same recommendation, record native-vs-fallback status in the
  snapshot header and refuse to compare across a mismatch.
- Synced contracts/RelicPay.sol, test/relicpay.test.js, tools/gas-snapshot.js, gas-snapshot.txt,
  README.md, ROADMAP.md back to the Desktop copy; legacy/ untouched.
- Not blocked. That closes stablecoin settlement. Next unchecked item is "Governance timelock + real
  parameter execution wiring". RelicPayGovernance.execute currently flips the executed flag without
  applying anything, and the Proposal struct already carries the parameter updates array, so the
  wiring is the work and the timelock is the design question: whether the delay lives on the
  proposal (a fourth uint40 will not fit the packed slot from 2026-08-20) or in a separate queue
  mapping. Scope it before implementing, same as part 2c.

## 2026-09-01 (daily build)
- Roadmap item: Stablecoin settlement option for sellers. Split into two sub-items and shipped
  part a. Part b (the remaining payment methods) is now its own unchecked item. The split is not
  arbitrary: the Manual path is the only one where the buyer hands over an asset the seller chose,
  so it is the only one that can honour a settlement preference without new plumbing. Auto draws
  on `autoPaymentBalance`, which is ETH. Collateral and AutoWithCollateral draw on collateral
  positions whose asset the buyer chose, not the seller. Doing all four in one session would have
  meant a token-denominated auto-payment pool, a settlement-asset-first draw order, and a decision
  about what `triggerDefault` seizes, none of which should be rushed.
- What shipped in part a:
  - `settlementTokens` registry with `authorizeSettlementToken(token, bool)`, owner-gated.
    Deliberately separate from `authorizedTokens`: that registry decides what the protocol will
    hold as collateral and lend against, this one decides what it will pay a seller in. Those are
    different risk questions and conflating them would let collateral authorization silently grant
    settlement.
  - `sellerSettlementToken` plus `setSettlementPreference(token)`, `address(0)` meaning ETH. Every
    seller who never opts in is byte-for-byte unaffected.
  - `agreementSettlementToken[agreementId]`, snapshotted at creation. Held in its own mapping
    rather than as a `BnplAgreement` field so the `agreements()`/`getAgreement()` tuple keeps its
    shape; the field could not pack into the existing 29-byte slot anyway, so storage cost is
    identical either way. Snapshotting is the actual security property here: without it a seller
    could flip their preference mid-agreement and change what the buyer owes.
  - Manual payments on a stablecoin agreement pull `safeTransferFrom(msg.sender, ...)` and credit
    `sellerTokenBalances`. Pulling from `msg.sender` rather than `agreement.buyer` preserves the
    existing property that a third party can pay on the buyer's behalf, which the ETH path already
    allowed via `msg.value`. Attached ETH reverts (`UnexpectedETHPayment`) instead of being trapped
    in the contract with no way out.
  - Views `getSettlementToken(id)` and `getSettlementTerms(id)` returning
    `(token, nextInstallment, amount, requiresApproval)`, so the Phase 2 dashboard can tell a buyer
    whether to send value or set an allowance without simulating the call.
- Three design calls worth flagging:
  1. Non-Manual payment methods are rejected at agreement creation with
     `UnsupportedSettlementMethod` rather than falling back to ETH settlement. A silent fallback
     would pay a seller who explicitly asked for stablecoins in the asset they were trying to avoid,
     which is the whole failure this item exists to prevent.
  2. De-authorizing a settlement token blocks new agreements only. Open agreements keep settling
     and the seller keeps their withdrawal path. The alternative bricks live agreements on an owner
     action and strands buyer funds, which is worse than the risk it would mitigate. Covered by a
     test.
  3. Removed a `SellerBalanceUpdated` emit I had first added to the ETH branch of `_settleManual`.
     It was scope creep on the hot path: together with `SettlementCredited` it showed up as a real
     +5.4% regression on `processPayment (2nd, manual)` in `gas:check`. `SettlementCredited` now
     fires on the token path only, and the ETH path costs exactly what it did before plus the one
     unavoidable settlement-currency SLOAD (about 2,100, under the 2% reporting threshold).
- Testing: 9 new v2 tests in test/relicpay.test.js covering the end-to-end stablecoin lifecycle
  (seller paid in token, zero ETH balance, relic still transfers, withdrawal works); attached ETH
  rejected; the snapshot holding across a mid-agreement preference flip in both directions;
  registry gating including the proof that `authorizeToken` does not grant settlement and that the
  registry is owner-only; de-authorization not stranding open agreements; Manual-only enforcement
  across all three other payment methods; a missing allowance reverting with the schedule left
  untouched and then succeeding once approved; and third-party payment. All custom-error
  assertions use `expectCustomError` with a `staticCall`, and I verified the strictness by
  flipping one expectation to the wrong error and confirming it failed with
  "Reverted with 0x2eeffb46, wanted InsufficientPayment (0xcd1c8867)".
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched). v2 91 passing (82 baseline
  plus 9 new). `npm run demo` still runs end to end.
- Gas: added `authorizeSettlementToken`, `setSettlementPreference`,
  `createAgreementWithRWA (stablecoin settled)`, two stablecoin `processPayment` calls and
  `withdrawSellerTokenBalance` to tools/gas-snapshot.js, with params distinct from the two
  existing RelicPay agreements so the agreementId hash cannot collide with warm slots. Stablecoin
  payments measure 193,682 first and 142,382 steady-state, against 175,846 and 116,362 for ETH;
  the gap is the ERC20 transfer plus the token balance write. RelicPay deployment rose 7.3%
  (3,857,832 -> 4,137,957), the expected one-time cost of the new bytecode. Init bytecode is
  18,350 bytes, about 6.2KB clear of the EIP-170 24,576 limit. Regenerated gas-snapshot.txt and
  ran `gas:check` three times against it, clean each time.
- Still open from the 2026-08-23 entry, not addressed here: the gas snapshot compares absolute
  numbers across sessions and this sandbox runs ganache without native bindings, so cross-host
  comparisons remain unreliable. Same recommendation stands, record the native-vs-fallback status
  in the snapshot header and refuse to compare across a mismatch.
- Synced contracts/RelicPay.sol, test/relicpay.test.js, tools/gas-snapshot.js, gas-snapshot.txt,
  README.md, ROADMAP.md back to the Desktop copy; legacy/ untouched.

## 2026-08-23 (daily build)
- Roadmap item: Explicit Defaulted state + seller triggerDefault in RelicPayCore. Opens Phase 2.
- Closes V1-QUIRK-3. RelicPay already carried `BnplState.Defaulted` and `PaymentStatus.Defaulted`
  in its enums and a matching set of errors, but nothing ever wrote them: there was no path out of
  Active. A buyer who simply stopped paying left the agreement live forever, the seller's relic
  untransferable through the protocol, and worst of all the buyer's `usedCredit` reserved against
  a dead agreement with no way to ever release it. Both enum values already existed at the same
  indices, so this is additive with no ABI break on the existing state fields.
- Added `RelicPay.triggerDefault(agreementId)`: seller only, valid once the grace period on the
  next unpaid installment has expired. Settlement on default marks every unpaid installment
  Defaulted, seizes the buyer's collateral up to the outstanding balance into the seller's
  pull-payment balance, releases the buyer's reserved credit in full, and deliberately does not
  transfer the relic. Records `collateralSeized[id]` and `defaultedAt[id]` and emits
  `AgreementDefaulted` plus a per-position `CollateralSeized`.
- Three design calls worth flagging, none of them forced by the spec:
  1. Grace runs off the payment schedule's own stored `dueDate`, not a recomputed one. Legacy
     Bnpl.triggerDefault recomputes `startTime + (n-1) * interval`, which is off by one interval
     from what its own schedule would say. Using the stored date means a seller can never trigger
     a default against a deadline different from the one the buyer was shown.
  2. `_seizeCollateral` takes what is there instead of requiring the full outstanding balance the
     way `_withdrawFromCollateral` does. A defaulting buyer is under-collateralised by definition,
     and a revert there would mean the seller could never close the agreement at all. The seller
     absorbs the shortfall, same economics as legacy Bnpl claiming a collateral deposit that no
     longer covers the balance.
  3. Credit is released for the full `totalPrice`, not just the seized part. `usedCredit` was
     incremented by `totalPrice` at creation and Defaulted is terminal, so anything left reserved
     would be stranded permanently. This is the actual fix for the quirk; the collateral seizure
     is the part that is merely nice to have.
  Also added `_updateAllYields(buyer)` before measuring, so the seizure sees the buyer's true
  balance rather than a stale one. Yield earned on posted collateral is part of that collateral.
- Added `getDefaultStatus(id)` returning `(defaultable, nextInstallment, graceExpiry, outstanding)`
  so the Phase 2 dashboard and any keeper can decide whether to call `triggerDefault` without
  simulating it. Returns all zeroes for a non-Active agreement.
- Testing: found and fixed a real hole in the harness while writing the guard tests. `expectRevert`
  can only ever prove "something reverted": `setup()` stubs out `estimateGas`, so a failing
  transaction comes back as a status 0 receipt with no revert data, and `expectRevert`'s `match`
  argument silently degrades to accepting any revert. Every custom-error assertion in this suite
  has been vacuous. An `eth_call` does carry the data, so added
  `expectCustomError(staticCallPromise, name)` to test/helpers.js, which decodes the 4 byte
  selector (and `Error(string)` for require strings) and compares it. Verified it is genuinely
  strict by flipping one expectation to the wrong error and confirming it fails with
  "Reverted with 0x5c427cd9, wanted GracePeriodNotExpired (0xc7cbe25a)". New tests use it; the
  existing `expectRevert` calls were left alone rather than churned in this session.
- 6 new v2 tests in test/relicpay.test.js: the happy path default end to end (seizure amount,
  schedule marking, relic staying put, credit released, seller can actually withdraw); the guards
  (seller only, not the contract owner, not before grace expiry, unknown id); Defaulted is
  terminal against payments, the keeper sweep and a second default, with no double seizure; a
  completed agreement cannot be defaulted; an under-collateralised default seizes what is left
  instead of reverting (drives `creditLimitRatio` to 12000 bps so the agreement can outgrow its
  collateral); and `getDefaultStatus` tracking the deadline across a payment and into the terminal
  state.
- Gas: added `createAgreementWithRWA (for default)` and `triggerDefault` to tools/gas-snapshot.js,
  using distinct params from the first agreement so the agreementId hash cannot collide with its
  warm slots (same trap the 2026-07-23 session hit on Bnpl). triggerDefault measures 217,089.
  Regenerated gas-snapshot.txt and ran `npm run gas:check` twice, no regressions. Existing RelicPay
  calls moved by under 0.05%. RelicPay deployment rose 9.6% (3,519,575 -> 3,857,832), the expected
  one-time cost of the new bytecode; init bytecode is 17,053 bytes, still about 7.5KB clear of the
  EIP-170 24,576 byte limit, so this does not threaten deployability yet.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched). v2 82 passing (76 baseline
  + 6 new).
- Note for the next run: the v2 baseline recorded in the task file is stale. It says "57 or more"
  and PROGRESS last recorded 64, but the real starting count this session was 76, since the
  2026-08-21 fuzz work added tests without the count being restated. Baseline is now 82.
- Synced contracts/RelicPay.sol, test/relicpay.test.js, test/helpers.js, tools/gas-snapshot.js,
  gas-snapshot.txt, README.md, ROADMAP.md back to the Desktop copy; legacy/ untouched.
- Not blocked. Next unchecked item is "Stablecoin settlement option for sellers", which should
  reuse the `sellerTokenBalances` pull-payment rail this default flow already writes into.

## 2026-08-21 (daily build)
- Roadmap item: Fuzz tests: payment sequencing, credit math, yield accrual. Closes Phase 1.
- No Foundry in this offline toolchain, so this is randomized property testing driven from mocha
  against a real ganache chain rather than forge's fuzzer. Two things make that a fuzzer and not
  just noise, and both are enforced by a test: cases come from a seeded PRNG (mulberry32 over an
  FNV-1a hash of the seed string) so any failure replays with FUZZ_SEED, and every generated case
  is materialized up front as a printable object that rides along in every assertion message.
  FUZZ_RUNS sets cases per property, default 8 to stay inside the mocha timeout on this
  no-native-bindings sandbox.
- Added test/fuzz.test.js, v2-only, 7 tests across three areas:
  - Payment sequencing (RelicPay). Randomizes installment count, price, payment method (Manual,
    Auto, Collateral), interval, grace, and how far time jumps before each payment so prepayment
    and long-overdue both get hit. Asserts the schedule accounts for every wei (n-1 equal
    installments plus the remainder on the final one), due dates are startTime + k*interval,
    credit is consumed on open and released exactly on completion, the seller is credited the
    full price under all three payment methods, and the relic lands with the buyer. A second test
    walks each agreement forward and at every position tries every illegal move (installment 0,
    count+1, skipping ahead, replaying a settled one), asserting each reverts and leaves
    paidInstallments, state and totalPaid untouched. Prices are generated with a random sub-ether
    wei remainder on purpose, since that remainder is where off-by-one payment math hides.
  - Credit math (EnhancedBnpl). Fresh contract per case so each run gets a virgin credit line.
    Asserts the four invariants on any CreditLine at any time: limit is 80% of live collateral,
    available + used == limit (or available floors at zero when collateral has fallen below the
    draw), available never exceeds limit, and utilization equals min(used*100/limit, 100) with 0
    for the no-credit and no-limit cases. Checks them after deposit, after a rejected overdraw,
    after the draw, after every installment, and after payoff. A second test computes the exact
    withdrawal boundary (the smallest x with floor(x*80/100) >= usedCredit), asserts one wei past
    it reverts with collateral untouched, that exactly the boundary succeeds, and that nothing
    further comes out after.
  - Yield accrual (DeFiIntegration). Randomizes protocol, APY (including 0 and uint32 max),
    principal and elapsed time, and asserts getPositionValue equals amount + floor(amount * apy *
    elapsed / (365 days * 10000)) exactly, not within a tolerance. Also asserts monotonicity in
    time, that zero APY never accrues, and that calculateProjectedYield agrees with the live
    valuation on the same inputs. A second test closes the position and settles against the block
    the close actually landed in, asserting totalYieldEarned and the contract's ETH outflow both
    match the formula to the wei, the position zeroes, and a second close reverts.
- Exact assertions needed a helpers fix worth flagging. ethers caches the "latest" block for its
  poll interval, so after evm_increaseTime, provider.getBlock('latest') can hand back a stale
  timestamp while an eth_call on the same node already sees the advanced clock. That is why the
  pre-existing defi test asserts yield within a range instead of exactly. Added latestTimestamp()
  and blockTimestamp(n) to test/helpers.js, both reading over the raw RPC, which makes wei-exact
  yield assertions possible. Existing tests are untouched by this; the old range assertions still
  pass and were left alone.
- Also added expectRevertCase() inside the fuzz file. helpers.expectRevert only takes a match
  string, so a bare "Expected revert, but tx succeeded" carried no case; the wrapper rethrows with
  the seed and case attached like every assert already had.
- Verified the properties actually bite rather than passing vacuously. Ran a mutation check on a
  scratch copy with four seeded defects: dropped RelicPay's strict-sequence check, made the final
  installment ignore the division remainder, changed EnhancedBnpl's credit ratio from 80 to 79,
  and shifted DeFiIntegration's yield divisor by one. All six execution-driven fuzz tests failed,
  each naming the exact generated case. Reverted the scratch copy after.
- Testing: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched; fuzz describes skip on
  legacy, pending went 15 -> 16). v2 76 passing (69 baseline + 7 new). Also ran the fuzz suite at
  FUZZ_RUNS=25 across four different seeds (alpha, bravo, charlie, delta), green on all four, so
  the default seed is not the only one that passes. Ran npm run gas:check, no regressions; no
  contracts were touched this session.
- Synced test/fuzz.test.js, test/helpers.js, README.md, ROADMAP.md, PROGRESS.md back to the
  Desktop copy; legacy/ and contracts/ untouched.
- Note for the next run: Phase 1 is now fully checked off, so the next item is Phase 2's "Explicit
  Defaulted state + seller triggerDefault in RelicPayCore". RelicPay already declares
  BnplState.Defaulted but nothing ever sets it and there is no triggerDefault; legacy Bnpl has the
  seller-claims-after-grace path worth reading first. Also still open from 2026-08-19: the
  gas-snapshot tooling compares absolute numbers across sessions and will mislead on a host with
  different ganache bindings.

## 2026-08-20 (daily build)
- Roadmap item: Optimization pass, part 2c: RelicPayGovernance Proposal struct.
- Scoped first, as the roadmap asked. The mapping inside Proposal does not block reordering the
  way the roadmap feared: a mapping member occupies exactly one slot like any other member, it
  just cannot itself be packed. Everything before it can be. The real find is that
  proposer (20 bytes) + startTime (5, uint40) + endTime (5, uint40) + executed (1) + canceled (1)
  is exactly 32 bytes, one perfect slot, and that set is precisely the hot read path that vote(),
  execute(), cancel() and isProposalActive() all touch. Proposal went from 10 storage slots to 7.
- `id` deliberately left uint256. After the pack above there is nothing left for it to share a
  slot with, so narrowing it would still occupy a full slot and only add mask/shift work. This is
  the same conclusion the 2026-08-19 session reached on EnhancedBnpl.creditUtilization, and it is
  why part 2c was worth scoping before implementing rather than narrowing every field on sight.
  The two strings and the two vote tallies are unbounded and stay in their own slots.
- ABI held flat, which needed a deliberate change. `proposals` was a public mapping, so its
  auto-generated getter returned the struct fields in declaration order with their storage widths.
  Repacking would have silently reordered that tuple and changed two members from uint256 to
  uint40. Made the storage `internal _proposals` and added an explicit
  `proposals(uint256) external view` returning the original tuple, same order, same uint256
  widths. getProposal and proposals now share one internal `_proposalView` so the two cannot
  drift apart. Note for a later session: RelicPay and EnhancedBnpl took the earlier packing passes
  without this treatment, so their public `agreements` / `creditLines` / `collateralPositions`
  getters do have narrowed tuple types today. Nothing in the repo reads them positionally, but the
  Phase 2 browser extension revival should be built against the current ABI, not the v1 one.
- Guards on the narrowing casts, same pattern as the prior three optimization sub-items. Added
  `error ValueTooLarge()`. votingDelay and votingPeriod are owner-supplied uint256 with no cap, so
  startTime and endTime are not inherently uint40-safe the way a bare block.timestamp is.
  updateGovernanceParameters now rejects either value above uint40 max as a fail-fast at config
  time, and propose() checks the actual computed `block.timestamp + votingDelay + votingPeriod`
  before the cast, which is the authoritative guard. No arbitrary policy ceiling invented; the
  bound is exactly what the storage can hold.
- Also dropped four redundant zero-writes in propose(): executed, canceled, totalForVotes and
  totalAgainstVotes were being explicitly set to false/0 on a struct that is always fresh, since
  proposalId comes from ++proposalCount and is never reused. Harmless before, but once
  executed/canceled share a slot with proposer those writes became read-modify-writes. This is
  where most of the propose() saving comes from.
- Testing: added two v2-only tests to test/governance.test.js. First, oversized voting
  delay/period revert instead of silently truncating: it drives the config-time guard on both
  parameters, asserts state was not corrupted by the revert, then drives the propose-time guard
  with two values that each fit uint40 alone but whose sum with block.timestamp does not, and
  asserts no proposal id was consumed. It closes with a large-but-storable round trip
  (period = uint40 max - 8e9) asserting startTime and endTime come back exact, so the test cannot
  pass by the guard simply rejecting everything. Second, proposals() keeps the pre-packing ABI:
  it asserts the function's output types are the exact ten-element uint256/address/string tuple
  from before, compares every field against getProposal, and checks an unknown id still reads back
  as an empty struct. Note that helpers.expectRevert falls back to accepting any revert when it
  cannot decode a custom error selector, which is why both tests assert on positive-path values
  too rather than leaning on the revert string alone.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched). v2 69 passing (67 baseline
  + 2 new). No viaIR stack-depth trouble this time, unlike the RelicPay work last session.
- Gas: same arm64 pure-JS ganache sandbox as the last three sessions. Ran the usual same-session
  A/B against a reconstructed pre-edit build. The before run reproduced the committed numbers
  exactly (propose 225,577, vote 107,112, execute 60,693, deployment 1,519,747), and every
  untouched contract except Bnpl came back at 0.00%. Real deltas, all on RelicPayGovernance:
  propose -22.51% (225,577 -> 174,797), execute -31.60% (60,693 -> 41,511), vote -3.91%
  (107,112 -> 102,926), deployment +0.33% (1,519,747 -> 1,524,758, the expected one-time
  pack/unpack bytecode cost and much smaller than the 3 to 5% the earlier passes paid). No
  regressions anywhere.
- One measurement note worth keeping. Bnpl, which this session never touched, showed a flat
  -0.02% (about 12 gas) on the six calls that take a bytes32 agreementId. Chased it rather than
  waving it off: agreementId is a keccak hash seeded with block.timestamp, so a different run
  produces a different hash with a different number of zero bytes, and calldata zero bytes cost 4
  gas versus 16. Confirmed by running the *unchanged* before-build twice back to back and getting
  the identical 12 gas shift. It is calldata noise, not an effect of this edit, and it is three
  orders of magnitude below the 5% threshold. Recording it so a future session does not spend the
  same time on it.
- `npm run gas:check` ran clean three times back to back against the freshly written snapshot.
  gas-snapshot.txt in this commit is regenerated fresh on this sandbox.
- Synced contracts/RelicPayGovernance.sol, test/governance.test.js, gas-snapshot.txt, ROADMAP.md
  back to the Desktop copy; legacy/ untouched and verified byte-identical.
- Not blocked. That closes the optimization pass; parts 1, 2a, 2b and 2c are all done. Next
  unchecked item is Fuzz tests: payment sequencing, credit math, yield accrual, the last item in
  Phase 1. Two things to decide up front there. First, the harness: the repo runs solc-js +
  ganache + mocha offline, so property tests would be JS-driven random input loops, not Foundry
  fuzzing, and Phase 3 already has a separate Foundry invariant suite item. Doing them in JS now
  keeps Phase 1 self-contained and offline. Second, that item is three distinct areas and is
  probably a multi-session job; splitting it into sub-items on first contact would follow the
  precedent set by the gas snapshot and optimization items.

## 2026-08-19 (daily build)
- Roadmap item: Optimization pass, part 2b: hard cap on CreditLine.creditUtilization, then pack
  RelicPay/EnhancedBnpl CreditLine.
- Product decision the last session flagged as blocking, made here so the work could ship: the cap
  clamps rather than reverts, and it sits at exactly 100% of the contract's own scale.
  `MAX_CREDIT_UTILIZATION` is 10000 on RelicPay (basis points) and 100 on EnhancedBnpl (percent),
  keeping each contract's existing reporting units. Reasoning: creditUtilization is a reporting
  field, never a settlement input, so reverting on an over-limit ratio would brick payment
  processing exactly when a buyer's collateral has fallen, which is the worst possible moment.
  Clamping instead means a read of the cap says "at or over the limit"; anyone needing the true
  over-limit ratio computes it from usedCredit and creditLimit, both still uint256. Documented in
  the constant's natspec on both contracts.
- RelicPay: with the clamp in place, `creditUtilization` narrowed to uint16 (cap 10000 fits with
  room) and `lastUpdateTime` to uint40, sharing one slot. CreditLine went from 6 storage slots to
  5. Added `_utilizationBps` as the single computation path for both write sites.
- EnhancedBnpl: capped via `_utilizationPercent`, but creditUtilization deliberately left uint256.
  Its CreditLine has no second small field to share a slot with, so narrowing would still occupy a
  full slot and only add mask/shift work on every read and write. Confirmed by the A/B below:
  createAgreementWithCredit came back at +0.06%, i.e. noise, which is the expected result of a
  cap with no packing behind it. Called out here so the next session does not re-open it looking
  for savings that are not there.
- Compile blocker hit and fixed: adding the `_utilizationBps` call inside createAgreementWithRWA
  pushed that function past the viaIR stack limit ("Variable _105 is 1 too deep in the stack",
  memoryguard present). Bisected it down to that one call site by compiling RelicPay.sol alone
  against a reconstructed pre-edit copy. Fix was to extract the three credit-reservation writes
  into `_consumeCredit(buyer, amount)` and drop the `CreditLine storage` local that
  createAgreementWithRWA was holding live across its entire body. That function is genuinely at
  the edge of the stack limit; anything added to it in future will need the same treatment.
- Testing: added `[v2] credit utilization is capped at MAX_CREDIT_UTILIZATION` to both
  relicpay.test.js and enhanced.test.js. Each drives a real over-limit line rather than mocking
  one: open an agreement on credit with the Collateral payment method, then pay installments,
  which shrinks collateral (and so the limit) while usedCredit stays outstanding until completion.
  By installment 2 the raw ratio is roughly 12400 bps / 124%, and the test asserts usedCredit >
  creditLimit before asserting the reported value is exactly the cap, so it would fail if the
  clamp were removed rather than passing vacuously. First draft asserted exact intermediate
  values (9375 bps, 93%) and was wrong: both contracts set autoReinvest = true on ETH deposits, so
  each 30 day warp reinvests yield into the collateral position and moves the denominator. Only
  the pre-warp value (7500 bps / 75%) is asserted exactly now; the mid-run step is bounded.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile
  (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched). v2 67 passing (65 baseline
  + 2 new).
- Gas: same arm64 pure-JS ganache sandbox as the 2026-07-31 and 2026-08-08 sessions (same
  uws_linux_arm64 warning). Ran the usual same-session A/B against a reconstructed pre-edit build
  rather than trusting the committed baseline. The before run reproduced the committed numbers
  exactly (createAgreementWithRWA 638,912, stakeWithLido 141,737), and every untouched contract
  came back at 0.00% in the A/B, which validates the method again. Real deltas: RelicPay
  createAgreementWithRWA -2.87% (638,912 -> 620,550), depositETHCollateral -0.81%, RelicPay
  deployment +0.66% (the expected one-time packing bytecode cost). One honest regression:
  RelicPay processPayment (final, manual + NFT transfer) +1.48% (201,886 -> 204,864). Cause is
  the gas refund, not extra work: on the final installment usedCredit goes to zero, and
  creditUtilization used to own a whole slot that cleared to zero and earned the storage-clear
  refund. Packed alongside lastUpdateTime, that slot stays non-zero, so the refund is gone.
  Net is clearly positive (roughly 18k saved at agreement creation and 1.8k per deposit against
  3k paid once at completion), and it is well inside the 5% gas:check threshold, but it is a real
  tradeoff and not noise. `npm run gas:check` ran clean three times back to back against the
  freshly written snapshot. gas-snapshot.txt in this commit is regenerated fresh on this sandbox.
- Synced contracts/RelicPay.sol, contracts/EnhancedBnpl.sol, test/relicpay.test.js,
  test/enhanced.test.js, gas-snapshot.txt, ROADMAP.md back to the Desktop copy; legacy/ untouched.
- Not blocked. Next unchecked item is part 2c (RelicPayGovernance Proposal struct). Worth noting
  before starting it: the roadmap already says slot reordering is limited by the mapping inside
  the struct, and this session's EnhancedBnpl result is the same lesson, a narrowed field with
  nothing to share a slot with buys nothing. Scope the actual packable bytes first and be willing
  to close it as "nothing to do" if that is the honest answer.

## 2026-08-08 (daily build)
- Roadmap item: Optimization pass, part 2a: DeFiIntegration.YieldPosition packing (protocol+
  timestamp+apy in one slot, asset in its own slot, amount/shares stay full uint256).
- Reordered YieldPosition to `address protocol; uint40 timestamp; uint32 apy; address asset;
  uint256 amount; uint256 shares;`. protocol+timestamp+apy now share one 29-byte slot (20+5+4);
  asset starts a fresh slot since the 3 leftover bytes can't fit another address; amount and
  shares stay full uint256 as specified, they are wei amounts with no safe bound to truncate to.
  Went from 6 storage slots per position to 4. Updated all three position constructors
  (stakeWithLido, supplyToAave, supplyToCompound) with `uint40(block.timestamp)` and
  `uint32(protocolAPYs[...])` casts. block.timestamp needs no guard, uint40 does not overflow
  until roughly the year 36812. apy is a different story: it is owner-supplied via
  authorizeProtocol/updateProtocolAPY with no existing cap, so added `error ValueTooLarge()` and a
  bound check in both write paths (`_authorizeProtocol`, called from the constructor and
  authorizeProtocol, and updateProtocolAPY directly) so an apy above uint32 max reverts instead of
  silently truncating on the narrowing cast at position-creation time, same pattern as the
  installmentCount/dueIntervalSeconds/gracePeriodSeconds guards added to Bnpl/EnhancedBnpl/RelicPay
  in the prior two optimization sub-items. No ABI field names or event signatures changed;
  `apy`/`timestamp` are still named struct members so ethers decodes them by name regardless of
  slot order, checked every call site in the contract, test/defi.test.js, and
  tools/gas-snapshot.js first.
- Testing: added `[v2] oversized apy reverts instead of silently truncating` to test/defi.test.js,
  exercising the new guard on both authorizeProtocol and updateProtocolAPY, plus a round-trip at
  exactly uint32 max. First pass forgot the `if (IMPL === 'v2')` guard that every other v2-only
  test in this suite uses; defi.test.js runs against both legacy and v2 builds via the IMPL env
  var, and legacy's DeFiIntegration has no cap, so the test failed against legacy on the first
  run. Fixed by wrapping it in `if (IMPL === 'v2') { ... }` to match the existing pattern in
  enhanced.test.js and relicpay.test.js. Copied the repo into the sandbox native filesystem, npm
  install, npm run compile (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched).
  v2 65 passing (64 baseline + 1 new).
- Gas: this session's sandbox is arm64 and ganache falls back to the pure-JS EVM (same
  uws_linux_arm64 warning as the 2026-07-31 session). Regenerated a same-session "before" build
  from the pre-edit contract to get an honest A/B rather than trusting the committed baseline
  blind. The before run reproduced the committed numbers exactly (stakeWithLido 185,861,
  closeYieldPosition 67,675), confirming this session's sandbox is the same measurement
  environment as whatever produced the 2026-08-01 baseline, so the comparison is trustworthy this
  time. Real deltas: stakeWithLido -23.7% (185,861 -> 141,737), closeYieldPosition -6.2% (67,675
  -> 63,512), DeFiIntegration deployment +2.5% (1,357,251 -> 1,391,182, the expected one-time
  packing bytecode cost). supplyToAave/supplyToCompound follow the identical code path as
  stakeWithLido so save the same ~2 slots but aren't separately tracked in gas-snapshot.txt.
  `npm run gas:check` ran clean (0 regressions) three times back to back against the freshly
  written snapshot. gas-snapshot.txt in this commit is regenerated fresh on this sandbox.
- Synced contracts/DeFiIntegration.sol, test/defi.test.js, gas-snapshot.txt, ROADMAP.md back to
  the Desktop copy; legacy/ untouched.
- Not blocked. Next unchecked item is part 2b (CreditLine.creditUtilization hard cap, then pack
  RelicPay/EnhancedBnpl CreditLine): that one needs an actual product decision (what the cap
  basis-point ceiling should be) before the packing work, flagging for whoever picks it up next.

## 2026-07-31 (daily build)
- Roadmap item: Optimization pass, reduce gas across v2 contracts, guarded by `npm run gas:check`.
- Repacked storage for the two most expensive contracts by gas: RelicPay and EnhancedBnpl.
  BnplAgreement in both contracts had 7 to 9 small fields (installmentCount, dueIntervalSeconds,
  startTime, paidInstallments, gracePeriodSeconds, state, paymentMethod, plus autoPaymentEnabled
  and lastPaymentTime on RelicPay) each sitting in its own 32 byte slot. Narrowed them to
  uint32/uint40/enum/bool and reordered the struct so they all land in a single slot (23 bytes for
  EnhancedBnpl, 29 for RelicPay), matching the packing pattern Bnpl.sol already used. Did the same
  for CollateralPosition on both contracts (collateralType + tokenAddress + autoReinvest +
  lastUpdateTime now share one slot instead of spreading across four). totalPrice,
  installmentAmount, amount, yieldAccrued and stakingRewards stay full uint256 since they are wei
  amounts with no safe bound to truncate to. Added a `ValueTooLarge` guard on
  createAgreementWithCredit and createAgreementWithRWA so an installmentCount, dueIntervalSeconds
  or gracePeriodSeconds above uint32 max reverts instead of silently truncating on the narrowing
  cast, mirroring the check Bnpl.sol already had. No ABI field names changed and no test relies on
  positional struct decoding (checked every test file, demo.js, and gas-snapshot.js first), so this
  did not touch external behavior, just storage layout.
- Left untouched, flagged as follow-up: DeFiIntegration.YieldPosition could pack similarly (worth
  roughly 2 slots on stakeWithLido) but that contract is explicitly a demo simulator, lower
  priority. CreditLine on both contracts has a creditUtilization ratio that is not hard-capped
  anywhere in the code (it can exceed 10000 basis points if collateral value drops while credit is
  outstanding), so shrinking it to uint16 risked introducing an overflow revert that does not exist
  today. Left as full uint256 until a cap is added. RelicPayGovernance.Proposal has a mapping
  inside it so its slots cannot be reordered around the struct boundary; PriceOracle and
  RelicRegistry were already lean.
- Important finding on the tooling itself: this session's sandbox is arm64 and ganache falls back
  to its pure JS EVM (native `uws` bindings are x64 only, confirmed via the "Cannot find module
  .../uws_linux_arm64_127.node" warning on every ganache boot). Running `gas:check` against the
  gas-snapshot.txt committed on 2026-07-23 showed "improvements" of up to 42% on Bnpl.sol, a
  contract this session never touched, because that snapshot was captured on a different-
  architecture host. This is not the ~2-3% run-to-run noise the 5% threshold was sized for, it is
  the pure-JS EVM fallback measuring gas differently at the operation level. To get a trustworthy
  number I ran a controlled A/B: reconstructed the pre-edit RelicPay.sol and EnhancedBnpl.sol,
  measured gas for both the original and the optimized code back to back in this same sandbox
  process, then diffed those two runs against each other (not against the stale committed
  baseline). Confirmed Bnpl.sol (untouched) came back at 0.0% delta in that same-environment A/B,
  which validates the method. Real, same-environment results for the touched contracts:
  createAgreementWithRWA -11.2% (719,452 -> 638,912), processPayment -23.1%/-6.6%/-12.6% across the
  three installments, depositETHCollateral -9.8% (RelicPay) and -11.1% (EnhancedBnpl),
  createAgreementWithCredit -24.3%, payInstallment -21.8%/-27.6%, withdrawCollateral -5.6%.
  Deployment cost rose 3.6% (RelicPay) and 4.8% (EnhancedBnpl), the expected one-time tradeoff for
  the extra pack/unpack bytecode, paid once versus savings on every lifecycle call after.
  gas-snapshot.txt in this commit is regenerated fresh on this sandbox with the optimized code, so
  `gas:check` is self-consistent again, but it will very likely show large false "improvements" or
  false "regressions" the next time this task runs on a host with a different architecture. Flagging
  for whoever picks up the next roadmap item: the gas-snapshot tooling needs to either record the
  ganache native-vs-fallback status in its header and refuse to compare across a mismatch, or move
  to relative same-run A/B measurement instead of a cross-session absolute-number diff. Did not fix
  this myself, it is a real scope increase beyond "optimization pass."
- Testing: added a `[v2] oversized packed fields revert instead of silently truncating` test to
  both enhanced.test.js and relicpay.test.js, exercising the new ValueTooLarge guard on all three
  packed count/duration parameters. Copied the repo into the sandbox native filesystem, npm
  install, npm run compile (clean), npm test. Legacy 51 passing (unchanged, legacy/ untouched). v2
  64 passing (62 baseline + 2 new). Ran gas:check four times against the freshly captured baseline,
  0 regressions each time.
- Synced contracts/RelicPay.sol, contracts/EnhancedBnpl.sol, test/relicpay.test.js,
  test/enhanced.test.js, gas-snapshot.txt, ROADMAP.md back to the Desktop copy; legacy/ untouched.

## 2026-07-23 (daily build)
- Roadmap item: Gas snapshot + optimization pass. Split into two sub-items since a real
  optimization pass needs a baseline to guard against regressions first; this session ships
  the baseline, "Optimization pass" is now its own unchecked item for the next run.
- Added tools/gas-snapshot.js: deploys every v2 contract (RelicRegistry, Bnpl, EnhancedBnpl,
  RelicPay, RelicPayGovernance, DeFiIntegration, PriceOracle) plus the mocks it needs, and
  exercises the core lifecycle calls on each (agreement creation, deposits, payments,
  early payoff, default, withdrawals, propose/vote/execute, stake/close yield, price updates),
  recording gas used per call.
- `npm run gas` regenerates gas-snapshot.txt (now committed as the baseline). `npm run gas:check`
  re-measures and diffs against that committed file, exiting non-zero on a regression greater
  than 5%. Threshold is 5%, not 2%: this sandbox's ganache runs without native bindings
  (pure-JS fallback) and showed up to ~2.3% run-to-run noise specifically on calls that make an
  external contract call (RelicPay.processPayment's try/catch NFT transfer), confirmed by
  running the snapshot four times back to back. 5% clears that noise with margin while still
  catching a real regression.
- Caught and fixed a measurement bug before committing the baseline: the second Bnpl agreement
  created to isolate triggerDefault's gas used identical params to the first, so on a run where
  both landed in the same block second, it hashed to the same agreementId and silently
  overwrote the first agreement's already-warm storage slots, understating gas by about 4x
  (50k vs the real 233k). Fixed by giving it distinct totalPrice/installmentCount/collateral
  so the agreementId can never collide with the first, regardless of timestamp.
- Added test/gas-snapshot.test.js (v2-only, 4 tests): every contract's deployment gas is
  measured and under the block gas limit, every core lifecycle call has a measurement, all
  measurements are positive and under the block gas limit, and the snapshot renders and
  round-trips through its own parser with an unchanged self-comparison reporting zero
  regressions and zero improvements.
- README: documented `npm run gas` / `npm run gas:check` and why the threshold is 5%.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run
  compile (clean), npm test. Legacy 51 passing (unchanged, untouched). v2 62 passing (58
  baseline + 4 new gas-snapshot tests). Ran `npm run gas:check` four times back to back after
  fixing the threshold to confirm no false-positive regressions from sandbox noise.
- Synced tools/gas-snapshot.js, test/gas-snapshot.test.js, gas-snapshot.txt, package.json,
  README.md, ROADMAP.md back to the Desktop copy; legacy/ and contracts/ untouched.
- Not blocked, but noted for whoever picks up the next item: the actual "optimization pass"
  should be run and checked on a machine with real native ganache bindings too before trusting
  absolute gas numbers, not just this sandbox's relative deltas.

## 2026-07-18 (daily build)
- Roadmap item: Demo script: mint relic -> collateral -> agreement -> payments -> ownership transfer
- Added tools/demo.js: a runnable, narrated walkthrough of the Phase 1 MVP flow. Local mode spins up its own offline ganache instance, deploys fresh RelicRegistry + RelicPay from build/v2, wires the issuer and NFT authorization, then mints an Optic Relic, deposits buyer collateral, opens a 3-installment RWA agreement, pays it off, and confirms the relic ownership moved to the buyer and the seller can withdraw proceeds. Runs via `npm run demo`.
- Added a `--network sepolia` path that attaches to the addresses in deployments/sepolia.txt (from DeployAll.s.sol) using RPC_URL/PRIVATE_KEY, with optional GALLERY_KEY/BUYER_KEY for distinct seller and buyer wallets. Not exercised live this session (no network access to a real RPC endpoint from the sandbox); the local path is fully verified and the code was reviewed against the same contract calls the local path already proved out.
- Added test/demo.test.js (v2-only) which runs the exact same runDemo() the CLI uses and asserts on credit limit, completion state, relic ownership, and seller balance, so the demo stays honest as the contracts evolve.
- package.json: added `npm run demo`. README: documented both run modes.
- Verification: copied the repo into the sandbox native filesystem, npm install, npm run compile (clean), npm test. Legacy 51 passing (unchanged). v2 58 passing (57 baseline + 1 new demo test). Also ran `npm run demo` directly as a CLI smoke test, output looks correct end to end.
- Synced tools/demo.js, test/demo.test.js, package.json, README.md back to the Desktop copy; legacy/ and contracts/ untouched.

## 2026-07-08 (daily build)
- Roadmap item: Deploy scripts for Sepolia (adapt legacy script/ to v2 addresses)
- Added foundry.toml (src = contracts, remaps @openzeppelin/contracts to node_modules so npm install covers it, forge-std via lib)
- Adapted all six legacy deploy scripts to import from contracts/ instead of src/: Deploy.s.sol (Bnpl), DeployEnhanced.s.sol (EnhancedBnpl), DeployPriceOracle.s.sol, DeployDeFiIntegration.s.sol, DeployRelicPay.s.sol, DeployRelicPayGovernance.s.sol. Governance script now requires GOVERNANCE_TOKEN_ADDRESS explicitly instead of a hardcoded placeholder address.
- New DeployRelicRegistry.s.sol for the v2-only tokenization contract (no legacy counterpart); sets the deployer as first issuer.
- New DeployAll.s.sol orchestrates the Phase 1 MVP stack (RelicRegistry + RelicPay + PriceOracle + DeFiIntegration) in one broadcast, wires RelicRegistry as an authorized RWA source on RelicPay, and writes addresses to deployments/sepolia.txt for the next roadmap item (the demo script) to consume.
- Verification: forge is not installable in this offline sandbox (no network to foundry.paradigm.xyz), so `forge build` could not run directly. Cross-checked every constructor call and function name in the scripts against the actual v2 contract source, then compiled all eight script files with solc against the real contracts/ ABIs using a minimal forge-std (Vm + console) stub as a syntax and type check. All eight compiled clean.
- Regression check: npm test still green, legacy 51 passing, v2 57 passing. No contract or test files touched.
- Before running against Sepolia for real: run `forge install foundry-rs/forge-std --no-commit` then `forge build` on your Mac as a first sanity pass, since that exercises the real cheatcodes this stub only approximates.

## 2026-07-03 (session zero, full rebuild)
- Located v1 codebase in Downloads, extracted full spec to docs/RELICPAY_SPEC.md
- Built offline toolchain: solc-js 0.8.26 (paris) + Ganache + ethers + mocha
- Characterization suite: 51 tests green against legacy, including documented quirk tests for V1-BUG-1..5
- Rebuilt all six contracts as v2 with same ABIs plus fixes; added RelicRegistry (tokenization MVP)
- v2 passes 57/57 including MVP end-to-end: tokenize relic -> BNPL -> ownership transfer

## 2026-10-04 (daily build)
- Roadmap item: Browser extension revival, part c2 (too large for one session, split into c2a, c2b, c2c in ROADMAP.md; c2a shipped).
- docs/ADR-006-extension-signing-and-wire.md: the popup signs through a provider it owns (WalletConnect intended), never a page bridge, since ADR-005 refuses MAIN-world scripts and `scripting`. Also corrects ADR-004: chrome.runtime messages are JSON, not structured clones, so BigInt cannot cross as is.
- extension/lib/wire.js: BigInt-safe tagged encoding, strict decode. extension/lib/store.js: replay store persisted in chrome.storage so it survives worker termination. extension/lib/worker.js: the service worker logic with all dependencies injected. Sender gating (seller tab for listings, tab-less extension page for signatures), tab id from the sender, domain pinning, buyer from storage, rate from config, requestId spent before the POST.
- test/extension-worker.test.js: 18 tests using real viem signatures and fake quoter, storage, tabs and operator.
- Verification: native-filesystem copy (staged to the cloud sandbox, since the local VM disk was full), npm install, compile clean, npm test. Legacy 51 passing, v2 469 passing (451 baseline + 18 new), 0 failing. extension:check clean.
- Blocked/noted: the local device VM has about 145 MB free, so builds cannot run there. Next up: c2b, the chrome shell.

## 2026-10-05 (daily build)
- Roadmap item: Browser extension revival, part c2b (the chrome shell). Checked off.
- docs/ADR-007-extension-chrome-shell.md: every context is a chrome free core plus a few lines of glue; the popup reads the latest quote from storage since there is no `tabs`; what is shown is what is signed and the signer is recovered before anything is sent; the page surface carries no amount and no markup; config is validated and the shipped placeholder refuses to run.
- New cores: lib/runtime-config.js, scrape.js, surface.js, content-core.js, background-core.js, popup.js. New glue: extension/background.js, content.js, popup.html, popup-main.js, wallet.js. worker.js now writes relicpay/last-quote. manifest.js and config.json gained walletOrigins (exact https, in the ADR-005 budget); manifest.json regenerated.
- test/extension-chrome-shell.test.js: 32 tests, including the real worker wired to the popup controller with a real viem account as wallet. Fixed the existing manifest host-permission test for walletOrigins.
- Verification: staged repo to the cloud sandbox (device disk was tight last run), npm install, compile clean, npm test. Legacy 51 passing, v2 501 passing (469 baseline + 32 new), 0 failing. extension:check and abi:check clean.
- Not done, owed to c2c: no bundle exists yet (popup.html loads popup.bundle.js, entries use require); wallet.js is a seam that refuses, WalletConnect v2 is not installed; nothing run in a real browser. config.json deployment.relicPay is the zero placeholder on purpose, set it before loading the extension.
- Next up: c2c, the bundling step.

## 2026-10-08 (daily build)
- Roadmap item: Browser extension revival, part c2c (bundling step and shippable check). Checked off.
- docs/ADR-008-extension-bundling.md: esbuild as a devDependency, IIFE output, unminified so a signing extension stays reviewable; extension/dist is the directory loaded into Chrome; what ships is verified statically instead of assumed.
- tools/bundle-extension.js: `npm run extension:bundle` builds extension/dist (background.js, content.js, popup.bundle.js, popup.html, manifest.json); `npm run extension:verify` fails unless dist equals a fresh build and every file the manifest and popup.html name exists, dist/manifest.json equals the validated source manifest and the ADR-005 budget, each script is self-contained (no require/import/export/node: left), nothing can eval or load remote code, popup.html has no inline script or handler, and dist has no unreferenced files.
- test/extension-bundle.test.js: 16 tests. Builds into a temp dir (never touches extension/dist), proves determinism, and proves each refusal by mutating a good build. Also asserts content.js does not carry the chain client.
- Verification: staged repo to the cloud sandbox (local VM disk is full again, about 146 MB free), npm install, compile clean, npm test. Legacy 51 passing, v2 517 passing (501 baseline + 16 new), 0 failing. extension:check and abi:check clean.
- Not synced: extension/dist (generated). Run `npm install` then `npm run extension:bundle` on your Mac, then load extension/dist unpacked.
- Not done, still owed: WalletConnect is not installed (wallet.js remains a seam that refuses, verify step will cover whatever it pulls in); config.json deployment.relicPay is still the zero placeholder; nothing run in a real browser yet.
- Next up: Contract: collateral valuation across mixed decimals (characterize first, then normalize through PriceOracle).

## 2026-10-09 (daily build)
- Roadmap item: Contract: collateral valuation across mixed decimals. Too large to fix and verify safely in one session (touches credit limit, minimum check, withdrawal headroom, settlement draws), so it is split into a and b in ROADMAP.md; part a shipped and checked off.
- docs/ADR-009-collateral-valuation.md: value positions in ETH wei through PriceOracle (USD value scaled by the ETH price), optional oracle so existing behaviour holds until wired, revert on stale price instead of falling back to raw units, minimum enforced on normalized value, withdrawable headroom converted back to position units.
- test/collateral-valuation.test.js: 5 characterization tests (v2 only) pinning the current raw-sum behaviour, including the 1e12 USDC effective minimum.
- No contract changes. Verification: staged repo to the cloud sandbox (local VM disk is full again), npm install, compile clean, npm test. Legacy 51 passing, v2 522 passing (517 baseline + 5 new), 0 failing.
- Next up: part b, the fix per ADR-009.

## 2026-10-09 (daily build, second run)
- Roadmap item: Contract: collateral valuation across mixed decimals, part b (the fix per ADR-009). Checked off.
- RelicPay: optional `priceOracle` with `setPriceOracle` (onlyGovernance, refuses an oracle that cannot answer an ETH price). `_toWei` / `_fromWei` are the single conversion points, identity for ETH and when no oracle is wired, so a bare deploy and every earlier test behave as before. Normalized: collateral value, the ERC20 minimum (now "at least 1 ETH worth"), withdrawal headroom (converted back to position units), ETH-denominated collateral draws, default seizure including the token-settled fallback pass, and the ETH path of getSettlementCollateral. Rounding is down throughout; a draw that converts to zero units is skipped, not burned.
- DeployAll.s.sol now wires the oracle into RelicPay. Not compiled with forge here (no forge offline); it is one added call on objects already in scope.
- test/collateral-valuation.test.js rewritten: the 5 part a characterization tests became 4 legacy-mode tests (oracle unwired, behaviour unchanged) plus setPriceOracle tests and 14 oracle-wired tests covering mixed-decimal valuation, the minimum, ETH price movement, rounding, staking rewards, staleness, headroom edge, collateral-method payment, mixed-position draw, settlement collateral, default seizure and the token-settled fallback.
- Regenerated dashboard/lib/abis.js and abis.d.ts (additive: priceOracle, setPriceOracle, PriceOracleUpdated) and gas-snapshot.txt (RelicPay deployment +5.6%, per-call about +200 gas, gas:check clean).
- Verification: staged repo to the cloud sandbox, npm install, compile clean, npm test. Legacy 51 passing, v2 538 passing (522 baseline - 5 replaced + 21 new), 0 failing. abi:check, extension:check, gas:check clean.
- Noted risk (written into ADR-009): with an oracle wired, a stale ETH price blocks credit-line refreshes for buyers holding ERC20 collateral, which includes payment completion and triggerDefault. ETH-only buyers are unaffected. Keep the oracle fresh (ChainlinkPriceAdapter.pushAll on a keeper) before wiring it on a live deployment.
- Not done: the dashboard still presents collateral amounts without an oracle-aware valuation note; the oracle is not a governed ParameterType (enum is governance ABI).
- Next up: Contract: maxAgreementDuration is declared and read by nothing.

## 2026-10-11 (daily build)
- Roadmap item: Contract: maxAgreementDuration enforcement (ADR-003 finding 4). Checked off.
- Decision: enforce, not remove. Removing the field would change the getGovernanceParams ABI the dashboard and extension read. createAgreementWithRWA now reverts AgreementTooLong when installmentCount * dueIntervalSeconds exceeds governanceParams.maxAgreementDuration (365 days default), checked in a private helper to stay inside the viaIR frame limit. Both operands are uint32-bounded first, so the product cannot overflow.
- New setMaxAgreementDuration (onlyGovernance, so owner or appointed governor), emits MaxAgreementDurationUpdated, refuses zero (InvalidMaxAgreementDuration). Not a governed ParameterType, same reasoning as setPriceOracle: the enum is the governance ABI. Applies to new agreements only.
- Extension quoter: the EXCEEDS_POLICY_DURATION warning is now a refusal, EXCEEDS_MAX_DURATION, since the chain would revert.
- test/max-duration.test.js: 8 new tests (boundary at and one second past, 20x30d, overflow bound, governor raise, appointed governor, other params untouched, zero refused). extension-offer test flipped from warn to refuse. Regenerated dashboard/lib/abis.js, abis.d.ts and gas-snapshot.txt (gas:check clean).
- Verification: copy built on the device's root partition (the session partition is full, so TMPDIR was redirected), npm install, compile clean, npm test. Legacy 51 passing, v2 546 passing (538 baseline + 8 new, 1 test rewritten), 0 failing. abi:check and extension:check clean.
- Blocked/noted: DeployAll.s.sol untouched and not forge-compiled. Existing live deployments keep unenforced behavior until redeployed.
- Next up: IBG Collection pilot: first 3 Optic Relics tokenized on Sepolia (needs Sepolia RPC key and funded deployer, likely blocked offline).

## 2026-10-11 (daily build, second run)
- Roadmap item: IBG Collection pilot. Needs a funded Sepolia key and pinned media, so it is split into a and b in ROADMAP.md; part a shipped and checked off.
- pilot/relics.json: manifest of three placeholder relics (IBG-OPTIC-0001..0003, one per triangle, circle, square motif), empty baseURI until metadata is pinned.
- tools/pilot.js (npm run pilot:check, pilot:build, pilot:mint): manifest validation (count, unique ids, motif, relative image paths, baseURI scheme), ERC721 metadata build with a sha256 index, and mint through RelicRegistry that skips any physicalId already registered, so a partial run resumes. Live mode refuses while baseURI is empty; the local dry run uses a fake ipfs://dry-run URI and a fresh ganache.
- test/pilot.test.js: 7 tests (manifest, 9 refusal cases, deterministic build and hashes, baseURI resolution, live refusal, mint then full skip, resume after partial mint and non-issuer refusal).
- No contract changes. Verification: copy built on the device root partition (session partition nearly full, npm cache redirected), npm install, compile clean, npm test. Legacy 51 passing, v2 553 passing (546 baseline + 7 new), 0 failing. abi:check, gas:check, extension:check clean. pilot:check and local pilot:mint run clean.
- Blocked: part b needs funded deployer key, Sepolia RPC_URL, DeployAll run, IBG-confirmed pieces and media, pinned metadata. Names and descriptions in the manifest are placeholders.
- Next up: part b if unblocked; otherwise Phase 3, Invariant suite in Foundry (forge is not available offline, so expect that to be written but not run here).

## 2026-10-13 (daily build)
- Roadmap item: Phase 3, Invariant suite in Foundry. Phase 2 pilot part b is still blocked on owner inputs, so this was the first workable item. Checked off.
- test/foundry/RelicPayHandler.sol: handler with 9 actions (deposit, withdraw collateral, create agreement, pay early or on time, default, seller withdraw, fund and defund auto-payment, warp), 3 buyers, 3 sellers, ghost ETH ledger, expected reverts swallowed.
- test/foundry/RelicPay.invariants.t.sol: 6 invariants: ETH solvency, balance equals ghost in minus out, usedCredit equals sum of Active totalPrice, credit line bounds, agreement and schedule coherence (including NFT custody), withdrawable within principal.
- `npm run invariant` (forge test, excludes Finding) is green: 64 runs x depth 40 default, also green at 256 x 100 locally. foundry.toml gained an [invariant] section.
- FINDING-1, found by the suite: with the default 5% simulated yield, seizure and collateral draws pay out yield backed by no ETH, so ETH solvency fails (`npm run invariant:finding`, red on purpose). Added to ROADMAP Phase 3 as an open item; no contract change made.
- Setup note: forge 1.5.1 and solc 0.8.20 were fetched from GitHub in the sandbox (binaries.soliditylang.org is blocked, so pass `--use <solc>` and `--offline`). lib/forge-std is not committed; run `forge install foundry-rs/forge-std --no-commit` locally.
- Verification: legacy 51 passing, v2 553 passing (unchanged, no JS changes), 0 failing.
- Blocked/noted: a stray .stage.tgz in relicpay-v2 could not be deleted (no delete permission); safe to remove by hand.
- Next up: FINDING-1 ADR and fix, then external audit prep pack.

## 2026-10-14 (daily build)
- Roadmap item: Phase 3, FINDING-1 (simulated yield paid out as real ETH). Phase 2 pilot part b is still blocked on owner inputs. Checked off.
- docs/ADR-010-yield-backed-draws.md: chose to cap settlement draws and seizures at collateralPrincipal (option 1) over backing yield with a real source, since nothing in the contract earns a return.
- RelicPay: _withdrawFromCollateral, _drawCollateralInToken and _seizeCollateral now take at most recorded principal per position; getSettlementCollateral reports the same figure so the preflight matches. Yield above principal stays on the position, still counts toward the credit line, and is neither payable nor withdrawable.
- Tests: two relicpay.test.js expectations that encoded the bug (default seizing principal plus yield, ETH-first seizure exceeding 10) now assert principal-only. New test/yield-backing.test.js, 3 tests (collateral draw cannot reach yield, settlement collateral reports principal, post-default seller credit within contract balance).
- Verification: staged repo to the cloud sandbox, npm install, compile clean, npm test. Legacy 51 passing, v2 556 passing (553 baseline + 3 new), 0 failing. abi:check clean (no ABI change), gas:check clean, gas-snapshot.txt regenerated.
- Not run: `npm run invariant:finding` (forge not available here). It should now go green; run it locally and, if so, fold the Finding contract into the main invariant run.
- Noted risk: a buyer whose credit limit is inflated by yield can see a collateral-method payment revert Insufficient collateral. Follow-up could exclude unbacked yield from the credit line.
- Cleanup: stage-b.tgz left in RelicPay/ (no delete permission); safe to remove by hand, along with .stage.tgz.
- Next up: External audit prep pack.

## 2026-10-15 (daily build)
- Roadmap item: Phase 3, External audit prep pack. Phase 2 pilot part b is still blocked on owner inputs. Checked off.
- docs/AUDIT_PREP.md: scope table with priorities, trust model and roles, asset flows, v1 bug lineage table, design decisions on record, verification already in place, known issues and open risks, reproduce steps, auditor questions, hand-off checklist.
- tools/audit-pack.js (npm run audit:pack, audit:check) generates docs/audit/SURFACE.md: per contract, every state-changing external function with guard, reentrancy guard and payable flags, inherited entry points, ETH send sites. Source is parsed and cross-checked against the compiled ABI so a missed function fails the build.
- Surface result: 60 state-changing functions in scope, 6 open to any caller (RelicPay processPayment and processOverduePayments, governance propose, three ChainlinkPriceAdapter push functions), 3 raw ETH send sites.
- test/audit-pack.test.js: 5 new tests (surface current, parser vs ABI, parser edge cases, createAgreementWithRWA owner-only and the open set pinned, doc has no em dashes and references real files). Adding an open function to RelicPay now fails a test until the pack is reviewed.
- Verification: staged repo to the cloud sandbox, npm install, compile clean, npm test. Legacy 51 passing, v2 561 passing (556 baseline + 5 new), 0 failing. abi:check, gas:check, audit:check clean. No contract changes.
- Doc caveat: V1-BUG-3/4/5 evidence rows in the prep doc say "auditor to confirm" because no test is named after them; worth adding explicit regression tests later.
- Blocked/noted: forge not run (FINDING-1 re-check and DeployAll compile still pending a local run). Cleanup: stage-c.tgz and sync-c.tgz sit in RelicPay/_to_delete, safe to remove by hand.
- Next up: Monitoring + alerting plan.

## 2026-10-15 (daily build, second run)
- Roadmap item: Phase 3, Monitoring + alerting plan. Phase 2 pilot part b is still blocked on owner inputs. Checked off.
- docs/MONITORING.md: threats ranked, events versus state checks, page/warn/info routing with response targets, the page tier table, two numeric escalation rules, health checks, runbooks per alert class, known gaps, owner decisions.
- tools/monitor.js (npm run monitor:catalog, monitor:check; `scan` and `health` take --rpc and --deployments): classifies all events of the 7 in-scope contracts (page, warn, info), generated into monitoring/alerts.json. A new event with no rule, or a rule with no event, fails the check. `scan` decodes logs for a block range and applies two escalations: seller withdrawal at or above 50 ETH, and a price move of 20 percent or more between consecutive pushes. `health` checks ETH oracle staleness (warn at 80 percent of max age, page past it), oracle mismatch, owner drift and governor drift. Both CLI commands exit 1 on a page.
- test/monitor.test.js: 16 new tests (catalog complete and current, severity of authority events, scan on ganache with real transactions, inherited Ownable and Governable events, price deviation and cross-window memory, health warp tests for stale oracle, DeployAll key coverage, doc names every page event).
- No contract changes. Verification: copy built on the device root partition (session partition full, TMPDIR and npm cache redirected), npm install, compile clean, npm test. Legacy 51 passing, v2 577 passing (561 baseline + 16 new), 0 failing. abi:check, gas:check, extension:check, audit:check, monitor:check clean.
- Findings: no contract is Pausable, so a page can only be answered by revoking roles (documented as a gap for the auditors). DeployAll does not write the ChainlinkPriceAdapter address, so scan and health only cover it if CHAINLINK_ADAPTER is added to the deployments file by hand.
- Blocked/noted: hosting and the paging channel are owner decisions (section 10 of the doc); the two escalation thresholds are placeholders until pilot volumes exist. forge still not run (FINDING-1 re-check and DeployAll compile pending a local run).
- Next up: L2 deployment decision (Base recommended). Pilot part b remains blocked on owner inputs.

## 2026-10-18 (daily build)
- Roadmap item: Phase 3, Contract: L2 sequencer uptime check in ChainlinkPriceAdapter (ADR-011 risk 1). Phase 2 pilot part b is still blocked on owner inputs. Checked off.
- ChainlinkPriceAdapter: setSequencerUptimeFeed(feed, gracePeriod), onlyOwner, grace 1 minute to 1 day, address(0) disables and zeroes the grace (the default, so L1 and existing tests are unchanged). Follows Chainlink's L2 pattern: answer 1 is down, startedAt 0 is an invalid round, pricing is refused until the grace period has passed since the last status change, a future startedAt counts as inside grace (no underflow), and a sequencer feed that reverts fails closed.
- The check runs inside the shared _peekFeed, before the aggregator is read, so readFeed, pushPrice, strict batches revert with typed errors (SequencerDown, SequencerGracePeriodNotOver, SequencerRoundInvalid, SequencerCheckFailed) and pushAll or skipUnhealthy batches emit PushSkipped with the reason. New view sequencerStatus() for keepers and dashboards. New event SequencerFeedSet, classed page in the monitor catalog and listed in docs/MONITORING.md.
- test/chainlink-sequencer.test.js: 9 new tests (disabled default, grace window, down, restart grace runs from restart, tolerant versus strict paths, invalid round and reverting feed, future startedAt, owner-only and bounds and events, disable, per-feed staleness unaffected).
- Fixed a failing test left by the last run: ADR-011 now references docs/DEVELOPMENT_PLAN.md by full path (l2-decision test). ADR-011 risk 1 marked resolved.
- Regenerated ABIs, gas-snapshot.txt, docs/audit/SURFACE.md, monitoring/alerts.json.
- Verification: copy built on the device root partition (session partition full, TMPDIR and npm cache redirected), npm install, compile clean, npm test. Legacy 51 passing, v2 591 passing, 0 failing. abi:check, gas:check, extension:check, audit:check, monitor:check clean.
- Blocked/noted: the Base sequencer uptime feed address must be verified on launch day (ADR-011 gate list). DeployAll.s.sol not touched or forge-compiled; wiring setSequencerUptimeFeed into the Base deploy is part of the retarget item. forge still not run locally.
- Next up: Retarget IBG pilot part b and DeployAll docs to Base Sepolia. Pilot part b stays blocked on owner inputs.

## 2026-10-20 (daily build)
- Roadmap item: Phase 3, Retarget IBG pilot part b and DeployAll docs to Base Sepolia. Checked off. Pilot part b itself is retargeted in the roadmap text and stays blocked on owner inputs.
- tools/networks.js: one table for sepolia (11155111) and base-sepolia (84532), per-network deployments file, and assertChain, which refuses an RPC on the wrong chain id. Unknown names (including path tricks) throw.
- tools/pilot.js: `mint --network sepolia|base-sepolia`, reads deployments/<network>.txt, checks chain id before sending. Dry-run default unchanged. tools/demo.js: same via setupLive(network); setupSepolia kept as a wrapper.
- script/DeployAll.s.sol: DEPLOY_NETWORK (default sepolia) must match block.chainid or the script reverts before broadcasting, and the output goes to deployments/<DEPLOY_NETWORK>.txt. script/DeployChainlinkAdapter.s.sol: optional SEQUENCER_UPTIME_FEED and SEQUENCER_GRACE_PERIOD, set before any feed is registered or pushed, warns when unset; appends CHAINLINK_ADAPTER to the deployments file (closes the monitor gap noted on 2026-10-15).
- foundry.toml: base_sepolia RPC endpoints, base-sepolia verifier entry, and fs_permissions for deployments/ (without it vm.writeFile in the deploy scripts would be denied by forge).
- Docs: README deploy section, ADR-011 rollout step 3, MONITORING examples, ROADMAP pilot item.
- test/networks.test.js: 11 new tests (network table, chain id guard, DeployAll and foundry.toml kept in step with the table, sequencer ordering in the adapter script, pilot and demo reject unknown networks, docs and no em dashes).
- Verification: staged repo to the cloud sandbox, npm install, compile clean, npm test. Legacy 51 passing, v2 602 passing (591 baseline + 11 new), 0 failing. abi:check, gas:check, extension:check, audit:check, monitor:check, pilot:check clean. No contract changes.
- Not verified: Solidity script edits (DeployAll, DeployChainlinkAdapter) are only checked structurally, forge is not available here and the local VM cannot run ganache (arm64 uws). Run `forge build` and a dry run with DEPLOY_NETWORK=base-sepolia locally. Also unverified offline: the Basescan verifier URL and key name in foundry.toml, and whether Chainlink has a sequencer feed on Base Sepolia.
- Blocked/noted: pilot part b needs a funded key, Base Sepolia RPC_URL, a DeployAll run, IBG-confirmed pieces and pinned metadata. Cleanup: stage-d.tgz is in RelicPay/_to_delete, safe to remove by hand.
- Next up: only the blocked pilot part b remains in the roadmap. Candidate new items: V1-BUG-3/4/5 regression tests named per bug (flagged in the audit prep doc), and excluding unbacked yield from the credit line.

## 2026-10-23 (daily build)
- Roadmap item: none runnable. The only unchecked item is Phase 2, IBG Collection pilot part b (live run on Base Sepolia), which is BLOCKED on owner inputs. No code changed, no tests run (last recorded state: legacy 51 passing, v2 602 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia (deployments/base-sepolia.txt does not exist yet), IBG-confirmed piece names and images in pilot/media (directory does not exist yet), pinned metadata and baseURI in pilot/relics.json.
- Next up: nothing in the queue. Candidate new items: V1-BUG-3/4/5 regression tests named per bug (flagged in docs/AUDIT_PREP.md), excluding unbacked yield from the credit line, a local `forge build` and DeployAll dry run on Base Sepolia.

## 2026-10-24 (daily build)
- Roadmap item: none runnable from the queue. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs. Took the first candidate from the 2026-10-20 note instead: V1-BUG-3/4/5 named regression tests. Added to the roadmap and checked off.
- Finding (real bug): V1-BUG-4 was never fixed in v2. RelicPayGovernance.vote() still called getPastVotes(voter, startTime - 1), a unix timestamp where a block number belongs. Against a real ERC20Votes token every vote reverts on a future lookup, so governance would be bricked on mainnet. It was hidden because MockGovToken ignores the timepoint argument, and docs/AUDIT_PREP.md claimed the bug fixed.
- Fix: new `proposalSnapshotBlock(proposalId)` mapping, set to block.number - 1 in propose() (own mapping, the packed Proposal slot is full), and vote() reads power at that block. Late acquired or late delegated tokens carry no weight. Works with votingDelay 0. No ABI removals; one new view added.
- New mocks: MockVotesToken (OpenZeppelin ERC20Votes, honours the timepoint) and MockSmartWallet (receive() writes storage, so it needs far more than 2300 gas, can be told to reject ETH).
- test/v1-bug-regressions.test.js: 9 new tests. BUG-3: availability equals the limit recomputed from live collateral after collateral-funded completion and after a default. BUG-4: real-token vote works, snapshot is a block number before the proposal block, the v1 call shape reverts on the real token, late delegation gets no weight, zero delay works. BUG-5: contract wallet seller withdraws via pull; a rejecting wallet cannot block buyer payments or a default and keeps its claim until it accepts ETH.
- Regenerated ABIs, docs/audit/SURFACE.md, gas-snapshot.txt, monitoring/alerts.json. AUDIT_PREP lineage table updated, including the BUG-4 correction.
- Verification: staged repo to the cloud sandbox, npm install, compile clean, npm test. Legacy 51 passing, v2 611 passing (602 baseline + 9 new), 0 failing. gas:check, abi:check, audit:check, monitor:check clean.
- Blocked/noted: pilot part b unchanged (funded key, Base Sepolia RPC_URL, DeployAll run, IBG pieces, pinned metadata). forge still not run locally, so the Foundry invariant suite has not seen the governor change. The Foundry mock token, if it also ignores the timepoint, should be checked on the next local run. Cleanup: stage-c, stage-d, stage-f and other tgz files in RelicPay/_to_delete are safe to remove by hand.
- Next up: Exclude unbacked simulated yield from the credit line (scope against ADR-010 first). Pilot part b stays blocked.

## 2026-10-25 (daily build)
- Roadmap item: Phase 3, Exclude unbacked simulated yield from the credit line. Checked off. Phase 2 pilot part b is still BLOCKED on owner inputs.
- Scope (docs/ADR-012-principal-backed-credit.md): `_getCollateralValue(user, positionId)` now returns `collateralPrincipal` (capped at position.amount), oracle-normalized for ERC20 as before. Simulated yield and the simulated 0.5 percent staking bonus no longer earn credit. Credit limit is principal times the ratio, and the credit-bearing value equals `getSettlementCollateral` for the ETH path, so the granted line and what a draw or seizure can take agree.
- Consequence handled: `getWithdrawableCollateral` is exact now (no pending-accrual floor). dashboard/lib/reader.js (`mayAccrue`) and extension/lib/offer.js (`mayCreditGrow`) gate the floor and softened-refusal paths behind `ACCRUAL_RAISES_CREDIT = false`, so the quote layer refuses what the chain refuses. Branches kept and still unit tested.
- test/credit-backing.test.js: 7 new tests (year of yield leaves the limit at 8.8 on 11 principal, agreement that only fits inside yield is refused, staking bonus earns no credit, credit-bearing value equals settlement collateral, withdrawable exact with accrual pending, multi-position, independent users). Updated 8 tests whose old assertions encoded yield-inflated credit (relicpay seizure, leftover yield, staking bonus, yield inflates line; dashboard-writes and dashboard-present floor tests; extension-offer softening test).
- Docs: ADR-012 added, ADR-010 consequence marked superseded in part, AUDIT_PREP known issue closed with a migration note. Regenerated gas-snapshot.txt and docs/audit/SURFACE.md.
- Verification: staged repo to the cloud sandbox, npm install, compile clean, npm test. Legacy 51 passing, v2 618 passing (611 baseline + 7 new), 0 failing. abi:check, gas:check, audit:check, monitor:check, extension:check, pilot:check clean.
- Blocked/noted: forge still not run, so the Foundry invariant suite has not seen ADR-012 (invariant "credit line bounds" should hold, confirm locally). Migration caveat in ADR-012: a live position whose open credit was covered only by yield shows limit below used credit after its next touch; none exists on the pilot. Cleanup: stage-g.tgz and the other tgz files in RelicPay/_to_delete are safe to remove by hand.
- Next up: nothing runnable in the queue. Pilot part b needs a funded deployer key, Base Sepolia RPC_URL, a DeployAll run, IBG-confirmed pieces and pinned metadata. Candidate new items: local forge build and invariant run, DeployAll dry run on Base Sepolia.

## 2026-10-26 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Checked: forge cannot be installed in the cloud sandbox (github.com is blocked by the egress proxy), so the Foundry invariant run still has to happen on Walter's machine.
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI in pilot/relics.json. Also run `forge build` and `npm run invariant` locally (ADR-010, ADR-012, proposalSnapshotBlock changes have not been seen by Foundry).
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-10-27 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-10-28 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-10-29 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-10-30 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-10-31 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-11-01 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-11-03 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-11-04 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-11-05 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-11-06 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-11-08 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-11-09 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-11-10 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty, no .env). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.

## 2026-11-11 (daily build)
- Roadmap item: none runnable. The only unchecked item, Phase 2 IBG pilot part b, is still BLOCKED on owner inputs (deployments/ and pilot/media still do not exist, baseURI in pilot/relics.json is empty, no .env). No code changed, no tests run (last recorded state: legacy 51 passing, v2 618 passing).
- Still needed from Walter: funded deployer key and Base Sepolia RPC_URL, a DeployAll run with DEPLOY_NETWORK=base-sepolia, IBG-confirmed piece names and images in pilot/media, pinned metadata and baseURI. Also run `forge build` and `npm run invariant` locally.
- Next up: nothing in the queue until the owner inputs arrive.
