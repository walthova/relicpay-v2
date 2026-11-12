# RelicPay Chain Parity: Solana and Base

Status: testnet only, no audit, simulated yield by default, agent layer not live. See the README Status section.

RelicPay runs the same mechanics on two chains:

- **Solana**: the Anchor program in `programs/relicpay` (program id `5GPVYpyzdosbzWcdttcCdziJVqUCCARf98J857C3T6Gi`).
- **Base**: the Solidity contracts in `evm/contracts/base`. There are four: `RelicEscrow`, `RelicStakePool`, `RelicCreditLine` and `RelicAgentDelegate`. All four share `RelicConstants` and are governed through `RelicGoverned`.

The rule for this repo is that **a mechanic changes on both chains or on neither**. Every constant in `programs/relicpay/src/constants.rs` has a twin with the same value in `evm/contracts/base/RelicConstants.sol`. Every Solana instruction maps to a Base function in the tables below.

## 1. Model differences that are expected, not bugs

| Topic | Solana | Base | Why it is fine |
|---|---|---|---|
| Escrow custody | One SPL token account per agreement (`["escrow", agreement]`), owned by the agreement PDA | One contract balance, with escrow tracked per agreement in `escrowDeposited` (or `vaultShares` for live yield) | On both chains only the recorded merchant and buyer can ever receive an agreement's escrow. The invariant `invariant_tvlMatchesEscrow` holds on Base. |
| Agreement id | PDA `["agreement", buyer, product_id]` | `keccak256(abi.encode("agreement", buyer, productId))` | The same uniqueness rule: one live agreement per buyer and product id. |
| Closing | `close_agreement` closes both accounts and refunds rent | `closeAgreement` deletes storage | Both free the product id for reuse. |
| Mint pinning | `ProtocolConfigExt.accepted_mint`, set by governance and checked on every create path, the stake pool, and credit | `usdc` is `immutable`, set in each constructor | Base pins the mint at deploy, so there is no window before it is pinned. |
| Governance | One authority key per singleton. On mainnet this must be a Squads v4 multisig with a time lock of at least 2 days. | `RelicGoverned`: `governance` must be a timelock whose `getMinDelay() >= 2 days`, checked in the constructor and in `setGovernance`. A pause-only `guardian` sits beside it. | Base enforces the 2-day delay in code. Solana enforces it through the multisig's configuration, which the deploy runbook checks (open question Q1). |
| Owner co-sign | The owner signs the same transaction (`owner.is_signer`) | An EIP-712 `OwnerApproval` signature verified with `SignatureChecker`, so Base Account smart wallets work through ERC-1271 | The two carry the same information: the owner approves this payee, this amount, and this reference. |
| Agent token pull for BNPL | SPL `approve` from the owner's token account to the mandate PDA (`delegated_allowance`) | ERC-20 allowance to `RelicAgentDelegate`, **or** a Coinbase Spend Permission (`SpendPermissionManager.spend`) | Spend Permissions are Base-native and fit this exactly, so `purchase(..., useSpendPermission = true)` uses them. See AGENT_CREDIT_LAYER.md. |
| Single-use payment ref | PDA `["charge_ref", mandate, ref]` (creating it twice fails) | `refUsed[mandateId][ref]` | The same rule: one 402 challenge is paid once. |

## 2. Instruction and function map

### 2.1 Escrow BNPL

