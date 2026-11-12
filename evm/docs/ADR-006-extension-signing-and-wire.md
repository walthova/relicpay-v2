# ADR-006: how the popup signs, and what crosses chrome.runtime

Status: accepted, 2026-10-04
Context: roadmap "Browser extension revival, part c2", split into c2a (this ADR, the worker core),
c2b (the chrome shell: background.js, content.js, popup) and c2c (bundling). ADR-005 left one decision
open: a popup has no injected `window.ethereum`.

## Decision 1: the popup signs through a provider it owns, never through the page

Relaying `eth_signTypedData_v4` into the page world needs a MAIN-world script or `scripting`. ADR-005
refuses both, and a bridge into the page is exactly the crossing the whole design avoids. Rejected.

The signer is an injected `signTypedData` function, the same seam request.js already uses
(`signAgreementRequest`). The popup supplies an EIP-1193 provider that lives in the popup itself, a
WalletConnect v2 session being the intended one. The popup builds the typed data with request.js,
shows `buildConfirmation` output, and asks only for `eth_signTypedData_v4` on that data. The provider
learns nothing from the page, and the page learns nothing from the provider.

Consequence for c2b: the relay origin the provider talks to is a new host the manifest must name.
c2b adds a `walletOrigins` list to config.json and to the ADR-005 budget (wss or https exact
origins, same rules), rather than loosening anything. Until c2b, nothing here depends on which
provider is chosen.

## Decision 2: BigInt cannot cross chrome.runtime, so there is a wire encoding

`chrome.runtime.sendMessage` serializes with JSON, and JSON.stringify throws on BigInt. Every amount
in a quote and every uint in an AgreementRequest is a BigInt (ADR-003, ADR-004). ADR-004's note that
messages are structured clones was wrong for runtime messaging. `extension/lib/wire.js` tags each
BigInt as `{ "$bigint": "<digits>" }`. Only that exact shape decodes, anything else with the key is
refused, and a field literally named `$bigint` is refused on the way out, so page-controlled data
cannot forge or smuggle a number.

## Decision 3: the worker's trust rules are code, in extension/lib/worker.js

- A listing is accepted only from a tab whose origin is a configured seller storefront, and the
  reply is routed to the tab id from the sender, never from the message body.
- A signed request is accepted only from a sender with no tab, so a content script cannot submit one.
- The signed domain must equal the configured chain id and RelicPay address.
- The buyer comes from extension storage and the seller rate from operator config, never the page.
- The replay store is persisted (`extension/lib/store.js`) because an MV3 worker dies when idle.
  The requestId is recorded before the POST, so a transport failure costs the buyer one re-signature
  and never produces a double submit.
- Dependencies are injected (quoter, storage, tab sender, fetch, clock), so background.js stays a thin
  adapter and the suite drives the real logic without a browser.

## Still owed

c2b: background.js adapter, content.js (scrape, closed shadow root quote, never the confirmation),
popup, the buyer-connect flow that writes `relicpay/buyer`, and the `walletOrigins` manifest change.
c2c: a bundling step, since the lib is CommonJS and MV3 service workers load ES modules.
