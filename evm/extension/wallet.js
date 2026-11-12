// The popup's wallet provider seam (ADR-006 decision 1). Part c2b ships the seam, not a wallet.
//
// The controller needs an EIP-1193 provider that lives in the popup. A WalletConnect v2 session is
// the intended one, and its relay origin is already in config.json walletOrigins and the manifest
// budget. The WalletConnect package is not installed here: it cannot be fetched or verified in the
// offline suite, and a bundler step (part c2c) is what would carry it into the popup. Until then this
// refuses clearly rather than pretending to sign.
function createWalletProvider() {
  return {
    async request() {
      throw new Error('No wallet provider is bundled yet. WalletConnect is wired in with the bundling step.');
    },
  };
}
module.exports = { createWalletProvider };
