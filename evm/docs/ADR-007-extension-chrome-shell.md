# ADR-007: the chrome shell, and what each context is allowed to know

Status: accepted, 2026-10-05
Context: roadmap "Browser extension revival, part c2b". ADR-005 fixed the permission budget and the
confirmation model, ADR-006 the signing seam, the wire encoding and the worker's trust rules. This ADR
decides how the three contexts (service worker, content script, popup) are built so that each one is a
thin file over a core the suite can run without a browser.

## Decision 1: every context is a core plus a few lines of glue

`extension/background.js`, `content.js` and `popup-main.js` only build real dependencies. The logic is in
chrome free cores: `lib/background-core.js`, `lib/content-core.js` and `lib/popup.js`, each taking
`chromeApi`, the document, storage, the provider and the clock as arguments. The suite drives the real
worker and the real popup controller against fakes, with a real viem account as the wallet, so the
signature, domain check and replay store under test are the shipped ones. A test pins the glue files at
40 lines or fewer and proves nothing under `extension/lib` references `chrome.`.

## Decision 2: the popup learns the quote through storage, not the tab

ADR-005 refuses `tabs` and `activeTab`, so a popup cannot ask which tab is active. The worker therefore
writes the latest quote (and the tab id it came from) to `relicpay/last-quote` in extension storage, in
wire encoding. The popup reads that. It treats the quote as stale after `requestTtlSeconds`, or if the
connected buyer is no longer the buyer the quote was made for, and never signs a stale one.

## Decision 3: what is shown is what is signed, and the signer is checked

`load()` builds the AgreementRequest once and holds it. The confirmation is derived from it (ADR-005),
and `sign()` signs that held object and nothing else, as `eth_signTypedData_v4` over typed data the
controller built. The returned signature is recovered locally and must be the connected buyer's before
anything is sent, so a wallet that signs from another account cannot get a request submitted. A signed
request is single use: the pending object is cleared, and a retry builds a new request with a new id.
Nothing here ever asks the page for anything.

## Decision 4: the page surface shows no amount and cannot carry markup

The content script renders in a closed shadow root. The surface says financing exists and how many
payments, or the extension's own refusal sentence, and nothing else: no figure, no unit. Amounts are the
popup's job (ADR-003). It is built as a plain tree and applied with `createElement` and `textContent`
over a tag and attribute allowlist (no `a`, `img`, `script`, `style`, `href`, `src` or `on*`), so hostile
text is text. The content script acts only on messages whose sender id is the extension's own, and
validates the shape before rendering. The listing is read from one marked element in a fixed shape;
zero listings is "none here" and more than one is refused.

## Decision 5: configuration is validated, and the shipped placeholder refuses to run

`config.json` gains `walletOrigins` (the relay the popup's provider talks to, in the manifest budget under
the same exact-origin rules, https only: a wss relay needs no host permission, so the https origin is the
grant) and a `deployment` block. `lib/runtime-config.js` refuses a zero or missing RelicPay address, an
operator endpoint or RPC URL whose origin the manifest does not grant, a bad credit unit, bad terms and
malformed rates. `createBackground` validates before it registers a listener, so a build with the
shipped placeholder never starts and cannot quote or sign against the wrong deployment.

## Not decided here, owed to c2c

- `popup.html` loads `popup.bundle.js`, and the entry files use `require`. Producing the bundle (and
  checking that it is what the manifest ships) is c2c.
- `wallet.js` is a seam that refuses clearly. The WalletConnect v2 provider is not installed: it cannot
  be fetched or verified in the offline suite. Its relay origin is already in the budget. Wiring it in
  is part of the bundling step.
- Nothing here was run in a real browser. The cores are proved; the DOM glue is read-checked only.
