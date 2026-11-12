// The route contract: what a URL means, decided outside the framework.
//
// Part b2 of the "Next.js buyer/seller dashboard" roadmap item. Everything the app does with a URL
// lives here rather than inside a page component, for the same reason the rest of dashboard/lib
// does: this is the layer that decides which address the page is about, and it is provable against
// a real chain in the offline suite. A page component is not.
//
// The rules below are all about one failure. `loadDashboard` hands its address straight to viem,
// and viem throws on anything that is not an address. In a server component that throw is a 500
// with a stack trace, on a page whose whole job is to tell someone what they owe, triggered by a
// typo in a query string. So nothing reaches the reader until it has been through here, and every
// rejection is a value the page can render as a message.
//
// Framework free by the same rule as the rest of this directory: no React, no next/*, no wagmi. The
// client island imports `dashboardPath` to write the connected address into the route, so this file
// is bundled for the browser too; it must stay small and must not reach for anything server-side.

const { getAddress } = require('viem');

class RouteError extends Error {}

const ROLES = ['buyer', 'seller'];

/** Query keys the dashboard understands. Anything else in the URL is ignored, not an error. */
const PARAMS = { address: 'address', block: 'at' };

/**
 * Why a parse failed. These are render states, not exceptions: each one is a different thing to
 * say to whoever is looking at the page.
 *
 *   missing    no address at all, the ordinary first visit. Show the connect button.
 *   ambiguous  ?address= given more than once with different values. Refusing beats picking one,
 *              because the two values are two different people's finances and there is no basis
 *              for choosing between them.
 *   malformed  not 20 bytes of hex.
 *   checksum   right shape, mixed case, and the EIP-55 checksum does not match, which is what a
 *              single mistyped character in a copied address looks like. Treated as an error rather
 *              than lowercased away, since that is the entire point of the checksum.
 *   block      ?at= is not a non-negative integer.
 */
const REASONS = ['missing', 'ambiguous', 'malformed', 'checksum', 'block'];

function isRole(role) {
  return ROLES.includes(role);
}

function assertRole(role) {
  if (!isRole(role)) throw new RouteError(`role must be one of ${ROLES.join(', ')}, got ${String(role)}`);
  return role;
}

/**
 * One value out of a Next.js searchParams entry, which is `string | string[] | undefined`.
 *
 * Returns `{ value }`, `{ missing: true }`, `{ ambiguous: true }` or `{ malformed: true }`. An
 * array is what `?address=a&address=b` produces, and taking the first silently resolves a conflict
 * the caller should see.
 */
function single(raw) {
  if (raw === undefined || raw === null) return { missing: true };
  if (Array.isArray(raw)) {
    const values = raw.filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
    if (values.length === 0) return { missing: true };
    // Repeating the same value is not a conflict, only a clumsy link.
    const unique = new Set(values.map((v) => v.toLowerCase()));
    if (unique.size > 1) return { ambiguous: true, values };
    return { value: values[0] };
  }
  if (typeof raw !== 'string') return { malformed: true };
  const v = raw.trim();
  return v === '' ? { missing: true } : { value: v };
}

/**
 * Validate an address and return it EIP-55 checksummed.
 *
 * All-lowercase and all-uppercase carry no checksum information, so they are accepted and
 * checksummed here. Mixed case is a claim, and a claim that does not hold is rejected.
 */
function parseAddress(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'malformed' };
  const value = input.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return { ok: false, reason: 'malformed' };
  const body = value.slice(2);
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
  let checksummed;
  try {
    checksummed = getAddress(value.toLowerCase());
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (mixed && checksummed !== value) return { ok: false, reason: 'checksum', suggestion: checksummed };
  return { ok: true, address: checksummed };
}

/**
 * A block number for the history view.
 *
 * Returned as a decimal string, not a BigInt: this crosses into a page's props and the presenter's
 * whole existence is that BigInt does not survive that trip. `loadDashboard` takes it back as a
 * BigInt via `blockNumberOf` below.
 */
function parseBlock(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'block' };
  const value = input.trim();
  if (!/^\d+$/.test(value)) return { ok: false, reason: 'block' };
  return { ok: true, block: value.replace(/^0+(?=\d)/, '') };
}

/** The BigInt `loadDashboard` wants, from the string the route carries. */
function blockNumberOf(parsed) {
  if (!parsed || parsed.block === null || parsed.block === undefined || parsed.block === '') return undefined;
  return BigInt(parsed.block);
}

/**
 * Turn a Next.js `searchParams` object into either something the page can load or something it can
 * say. Never throws on user input; `role` is the one argument that comes from the code rather than
 * the URL, so a bad one is a programming error and does throw.
 *
 * @param {object} searchParams
 * @param {{role: string}} options
 * @returns {{ok: boolean, role: string, address: string|null, block: string|null,
 *            reason?: string, suggestion?: string, given?: string}}
 */
