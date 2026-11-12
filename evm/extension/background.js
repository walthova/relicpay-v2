// MV3 service worker entry. Part c2b. A bundler entry point (part c2c): it uses require().
const { createPublicClient, http } = require('viem');
const { createOfferQuoter } = require('./lib/offer');
const { createRelicPayReader } = require('../dashboard/lib/reader');
const { createBackground } = require('./lib/background-core');
const rawConfig = require('./config.json');

createBackground({
  chromeApi: chrome,
  rawConfig,
  fetchImpl: (...a) => fetch(...a),
  makeQuoter: (runtime) => {
    const publicClient = createPublicClient({ transport: http(runtime.rpcUrl) });
    const reader = createRelicPayReader({ publicClient, addresses: runtime.addresses });
    return createOfferQuoter({ publicClient, addresses: runtime.addresses, reader });
  },
});
