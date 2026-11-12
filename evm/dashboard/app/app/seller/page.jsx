// The seller dashboard. Same shape as the buyer page and for the same reason; see its header and
// docs/ADR-001-dashboard-reads.md.

import { parseDashboardParams } from '../../../lib/routes.js';
import { loadForRoute } from '../data.js';
import { SellerView } from '../ui/SellerView.jsx';
import { Header, LoadProblem, RouteProblem } from '../ui/Shell.jsx';

export const dynamic = 'force-dynamic';

export default async function SellerPage({ searchParams }) {
  const sp = await searchParams;
  const parsed = parseDashboardParams(sp || {}, { role: 'seller' });

  if (!parsed.ok) {
    return (
      <main>
        <Header role="seller" parsed={parsed} />
        <RouteProblem parsed={parsed} />
      </main>
    );
  }

  const result = await loadForRoute(parsed);

  return (
    <main>
      <Header role="seller" parsed={parsed} at={result.ok ? result.view.at : null} />
      {result.ok ? (
        <SellerView view={result.view} address={parsed.address} />
      ) : (
        <LoadProblem error={result.error} role="seller" />
      )}
    </main>
  );
}
