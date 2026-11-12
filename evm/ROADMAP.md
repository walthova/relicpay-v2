# RelicPay v2 Roadmap (worked daily by the build swarm)

## Phase 1: MVP (tokenization end to end)
- [x] Characterization suite green on legacy (51 tests)
- [x] v2 contracts pass full suite (57 tests)
- [x] RelicRegistry: issuer-gated minting with provenance
- [x] Deploy scripts for Sepolia (adapt legacy script/ to v2 addresses)
- [x] Demo script: mint relic -> collateral -> agreement -> payments -> ownership transfer
- [x] Gas snapshot tooling: baseline gas costs for every v2 lifecycle call, checked into gas-snapshot.txt
- [x] Optimization pass: reduce gas across v2 contracts, guarded by `npm run gas:check`
- [x] Optimization pass, part 2a: DeFiIntegration.YieldPosition packing (protocol+timestamp+apy
      in one slot, asset in its own slot, amount/shares stay full uint256)
- [x] Optimization pass, part 2b: hard cap on CreditLine.creditUtilization, then pack
      RelicPay/EnhancedBnpl CreditLine
- [x] Optimization pass, part 2c: RelicPayGovernance Proposal struct (has a mapping inside it,
      so slot reordering is limited; scope what is actually packable before starting)
- [x] Fuzz tests: payment sequencing, credit math, yield accrual

## Phase 2: Build-out
- [x] Explicit Defaulted state + seller triggerDefault in RelicPayCore
- [x] Stablecoin settlement, part a: settlement token registry (separate from the collateral one),
      per-seller preference, currency snapshotted onto the agreement at creation, and Manual
      payments settled in the seller's stablecoin
- [x] Stablecoin settlement, part b: the remaining payment methods for stablecoin-settled
      agreements (token-denominated auto-payment balances, settlement-asset-first collateral draw
      for Collateral and AutoWithCollateral, and the triggerDefault seizure path)
- [x] Governance timelock, part a: two-phase queue/execute with an eta, grace period, cancel
      during the delay, and owner-tunable bounds
- [x] Governance timelock, part b1: dispatch and authority. ParameterType to selector table,
      target/selector allowlist on the governance side, Governable governor role on the target
      side (RelicPay), execute() makes the real call
- [x] Governance timelock, part b2: extend the wiring past RelicPay. Make PriceOracle and
      DeFiIntegration Governable and give their owner-only setters ParameterTypes (the enum has
      no entry for an oracle or a protocol APY today, so this needs an ABI decision first);
      wire setGovernor + the allowlist into DeployAll.s.sol so a fresh deploy comes up governed;
      decide whether ProtocolFee and MaxInstallments become real parameters or are retired
      from the enum, since both currently revert UnsupportedParameterType
- [x] Chainlink adapter behind PriceOracle interface
- [x] Next.js buyer/seller dashboard, part a: the data layer. Generated ABI export from build/v2,
      address book parsed from the deployments file DeployAll already writes, enum decoding, and a
      framework-free block-pinned viem read layer covering both the buyer and seller views. No
      React, so it is provable against ganache in the existing suite.
- [x] Next.js buyer/seller dashboard, part b1: the read architecture decision and the render model
      it requires. Decided in docs/ADR-001-dashboard-reads.md: reads run in server components
      calling the reader directly, wagmi is client-side only for wallet identity and part c's
      writes. That decision forces a serializable view model, since React cannot pass BigInt across
      the server/client boundary and every reader amount is one. Ships present.js, tokens.js and
      client.js, all framework free and provable against ganache.
- [x] Next.js buyer/seller dashboard, part b2: the app itself. Next.js App Router project under
      dashboard/app with its own package.json (the root manifest stays offline-installable for the
      solc + ganache suite), server-rendered buyer and seller pages calling loadDashboard, and a
      wagmi client island for connect/disconnect that writes the connected address into the route.
      No protocol reads through wagmi, per the ADR.
- [x] Next.js buyer/seller dashboard, part c1: the transaction model decision and the write layer it
      requires. Decided in docs/ADR-002-dashboard-writes.md: the snapshot is immutable, a write
      never patches it, pending is a per-action scope rather than a page-wide spinner, and the
      reload re-pins at the receipt's block instead of at latest. Ships dashboard/lib/writes.js,
      framework free and provable against ganache: every action planned as a viem-shaped request
      list, preflighted against the pinned view, with each rejection sent to the chain anyway to
      prove it really does revert.
