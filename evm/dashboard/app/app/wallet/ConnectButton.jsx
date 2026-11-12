'use client';

// The client island, and the whole of wagmi's job in this app: connect a wallet, disconnect it, and
// write the connected address into the route so the server render can load it.
//
// The address goes into the URL rather than into React state on purpose. The dashboard is rendered
// on the server from the address in the route, so the route is the single source of truth for whose
// dashboard this is. That also makes every view a link: copyable, bookmarkable, shareable with a
// seller, and reloadable without reconnecting.
//
// This file imports wagmi and ../../../lib/routes.js and nothing else from the data layer. Importing
// the reader or the client here would ship the RPC endpoint and the log scan to the browser, which
// is what docs/ADR-001-dashboard-reads.md decided against; `app/data.js` is marked server-only so
// that mistake fails the build rather than shipping.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

import { dashboardPath, parseAddress, routeMatchesAddress } from '../../../lib/routes.js';

function short(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * @param {object} props
 * @param {'buyer'|'seller'} props.role which dashboard a connected wallet should be sent to
 * @param {string|null} props.routeAddress the address currently in the route, if any
 * @param {boolean} props.follow whether connecting should rewrite the route. False on the home
 *   page, where following the wallet would bounce anyone with a connected wallet off it on sight.
 */
export function ConnectButton({ role, routeAddress = null, follow = true }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();

  const parsedRoute = routeAddress ? { address: routeAddress } : null;
  const viewingSelf = isConnected && address ? routeMatchesAddress(parsedRoute, address) : false;

  // Someone who opened another party's dashboard by link and then connects their own wallet should
  // not be yanked off the page they asked for. Follow the wallet only when the route had no address
  // to begin with, or when it was already following this wallet and the wallet switched accounts.
  const following = useRef(follow && !routeAddress);

  useEffect(() => {
    if (!follow) return;
    if (!isConnected || !address) return;
    const parsed = parseAddress(address);
    if (!parsed.ok) return;
    if (routeMatchesAddress(parsedRoute, address)) {
      following.current = true;
      return;
    }
    if (!following.current) return;
    // `replace`, not `push`: connecting is not a navigation a back button should undo, and an
    // account switch in the wallet would otherwise stack one history entry per switch. Any `at=`
    // block is dropped, because a pinned historical block belongs to the address it was pinned for.
    router.replace(dashboardPath({ role, address: parsed.address }));
    // parsedRoute is derived from routeAddress, so routeAddress is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected, follow, role, router, routeAddress]);

  if (isConnected && address) {
    return (
      <div className="wallet">
        <span className="wallet-address" title={address}>
          {short(address)}
        </span>
        {!viewingSelf && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              following.current = true;
              router.replace(dashboardPath({ role, address }));
            }}
          >
            View mine
          </button>
        )}
        <button
          type="button"
          className="link-button"
          onClick={() => {
            following.current = false;
            disconnect();
          }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="wallet">
      {connectors.map((c) => (
        <button
          key={c.uid}
          type="button"
          className="button"
          disabled={isPending}
          onClick={() => {
            following.current = true;
            connect({ connector: c });
          }}
        >
          {isPending ? 'Connecting...' : `Connect ${c.name}`}
        </button>
      ))}
      {error && <span className="wallet-error">{error.message}</span>}
    </div>
  );
}
