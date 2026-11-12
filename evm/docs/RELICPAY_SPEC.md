# RelicPay v1 Specification (Extracted From Old Codebase)

Source of truth: `~/Downloads/relicpay-demo-main` (Foundry project, Solidity 0.8.20, OpenZeppelin v5, Sepolia target).
This document is the behavioral spec that v2 must match or consciously exceed. Every deviation is logged in the Deviations section.

## System Summary

RelicPay v1 is a Buy Now Pay Later (BNPL) protocol for Real World Assets on Ethereum. Buyers lock collateral, pay installments, and receive the asset (optionally an NFT twin) on completion. Sellers get paid via a pull-payment balance. Collateral can earn simulated yield and back a revolving credit line. Six contracts:

| Contract | Lines | Role |
|---|---|---|
| Bnpl.sol | 346 | Minimal escrow BNPL: collateral, installments, default, early payoff |
| EnhancedBnpl.sol | 587 | Yield-bearing collateral, credit lines, collateral-funded payments |
| RelicPay.sol | 798 | Full system: RWA NFTs, payment schedules, auto-pay, governance params |
| RelicPayGovernance.sol | 369 | Token voting: propose, vote, execute, cancel |
| DeFiIntegration.sol | 303 | Simulated Lido/Aave/Compound yield positions |
| PriceOracle.sol | 342 | Push oracle: multi-asset USD prices, staleness, confidence |

Plus a browser extension prototype (merchant checkout injection) and CI via GitHub Actions.

## Contract-by-Contract Behavior

### Bnpl.sol
State machine per agreement: Active -> Completed | Defaulted.
- `createAgreement(seller, buyer, totalPrice, installmentCount, dueIntervalSeconds, collateralAmount, gracePeriodSeconds)` onlyOwner. Validates non-zero params. installmentAmount = totalPrice / installmentCount (integer division, remainder silently dropped). Agreement id = keccak of params + timestamp.
- `depositCollateral(id)` payable, buyer only, exact collateralAmount required.
- `payInstallment(id, n)` payable, buyer only, exact installmentAmount, n must be next unpaid, due when now >= startTime + (n-1)*interval. Installment N completes agreement and emits OwnershipTransferred.
- `earlyPayoff(id, discountAmount)` buyer pays remaining minus discount. NOTE: buyer chooses the discount (V1-BUG-1).
- `triggerDefault(id)` seller only, after grace expiry of next unpaid installment. Pushes collateral + paid installments to seller immediately (push transfer).
- `withdrawFunds` (seller, Completed) and `withdrawCollateral` (buyer, Completed) via pull pattern.
- Views: `getAgreement`, `isInstallmentDue`, `isGracePeriodExpired`.

### EnhancedBnpl.sol
- Collateral positions keyed by keccak(user, token, tag). ETH and arbitrary ERC20 (no allowlist here). Auto-reinvest yield, 5% APY default for ETH, updated lazily when >= 1 day elapsed.
- Credit line = 80% of total collateral value (CREDIT_LIMIT_RATIO constant). Utilization in percent.
- `createAgreementWithCredit(...)` onlyOwner, requires availableCredit >= totalPrice, reserves credit.
- `payInstallment` due when now >= startTime + n*interval (note: differs from Bnpl by one interval, V1-QUIRK-1). Manual = exact ETH; Collateral = pulled from positions in order; Auto reverts InvalidPaymentMethod.
- Seller settlement: sellerBalances (ETH) and sellerTokenBalances (per token), pull withdrawals.
- `withdrawCollateral(positionId, amount)` does NOT check active agreements (V1-BUG-2: collateral backing open credit can be withdrawn).
- `_releaseCredit` on completion.