| Mechanic | Solana instruction / account | Base function / storage | Parity notes |
|---|---|---|---|
| Escrow creation | `create_agreement(total_price, installment_count, interval_seconds, product_id, merchant_name)`. Accounts: `BnplAgreement`, escrow token PDA, `ProtocolConfig`, `ProtocolConfigExt`. | `RelicEscrow.createAgreement(merchant, totalPrice, installmentCount, intervalSeconds, productId, merchantName)`. Storage: `_agreements[id]`. | The same bounds on both chains: 2 to 12 installments, interval > 0, product id and name at most 64 bytes, pause, the per-agreement cap and TVL cap, and the pinned mint. The first installment, `total_price / count`, is escrowed at creation and `paid_installments` starts at 1. |
| Live yield create | `create_agreement_kamino` (Kamino klend CPI) | `createAgreementLive` (ERC-4626 vault: Morpho on Base) | `yield_source` is `0` for simulated and `1` for live on both chains. |
| Installments | `pay_installment`, `pay_installment_kamino` | `payInstallment(id)` (a single function that branches on `yieldSource`) | Only the buyer can pay, and only once the installment is due: `now >= start + (paid + 1) * interval`. Early prepayment is not allowed on either chain. The last installment carries the integer remainder. Simulated yield accrues on escrowed principal at 300 bps using the same floor math. Payments are blocked while paused. |
| Merchant withdraw on completion | `merchant_withdraw`, `merchant_withdraw_reconciled` | `merchantWithdraw(id)` | Only the merchant, only once `Completed`, and only once (`merchant_withdrawn`). Live yield on Base: the merchant gets `total_price` and **any vault surplus goes to the buyer in the same call** (see gap G-7). |
| 7-day grace and default | `trigger_default`, `trigger_default_reconciled` | `triggerDefault(id)`, `getDefaultStatus(id)` | Permissionless on both chains. Default is allowed when `now > max(due + 7 days, last_unpaused_at + 7 days)`, it is **blocked while paused**, and all escrow goes to the recorded merchant (gap G-5). |
| Cancel | `cancel_agreement`, `cancel_agreement_reconciled` | `cancelAgreement(id)` | Only the buyer, only while `Active`. 10% of the escrowed principal goes to the merchant and the rest goes to the buyer (on Base the rest includes vault yield). |
| Claim yield | `claim_yield` (v1, frozen) and `claim_yield_paid` (parity) | `claimYield(id)` | Both chains pay from the **yield reserve**, never from escrow. Payouts are partial when the reserve runs short, and the remainder stays owed. v1 `claim_yield` still zeroes the yield without paying (gap G-12, decision D2). |
| close_agreement | `close_agreement` | `closeAgreement(id)` | Only the buyer, and not while `None` or `Active`. Escrow must be empty, and a `Completed` agreement needs `merchant_withdrawn`. On Base unclaimed simulated yield is forfeited by choosing to close. On Solana close still requires `yield_accrued == 0` (frozen v1 rule, decision D2). |
| Agent BNPL purchase | `agent_create_agreement` | `RelicAgentDelegate.purchase` → `RelicEscrow.agentCreateAgreement` (callable only by the delegate) | The agreement records `buyer = owner` on both chains. The agent's terms must be at most `max_installments` installments, with an interval of at least `min_interval_seconds`. |

### 2.2 ProtocolConfig: pause, caps, mint

| Mechanic | Solana | Base | Notes |
|---|---|---|---|
| Init | `init_protocol_config` (gated on the upgrade authority) and `init_protocol_config_ext` (same gate) | Constructor arguments `(usdc, governance, guardian)` | Neither chain has a front-runnable initializer. |
| Pause | `set_protocol_paused(bool)` (authority). An unpause writes `ProtocolConfigExt.last_unpaused_at`. | `setPaused(bool)`: the guardian or governance can pause, only governance (2-day timelock) can unpause. Writes `lastUnpausedAt`. | Pause blocks create, pay and default on both chains. Cancel, withdraw and claim stay open so users can exit. |
| Caps | `update_risk_limits(max_agreement_deposit, tvl_cap)` | `setRiskLimits(maxAgreementDeposit, tvlCap)` | `0` means unlimited. The per-agreement cap applies to `total_price`. The TVL cap applies to escrowed principal. |
| TVL bookkeeping | `ProtocolConfig.current_tvl`, updated through `apply_tvl_increase` / `apply_tvl_decrease` | `currentTvl`, updated in `_pullAndEscrow` / `_decreaseTvl` | Exits decrease TVL by the principal they release. |
| Accepted mint | `set_accepted_mint(mint)` (ext authority) | `usdc` (immutable) | |

### 2.3 yield_source