- [x] Next.js buyer/seller dashboard, part c2: wiring the write layer into dashboard/app. Client
      islands calling useWriteContract with the planned requests, the approve-then-call two-step
      rendered as two steps, scope-level disabling while a write is in flight, and the
      reload-at-receipt-block from the ADR driven through the existing `?at=` route. Part c1's
      structural-test approach applies: the suite cannot render React, so the rules checkable here
      are import rules plus the plan objects the components consume.
- [x] RelicPay has no collateral withdrawal path (found in c1). depositETHCollateral and
      depositERC20Collateral have no counterpart, so collateral leaves the contract only through a
      payment draw or a default seizure and an over-collateralised buyer cannot get the remainder
      back. Bnpl and EnhancedBnpl both have a withdrawCollateral; RelicPay does not. Adding one has
      to answer V1-BUG-2 first (EnhancedBnpl.withdrawCollateral ignores open credit; v2's stated fix
      is to block withdrawal below required backing), so this is a contract item, not a UI one. The
      dashboard cannot offer the flow until it exists.
- [x] Dashboard: surface the collateral withdrawal flow now that the contract has one. The buyer
      collateral panel shows deposits only. Needs a withdraw action per position planned through
      dashboard/lib/writes.js, with getWithdrawableCollateral driving the max and the disabled
      reason, and the three revert cases (InsufficientCollateral, ExceedsWithdrawablePrincipal,
      CollateralBacksOpenCredit) rendered as distinct messages rather than one generic failure.
      Note getWithdrawableCollateral is a floor, not an exact figure, when a position has
      unsettled yield, so the UI should not present it as a guaranteed-exact max.
- [x] Browser extension revival against v2 ABI, part a: the quote layer. Decided in
      docs/ADR-003-extension-offers.md: the extension quotes and never creates (createAgreementWithRWA
      is onlyOwner), quotes are scoped to authorized-NFT listings rather than <all_urls>, a fiat price
      needs a declared rate and currency, and a scraped listing is a claim checked against chain state.
      Ships extension/lib/offer.js, framework and chrome free, provable against ganache.
- [x] Browser extension revival, part b: the request channel. Decided in
      docs/ADR-004-extension-request-channel.md: a buyer-signed request is EIP-712 typed data over the
      quoted terms, domain-separated by the specific RelicPay address and chain id so a signature
      cannot be replayed against a different deployment; it reaches an operator as a signed HTTP POST
      of the serialized envelope; an operator checks a created agreement against it by comparing the
      agreement's own fields (agreementId cannot be predicted, since it hashes in block.timestamp and
      a contract-side nonce). Ships extension/lib/request.js (signing, verification, expiry, a replay
      store, the transport envelope, and the field-by-field match) and extension/lib/messages.js (the
      four message shapes crossing content script / service worker / popup, chain reads and quoting
      staying in the service worker per ADR-003), both framework free and provable against ganache.
- [x] Browser extension revival, part c1: the permission budget and the confirmation model. Decided in
      docs/ADR-005-extension-shell.md: the manifest is generated from extension/config.json and
      validated against a fixed budget (storage only, exact https origins, one static seller-scoped
      content script, no tabs/scripting/externally_connectable), and the popup confirmation is derived
      from the signed AgreementRequest message, never the listing. Ships extension/lib/manifest.js,
      extension/lib/confirm.js, tools/build-extension-manifest.js (npm run extension:manifest and
      extension:check) and the generated extension/manifest.json.
- [x] Browser extension revival, part c2a: the worker core and the signing decision. Decided in
      docs/ADR-006-extension-signing-and-wire.md: the popup signs through a provider it owns (no page
      bridge), BigInt needs a wire encoding because chrome.runtime is JSON, and the worker's trust
      rules are code. Ships extension/lib/worker.js, store.js (persistent replay store) and wire.js,
      all chrome free and provable in the suite.
- [x] Browser extension revival, part c2b: the chrome shell. background.js (thin adapter over
      worker.js), content.js (scrape a listing, render the quote in a closed shadow root, never the
      confirmation), popup.html/js rendering buildConfirmation, the buyer-connect flow that writes
      relicpay/buyer, and the walletOrigins addition to config.json and the ADR-005 budget.
- [x] Browser extension revival, part c2c: a bundling step for the CommonJS lib (MV3 service workers
      load ES modules) and a manifest check that the bundle is what ships.
