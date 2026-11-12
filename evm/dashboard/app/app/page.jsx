// The entry point. Deliberately not a redirect to /buyer: an address can be both a buyer and a
// seller, the protocol has no notion of which one someone "is", and guessing means half of visitors
// land on a page that is correctly empty and looks broken.

import Link from 'next/link';

import { dashboardPath, parseAddress } from '../../lib/routes.js';
import { ConnectButton } from './wallet/ConnectButton.jsx';

export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }) {
  const sp = (await searchParams) || {};
  const raw = typeof sp.address === 'string' ? sp.address : null;
  const parsed = raw ? parseAddress(raw) : null;
  const address = parsed && parsed.ok ? parsed.address : null;

  return (
    <main className="home">
      <h1>RelicPay</h1>
      <p className="lede">
        Real-world asset BNPL. Pick a view, or connect a wallet and the address goes into the URL.
      </p>

      {raw && !address ? (
        <p className="warn-line">
          <code>{raw}</code> is not a valid address, so the links below were left empty.
        </p>
      ) : null}

      <div className="home-actions">
        <Link className="button" href={address ? dashboardPath({ role: 'buyer', address }) : '/buyer'}>
          Buyer dashboard
        </Link>
        <Link className="button" href={address ? dashboardPath({ role: 'seller', address }) : '/seller'}>
          Seller dashboard
        </Link>
      </div>

      {/* follow={false}: on a dashboard the island rewrites the route to the connected wallet, which
          is the point. Here it would bounce anyone with a connected wallet straight off the home
          page and they could never get back to it. */}
      <ConnectButton role="buyer" routeAddress={address} follow={false} />

      <form className="home-form" action="/buyer" method="get">
        <label htmlFor="address">Or look up an address</label>
        <input id="address" name="address" placeholder="0x..." autoComplete="off" spellCheck="false" />
        <button className="button" type="submit">
          View as buyer
        </button>
      </form>
    </main>
  );
}
