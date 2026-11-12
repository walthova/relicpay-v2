// The quote surface the content script injects. Part c2b.
//
// ADR-003: the page may show that financing exists but the amount a buyer confirms is rendered by
// the extension, in the popup, never in the page. So this surface carries no amount at all: it says
// whether financing is available and how many payments, or the extension's own sentence for why not.
// Everything is built as a plain tree of { tag, text, attrs, children } and applied with
// createElement and textContent only, so there is no innerHTML to inject through, no event handler
// attribute, no href or src, and a tag outside the allowlist is dropped.
//
// Chrome free. applyTree takes the `document` it should build in, so the suite drives it with a fake.

const ALLOWED_TAGS = new Set(['div', 'p', 'strong', 'span']);
const ALLOWED_ATTRS = new Set(['class', 'role']);

function quoteView(quote) {
  if (!quote || typeof quote.ok !== 'boolean') throw new Error('quote must be a quote() result');
  if (!quote.ok) {
    return {
      tag: 'div',
      attrs: { class: 'rp-card rp-refused', role: 'status' },
      children: [
        { tag: 'strong', text: 'Financing not available' },
        // The extension's own words (offer.js REFUSAL, worker.js WORKER_REFUSAL), never the page's.
        { tag: 'p', text: String(quote.reason || quote.code || 'Not available.') },
      ],
    };
  }
  const n = Number(quote.installmentCount);
  return {
    tag: 'div',
    attrs: { class: 'rp-card rp-ok', role: 'status' },
    children: [
      { tag: 'strong', text: 'Pay in installments with RelicPay' },
      { tag: 'p', text: `${n} ${n === 1 ? 'payment' : 'payments'}. Open the RelicPay extension to review and confirm.` },
      ...(quote.unconfirmed ? [{ tag: 'p', text: 'Your credit may not cover this yet.' }] : []),
    ],
  };
}

function resultView(result) {
  if (!result || typeof result.ok !== 'boolean') throw new Error('result must be a submit-result message');
  return {
    tag: 'div',
    attrs: { class: result.ok ? 'rp-card rp-ok' : 'rp-card rp-refused', role: 'status' },
    children: [
      { tag: 'strong', text: result.ok ? 'Request sent' : 'Request not sent' },
      { tag: 'p', text: result.ok ? 'The seller will review your financing request.' : String(result.reason || result.code || 'Not sent.') },
    ],
  };
}

function applyTree(doc, node) {
  if (!node || !ALLOWED_TAGS.has(node.tag)) return null;
  const el = doc.createElement(node.tag);
  for (const [k, v] of Object.entries(node.attrs || {})) {
    if (ALLOWED_ATTRS.has(k)) el.setAttribute(k, String(v));
  }
  if (typeof node.text === 'string') el.textContent = node.text;
  for (const child of node.children || []) {
    const c = applyTree(doc, child);
    if (c) el.appendChild(c);
  }
  return el;
}

const SURFACE_STYLE =
  '.rp-card{font:14px system-ui,sans-serif;border:1px solid #6b5b95;border-radius:8px;padding:10px 12px;margin:8px 0;background:#fff;color:#1a1a1a}' +
  '.rp-card p{margin:4px 0 0}.rp-refused{border-color:#999;color:#555}';

module.exports = { ALLOWED_TAGS, ALLOWED_ATTRS, SURFACE_STYLE, quoteView, resultView, applyTree };
