#!/usr/bin/env node
// Renders artifact/relic-status.json into artifact/relic-status.html.
// The recurring relicpay-growth / relicpay-build agents update the JSON
// with what actually changed each run, then run this script, then publish
// the resulting HTML to the standing "Relic Pay Relic" artifact URL
// recorded in artifact/RELIC_URL.md. See that file for the publish step.
//
// Usage: node scripts/build-relic-status.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.join(__dirname, "..", "artifact", "relic-status.json");
const outPath = path.join(__dirname, "..", "artifact", "relic-status.html");

const data = JSON.parse(readFileSync(jsonPath, "utf8"));

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function daysOut(dateStr) {
  const target = new Date(dateStr + "T00:00:00Z");
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diff = Math.round((target - today) / 86400000);
  if (diff > 1) return `${diff} days out`;
  if (diff === 1) return "1 day out";
  if (diff === 0) return "today";
  return `${Math.abs(diff)} days past`;
}

const t = data.thesis, b = data.build, c = data.clock, p = data.pipeline, pos = data.position;

const html = `<title>Relic Pay Relic</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

  :root {
    --bg: #F2ECDC; --surface: #FAF6EA; --border: #D9CFB0;
    --ink: #211C12; --ink-dim: #6E6350;
    --accent: #93650E; --ledger: #3E7D74;
    --good: #3F7D4C; --warn: #A9631A; --critical: #AC3B2E;
    --seal-stroke: #93650E;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #14120C; --surface: #1C1911; --border: #362F20;
      --ink: #EDE6D3; --ink-dim: #A79A7D;
      --accent: #D9A94A; --ledger: #79C2B7;
      --good: #6FB077; --warn: #D6934C; --critical: #D97562;
      --seal-stroke: #D9A94A;
    }
  }
  :root[data-theme="dark"] {
    --bg: #14120C; --surface: #1C1911; --border: #362F20;
    --ink: #EDE6D3; --ink-dim: #A79A7D;
    --accent: #D9A94A; --ledger: #79C2B7;
    --good: #6FB077; --warn: #D6934C; --critical: #D97562;
    --seal-stroke: #D9A94A;
  }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--ink); font-family: 'IBM Plex Sans', system-ui, sans-serif; font-variant-numeric: tabular-nums; line-height: 1.55; }
  .page { max-width: 760px; margin: 0 auto; padding: 64px 24px 80px; }
  .seal-block { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 18px; margin-bottom: 56px; }
  .seal-block svg { width: 108px; height: 108px; }
  .wordmark { font-family: 'IBM Plex Mono', monospace; font-size: 13px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); font-weight: 500; }
  .seal-eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-dim); }
  h1 { font-family: 'Fraunces', serif; font-optical-sizing: auto; font-weight: 500; font-size: clamp(28px, 4.6vw, 40px); margin: 0; text-wrap: balance; letter-spacing: -0.01em; }
  h1 span { display: block; font-size: 0.42em; font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-dim); font-weight: 500; margin-top: 8px; }
  .seal-sub { max-width: 46ch; color: var(--ink-dim); font-size: 15px; }
  .ledger { display: flex; flex-direction: column; }
  .folio { display: grid; grid-template-columns: 44px 1fr; gap: 4px 20px; padding: 32px 0; border-top: 1px solid var(--border); }
  .folio:last-child { border-bottom: 1px solid var(--border); }
  .folio-num { font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: var(--accent); padding-top: 4px; }
  .folio-label { font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-dim); margin-bottom: 10px; }
  .folio-headline { font-family: 'Fraunces', serif; font-weight: 500; font-size: clamp(20px, 3.2vw, 25px); line-height: 1.3; margin: 0 0 12px; text-wrap: balance; }
  .folio-stat { font-family: 'IBM Plex Mono', monospace; font-size: 15px; color: var(--ink); display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0 0 12px; }
  .folio-stat b { color: var(--ledger); font-weight: 500; }
  .folio-body { color: var(--ink-dim); font-size: 15px; max-width: 62ch; }
  .folio-body a { color: var(--accent); text-decoration-color: var(--border); }
  .pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .pill { font-family: 'IBM Plex Mono', monospace; font-size: 12px; padding: 4px 10px; border-radius: 3px; border: 1px solid var(--border); background: var(--surface); color: var(--ink-dim); }
  .pill.state-good { color: var(--good); border-color: color-mix(in srgb, var(--good) 40%, var(--border)); }
  .pill.state-warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--border)); }
  .pill.state-critical { color: var(--critical); border-color: color-mix(in srgb, var(--critical) 40%, var(--border)); }
  .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--ink-dim); }
  .footer a { color: var(--ink-dim); }
  @media (max-width: 520px) { .folio { grid-template-columns: 1fr; } .folio-num { display: none; } }
</style>

<div class="page">

  <div class="seal-block">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="none" stroke="var(--seal-stroke)" stroke-width="1.5"/>
      <circle cx="50" cy="50" r="39" fill="none" stroke="var(--seal-stroke)" stroke-width="0.75"/>
      <polygon points="50,32 63,55 37,55" fill="none" stroke="var(--seal-stroke)" stroke-width="1.4"/>
      <circle cx="50" cy="50" r="8.5" fill="none" stroke="var(--seal-stroke)" stroke-width="1.4"/>
      <rect x="43" y="63" width="14" height="14" fill="none" stroke="var(--seal-stroke)" stroke-width="1.4"/>
    </svg>
    <div class="wordmark">Relic Pay</div>
    <div class="seal-eyebrow">Provenance Record &middot; Relic No. 000</div>
    <h1>The Protocol Itself<span>Not a garment. Not an installment. The thing that makes the others provable.</span></h1>
    <p class="seal-sub">Every Optic Relic in the collection carries a story that reveals on scan. This one is Relic Pay's own: the yield-bearing Buy Now, Pay Later protocol behind every other relic's provenance. Its record is drawn from the Walter OS hive, the RelicPay repository, and original on-chain research, and redrawn automatically as the protocol moves.</p>
  </div>

  <div class="ledger">

    <section class="folio">
      <div class="folio-num">I</div>
      <div>
        <div class="folio-label">The thesis</div>
        <h2 class="folio-headline">${esc(t.headline)}</h2>
        <p class="folio-stat"><b>${esc(t.stat)}</b> ${esc(t.stat_label)}</p>
        <p class="folio-body">${esc(t.body)} <a href="${esc(t.link)}" target="_blank" rel="noopener">${esc(t.link_label)}</a></p>
      </div>
    </section>

    <section class="folio">
      <div class="folio-num">II</div>
      <div>
        <div class="folio-label">The build</div>
        <h2 class="folio-headline">${esc(b.headline)}</h2>
        <p class="folio-stat">Anchor tests <b>${esc(b.anchor_tests)}</b> &middot; Cargo tests <b>${esc(b.cargo_tests)}</b></p>
        <p class="folio-body">${esc(b.body)}</p>
        <div class="pill-row">
          <span class="pill state-${esc(b.state_level)}">${esc(b.state)}</span>
          <span class="pill">${esc(b.note)}</span>
        </div>
      </div>
    </section>

    <section class="folio">
      <div class="folio-num">III</div>
      <div>
        <div class="folio-label">The clock</div>
        <h2 class="folio-headline">Colosseum Fall Hackathon, ${esc(daysOut(c.colosseum_deadline))}</h2>
        <p class="folio-stat">Submissions close <b>${esc(c.colosseum_deadline)}</b></p>
        <p class="folio-body">${esc(c.grant_body)}</p>
        <div class="pill-row">
          <span class="pill state-${esc(c.colosseum_blocker_level)}">${esc(c.colosseum_blocker)}</span>
          <span class="pill">${esc(c.grant_status)}</span>
        </div>
      </div>
    </section>

    <section class="folio">
      <div class="folio-num">IV</div>
      <div>
        <div class="folio-label">The pipeline</div>
        <h2 class="folio-headline">${esc(p.ready)} merchants, outreach-ready</h2>
        <p class="folio-stat"><b>${esc(p.ready)} / ${esc(p.total)}</b> candidates have verified contact channels</p>
        <p class="folio-body">${p.names.map(esc).join(", ")}. ${esc(p.body)}</p>
      </div>
    </section>

    <section class="folio">
      <div class="folio-num">V</div>
      <div>
        <div class="folio-label">The position</div>
        <h2 class="folio-headline">${esc(pos.headline)}</h2>
        <p class="folio-body">${esc(pos.body)}</p>
        <div class="pill-row">
          <span class="pill state-${esc(pos.state_level)}">${esc(pos.state)}</span>
        </div>
      </div>
    </section>

  </div>

  <div class="footer">
    <span>Drawn automatically from the Walter OS hive and the RelicPay repo. Last drawn ${esc(data.updated)}.</span>
    <span><a href="https://relicpay.app" target="_blank" rel="noopener">relicpay.app</a></span>
  </div>

</div>
`;

writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
