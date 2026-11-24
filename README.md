# Relic Pay v2

**Credit for you and your agent.** Relic Pay is an early-stage Solana project exploring how people and their AI agents can buy now and pay later within limits the owner controls. It started as a USDC installment checkout and grew into a testbed for delegated spending and agent payments.

[Relic Pay website](https://relicpay.app) · [Product direction](RELICPAY_V2.md) · [Security and known limitations](SECURITY.md)

## What works today

- **On-chain installments:** The Anchor program escrows buyer-funded installments and pays the merchant after the plan is complete. Owners can grant and revoke an `AgentMandate` with spending caps, merchant restrictions, and an expiry. Yield is simulated in the demo; the Kamino adapter has been tested against a local mock reserve, not verified for live yield.
- **Local mock x402 flow ([#10](https://github.com/walthova/relicpay-v2/pull/10)):** A mock merchant sends an HTTP 402 challenge and releases a demo resource after verifying the first on-chain installment. This uses test tokens and existing installment instructions, not standard x402 settlement or an upfront merchant payment.
- **Wallet-free owner credit demo ([#14](https://github.com/walthova/relicpay-v2/pull/14)):** A browser walkthrough lets you set limits, try agent purchases, and see simulated merchant payouts and repayments. [IBG Collection](https://IBGCollects.com) is the example merchant, not a live integration.
- **CI and seeded fuzz testing ([#3](https://github.com/walthova/relicpay-v2/pull/3)):** The `RelicPay PR gate` checks the frozen v1 characterization suite, Rust unit tests, Anchor integration tests (including seeded agent-mandate cases), and the demo app. PRs to `main` require the gate to pass.

**The program is unaudited and not deployed to mainnet.** The collateral-backed credit line and upfront merchant funding shown in the browser demo are not implemented in the program on `main`. Do not use real funds.

## Quickstart

### Try the browser demo

From the repository root, use Node.js 22.12+ (`nvm use`), then run:

```sh
npm ci
npm --prefix app ci
npm --prefix app run dev
```

Open [localhost:3000](http://localhost:3000). Open the demo credit line, try a blocked purchase as Nova, then make an allowed purchase as Atlas. The Merchant and Activity views show simulated payouts and repayments. No wallet, API keys, or validator are needed.

### Run the mock x402 flow on localnet

With the root dependencies installed, use Rust, Anchor 0.32.1, and Agave/Solana CLI 3.0.11:

```sh
anchor build
node -r ts-node/register scripts/x402-mock/localnet.ts
```

The helper starts its own validator on port 18999 and uses throwaway keys and mock tokens. See the [mock flow guide](scripts/x402-mock/README.md) for reruns, reports, and test setup.

### Run the checks

```sh
node scripts/test-guard.js
cargo test --locked --manifest-path programs/relicpay/Cargo.toml
```

Follow the [localnet test setup](scripts/x402-mock/README.md#tests) to run `anchor test` with a throwaway wallet. To replay a CI fuzz case, prefix that command with `RELICPAY_FUZZ_SEED` set to the seed printed in the CI log.

## Roadmap

1. **Security first:** Expand fuzz and unit coverage, resolve [known limitations](SECURITY.md), and get an independent audit before mainnet.
2. **Micro-credit and x402:** Build a collateral-backed credit line and move from the mock challenge to x402 settlement, with caps on how much and how often an agent can spend.
3. **Reputation and underwriting:** Explore using repayment history to inform credit decisions for owners and their agents.
4. **Agent tooling:** Explore an MCP server and agent-facing SDK with owner-controlled limits and passkey or multisig approvals.

## Project journey

The [build log](docs/progress/) shows what shipped, what broke in testing, and what was deferred along the way:

- [July 2026: added the first protocol risk controls](docs/progress/2026-07-06.md).
- [October 2026: added the Kamino deposit path and local fallback](docs/progress/2026-10-26.md).
- [November 2026: built the merchant dashboard and its checkout SDK view model](docs/progress/2026-11-06.md).

For more background, see the [technical breakdown](docs/TECHNICAL_BREAKDOWN.md) and [funding materials](docs/funding/).
