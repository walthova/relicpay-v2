# Relic Pay — Terms and Conditions
**Version 1.0 | Effective: May 2026**

*Please read these terms carefully before using the Relic Pay protocol.*

---

## 1. Acceptance of Terms

By connecting a wallet to, interacting with, or using any component of the Relic Pay protocol (including smart contracts, the web application at relicpay.app, browser extension, or API), you agree to these Terms and Conditions in full. If you do not agree, do not use the protocol.

---

## 2. Definitions

**"Protocol"** means the Relic Pay smart contract system deployed on the Solana blockchain, including all associated programs, PDAs, and on-chain state.

**"Agreement"** means a BNPL agreement created on-chain between a Buyer and Merchant via the Protocol.

**"Escrow"** means the Program Derived Address (PDA) token account that holds Buyer funds during an active Agreement.

**"Yield"** means interest earned on Escrow funds through DeFi protocol integrations.

**"You" / "User"** means any individual or entity who accesses or interacts with the Protocol in any role (Buyer, Merchant, Staker, or otherwise).

---

## 3. Nature of the Protocol

Relic Pay is a **decentralized protocol**. This means:

3.1. The Protocol operates via autonomous smart contracts on the Solana blockchain. No centralized entity controls, reverses, or modifies on-chain transactions once confirmed.

3.2. Smart contracts execute as written. Bugs, exploits, or unexpected behavior in the smart contract code may result in permanent loss of funds. The Protocol is provided "as is."

3.3. The Protocol is non-custodial. At no point does Relic Pay (or its developers) hold, control, or have access to User funds. Funds are held by on-chain PDAs controlled solely by program logic.

3.4. Blockchain transactions are **irreversible**. Once an instruction is executed on-chain, it cannot be undone by any party.

---

## 4. Buyer Terms

4.1. **Payment Obligations.** By creating an Agreement, you commit to paying all installments by their scheduled due dates. Missing a payment beyond the 7-day grace period allows any party to trigger a default, transferring your escrowed funds to the Merchant.

4.2. **Installment Schedule.** The payment schedule is set at Agreement creation and enforced by the smart contract. You cannot modify the schedule after creation.

4.3. **Cancellation.** You may cancel an active Agreement at any time by calling `cancel_agreement`. A 10% cancellation fee is deducted from your escrowed balance and sent to the Merchant. You receive the remaining 90%.

4.4. **Yield.** Any yield earned on your Escrow balance during v1 of the Protocol is credited on-chain but disbursed from the protocol reserve fund. Yield is not guaranteed and may be zero if the reserve is depleted. In v2, yield will come directly from integrated DeFi protocols and is subject to those protocols' performance and risks.

4.5. **Sufficient Funds.** You are responsible for maintaining sufficient USDC in your wallet to cover each installment when due. The Protocol will not send payment reminders. Missed payments result in default.

4.6. **Collateral Risk.** Funds in Escrow are at risk if: (a) a smart contract bug is exploited; (b) an integrated DeFi protocol is hacked or fails; (c) you trigger a default by missing payments. Relic Pay does not insure against these risks.

---

## 5. Merchant Terms

5.1. **Payment Receipt.** Merchants receive exactly `total_price` in USDC upon Agreement completion. The Protocol does not add fees to the merchant-facing amount in v1.

5.2. **Default Recovery.** In the event of Buyer default, Merchants receive all funds currently in the Escrow PDA at the time of default. This may be less than `total_price` if the Buyer has not made all installments.

5.3. **No Chargeback Risk.** Blockchain payments are final. Merchants accept no chargeback risk from Relic Pay Agreements.

5.4. **Merchant Wallet Responsibility.** Merchants are responsible for maintaining access to the wallet address registered as `merchant` in each Agreement. Lost wallet access means lost funds — the Protocol cannot redirect payments.

5.5. **Tax Obligations.** Merchants are solely responsible for determining and fulfilling their tax obligations arising from payments received via the Protocol.

---

## 6. Staker Terms

6.1. **Yield on Staked USDC.** Stakers deposit USDC into the Relic Pay Stake Pool and earn yield (3% APY in v1, variable in v2). Yield is paid from the protocol reserve in v1.

6.2. **No Lockup.** Stakers may unstake at any time by calling `unstake_usdc`. There is no minimum lockup period. Yield is only distributed on full unstake in v1.

