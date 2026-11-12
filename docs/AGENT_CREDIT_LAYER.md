# Agent Credit Layer (design and testnet code)

Status: **not live**. Testnet code only, no audit. Nothing here is deployed.

## 1. What it does

A **principal** (person or business) gives an **agent key** a bounded right to spend on the principal's RelicPay credit:

- **Caps**: a per-transaction cap, a period cap, and a transaction count per period.
- **Merchant allowlist**: non-empty, at most 8 payees. Empty never means "any".
- **Time windows**: `valid_from`, `expires_at`, and an optional daily window in UTC (it may wrap past midnight).
- **Per-transaction approval threshold**: above it, the principal must co-sign. On Solana that is a second signer on the same transaction. On Base it is an EIP-712 `OwnerApproval` signature, and ERC-1271 smart wallets (Base Account) work through `SignatureChecker`.
- **BNPL term bounds**: the agent may only choose installments up to `max_installments` and intervals of at least `min_interval_seconds`.
- **Revocable in one call**: `revoke_agent_mandate` / `revokeMandate`. This is terminal; close and re-create to re-enable.

The agent can do two things:

| Action | Solana | Base | Where the money goes |
|---|---|---|---|
| Pay a merchant or API now, on credit | `agent_charge(amount, payment_ref)` | `RelicAgentDelegate.charge(...)` | From the lender pool straight to the payee. Debt lands on the principal's credit line, so the agent never holds funds. |
| Open a BNPL plan for the principal | `agent_create_agreement(...)` | `RelicAgentDelegate.purchase(...)` | The first installment comes from the principal (SPL delegation on Solana; ERC-20 allowance or Coinbase Spend Permission on Base). The agreement records `buyer = principal`. |

## 2. Delegation primitive per chain

- **Solana: delegate PDA.** `AgentMandate` at `["agent_mandate", owner, agent]`. It holds the limits and the books, and for BNPL it holds a bounded SPL delegation over the owner's USDC account. Credit charges need no token delegation, because they draw on the owner's `CreditLine`.
- **Base: our own delegate contract, with Spend Permissions as an optional funding rail.** Coinbase Spend Permissions (`SpendPermissionManager`, `0xf85210B21cC50302F477BA56686d2019dC9b67Ad`) give a period allowance per token and per spender, but they have no merchant allowlist, no daily window, no co-sign threshold and no BNPL term bounds. They also only work for Coinbase Smart Wallet / Base Account owners. So `RelicAgentDelegate` enforces the policy, and a Spend Permission is just one way it can pull the BNPL first installment, with `spender = RelicAgentDelegate`. That gives two independent limits, our mandate plus the wallet's own permission, and the owner can kill either one.

## 3. x402 flow

```
Agent ──GET /resource──▶ API
Agent ◀──402 PAYMENT-REQUIRED (accepts[]: scheme, network, payTo, amount, asset)── API
Agent: policy check (asset == pinned USDC, payTo allowlisted, amount ≤ caps, network is ours)
Agent ──agent_charge / charge(payTo, amount, ref = sha256(requirements))──▶ chain
Agent ──GET /resource + PAYMENT-SIGNATURE (payload references the tx)──▶ API
API: verify the AgentCharge event on-chain (payee, amount, ref, finalized) ──▶ 200 + PAYMENT-RESPONSE
```

Notes:

- `ref = sha256(canonical PaymentRequirements)` is single-use per mandate (a `charge_ref` PDA on Solana, `refUsed` on Base). The same 402 challenge can never be paid twice, even by a looping agent.
- **Standard x402 `exact` compatibility.** The standard schemes settle a transfer signed by the payer (EIP-3009 on EVM, an SPL transfer on Solana). A credit-line draw is a program call, not a payer-signed transfer, so a stock facilitator will not recognize it. There are two options, and the choice is open question Q5:
  1. **A RelicPay credit scheme**: the merchant verifies the `AgentCharge` event itself, as the reference client sketches. No facilitator, but merchants must opt in.
  2. **Just-in-time funding**: draw to the agent's own hot wallet for exactly one requirement, and the agent then pays with the standard `exact` scheme. This works with every x402 server, but the funds sit briefly in the agent key and the allowlist cannot be enforced on-chain.
- `agent-layer/x402/` contains the reference client policy (`decide()`), which is plain JavaScript with unit tests. Signing and sending are injected, so the client does not depend on any SDK version.

