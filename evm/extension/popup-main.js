// Popup entry (bundled to popup.bundle.js in part c2c). Renders controller output with textContent
// only, and builds the controller around a provider from wallet.js.
const { createPopupController, POPUP_STATE } = require('./lib/popup');
const { buildRuntimeConfig } = require('./lib/runtime-config');
const { createWalletProvider } = require('./wallet');
const rawConfig = require('./config.json');

const view = document.getElementById('view');
const actions = document.getElementById('actions');

function line(parent, tag, text, cls) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (cls) el.className = cls;
  parent.appendChild(el);
  return el;
}
function button(label, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', fn);
  actions.appendChild(b);
}

const controller = createPopupController({
  runtime: buildRuntimeConfig(rawConfig),
  storage: chrome.storage.local,
  send: (msg) => chrome.runtime.sendMessage(msg),
  provider: createWalletProvider(rawConfig),
});

async function render(note) {
  view.textContent = '';
  actions.textContent = '';
  const m = await controller.load();
  if (note) line(view, 'p', note);
  if (m.state !== POPUP_STATE.READY) {
    line(view, 'p', m.text);
    if (m.state === POPUP_STATE.NO_BUYER) button('Connect wallet', async () => { const r = await controller.connect(); render(r.ok ? '' : r.reason); });
    else button('Disconnect', async () => { await controller.disconnect(); render(''); });
    return;
  }
  const c = m.confirmation;
  line(view, 'div', c.total, 'total');
  const dl = document.createElement('dl');
  const row = (k, v) => { line(dl, 'dt', k); line(dl, 'dd', v); };
  row('Payments', `${c.installments.count} of ${c.installments.each}` + (c.installments.last ? `, last ${c.installments.last}` : ''));
  row('Every', c.installments.every);
  row('Grace', c.installments.grace);
  row('Method', String(c.paymentMethod));
  row('Seller', c.seller);
  row('Relic', `${c.relic.nftContract} #${c.relic.tokenId}`);
  view.appendChild(dl);
  for (const w of c.warnings) line(view, 'p', w.message, 'warn');
  if (c.unconfirmed) line(view, 'p', 'Your credit may not cover this yet.', 'warn');
  if (c.canSign) button('Sign and request', async () => { const r = await controller.sign(); render(r.ok ? 'Request sent.' : r.reason); });
  button('Disconnect', async () => { await controller.disconnect(); render(''); });
}
render('');
