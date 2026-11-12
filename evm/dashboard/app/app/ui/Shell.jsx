// The page frame: header with the role switch and the wallet island, plus the two states a page can
// be in other than "here is a dashboard".
//
// The header is a server component that renders one client component. That is the whole client
// surface of this app.

import Link from 'next/link';

import { describeReason, otherRolePath } from '../../../lib/routes.js';
import { livePath } from '../../../lib/panels.js';
import { ConnectButton } from '../wallet/ConnectButton.jsx';
import { Address, AsOf } from './atoms.jsx';

export function Header({ role, parsed, at }) {
  const other = role === 'buyer' ? 'seller' : 'buyer';
  // Part c2 makes this link load bearing rather than a convenience. A confirmed write re-pins the
  // route to the receipt's block (ADR-002), so after paying, the URL in the address bar names a
  // fixed block and the page will never advance again. That URL is the one someone bookmarks or
  // sends to their seller. Without a way back to latest, the reload quietly converts a live
  // dashboard into a snapshot of the instant they paid.
  const pinned = Boolean(parsed.ok && parsed.block && parsed.address);
  return (
    <header className="top">
      <div className="top-left">
        <Link href="/" className="brand">
          RelicPay
        </Link>
        <nav>
          <span className="role-current">{role}</span>
          <Link href={otherRolePath({ role, address: parsed.address, block: parsed.block })}>
            switch to {other}
          </Link>
        </nav>
      </div>
      <div className="top-right">
        {parsed.address ? <Address value={parsed.address} /> : null}
        <ConnectButton role={role} routeAddress={parsed.address} />
      </div>
      {at ? <AsOf at={at} /> : null}
      {pinned ? (
        <p className="pinned-note">
          This view is pinned to block {parsed.block}.{' '}
          <Link href={livePath({ role, address: parsed.address })}>View the latest block</Link>
        </p>
      ) : null}
    </header>
  );
}

/** A route this page cannot load an address out of. Not an error page: `missing` is a first visit. */
export function RouteProblem({ parsed }) {
  return (
    <div className={parsed.reason === 'missing' ? 'notice' : 'notice notice-warn'}>
      <h2>{parsed.reason === 'missing' ? `No ${parsed.role} selected` : 'This link cannot be read'}</h2>
      <p>{describeReason(parsed)}</p>
      {parsed.given ? (
        <p className="muted">
          Given: <code>{parsed.given}</code>
        </p>
      ) : null}
    </div>
  );
}

/**
 * A load that failed for our reasons rather than the user's: no RPC endpoint configured, no address
 * book for this network, an endpoint that is down. Rendered rather than thrown, because a 500 with a
 * stack trace on a page that tells someone what they owe is the worst version of this.
 */
export function LoadProblem({ error, role }) {
  return (
    <div className="notice notice-danger">
      <h2>The {role} dashboard could not be loaded</h2>
      <p>{error.message}</p>
      <p className="muted">
        This is a configuration or network problem, not a problem with the address. Check RPC_URL,
        NETWORK and the address book; see dashboard/app/README.md.
      </p>
    </div>
  );
}
