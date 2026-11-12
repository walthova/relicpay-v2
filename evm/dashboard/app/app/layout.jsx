import './globals.css';
import { Providers } from './providers.jsx';
import { PendingProvider } from './write/PendingScopes.jsx';

export const metadata = {
  title: 'RelicPay',
  description: 'Buyer and seller dashboard for the RelicPay RWA BNPL protocol',
};

// Every page reads chain state, so nothing here is cacheable. Next would otherwise prerender the
// buyer and seller routes at build time, against an RPC endpoint that is not configured yet, and
// serve a snapshot of someone's finances from whenever the build ran.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* PendingProvider sits above the whole tree because a scope is page-wide: a payment sent
            from one agreement card claims the credit line and the collateral list, which are
            rendered somewhere else entirely. See rule 2 in docs/ADR-002-dashboard-writes.md. */}
        <Providers>
          <PendingProvider>{children}</PendingProvider>
        </Providers>
      </body>
    </html>
  );
}