### RelicPay.sol
Everything in EnhancedBnpl plus:
- Governance params struct (creditLimitRatio bp 8000, defaultGracePeriod 7d, minCollateralAmount 1 ether, maxAgreementDuration 365d unused, autoPaymentEnabled).
- ETH collateral can be flagged staked; adds one-time 0.5% simulated stakingRewards. ERC20 collateral requires authorizedTokens allowlist.
- RWA: RWAAsset struct (physicalId, nftContract, tokenId, metadataURI, ownershipTransferred, currentOwner). createAgreementWithRWA requires authorizedNFTs, onlyOwner, credit check, per-buyer nonce in id. On completion contract transferFrom's the NFT from currentOwner to buyer (requires prior approval, else OwnershipTransferFailed).
- Payment schedule array per agreement, one entry per installment with dueDate = start + (i+1)*interval, status Pending/Paid.
- `processPayment(id, n)`: payable; requires now >= dueDate (cannot pay early, V1-QUIRK-2); methods Manual (exact ETH), Auto (from autoPaymentBalance), Collateral, AutoWithCollateral (auto then fallback collateral).
- `processOverduePayments(id)`: permissionless keeper function; force-pays overdue-past-grace installments from buyer collateral. No default state transition exists in RelicPay (V1-QUIRK-3: agreements never become Defaulted).
- Auto-payment: deposit/withdraw ETH balance, per-user toggle.
- `_releaseCredit` adds back availableCredit without recomputing against limit (V1-BUG-3: credit inflation when collateral was consumed for payments).
- Governance setters onlyOwner: params, yield rates, token/NFT allowlists.

### RelicPayGovernance.sol
- IGovernanceToken (balanceOf, totalSupply, getPastVotes).
- propose: threshold 1000e18 balance; voting window = [now + 1d, now + 4d]; stores title/description; updates array NOT stored on-chain (V1-QUIRK-4: execute takes updates array on trust, only checksum-free).
- vote: within window, power = getPastVotes(voter, startTime - 1) (timestamp passed where block number expected, V1-BUG-4), revote supported.
- execute: authorizedExecutors only, after endTime, for > against, for >= quorum (10000e18); _executeParameterUpdate only emits events (no-op).
- cancel: proposer or owner. Views: getProposal, getVote, getVotingPower, isProposalActive.

### DeFiIntegration.sol
Explicit simulator. stakeWithLido/supplyToAave/supplyToCompound store ETH and record YieldPosition with protocol APY (500/300/250 bp). closeYieldPosition pays principal + linear APY yield from contract balance. Owner can authorize/deauthorize protocols, update APY, emergencyWithdraw. calculateProjectedYield view.

### PriceOracle.sol
Push oracle. Seeded assets: ETH $2000, BTC $30000, USDC/USDT $1 (1e8 scale). maxPriceAge staleness (300s crypto, 60s stables). authorizedOracles push updatePrice/batchUpdatePrices with confidence 0-100. getPrice reverts on unsupported/invalid/stale. getUSDValue converts via decimals. Owner manages assets and oracles.

## Known V1 Bugs and Quirks (Characterized, Not Preserved)

- V1-BUG-1 earlyPayoff: buyer-controlled discount lets buyer settle for 0. v2 requires sellerApprovedDiscount.
- V1-BUG-2 EnhancedBnpl.withdrawCollateral ignores open credit. v2 blocks withdrawal below required backing.
- V1-BUG-3 _releaseCredit inflates availableCredit past recomputed limit. v2 recomputes from collateral.
- V1-BUG-4 Governance uses timestamp as block number for getPastVotes. v2 uses checkpointed block numbers.
- V1-BUG-5 push transfer() in triggerDefault/withdrawals (2300 gas stipend breaks smart wallets). v2 uses call with pull-payment.
- V1-QUIRK-1 Bnpl due at (n-1)*interval vs Enhanced/RelicPay at n*interval. v2 standardizes: installment n due at start + n*interval, payable any time before due (prepayment allowed) and required by due + grace.
- V1-QUIRK-2 RelicPay.processPayment forbids paying before dueDate. v2 allows early payment.
- V1-QUIRK-3 RelicPay has no Defaulted transition. v2 adds explicit default flow.
- V1-QUIRK-4 Governance execute takes arbitrary updates array. v2 hashes proposed actions at propose time and verifies at execute.
- V1-QUIRK-5 Integer division drops remainder of totalPrice. v2 adds remainder to final installment.

## Non-Contract Assets
- Browser extension (manifest v3) prototype: detects checkout pages, injects RelicPay BNPL option. Research doc covers Affirm/Klarna/Afterpay patterns.
- CI: forge test on push (GitHub Actions).
- Deploy scripts per contract, Sepolia focused.
