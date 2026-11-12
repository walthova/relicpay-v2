# RelicPay v2: External Audit Prep Pack

Status: ready for scoping. Generated companion: `docs/audit/SURFACE.md` (`npm run audit:pack`, `npm run audit:check`).

## 1. What to audit

RelicPay is a buy-now-pay-later protocol for real-world assets. A seller lists a tokenized relic (ERC721 from RelicRegistry), a buyer posts collateral, the owner creates an installment agreement, payments settle to the seller, and the NFT moves to the buyer when the last installment clears.

In scope, in review order:

| Contract | Role | Priority |
|---|---|---|
| RelicPay | Collateral, credit lines, agreements, payments, defaults, seller balances | Critical. Holds all user funds |
| RelicPayGovernance | Proposals, votes, timelock queue/execute, dispatch to targets | High. Can change core parameters |
| Governable | Single governor role beside the owner | High, small |
| PriceOracle | Push oracle used to normalize mixed-decimal collateral | High. Price manipulation |
| ChainlinkPriceAdapter | Permissionless push from Chainlink feeds into PriceOracle | Medium |
| DeFiIntegration | Lido/Aave/Compound staking positions | Medium. External protocol risk |
| RelicRegistry | Issuer-gated ERC721 with physical id provenance | Low, 55 lines |

Out of scope: `Bnpl.sol` and `EnhancedBnpl.sol` (v1 lineage kept for ABI parity), `legacy/` (frozen spec), `mocks/`, `dashboard/`, `extension/`, `pilot/`, `tools/`. Foundry scripts under `script/` are in scope only for the wiring they establish (DeployAll).

Solidity 0.8.20, OpenZeppelin v5, viaIR. Size and surface numbers are in `docs/audit/SURFACE.md`.

## 2. Trust model and roles

- Owner (RelicPay): creates agreements (`createAgreementWithRWA` is onlyOwner), authorizes settlement tokens, and can set the governor. The owner is trusted to create agreements honestly. This is the largest centralization point and should be stated as such in the report.
- Governor (Governable, one address): may call `onlyGovernance` setters alongside the owner. Intended holder is RelicPayGovernance. The owner can revoke it in one transaction. Ownership is never handed to governance, by design.
- Sellers: receive settlement balances, may call `triggerDefault` on their own agreements, choose a settlement token.
- Buyers: deposit collateral, pay installments, fund auto-payment balances, withdraw unlocked collateral.
- Issuers (RelicRegistry): owner-managed set that may mint relics.
- Oracle pushers (PriceOracle): owner or governance authorized set. ChainlinkPriceAdapter is intended to be one of them.
- Anyone: `processPayment`, `processOverduePayments`, ChainlinkPriceAdapter `pushPrice`, `pushPrices`, `pushAll`, and `propose`/`vote` subject to token rules. These are the open entry points to review first.

## 3. Asset flows

ETH and ERC20 enter RelicPay through collateral deposits, auto-payment funds, and payments. They leave through: seller balance withdrawals (`withdrawSellerBalance`, `withdrawSellerTokenBalance`), collateral withdrawal, and auto-payment withdrawals. Collateral is consumed by payment draws and by default seizure, both capped at recorded principal (ADR-010). ETH sends use a single internal `_send` with `call{value:}`.

Simulated yield is bookkeeping only. Nothing in RelicPay earns a return, so yield above principal and the simulated staking bonus earn no credit (ADR-012) and are neither payable nor withdrawable (ADR-010). Reviewers should treat any path that pays out `position.amount` rather than `collateralPrincipal` as a finding.

NFTs: held by RelicPay as collateral for the agreement, transferred to the buyer on completion through a try/catch transfer.

## 4. v1 bug lineage

Each v1 defect and where v2 answers it. Tests named are in `test/`.

| Id | v1 defect | v2 behavior | Evidence |
|---|---|---|---|
| V1-BUG-1 | Buyer chooses early payoff discount | RelicPay has no early payoff entry point, so the defect has no surface | Quirk pinned on legacy in `bnpl.test.js` |
| V1-BUG-2 | Collateral backing open credit can be withdrawn | `CollateralBacksOpenCredit`, `ExceedsWithdrawablePrincipal` | Quirk in `enhanced.test.js`, fix in `relicpay.test.js` |
| V1-BUG-3 | `_releaseCredit` inflates available credit | Recomputed against the limit | Named regressions in `v1-bug-regressions.test.js`; credit math also covered by `fuzz.test.js` and the invariant suite |
| V1-BUG-4 | Timestamp passed as block number to `getPastVotes` | `proposalSnapshotBlock` (block before creation) passed to `getPastVotes`. Not actually fixed until 2026-10-24: vote() passed `startTime - 1`, a timestamp, and the lenient MockGovToken hid it | Named regressions in `v1-bug-regressions.test.js` against a real ERC20Votes token |
| V1-BUG-5 | Push `transfer()` breaks smart wallets | `call` plus seller pull-payment balances | Named regressions in `v1-bug-regressions.test.js` with a contract wallet that needs more than 2300 gas |