- [x] Contract: collateral valuation across mixed decimals, part a: characterization tests and the
      decision. docs/ADR-009-collateral-valuation.md; test/collateral-valuation.test.js pins the BUG
      behaviour so part b has to flip it on purpose.
- [x] Contract: collateral valuation across mixed decimals, part b: the fix per ADR-009 (optional
      priceOracle on RelicPay, ETH-wei normalization, minimum on the normalized value, withdrawable
      headroom converted back to position units, DeployAll wiring, flip the BUG tests).
      Original finding: collateral valuation is unsound across mixed decimals (ADR-003 finding 3, not in the
      V1-BUG list). _getCollateralValue sums raw amounts, so 1 ETH + 1e18 raw USDC reads as 2e18, and
      minCollateralAmount (1e18 raw) means the smallest 6-decimal deposit accepted is 1e12 USDC.
      Characterize first, then fix by normalizing through PriceOracle as the code comment promises.
- [x] Contract: maxAgreementDuration is declared and read by nothing (ADR-003 finding 4). Enforce it in
      createAgreementWithRWA or remove it from GovernanceParams; the extension currently warns on it.
- [x] IBG Collection pilot, part a: pilot/relics.json manifest (3 placeholder relics, one per
      triangle/circle/square motif), tools/pilot.js (validate, build metadata with sha256 index,
      idempotent mint through RelicRegistry), proven on ganache.
- [ ] IBG Collection pilot, part b: live run on Base Sepolia (retargeted from Sepolia per ADR-011).
      BLOCKED on owner inputs: funded deployer key + Base Sepolia RPC_URL, `DEPLOY_NETWORK=base-sepolia`
      DeployAll run (deployments/base-sepolia.txt), IBG-confirmed piece names and images in
      pilot/media, metadata pinned and baseURI set in pilot/relics.json. Then
      `npm run pilot:mint -- --network base-sepolia`.

## Phase 3: Hardening
- [x] FINDING-1 (from the invariant suite): simulated yield is paid out as real ETH. Default seizure
      (_seizeCollateral) and collateral-method payment draws take position.amount, which includes
      simulated yield backed by no ETH, and credit it to sellerBalances, so sellers can be owed more
      than the contract holds and the gap comes out of other users' deposits. Repro:
      `npm run invariant:finding` (red until fixed). Fix options: cap draws/seizures at
      collateralPrincipal, or back yield with a real source. Resolved per docs/ADR-010-yield-backed-draws.md: draws and seizures capped at collateralPrincipal.
- [x] Invariant suite in Foundry (test/foundry, `npm run invariant`; green with simulated yield off.
      See FINDING-1 below, which the suite found)
- [x] External audit prep pack: docs/AUDIT_PREP.md (scope, trust model, asset flows, v1 bug lineage, known issues, repro steps, hand-off checklist) plus generated docs/audit/SURFACE.md via tools/audit-pack.js (npm run audit:pack, audit:check).
- [x] Monitoring + alerting plan: docs/MONITORING.md, tools/monitor.js (catalog, check, scan, health), generated monitoring/alerts.json (npm run monitor:catalog, monitor:check). Hosting and paging channel are owner decisions, listed in the doc.
- [x] L2 deployment decision (Base recommended). Recorded in docs/ADR-011-l2-deployment.md: Base mainnet after a Base Sepolia rehearsal, pending owner sign-off.
- [x] Contract: L2 sequencer uptime check in ChainlinkPriceAdapter (ADR-011 risk 1). Read the Chainlink sequencer uptime feed, revert pricing while the sequencer is down, and enforce a grace period after restart. Optional per-deployment (zero address disables it, so L1 and tests are unchanged). Must land before mainnet.
- [x] Retarget IBG pilot part b and DeployAll docs to Base Sepolia (deployments/base-sepolia.txt) once the sequencer item lands.
- [x] V1-BUG-3/4/5 named regression tests (flagged in docs/AUDIT_PREP.md). Writing the BUG-4 case against a
      real ERC20Votes token found the fix was never in the governor: vote() passed startTime - 1 (a
      timestamp) to getPastVotes. Fixed with proposalSnapshotBlock; tests in test/v1-bug-regressions.test.js.
- [x] Exclude unbacked simulated yield from the credit line (candidate from the 2026-10-20 run; scope it
      against ADR-010 before starting). Done per docs/ADR-012-principal-backed-credit.md: credit counts
      recorded principal only, staking bonus included.
