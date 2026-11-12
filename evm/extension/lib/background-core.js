// Builds the service worker from a chrome-like object. Part c2b.
//
// background.js is a few lines of glue over this. Splitting it out lets the suite run the real wiring
// against a fake chrome: the config is validated first (a bad or placeholder config means the worker
// never starts, so nothing can sign or quote against the wrong deployment), the quoter and the replay
// store are constructed, and one onMessage listener forwards to worker.handle. The listener answers
// over the wire encoding, since chrome.runtime carries JSON (ADR-006).
//
// Chrome free: `chromeApi` is passed in.

const { buildRuntimeConfig } = require('./runtime-config');
const { createPersistentSeenStore } = require('./store');
const { createWorker } = require('./worker');
const { toWire } = require('./wire');

/**
 * @param {object} deps
 * @param {object} deps.chromeApi  { runtime: {onMessage}, tabs: {sendMessage}, storage: {local} }
 * @param {object} deps.rawConfig  parsed extension/config.json
 * @param {function} deps.makeQuoter  (runtimeConfig) -> a createOfferQuoter() result
 * @param {function} [deps.fetchImpl]
 * @param {function} [deps.now]
 */
function createBackground({ chromeApi, rawConfig, makeQuoter, fetchImpl, now }) {
  const runtime = buildRuntimeConfig(rawConfig); // throws ConfigError: the worker does not start
  const storage = chromeApi.storage.local;
  const worker = createWorker({
    config: runtime.worker,
    quoter: makeQuoter(runtime),
    storage,
    sendToTab: (tabId, wire) => chromeApi.tabs.sendMessage(tabId, wire),
    createStore: () => createPersistentSeenStore(storage),
    fetchImpl,
    now,
  });

  function listener(wireMsg, sender, sendResponse) {
    worker
      .handle(wireMsg, sender)
      .then((result) => sendResponse(toWire(result)))
      .catch(() => sendResponse(toWire({ ok: false, code: 'INTERNAL', reason: 'The extension hit an internal error.' })));
    return true; // the response is asynchronous
  }

  chromeApi.runtime.onMessage.addListener(listener);
  return { runtime, worker, listener };
}

module.exports = { createBackground };
