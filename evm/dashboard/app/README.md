# RelicPay dashboard

Next.js App Router front end for the buyer and seller views. Part b2 of the dashboard roadmap item.

## Why this has its own package.json

The repo root manifest is what the solc + ganache characterization suite installs. It is small and
installs offline. `next`, `react` and `wagmi` are several hundred packages that the test toolchain
has no use for, so they live here instead. The two installs are independent.

## Architecture

Set by [docs/ADR-001-dashboard-reads.md](../../docs/ADR-001-dashboard-reads.md):

- **Reads run in server components.** `app/data.js` is the only file that imports the data layer,
  and it starts with `import 'server-only'`, so a client component that reaches for the reader fails
  the build rather than shipping the RPC endpoint, the ABIs and the log scan to every visitor.
- **wagmi never reads protocol state.** Its entire job is `app/wallet/ConnectButton.jsx`: connect,
  disconnect, and write the connected address into the route. There is no `useReadContract` in this
  app and there must not be one.
- **The route is the source of truth for whose dashboard this is.** `/buyer?address=0x...`. That
  makes every view a link: copyable, bookmarkable, reloadable without reconnecting, and
  server-renderable. `?at=<block>` pins the same view to a historical block.
- **Route parsing lives in `../lib/routes.js`,** not in the pages, because that is the layer the
  offline suite can prove. Nothing reaches viem until it has been validated there; an invalid
  address in a query string renders a message, it does not 500.

## Routes

| Route | What it shows |
| --- | --- |
| `/` | Role picker, wallet connect, address lookup form |
| `/buyer?address=0x...` | Credit, collateral, auto-payment pool, agreements |
| `/seller?address=0x...` | Settlement preference, withdrawable balances, receivables, agreements |
| `…&at=<block>` | The same view pinned to a historical block |

## Running it

The data layer resolves `viem` from the repo root, so install both:

```bash
npm install                 # repo root, once
cd dashboard/app
cp .env.example .env.local  # then set RPC_URL and NETWORK
npm install
npm run dev
```

`npm run build` type-checks nothing (this is JavaScript, not TypeScript) but does compile every
route and will fail on a client component that imports `server-only`, which is the architectural
check worth having in CI.

## Writes

Set by [docs/ADR-002-dashboard-writes.md](../../docs/ADR-002-dashboard-writes.md) and wired in part
c2. The shape is the same idea as the reads: the decisions live in `../lib`, where the offline suite
can prove them, and the components render what those modules return.

- **`../lib/panels.js` is the control surface.** Which controls exist for a viewer, which are
  disabled, the sentence saying why, and the steps each plan will send. A rule that lives in JSX is
  a rule nothing checks, because the suite cannot render React, so no rule lives in JSX.
- **`app/write/Actions.jsx`** is the only interactive surface. It holds form state and nothing else.
- **`app/write/useActionRunner.js`** is the only file that sends a transaction. Steps run strictly
  in sequence, each awaiting its receipt, so the second half of an approve-then-pay cannot reach the
  contract before the allowance does.
- **Pending is a scope, not a spinner.** `app/write/PendingScopes.jsx` holds the in-flight plans for
  the whole tree, because a payment sent from one agreement card claims the credit line and the
  collateral list, which render elsewhere.
- **A confirmed write navigates to `?at=<receipt block>`,** which re-renders through the same
  `loadDashboard` path a fresh visit uses. There is one read path in this app and no cache to
  invalidate. The header then offers a link back to the latest block, because that pin is otherwise
  permanent and the URL is what people bookmark.

Client components may import `../lib/writes.js`, `../lib/panels.js` and `../lib/abis.js`: encoding a
transaction needs its ABI and the wallet is what sends it. They still may not import `client`,
`reader`, `tokens` or `present`, which carry `RPC_URL` and the log scan. The write layer costs the
buyer and seller routes about 19 kB of First Load JS.

## What is not here yet

Withdrawing collateral. The protocol has no function for it: `depositETHCollateral` and
`depositERC20Collateral` have no counterpart in `RelicPay.sol`, so the dashboard cannot offer the
flow until the contract does. Filed as its own Phase 2 roadmap item.
