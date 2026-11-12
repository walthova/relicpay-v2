// One agreement, server rendered from the view model.
//
// Nothing here decides anything. Overdue, defaultable and settlement readiness are all derived in
// reader.js from chain state against the pinned block, and `tone` is chosen in present.js. A
// conditional here that recomputes any of them is how the page and the data layer start disagreeing
// about whether someone is late. See rule 1 in dashboard/lib/present.js.

import { Address, Amount, Time, Tone } from './atoms.jsx';
import { AgreementActions } from '../write/Actions.jsx';

function Schedule({ schedule }) {
  if (!schedule || schedule.length === 0) return null;
  return (
    <table className="schedule">
      <thead>
        <tr>
          <th>#</th>
          <th>Amount</th>
          <th>Due</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {schedule.map((row) => (
          <tr key={row.installmentNumber} className={row.isOverdue ? 'row-overdue' : ''}>
            <td>{row.installmentNumber}</td>
            <td>
              <Amount value={row.amount} />
            </td>
            <td>
              <Time value={row.dueDate} />
            </td>
            <td>
              {row.storedStatus === 'Paid' ? (
                <Tone tone="ok">Paid</Tone>
              ) : row.isOverdue ? (
                <Tone tone="warn">Overdue</Tone>
              ) : (
                <Tone tone="neutral">{row.storedStatus}</Tone>
              )}
              {/* The contract's stored status only advances when someone pays gas to call
                  processOverduePayments, so it lags reality. `isOverdue` above is derived from the
                  due date against the pinned block and is the truth; `isStale` is the reader naming
                  the gap, which is the thing a seller can actually act on. */}
              {row.isStale ? (
                <span
                  className="muted"
                  title="the contract still records this as Pending until processOverduePayments is called"
                >
                  {' '}
                  (unrecorded on chain)
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Settlement({ settlement, paymentMethod }) {
  if (!settlement) return null;
  return (
    <div className="settlement">
      <h4>Next settlement</h4>
      <dl className="inline">
        <dt>Required</dt>
        <dd>
          <Amount value={settlement.required} />
        </dd>
        {paymentMethod.usesAutoBalance ? (
          <>
            <dt>Auto-payment pool</dt>
            <dd>
              <Amount value={settlement.autoBalance} />
            </dd>
          </>
        ) : null}
        {paymentMethod.usesCollateral ? (
          <>
            <dt>Collateral available</dt>
            <dd>
              <Amount value={settlement.collateralAvailable} />
            </dd>
          </>
        ) : null}
        {/* `ready` is only meaningful for a method that settles from a pool the contract controls.
            For Manual it is false on every healthy agreement, because the money is in a wallet the
            contract cannot see, and rendering that as "Ready: no" puts a warning on an agreement
            with nothing wrong with it. The method decides whether the question applies at all. */}
        {paymentMethod.requiresBuyerTransaction ? null : (
          <>
            <dt>Ready</dt>
            <dd>{settlement.ready ? <Tone tone="ok">yes</Tone> : <Tone tone="warn">no</Tone>}</dd>
          </>
        )}
      </dl>
      {settlement.shortfall === null ? (
        // Manual settlement draws from a wallet, which neither the contract nor this page can see,
        // so there is no shortfall to report and a confident zero would be a lie.
        <p className="muted">The buyer sends this one themselves, so there is no pool to check.</p>
      ) : settlement.shortfall.isZero ? null : (
        <p className="warn-line">
          Short by <Amount value={settlement.shortfall} /> in the pools this payment method can draw
          from.
        </p>
      )}
      {settlement.requiresApproval ? (
        <p className="warn-line">The buyer still needs to approve this token for the contract.</p>
      ) : null}
    </div>
  );
}

export function AgreementCard({ agreement, viewer, view, address }) {
  const a = agreement;
  const counterparty = viewer === 'buyer' ? a.seller : a.buyer;
  const counterpartyLabel = viewer === 'buyer' ? 'Seller' : 'Buyer';

  return (
    <article className={`agreement agreement-${a.tone}`}>
      <header>
        <div>
          <h3>{a.relic.physicalId || 'Untitled relic'}</h3>
          <p className="muted">
            {counterpartyLabel} <Address value={counterparty} /> · token #{a.relic.tokenId}
          </p>
        </div>
        <Tone tone={a.tone}>{a.state}</Tone>
      </header>

      <dl className="inline">
        <dt>Total</dt>
        <dd>
          <Amount value={a.totalPrice} />
        </dd>
        <dt>Paid</dt>
        <dd>
          <Amount value={a.totalPaid} /> <span className="muted">({a.progress.percent})</span>
        </dd>
        <dt>Outstanding</dt>
        <dd>
          <Amount value={a.outstanding} />
        </dd>
        <dt>Installments</dt>
        <dd>
          {a.paidInstallments} of {a.installmentCount}, every {a.dueInterval.human}
        </dd>
        <dt>Method</dt>
        <dd>{a.paymentMethod.label}</dd>
        <dt>Relic</dt>
        <dd>
          {a.relic.ownershipTransferred ? (
            <Tone tone="ok">transferred to the buyer</Tone>
          ) : (
            <>
              held by <Address value={a.relic.currentOwner} />
            </>
          )}
        </dd>
      </dl>

      {a.next ? (
        <p className={a.next.isDefaultable ? 'danger-line' : a.next.isOverdue ? 'warn-line' : ''}>
          Installment {a.next.installmentNumber} of <Amount value={a.next.amount} /> due{' '}
          <Time value={a.next.dueDate} />
          {a.next.isDefaultable
            ? '. The grace period has expired.'
            : a.next.isOverdue
              ? `. Grace expires ${a.next.secondsUntilGraceExpiry.relative}.`
              : '.'}
        </p>
      ) : null}

      {a.state === 'Defaulted' ? (
        <p className="danger-line">
          Defaulted <Time value={a.defaultedAt} />. Collateral seized:{' '}
          <Amount value={a.collateralSeized} />.
        </p>
      ) : null}

      <Settlement settlement={a.settlement} paymentMethod={a.paymentMethod} />
      <Schedule schedule={a.schedule} />
      {/* Per agreement rather than per page, which is `agreement:<id>` in the scope list earning
          its keep: a payment confirming on one agreement disables that card's button and leaves
          every other card's alone. See rule 2 in docs/ADR-002-dashboard-writes.md. */}
      {view ? <AgreementActions view={view} agreementId={a.id} address={address} /> : null}
    </article>
  );
}
