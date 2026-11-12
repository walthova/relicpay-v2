import { AgreementCard } from './Agreement.jsx';
import { Amount, Card, Stat, Totals } from './atoms.jsx';
import { Actions } from '../write/Actions.jsx';

// See the header of BuyerView.jsx for why a server component hands `view` to a client island.
export function SellerView({ view, address }) {
  const s = view.summary;

  return (
    <>
      <div className="grid">
        <Card title="Settlement preference">
          <p>
            New agreements settle in{' '}
            <strong>
              {view.settlementPreference.known
                ? view.settlementPreference.symbol
                : view.settlementPreference.tokenAddress || 'ETH'}
            </strong>
            .
          </p>
          {!view.settlementPreference.known && view.settlementPreference.tokenAddress ? (
            <p className="muted">
              This token did not answer symbol() or decimals(), so its amounts render as raw
              integers rather than as a number that would be wrong.
            </p>
          ) : null}
          <Actions view={view} panelId="preference" address={address} />
        </Card>

        <Card title="Withdrawable">
          {/* Collected per agreement rather than from Active agreements only. A seller whose
              stablecoin agreements have all completed is still owed the proceeds, and collecting
              currencies from Active agreements alone showed them an empty list while the contract
              held their money. */}
          <dl className="stats">
            <Stat label="ETH">
              <Amount value={view.balances.eth} />
            </Stat>
          </dl>
          {view.balances.tokens.length > 0 ? (
            <ul className="totals">
              {view.balances.tokens.map((b) => (
                <li key={b.tokenAddress}>
                  <Amount value={b.balance} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No token balances held by the contract for this seller.</p>
          )}
          <Actions view={view} panelId="balances" address={address} />
        </Card>

        <Card title="Receivable">
          <Totals totals={s.receivableByCurrency} empty="nothing receivable" />
          <dl className="stats">
            <Stat label="Active">{s.active}</Stat>
            <Stat label="Completed">{s.completed}</Stat>
            <Stat label="Defaulted">{s.defaulted}</Stat>
          </dl>
        </Card>
      </div>

      {s.defaultable.length > 0 || s.overdue.length > 0 || s.staleSchedules.length > 0 ? (
        <div className="notice notice-warn">
          <h2>Needs attention</h2>
          <ul>
            {s.overdue.length > 0 ? <li>{s.overdue.length} overdue</li> : null}
            {s.defaultable.length > 0 ? (
              <li>{s.defaultable.length} past the grace period, so triggerDefault would succeed</li>
            ) : null}
            {/* The seller is the one who would pay the gas to call processOverduePayments, so the
                seller is the one who is told the chain's record is behind. */}
            {s.staleSchedules.length > 0 ? (
              <li>
                {s.staleSchedules.length} with installments the chain still records as Pending;
                processOverduePayments would bring the record up to date
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <h2 className="section">Agreements ({s.total})</h2>
      {view.agreements.length === 0 ? (
        <p className="muted">No agreements found for this address at this block.</p>
      ) : (
        view.agreements.map((a) => (
          <AgreementCard key={a.id} agreement={a} viewer="seller" view={view} address={address} />
        ))
      )}
    </>
  );
}