| Mechanic | Solana | Base | Notes |
|---|---|---|---|
| Simulated | `calculate_yield` in `math.rs`: `principal * bps * secs / (10_000 * 31_536_000)` | `RelicConstants.calculateYield`, the same formula | Paid only from the yield reserve on both chains. |
| Live venue | Kamino klend through `KaminoConfig` (`enabled = false` by default) | `setYieldVault(IERC4626)`: Morpho vault on Base, or `address(0)` | On Base the vault cannot change while any live agreement holds shares (gap G-8). |
| Yield reserve | `["yield_reserve"]` token account, authority = stake pool PDA. Funded by `fund_yield_reserve`. Created by `init_stake_pool`, or by `init_yield_reserve` for pools that predate it (devnet). | `RelicEscrow.yieldReserve`, `RelicStakePool.yieldReserve`. Funded by `fundYieldReserve`. | Base keeps two reserves (escrow and staking). Solana keeps one shared reserve. Q3 asks whether to split it. |

### 2.4 Stake pool and tiers

| Mechanic | Solana | Base | Notes |
|---|---|---|---|
| Init | `init_stake_pool`: creates the pool, the vault **and the yield reserve**. Once ProtocolConfig exists, only its authority may call it, and only for the pinned mint. | Constructor | Gap G-2: on Solana the pool can still be front-run before ProtocolConfig exists (decision D1). |
| Stake | `stake_usdc(amount)` | `stake(amount)` | |
| Unstake | `unstake_usdc(amount)`. `0` or more than the stake means a full unstake. Yield is paid on a full unstake only, capped at the reserve. With nothing staked, a call can still collect yield that was owed. | `unstake(amount)`, the same rules | Principal is always withdrawable (gap G-1). |
| Tiers | `compute_tier`: $10 / $50 / $200 / $500 → tiers 1 to 4 | `computeTier`, the same thresholds | Tests check the boundary values on both chains. |
| update_pool_rate cap at 20% | `update_pool_rate(new_rate_bps)`, at most `MAX_YIELD_RATE_BPS = 2000`. The index is checkpointed first. | `updatePoolRate(newRateBps)`, at most 2000, timelocked, checkpointed first | A rate change applies only from the moment it lands (`test_rateChangeIsNotRetroactive`, `index_*` unit tests). |
| Yield accounting | `StakePool.yield_index`, `last_index_update`, `UserStake.index_snapshot` (these live in the old reserved bytes) | `yieldIndex`, `lastIndexUpdate`, `UserStake.indexSnapshot` | Scale is `1e12` on both chains. A pre-upgrade pool (`last_index_update == 0`) starts its index on the first checkpoint. |

### 2.5 Collateralized credit line (feature flagged)

| Mechanic | Solana | Base |
|---|---|---|
| Feature flag | `set_credit_params(enabled, rate_bps)` on `ProtocolConfigExt` (off at init, rate at most 3000) | `setCreditEnabled`, `setCreditRate` (timelocked), and `disableCredit` (guardian, immediate) |
| Lender pool | `init_credit_pool`, `supply_liquidity`, `withdraw_liquidity`. Accounts: `["credit_pool"]`, `["credit_vault"]`, `["lender", supplier]`. | `supplyLiquidity`, `withdrawLiquidity`. Storage: `availableLiquidity`, `liquiditySupplied`. |
| Collateral / top-up | `deposit_collateral(amount)` (anyone may top up a line), `withdraw_collateral(amount)` | `depositCollateral(owner, amount)`, `withdrawCollateral(amount)` |
| Draw (80% max LTV) | `draw_credit(amount)`, paid straight to the payee's token account | `draw(payee, amount)` |
| Repay | `repay_credit(amount)`: interest first, then principal. Anyone may repay. | `repay(owner, amount)` |
| Liquidation (above 90%) | `liquidate_credit()`: seizes debt plus a 5% penalty from collateral, half the penalty to the liquidator, and records any shortfall as bad debt | `liquidate(owner)`, the same waterfall |
| Trust score | `CreditLine.trust_score`: 1 point per USDC of principal repaid on debt at least 1 day old, capped at 100 per 30 days, reset on liquidation | `Line.trustScore`, the same rules |
| Agent identity | `CreditLine.agent_identity` (a reserved Pubkey slot for the Solana agent registry design) | `bindAgentIdentity(agentId)`, with optional ERC-8004 `giveFeedback` on repay and liquidation (try/catch, so it can never block) |

