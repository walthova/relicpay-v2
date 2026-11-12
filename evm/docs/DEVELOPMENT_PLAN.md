# RelicPay v2: Development Plan

Owner: Walter Mendez. Prepared July 3, 2026.
Mission: rebuild RelicPay from the v1 demo into a production-grade RWA BNPL protocol, 10x on security, correctness, and shipability. First end-to-end flow: asset tokenization (Optic Relic onboarding, mint, view, finance).

## Why 10x Is Achievable

v1 proved the concept but is a demo: owner-created agreements, simulated yield, a buyer-controlled discount exploit, no default path in the flagship contract, and a governance module that executes nothing. v2 keeps the proven interface surface (so the characterization suite passes) while replacing internals with audited-pattern code, and adds the one thing v1 never had: a real path from a physical Optic Relic to on-chain financing.

## Architecture (v2)

Layered, single-responsibility contracts. Same external ABIs as v1 where tests depend on them.

1. RelicRegistry (new): tokenizes assets. ERC721 with provenance metadata (physicalId, mediaURI, attestations). Mint gated by verified issuers (galleries, IBG first). This is the MVP tokenization flow.
2. RelicPayCore (rebuild of RelicPay.sol): agreements, schedules, payments, explicit Default state, pull payments everywhere, remainder-correct installments, seller-approved discounts.
3. CollateralVault (rebuild of collateral logic): positions, credit lines recomputed from collateral on every mutation, withdrawal blocked below required backing.
4. YieldRouter (rebuild of DeFiIntegration): same simulator interface now, adapter pattern so real Lido/Aave adapters can drop in later without storage changes.
5. PriceOracle v2: same interface, plus Chainlink adapter slot and per-asset circuit breaker bounds.
6. Governance v2: checkpointed votes (block numbers), action hashes committed at propose time, timelocked execution that actually calls targets.

Stack: Solidity 0.8.20, OpenZeppelin v5. Tests: characterization suite (JS, solc + in-process EVM) that runs identically against legacy and v2, so parity is proven mechanically, plus v2-only tests for the fixes. Foundry remains the local dev toolchain on your Mac; the JS suite is CI-portable anywhere.

## Phases

### Phase 0: Characterization (done in this session)
Old code copied as legacy reference. Test suite captures v1 behavior per contract. Bugs captured as documented quirk tests, not preserved.

### Phase 1: MVP (weeks 1-3). Tokenization end to end.
Deliverable: an Optic Relic goes from photo + physicalId to minted NFT to a financed BNPL agreement, on Sepolia, in one demo script.
Scope: RelicRegistry, RelicPayCore (Manual + Collateral payments), CollateralVault (ETH only), deploy scripts, demo walkthrough. Exit criteria: full characterization suite green on v2, demo script runs on a fresh Sepolia deploy, no known criticals.

### Phase 2: Build-out (weeks 4-8)
ERC20 collateral + allowlist, auto-pay, AutoWithCollateral, keeper flow with explicit Default, Governance v2 with timelock, PriceOracle v2 with Chainlink adapter, frontend (Next.js, wagmi) for buyer/seller dashboards, browser extension revived against the new API. Exit criteria: testnet beta with 2 pilot sellers (IBG Collection first), external audit booked.

### Phase 3: Hardening + Mainnet (weeks 9-14)
Audit remediation, invariant/fuzz suite in Foundry, monitoring (Tenderly/Defender), mainnet or L2 launch (Base recommended for fees; Solana bridge explored later, aligned with your Solana thesis but not blocking).

## Daily Swarm Cadence
Two scheduled tasks drive daily progress:
- relicpay-daily-build: each morning picks the top unchecked item from ROADMAP.md, implements it in relicpay-v2, runs the suite, commits notes to PROGRESS.md.
- relicpay-daily-marketing: each morning produces one marketing asset (thread, post, partner email, deck slide) from MARKETING_KIT.md themes and logs it.

## Risks
Regulatory: BNPL for RWAs may touch lending regs; keep agreements collateral-backed and consult counsel before mainnet (fundraising doc already budgets this). Oracle trust: push oracle is centralized until Chainlink adapter lands. Liquidity: seller settlement is ETH-denominated; stablecoin settlement should land in Phase 2.