function parseDashboardParams(searchParams, { role } = {}) {
  assertRole(role);
  const sp = searchParams && typeof searchParams === 'object' ? searchParams : {};
  const no = (reason, extra = {}) => ({ ok: false, role, address: null, block: null, reason, ...extra });

  const rawAddress = single(sp[PARAMS.address]);
  if (rawAddress.missing) return no('missing');
  if (rawAddress.ambiguous) return no('ambiguous', { given: rawAddress.values.join(', ') });
  if (rawAddress.malformed) return no('malformed', { given: String(sp[PARAMS.address]) });

  const address = parseAddress(rawAddress.value);
  if (!address.ok) {
    return no(address.reason, {
      given: rawAddress.value,
      ...(address.suggestion ? { suggestion: address.suggestion } : {}),
    });
  }

  // The block is parsed after the address so an unreadable `at=` on a page that also has no address
  // still reports the address problem, which is the one worth fixing first.
  const rawBlock = single(sp[PARAMS.block]);
  let block = null;
  if (!rawBlock.missing) {
    const bad = { ok: false, role, address: address.address, block: null, reason: 'block' };
    if (rawBlock.ambiguous) return { ...bad, given: rawBlock.values.join(', ') };
    if (rawBlock.malformed) return { ...bad, given: String(sp[PARAMS.block]) };
    const parsed = parseBlock(rawBlock.value);
    if (!parsed.ok) return { ...bad, given: rawBlock.value };
    block = parsed.block;
  }

  return { ok: true, role, address: address.address, block };
}

/**
 * The URL for a dashboard view. The client island calls this to write the connected wallet into the
 * route, so connecting a wallet produces a link that can be copied, bookmarked and reloaded, and
 * the server render is what fills it in.
 *
 * An address is checksummed here, never lowercased: the route is a thing a person reads.
 */
function dashboardPath({ role, address, block } = {}) {
  assertRole(role);
  const query = [];
  if (address !== undefined && address !== null && address !== '') {
    const parsed = parseAddress(address);
    if (!parsed.ok) throw new RouteError(`cannot build a path for address ${String(address)}: ${parsed.reason}`);
    query.push(`${PARAMS.address}=${parsed.address}`);
  }
  if (block !== undefined && block !== null && block !== '') {
    const parsed = parseBlock(typeof block === 'bigint' ? block.toString() : String(block));
    if (!parsed.ok) throw new RouteError(`cannot build a path for block ${String(block)}`);
    query.push(`${PARAMS.block}=${parsed.block}`);
  }
  return `/${role}${query.length ? `?${query.join('&')}` : ''}`;
}

/** The other role's path for the same address, for the header's view switch. */
function otherRolePath(current) {
  assertRole(current && current.role);
  const role = current.role === 'buyer' ? 'seller' : 'buyer';
  return current.address ? dashboardPath({ role, address: current.address, block: current.block }) : `/${role}`;
}

/**
 * Does the route already describe this address?
 *
 * The island calls this before navigating, and it is the whole reason the comparison is not `===`.
 * wagmi reports a checksummed address, a hand-typed URL is usually lowercase, and a `replace` on
 * every render because the two strings differ in case is an infinite navigation loop.
 */
function routeMatchesAddress(parsed, address) {
  if (!parsed || !parsed.address) return false;
  const candidate = parseAddress(address);
  if (!candidate.ok) return false;
  return parsed.address.toLowerCase() === candidate.address.toLowerCase();
}

/** Human text for a failed parse. One place, so the two pages cannot word it differently. */
function describeReason(parsed) {
  switch (parsed && parsed.reason) {
    case 'missing':
      return 'Connect a wallet, or put an address in the URL, to see this dashboard.';
    case 'ambiguous':
      return 'This link names more than one address. Open it with a single address.';
    case 'malformed':
      return 'That is not an Ethereum address. An address is 0x followed by 40 hex characters.';
    case 'checksum':
      return parsed.suggestion
        ? `That address fails its checksum, so at least one character is wrong. Did you mean ${parsed.suggestion}?`
        : 'That address fails its checksum, so at least one character is wrong.';
    case 'block':
      return 'The block in this link is not a whole number. Remove it to see the latest block.';
    default:
      return 'This link could not be read.';
  }
}

module.exports = {
  PARAMS,
  REASONS,
  ROLES,
  RouteError,
  assertRole,
  blockNumberOf,
  dashboardPath,
  describeReason,
  isRole,
  otherRolePath,
  parseAddress,
  parseBlock,
  parseDashboardParams,
  routeMatchesAddress,
  single,
};
