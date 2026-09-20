# Relic Pay Relic — standing artifact

URL: https://claude.ai/code/artifact/8ebd1a88-89f6-4f3e-81ed-27fd0e20ca21

This is the live "Relic Pay Relic" artifact: a provenance-record page for the
protocol itself (thesis, build, funding clock, merchant pipeline, position).
Created 2026-09-19.

Do not create a new artifact for this. Every update republishes to the URL
above, so the link Walter shares never changes.

## How to update it (relicpay-growth / relicpay-build, end of each run)

1. Edit `artifact/relic-status.json` to reflect what actually changed this
   run. Only touch fields your run has real evidence for:
   - `build`: relicpay-build updates this after a shipped increment
     (headline, test counts, state).
   - `clock`, `pipeline`, `position`: relicpay-growth updates these after
     verifying deadlines, pipeline status, or a positioning decision.
   - `thesis`: rarely changes; only touch it if new Dune research replaces
     the Liquidation Tax finding.
   - `updated`: always bump to today's date (YYYY-MM-DD) if you changed
     anything else in the file.
2. Run `node scripts/build-relic-status.mjs` to regenerate
   `artifact/relic-status.html`.
3. Use the Artifact tool to publish `artifact/relic-status.html` with
   `url` set to the URL above (this updates the existing artifact in place,
   it does not create a new one).
4. Commit `artifact/relic-status.json` and `artifact/relic-status.html`
   along with your normal run output.

If nothing you verified this run actually changed a field, skip steps 2-4 —
don't republish an identical page just to have done something.