## 4. Identity and reputation

- **Base**: optional ERC-8004 hooks. `RelicAgentDelegate.bindAgentIdentity(agent, agentId)` checks `IdentityRegistry.getAgentWallet(agentId) == agent` when a registry is configured. `RelicCreditLine.bindAgentIdentity(agentId)` checks `ownerOf(agentId) == owner`. Then `giveFeedback` posts `+points` on aged repayment and `-100` on liquidation. Every call is wrapped in try/catch, so a broken or upgraded registry can never block repayment or liquidation. ERC-8004 is a **Draft**; addresses are listed in docs/research.
- **Solana: equivalent registry design (not built).**
  - `AgentIdentity` PDA `["agent_identity", agent]`: `owner`, `agent_uri` (≤ 200 bytes, an off-chain registration file in the ERC-8004 format), `created_at`. It is created by the owner, and the agent co-signs once to prove key control. This mirrors `register` plus `setAgentWallet`.
  - `ReputationEntry` PDA `["reputation", agent, client, seq]`: `value: i64`, `decimals: u8`, `tag1`, `tag2`, `feedback_hash`. RelicPay itself is one client, writing on repayment and liquidation from `repay_credit` and `liquidate_credit`. Summaries are read off-chain by client set, as ERC-8004's `getSummary` does.
  - `CreditLine.agent_identity` already reserves the slot to bind a line to an `AgentIdentity`.

## 5. Failure cases

| Case | What can go wrong | Bound / mitigation in this code | Residual risk |
|---|---|---|---|
| **Agent overspend within limits** | A prompt-injected or buggy agent spends the whole period cap on junk from allowlisted payees | Per-transaction cap, period cap, count, daily window, co-sign above the threshold, single-use `ref`, one-call revoke. The fuzz test `testFuzz_compromisedKeyBoundedByPeriodCap` shows spend never exceeds the period cap. | Up to one period cap per period until the owner revokes. Owners should set small caps and short periods. |
| **Merchant fraud or disputes** | An allowlisted merchant takes payment and does not deliver, or overcharges | Allowlist (owner-curated); co-sign for large amounts; BNPL keeps money in escrow until completion and the buyer can cancel (10% fee) | **No refund or dispute path exists on either chain** (audit NV-4). A credit-line charge is final. Open question Q6: a dispute window with merchant-posted bonds, or an arbitrated reversal from the merchant's future receivables. |
| **Compromised agent key** | An attacker holds the key | Same bounds as overspend. An attacker cannot add payees (only the owner edits the allowlist), cannot raise caps, cannot move collateral, and cannot pay itself unless it is allowlisted (`test_merchantAllowlistEnforced`: an agent naming itself is rejected). | One period cap. Key custody for agents is still open (audit NV-9): use a KMS or hardware-backed signer and rotate through close and re-create. |
| **Oracle or price issues** | A bad price lets someone over-borrow or forces liquidations | Collateral and debt are both USDC, so there is **no oracle** and no price-driven liquidation. LTV moves only with interest. | A USDC depeg hits collateral and debt equally, so LTV is unaffected, but lenders carry the depeg. Adding non-USDC collateral later would need an oracle with staleness and sequencer checks (the EVM v2 ChainlinkPriceAdapter has this pattern). |
| **Sybil trust farming** | Many wallets wash draw-and-repay cycles to manufacture trust | Points only for principal repaid on debt at least 1 day old, at most 100 points per 30-day epoch, reset to 0 on liquidation, and interest on every draw makes washing cost money. Same-block wash earns 0 (`test_trustScore_agedRepaymentOnly_cappedPerEpoch`). | Trust is per wallet, not per person, so a patient farmer with capital can still build scores across many wallets. **Trust does not raise LTV today** (the 80% cap is fixed), so a farmed score buys nothing on-chain. Any future use of trust for credit limits needs identity (ERC-8004 plus validation, or attestations). Open question Q7. |
| Liquidity run | Lenders withdraw and draws fail | Draws fail cleanly with `InsufficientLiquidity`; lenders cannot withdraw lent-out funds | An agent mid-task may fail to pay. Callers must handle it. |
| Registry failure | The ERC-8004 registry reverts or is upgraded | try/catch, plus a `ReputationFeedbackFailed` event | Lost feedback events only |
