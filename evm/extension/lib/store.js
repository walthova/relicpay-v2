// A replay store that survives service worker termination. Part c2a.
//
// ADR-005 grants `storage` for exactly this: an MV3 worker is killed when idle, so request.js's
// in-memory createSeenRequestStore forgets every requestId between wakeups. This module keeps the
// same three methods checkRequest uses (hasSeen, remember, sweep) over a chrome.storage.local-like
// area ({ get(key) -> Promise<{[key]: v}>, set({[key]: v}) -> Promise }), loaded into memory at the
// start of a request and written back after a change.

const KEY = 'relicpay/seen-requests';

async function createPersistentSeenStore(area, { key = KEY } = {}) {
  const got = (await area.get(key)) || {};
  const raw = got[key] && typeof got[key] === 'object' ? got[key] : {};
  const seen = new Map();
  for (const [id, expiry] of Object.entries(raw)) {
    try {
      seen.set(id, BigInt(expiry));
    } catch {
      // a corrupt entry is dropped rather than trusted
    }
  }

  return {
    hasSeen: (id) => seen.has(id),
    remember(id, expiry) {
      seen.set(id, BigInt(expiry));
    },
    sweep(now) {
      const t = BigInt(now);
      for (const [id, expiry] of seen) if (expiry < t) seen.delete(id);
    },
    size: () => seen.size,
    async save() {
      const out = {};
      for (const [id, expiry] of seen) out[id] = expiry.toString();
      await area.set({ [key]: out });
    },
  };
}

module.exports = { createPersistentSeenStore, SEEN_KEY: KEY };
