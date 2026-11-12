# ADR-001: how the dashboard reads chain state

Status: accepted, 2026-09-14
Context: roadmap "Next.js buyer/seller dashboard, part b", which asked for this decision before any
app code was written.

## The question

Part a shipped `dashboard/lib/reader.js`, a framework-free read layer whose central invariant is
that one dashboard render is one block. `getBuyerDashboard` makes on the order of twenty eth_calls
and pins all of them to a single block number taken once at the top.

Part b has to put a UI on that. The two candidates:

1. wagmi hooks in client components wrapping the reader.
2. React Server Components calling the reader directly, with wagmi confined to the client for
   wallet identity and, later, writes.

## Decision

**Reads go through server components. wagmi never reads protocol state.**

wagmi's role is narrowed to three things: which address is connected, which chain the wallet is on,
and (part c) sending transactions. It is a client-side island that supplies an address; it is not
the data path.

## Why

**The pin does not survive hooks.** wagmi's natural unit is one hook per read. Twenty
`useReadContract` calls resolve twenty independent block tags, which is precisely the inconsistency
the pin exists to prevent: a credit line from block N rendered beside a payment schedule from N+2
that already consumed it, so the page shows available credit that is gone. The failure is silent and
the numbers look plausible, which is the worst shape for a money screen.

One `useQuery` wrapping the whole `getBuyerDashboard` would keep the pin. But then wagmi is
contributing a cache and nothing else, and it is contributing it on the wrong side of the network.

**Log scanning belongs on the server.** Agreement discovery is `eth_getLogs` over the deployment's
full block range. In the browser that is a wide, repeated, unauthenticated range query against
whatever RPC endpoint is in the bundle. Public endpoints rate-limit it; a keyed endpoint means the
key ships to every visitor. On the server the range query happens once per request against a URL
that stays in the environment.

**Nothing in the reader has to change.** Part a's whole argument was that the layer is provable
against ganache without a renderer. Server components consume it as the plain async module it
already is. Hooks would have required a parallel wagmi-shaped surface next to the one the
characterization suite exercises, and two surfaces drift.

## Cost, and what this session paid

React cannot serialize `BigInt` across the server/client boundary, and the reader returns `BigInt`
for every amount, timestamp and duration. Rendering entirely in server components would sidestep it,
but part c needs interactive client components holding this data, so the boundary is real.

So the decision requires a presenter: `dashboard/lib/present.js`, pure functions that turn reader
output into JSON-safe view models. It is framework-free for the same reason the reader is, and it is
tested against live reader output on ganache rather than against fixtures.

Two things the presenter is deliberately strict about:

- **Unknown token decimals render as nothing, never as a plausible number.** An agreement settled in
  a 6-decimal stablecoin, formatted at 18, shows `0.000000000001`. The presenter emits
  `display: null, known: false` when it has no metadata for a currency and lets the UI say so.
- **Every amount carries its own currency.** `getSettlementTerms` performs no conversion, so an
  agreement's `totalPrice` is denominated in that agreement's settlement token, not in wei. The
  currency is a per-agreement fact and is attached to every amount derived from it.

## Consequence found while building this

`getSettlementReadiness` and `getSettlementTerms` both return zeroes once an agreement leaves
Active, and the reader built its settlement block from them alone. That meant a completed or
defaulted agreement came back with no currency at all, and the presenter would have denominated a
stablecoin agreement's history in ETH.

Fixed in the reader by reading `getSettlementToken`, which is not gated on state, into a new
`settlementToken` field that is always present. The Active-only `settlement` block is unchanged and
still means "what the next payment needs".

## Revisit if

Server components stop being able to hold the RPC URL privately (a fully static export), or the
product needs sub-block-latency live updates, at which point a websocket subscription feeding a
single pinned refetch is the next step, still not per-field hooks.
