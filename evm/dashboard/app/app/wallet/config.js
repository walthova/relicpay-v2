'use client';

// wagmi configuration for wallet identity only.
//
// The transports below are deliberately the wallet's own and the chain's public default. That looks
// like an oversight and is not: per docs/ADR-001-dashboard-reads.md nothing in this app reads
// protocol state through wagmi, so this transport is never used for a RelicPay call. It exists
// because createConfig requires one, and because part c's write flows send transactions through the
// connected wallet, which uses the wallet's own endpoint regardless of what is configured here.
//
// The server-side endpoint, the one with the API key, is RPC_URL and is read in ../../lib/client.js.
// It must never appear in this file: everything here is bundled and served to the browser.

// `injected` comes from the wagmi root, not from `wagmi/connectors`. That barrel pulls in every
// connector wagmi ships, including the Base account SDK, whose own optional dependencies
// (@x402/evm and friends) do not resolve and fail the build outright. The root export is the same
// connector without the rest of the catalogue. If a hosted wallet is ever needed here, import that
// one connector by its own path rather than reopening the barrel.
import { createConfig, http, injected } from 'wagmi';
import { base, baseSepolia, mainnet, sepolia } from 'wagmi/chains';

export const SUPPORTED_CHAINS = [sepolia, mainnet, base, baseSepolia];

export const wagmiConfig = createConfig({
  chains: [sepolia, mainnet, base, baseSepolia],
  // EIP-6963 discovery is on by default, so every injected wallet the browser announces shows up in
  // useConnect().connectors on its own. This one is the fallback for a wallet that only exposes
  // window.ethereum.
  connectors: [injected()],
  // Server-rendered pages mount this provider too, so wagmi must not reach for window during SSR.
  ssr: true,
  transports: {
    [sepolia.id]: http(),
    [mainnet.id]: http(),
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
});