6.3. **Discount Tiers.** Discount tiers are determined by on-chain `UserStake.tier` and applied by the browser extension. Tiers are calculated at the time of each stake or unstake transaction.

6.4. **Staking Risk.** Staked USDC is held in the Stake Pool PDA. It is subject to smart contract risk. The Protocol does not guarantee return of principal in the event of an exploit.

---

## 7. Yield and DeFi Integration Risk

7.1. In v2 and beyond, Escrow and Staked funds may be deployed into third-party DeFi protocols (Kamino Lend, MarginFi, Solend, Marinade, Jito, and others). You acknowledge:

- These protocols carry their own smart contract and liquidity risks
- APY is variable and not guaranteed
- Protocol insolvency or exploit may result in partial or total loss of yield, and in extreme cases, loss of principal

7.2. The Relic Pay Yield Router (v3) will diversify across approved protocols subject to governance constraints. Diversification reduces but does not eliminate risk.

7.3. Relic Pay does not guarantee any minimum yield. Any APY figures referenced in documentation are estimates based on historical market conditions.

---

## 8. No Financial Advice

Nothing in the Protocol, documentation, website, or any communication from Relic Pay constitutes financial, investment, legal, or tax advice. Use of the Protocol is entirely at your own risk. You should consult a licensed financial advisor before making decisions based on anything related to the Protocol.

---

## 9. Prohibited Uses

You agree not to use the Protocol to:

9.1. Launder money or finance illegal activities
9.2. Evade sanctions or regulatory requirements
9.3. Exploit smart contract bugs or vulnerabilities (responsible disclosure required instead — contact security@relicpay.app)
9.4. Create fraudulent Agreements with merchants you do not intend to pay
9.5. Manipulate on-chain price oracles or DeFi liquidity pools to extract unfair yield

Violations may be reported to relevant authorities.

---

## 10. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:

10.1. Relic Pay, its developers, contributors, and affiliated entities are not liable for any loss of funds arising from smart contract bugs, DeFi protocol failures, network outages, user error, or any other cause.

10.2. Relic Pay's aggregate liability for any claim arising from use of the Protocol shall not exceed the greater of: (a) $0, or (b) the amount of protocol fees you paid in the 30 days preceding the claim.

10.3. Relic Pay is not liable for any indirect, incidental, consequential, or punitive damages.

---

## 11. Smart Contract Risk Disclosure

The Relic Pay smart contracts have not been audited by a professional security firm as of v1. Use of the Protocol with real funds prior to a completed audit is at your own risk. An audit is planned prior to mainnet launch. Audit results will be published publicly at github.com/walthova/relicpay-claude.

---

## 12. Governance

Protocol parameters (yield rates, approved DeFi protocols, fee structures, discount tiers) are subject to change via La Familia DAO governance. Changes require a governance vote with a 7-day timelock. Users are responsible for monitoring governance proposals.

---

## 13. Privacy

13.1. The Protocol is on-chain and fully transparent. All transactions, Agreement terms, and balances are publicly visible on the Solana blockchain.

13.2. The web application (relicpay.app) does not collect personally identifiable information beyond what is necessary to display your on-chain state.

13.3. The Claude AI Guide feature sends conversation messages to Anthropic's API. See Anthropic's Privacy Policy at anthropic.com/privacy.

---

## 14. Jurisdiction and Disputes

14.1. These Terms are governed by the laws of the State of California, without regard to conflict of law provisions.

14.2. Any dispute arising from use of the Protocol that cannot be resolved through good-faith negotiation shall be submitted to binding arbitration under the JAMS rules in Los Angeles, California.

14.3. You waive any right to participate in class action litigation against Relic Pay.

---

## 15. Changes to These Terms

Relic Pay reserves the right to update these Terms at any time. Material changes will be announced via the official GitHub repository and the relicpay.app website. Continued use of the Protocol after changes constitute acceptance.

---

## 16. Contact

For security disclosures: security@relicpay.app
For general inquiries: hello@relicpay.app
GitHub: github.com/walthova/relicpay-claude

---

*These Terms and Conditions were last updated May 2026. They apply to Relic Pay Protocol v1 and will be updated for v2 mainnet.*
