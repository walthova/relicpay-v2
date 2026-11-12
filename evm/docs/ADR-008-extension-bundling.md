# ADR-008: Extension bundling and the shippable check

Status: accepted. Part c2c of the browser extension revival. Follows ADR-005 (permission budget), ADR-006 (signing and wire) and ADR-007 (chrome shell).

## Context

Every extension source file is CommonJS, because the offline mocha suite and dashboard/lib share the same modules. An MV3 service worker, a content script and a popup page cannot `require()`, and an installed extension has no node_modules. ADR-007 left the entries (`background.js`, `content.js`, `popup-main.js`) as bundler entry points and `popup.html` loading `popup.bundle.js`, which did not exist. Nothing proved that what would be loaded in Chrome was what the sources and the validated manifest describe.

## Decisions

1. **esbuild, as a devDependency, bundling to IIFE.** It is one package with no plugins, deterministic for fixed sources, and needs no network at build time. Output is unminified on purpose: a reviewer of a signing extension should be able to read what ships, and Chrome Web Store review prefers it. Target is chrome110, platform browser. Node builtins are not polyfilled, so a stray import of one fails the build.
2. **The loaded directory is `extension/dist`.** It holds `background.js`, `content.js`, `popup.bundle.js`, `popup.html` and a verbatim copy of the generated `manifest.json`. The names are the ones the manifest and popup.html already use, so no source file changed. `dist` is generated and not checked in.
3. **What ships is verified, statically.** `npm run extension:verify` rebuilds from sources and fails unless dist matches it byte for byte, and also checks: every file the manifest or popup.html references exists; `dist/manifest.json` equals the source manifest and still passes the ADR-005 budget; each script is self-contained (no `require`, `import`, `export` or `node:` specifier left); nothing can load or evaluate code at runtime (`eval`, `new Function`, `importScripts`, dynamic `import()`, creating a script element), which the `script-src 'self'` policy would block anyway; popup.html has no inline script, remote script or inline handler; and dist holds nothing the manifest does not account for.
4. **The suite builds into a temp directory.** test/extension-bundle.test.js never reads or writes `extension/dist`. Each refusal is proved by mutating a good build and requiring the specific code, so a check that silently stopped checking would fail.
5. **Content script stays small.** The suite asserts `content.js` does not contain the chain client, since it runs inside a seller page.

## Consequences

- WalletConnect is still not installed. `wallet.js` remains a seam that refuses. Adding the package now only changes what the popup bundle contains, and the verify step already covers it (a provider that pulled in `eval` or a remote script would be refused). Pick the wallet package in its own roadmap item.
- `config.json` `deployment.relicPay` is still the zero placeholder, on purpose. The bundle carries it and the runtime config refuses to run on it.
- Nothing has been loaded in a real browser. The checks are static; a manual load of `extension/dist` as an unpacked extension is the remaining smoke test.
- Bundle size is about 1.9 MB for the worker and 1.7 MB for the popup, almost all viem. Minification and tree shaking are available later without changing the contract above, but would make the shipped code harder to review, so they are not on by default.