Full definitions: `docs/RELICPAY_SPEC.md`. Please confirm each fix independently rather than trusting this table.

## 5. Design decisions on record

`docs/ADR-009-collateral-valuation.md` collateral valuation across mixed decimals (ETH-wei normalization through PriceOracle, optional oracle). `docs/ADR-010-yield-backed-draws.md` yield-backed draws (principal caps). `docs/ADR-012-principal-backed-credit.md` credit line valued at principal only. ADR-001 to ADR-008 cover the dashboard and extension and are off-chain scope. Three decisions an auditor will question first:

1. `createAgreementWithRWA` is onlyOwner. Agreements are operator-created from buyer-signed EIP-712 requests (ADR-004), so a compromised owner can create agreements against any buyer who has collateral and credit.
2. Governance dispatch is an allowlist of (target, selector) and (target, ParameterType). Review the allowlist setters and `execute` as one unit.
3. `maxAgreementDuration` is enforced on new agreements only, and is not a governed ParameterType.

## 6. Verification already in place

- Characterization suite: legacy 51 passing, v2 556 passing (solc-js + ganache + mocha, fully offline). `npm test`.
- Fuzz tests (payment sequencing, credit math, yield accrual): `test/fuzz.test.js`.
- Foundry invariants: ETH solvency, ledger balance, usedCredit equals sum of Active totalPrice, credit line bounds, agreement and NFT custody coherence, withdrawable within principal. `npm run invariant` (needs forge and `forge install foundry-rs/forge-std`).
- Gas snapshot guard: `npm run gas:check`. ABI drift guard: `npm run abi:check`.
- FINDING-1 (simulated yield paid out as ETH) found by the invariant suite and fixed per ADR-010.

## 7. Known issues and open risks (disclose, do not hide)

- FINDING-1 fix has not been re-run under Foundry. `npm run invariant:finding` should now be green; confirm locally and fold the Finding contract into the main run. Until then the fix is proven by `test/yield-backing.test.js` only.
- Yield no longer inflates the credit limit (ADR-012, resolved). Migration note: a position whose open credit was covered only by yield is re-valued on its next credit-line touch and may show `creditLimit < usedCredit` until paid down.
- `DeployAll.s.sol` and the other forge scripts have not been compiled under forge in the offline build. Deployed bytecode and wiring should be verified on a testnet deploy before audit start.
- No live deployment has been audited. Existing testnet deployments predate `maxAgreementDuration` enforcement.
- `processOverduePayments` is open and has no `nonReentrant`. The surface file lists every open function; each needs a reentrancy argument in the report.
- PriceOracle is a push oracle with a staleness window. Price manipulation and staleness behavior at the boundary are explicit review requests.
- DeFiIntegration forwards ETH to external protocols. It is outside the RelicPay custody path today; confirm that no RelicPay balance can reach it.

## 8. Reproduce the environment

```
npm install
npm run compile
npm test                # legacy 51, v2 556+
npm run abi:check
npm run gas:check
npm run audit:check     # surface file is current
forge install foundry-rs/forge-std --no-commit
npm run invariant       # needs forge
```

Offline notes: solc binaries are fetched by solc-js from the npm package, so no network is needed for `npm test`. Forge needs a local solc 0.8.20 (`--use <path>`, `--offline`).

## 9. Questions for the auditor

1. Is the owner-created agreement model acceptable, or should creation require an on-chain buyer signature?
2. Is a single governor address plus owner the right admin shape, versus a timelocked owner?
3. Should seller default triggering be time-bound beyond the grace period?
4. Preferred report format and re-review process for fixes.

## 10. Hand-off checklist

- [ ] Freeze a commit and tag it `audit-v1`.
- [ ] Run every command in section 8 on a clean clone and attach the output.
- [ ] Resolve or consciously accept each item in section 7.
- [ ] Testnet deploy through DeployAll with governance wired; record addresses.
- [ ] Share this file, `docs/audit/SURFACE.md`, ADR-009, ADR-010, and `docs/RELICPAY_SPEC.md` with the auditor.
