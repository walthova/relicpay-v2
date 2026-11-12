'use client';

// The wagmi boundary. This is the only provider tree in the app and it wraps exactly one thing:
// which wallet is connected. Per docs/ADR-001-dashboard-reads.md wagmi never reads protocol state,
// so there is no useReadContract anywhere under here and there must not be one.

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { wagmiConfig } from './wallet/config.js';

export function Providers({ children }) {
  // One client per browser session, created in state rather than at module scope: a module-scope
  // client is shared across requests on the server, which on a dashboard means one user's cache
  // answering another user's render.
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  }));

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
