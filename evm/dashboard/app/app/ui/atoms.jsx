// Server components. No 'use client' anywhere in ui/: these render on the server from the view
// model and have no interactivity, so they never enter the client bundle.
//
// The one rule worth stating: an amount whose currency is unknown renders as its raw integer and
// says so. It never renders a number formatted at an assumed 18 decimals. present.js hands over
// `display: null, known: false` for exactly this case and the whole point is lost if a component
// falls back to a plausible-looking figure. See rule 3 in dashboard/lib/present.js.

export function Amount({ value, className = '' }) {
  if (!value) return <span className={`amount muted ${className}`}>none</span>;
  if (!value.currency || !value.currency.known) {
    return (
      <span className={`amount amount-unknown ${className}`} title={`raw value: ${value.raw}`}>
        {value.raw} <span className="unit">units, unknown currency</span>
      </span>
    );
  }
  return (
    <span className={`amount ${className}`}>
      {value.display} <span className="unit">{value.symbol}</span>
    </span>
  );
}

/** A per-currency list. Cross-currency sums are never added together; see present.js sumByCurrency. */
export function Totals({ totals, empty = 'nothing outstanding' }) {
  if (!totals || totals.length === 0) return <span className="muted">{empty}</span>;
  return (
    <ul className="totals">
      {totals.map((t) => (
        <li key={t.tokenAddress || 'native'}>
          <Amount value={t.total} />
          <span className="muted"> across {t.count} agreement{t.count === 1 ? '' : 's'}</span>
        </li>
      ))}
    </ul>
  );
}

export function Time({ value, showRelative = true }) {
  if (!value) return <span className="muted">not recorded</span>;
  const date = value.iso ? value.iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : value.unix;
  return (
    <span className="time" title={`block time ${value.unix}`}>
      {date}
      {showRelative && value.in ? <span className="muted"> ({value.in.relative})</span> : null}
    </span>
  );
}

export function Tone({ tone, children }) {
  return <span className={`tone tone-${tone}`}>{children}</span>;
}

export function Stat({ label, children, hint }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{children}</dd>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Card({ title, children, actions }) {
  return (
    <section className="card">
      <header className="card-header">
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Address({ value, short = true }) {
  if (!value) return <span className="muted">not recorded</span>;
  return (
    <code className="address" title={value}>
      {short ? `${value.slice(0, 6)}...${value.slice(-4)}` : value}
    </code>
  );
}

/**
 * The as-of line.
 *
 * Every dashboard read is pinned to one block (see the reader's header), and a page that does not
 * say which block is claiming to be live when it is a snapshot. It is also the only honest way to
 * present the history view, where the block is deliberately not the latest one.
 */
export function AsOf({ at }) {
  if (!at) return null;
  return (
    <p className="as-of">
      As of block {at.blockNumber}, {at.iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}
    </p>
  );
}