### 2.6 Agent mandates and the agent credit layer

| Mechanic | Solana | Base |
|---|---|---|
| Create / update | `create_agent_mandate(limits)`, `update_agent_mandate(limits)` | `createMandate(agent, limits)`, `updateMandate(agent, limits)` |
| Limits | `per_purchase_cap, period_cap, period_seconds, max_purchases_per_period, approval_threshold, expires_at, delegated_allowance, allowed_merchants, valid_from, window_start, window_end, min_interval_seconds, max_installments` | The same fields except `delegated_allowance` (the owner grants the ERC-20 allowance or Spend Permission directly) |
| Validation | Non-empty allowlist (max 8, no zero key), `period_cap >= per_purchase_cap`, expiry later than now and later than `valid_from`, window values `< 86400`, `min_interval_seconds > 0`, max installments 2 to 12 | Identical |
| Revoke (one call) | `revoke_agent_mandate`: also revokes the SPL delegation | `revokeMandate(agent)` |
| Close and re-enable | `close_agent_mandate`, then `create_agent_mandate` again | `closeMandate`, then `createMandate` |
| Pay over credit (x402) | `agent_charge(amount, payment_ref)`, which draws on the owner's credit line to an allowlisted payee | `charge(owner, payee, amount, ref, approvalDeadline, ownerApproval)` |
| Check order | `authorize_spend`: revoked, valid_from, expiry, window, allowlist, per-transaction cap, co-sign, period roll, period cap, count | `_authorize`: the same order, plus the single-use ref and the EIP-712 approval |

## 3. Divergences found in the existing EVM v2 code, and what was done

The existing EVM v2 code (`evm/contracts/RelicPay.sol` and friends, imported unchanged from `relicpay-v2`) is an **RWA installment sale**. A relic NFT is sold in ETH or a settlement token, backed by collateral-derived credit, and paid seller-to-seller with no escrow. It does not implement the Solana escrow model. Rewriting a 1,762-line contract with its own mocha suite (451 v2 tests per its PROGRESS.md, not imported here) into a different mechanism would have broken that suite and its RWA purpose. So the fix was to build the Base parity core (`evm/contracts/base`) as the canonical Base deployment for the Solana mechanics. `RelicPay.sol` stays as the RWA relic module, and its Foundry invariant suite still passes unchanged. The table records every divergence.

| # | Mechanic | EVM v2 `RelicPay.sol` behavior | Solana behavior | Resolution on Base |
|---|---|---|---|---|
| E-1 | Escrow | None: installments go to `sellerBalances` as they arrive | Every installment is escrowed until completion | `RelicEscrow` escrows every installment and releases at completion |
| E-2 | Currency | ETH by default, with an optional settlement token per seller | USDC only | Pinned USDC (`immutable usdc`) |
| E-3 | Grace period | Set per agreement by the seller (`gracePeriodSeconds`, any uint32) | A fixed 7 days | `GRACE_PERIOD_SECONDS = 7 days` |
| E-4 | Default trigger | Seller only | Permissionless | Permissionless, and paused-aware on both chains |
| E-5 | Default proceeds | Seizes buyer **collateral** up to the outstanding balance | Escrow goes to the merchant, and nothing else is touched | Escrow only |
| E-6 | Completion | The NFT transfers to the buyer, and there is no separate merchant withdraw | `Completed`, then `merchant_withdraw` | `merchantWithdraw` |
| E-7 | Cancel | Not available | Buyer cancels with a 10% fee to the merchant | `cancelAgreement` |
| E-8 | close_agreement | Not available | Available | `closeAgreement` |
| E-9 | Pause | Not available | `ProtocolConfig.paused` | `setPaused` with guardian and timelock |
| E-10 | Caps | `maxAgreementDuration` only | Per-agreement cap and TVL cap | `setRiskLimits` |
| E-11 | Stake tiers | Not available | Stake pool with 4 discount tiers | `RelicStakePool` |
| E-12 | Pool rate cap | `setYieldRate` per token, with no 20% cap | `update_pool_rate`, at most 20% | `updatePoolRate`, at most 2000 bps |
| E-13 | Yield | Simulated per token, and yield could be paid out of other users' funds (`RelicPayFindingYieldSolvencyTest` documents it) | Simulated, paid from a reserve (after this branch) | Reserve-only, solvent by invariant |
| E-14 | Governance | `Governable`: the owner **or** the governor. The owner bypasses the 2-day `RelicPayGovernance` delay entirely. | One authority key | Governance must be a timelock of at least 2 days. There is no owner bypass. The guardian can only pause. |
| E-15 | Credit | Credit limit is a ratio of oracle-priced collateral (ETH and tokens) | None (before this branch) | A USDC/USDC credit line with no oracle, 80/90 LTV, behind a flag |
| E-16 | Agents | None | AgentMandate | `RelicAgentDelegate` |

