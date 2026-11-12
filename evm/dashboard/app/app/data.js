// The one place the app touches the data layer.
//
// `import 'server-only'` is the enforcement of docs/ADR-001-dashboard-reads.md, not decoration. The
// ADR says reads run in server components and wagmi never reads protocol state; this makes a client
// component that imports the reader fail the build instead of shipping the RPC endpoint, the ABIs
// and the eth_getLogs scan to every visitor. Nothing else in the app may import ../../lib/client.
import 'server-only';

import { loadDashboard } from '../../lib/client.js';
import { blockNumberOf } from '../../lib/routes.js';

/**
 * Load a parsed route into a serializable view model.
 *
 * Returns `{ ok: true, view }` or `{ ok: false, error }`. A page must be able to render a load
 * failure: an unreachable RPC endpoint or a missing address book is an ordinary operational state,
 * and the alternative is a 500 on a page whose job is to tell someone what they owe. Errors from
 * here are ours (configuration, network), not the user's; a bad address never gets this far,
 * routes.js turned it into a message first.
 */
export async function loadForRoute(parsed) {
  if (!parsed || !parsed.ok) throw new Error('loadForRoute needs a parsed route that succeeded');
  try {
    const view = await loadDashboard(parsed.address, {
      role: parsed.role,
      blockNumber: blockNumberOf(parsed),
    });
    return { ok: true, view };
  } catch (error) {
    return {
      ok: false,
      error: {
        // The message is shown; the stack is not. A server render leaks whatever it renders, and a
        // viem stack carries the RPC URL, which is the one value this whole file exists to keep off
        // the client.
        message: error && error.message ? error.message : 'the dashboard could not be loaded',
        name: error && error.name ? error.name : 'Error',
      },
    };
  }
}
