// The buyer dashboard. A server component, per docs/ADR-001-dashboard-reads.md.
//
// The shape of this file is the ADR made concrete: parse the route, load on the server, render. No
// hooks, no wagmi, no client bundle. The only interactive thing on the page is the connect button
// inside Header, which is its own island and reads nothing.

import { parseDashboardParams } from '../../../lib/routes.js';
import { loadForRoute } from '../data.js';
import { BuyerView } from '../ui/BuyerView.jsx';
import { Header, LoadProblem, RouteProblem } from '../ui/Shell.jsx';

export const dynamic = 'force-dynamic';

export default async function BuyerPage({ searchParams }) {
  // Next 15 hands searchParams over as a promise. Awaiting a plain object is harmless, so this is
  // also correct if the app is ever pinned back to 14.
  const sp = await searchParams;
  const parsed = parseDashboardParams(sp || {}, { role: 'buyer' });

  if (!parsed.ok) {
    return (
      <main>
        <Header role="buyer" parsed={parsed} />
        <RouteProblem parsed={parsed} />
      </main>
    );
  }

  const result = await loadForRoute(parsed);

  return (
    <main>
      <Header role="buyer" parsed={parsed} at={result.ok ? result.view.at : null} />
      {result.ok ? (
        <BuyerView view={result.view} address={parsed.address} />
      ) : (
        <LoadProblem error={result.error} role="buyer" />
      )}
    </main>
  );
}