Divergences still open in the legacy RWA module are listed so nobody deploys it by mistake as the parity core. The README says to deploy `evm/contracts/base` for two-chain parity.

## 4. Gaps fixed on both chains in this branch (audit run 1 cross-reference)

| Gap | Was | Now (both chains) | Tests |
|---|---|---|---|
| G-1 (C-1) | Staking yield paid from other stakers' principal | Paid only from the yield reserve, capped. Principal is always withdrawable. | Base: `test_principalAlwaysWithdrawable_yieldOnlyFromReserve`, `testFuzz_solvencyAcrossStakeUnstake`. Solana: `index_*` unit tests plus characterization unstake. |
| G-1b | Rate changes were retroactive | Index checkpointed before every rate change | `test_rateChangeIsNotRetroactive` |
| G-2 (C-2) | `init_stake_pool` permissionless | Base: constructor. Solana: gated on the ProtocolConfig authority and the pinned mint once config exists. | Solana runbook ordering. Full gate pending D1. |
| G-3 (C-3) | Empty allowlist meant any merchant | Non-empty allowlist required, and empty is never "any" | `test_createRejectsEmptyAllowlistAndBadLimits`, `rejects an empty merchant allowlist` |
| G-4 (C-4) | Mint never pinned | Pinned mint on every create path, the stake pool and credit | `test_onlyPinnedUsdcEverMoves`, `pins the accepted USDC mint` |
| G-5 (C-5) | Pause did not block default | Default blocked while paused, with a fresh 7-day window after unpause | `test_default_blockedWhilePaused_andFreshGraceAfterUnpause`, `blocks trigger_default while paused` |
| G-6 (C-6) | The agent chose loan terms freely | Owner-set `min_interval_seconds` and `max_installments` | `test_purchaseTermsBoundedByOwner`, `keeps agent-chosen terms inside the owner's bounds` |
| G-7 (C-7) | Kamino collateral could be stranded | Base: full redemption on every exit. Solana: unchanged; the Kamino path stays disabled (Q4). | `test_live_merchantGetsPrice_buyerGetsSurplus` |
| G-8 (C-8) | One governance key could redirect escrow through the venue config | Base: the vault cannot change while it holds shares, and changes need the 2-day timelock. Solana: unchanged; the Kamino path stays disabled (Q4). | `test_live_vaultCannotChangeWhileHoldingEscrow` |
| G-12 (C-12) | `claim_yield` paid nothing | `claim_yield_paid` / `claimYield` pay from the reserve | `test_claimYield_paysFromReserveOnly`, `claim_yield_paid pays only from the yield reserve` |
| G-14 (C-14) | A revoked mandate could not be re-created | Close, then re-create | `test_revokeIsOneCallAndTerminal_closeAllowsFreshMandate`, `re-enables a closed agent key` |

## 5. Decisions the frozen v1 suite forces (for Walter)

`tests/characterization.ts` is the frozen v1 spec. These parity fixes stop short on Solana because the full fix would break it:

- **D1**: Gate `init_stake_pool` on the upgrade authority unconditionally. The v1 suite creates the pool from a fresh keypair.
- **D2**: Retire v1 `claim_yield` (it zeroes yield without paying) in favor of `claim_yield_paid`, and let `close_agreement` forfeit unclaimed yield like Base does.
