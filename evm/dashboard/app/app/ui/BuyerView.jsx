import { AgreementCard } from './Agreement.jsx';
import { Amount, Card, Stat, Time, Totals } from './atoms.jsx';
import { Actions } from '../write/Actions.jsx';

// A server component rendering client islands. `view` is the serializable model present.js produces
// and `assertSerializable` guarantees, which is what lets it cross into <Actions/> as a prop; the
// island computes its own control surface from it, because the surface also depends on the
// connected wallet, and the wallet is knowable only in the browser.
export function BuyerView({ view, address }) {
  const s = view.summary;
  const flagged = new Set([...s.overdue, ...s.atRisk, ...s.underfunded]);

  return (
    <>
      <div className="grid">
        <Card title="Credit">
          <dl className="stats">
            <Stat label="Limit">
              <Amount value={view.credit.creditLimit} />
            </Stat>
            <Stat label="Available">
              <Amount value={view.credit.availableCredit} />
            </Stat>
            <Stat label="Used">
              <Amount value={view.credit.usedCredit} />
            </Stat>
            <Stat
              label="Utilization"
              // The contract clamps its stored utilization at 100%, so on an over-limit buyer the
              // stored figure cannot show how far over. The reader carries both; showing only the
              // clamped one would report a buyer at exactly their limit when they are past it.
              hint={
                view.credit.isOverLimit
                  ? `Over limit. The contract clamps its own figure at 100%; the real ratio is ${view.credit.trueUtilization.percent}.`
                  : undefined
              }
            >
              {view.credit.utilization.percent}
            </Stat>
          </dl>
        </Card>

        <Card title="Collateral">
          <dl className="stats">
            <Stat label="Total value">
              <Amount value={view.totalCollateral} />
            </Stat>
            <Stat label="Positions">{view.collateral.length}</Stat>
          </dl>
          {view.collateral.length > 0 ? (
            <table className="positions">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Yield</th>
                  {/* Three columns rather than one, because the gap between them is the whole
                      explanation when a withdrawal is refused. Amount includes reinvested yield,
                      principal is the part that can ever leave, and withdrawable is what is left
                      after the credit line's claim on it. A buyer looking at one number cannot tell
                      "that is not yours to take" from "that is yours once you pay the agreement
                      down", and those have different fixes. */}
                  <th>Principal</th>
                  <th>Withdrawable</th>
                  <th>Staked</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {view.collateral.map((p) => (
                  <tr key={p.id}>
                    <td>{p.collateralType}</td>
                    <td>
                      <Amount value={p.amount} />
                    </td>
                    <td>
                      <Amount value={p.yieldAccrued} />
                    </td>
                    <td>{p.principal ? <Amount value={p.principal} /> : <span className="muted">n/a</span>}</td>
                    <td>
                      {p.withdrawable ? (
                        <>
                          {p.isFloor ? <span className="muted">at least </span> : null}
                          <Amount value={p.withdrawable} />
                        </>
                      ) : (
                        <span className="muted">n/a</span>
                      )}
                    </td>
                    <td>{p.isStaked ? 'yes' : 'no'}</td>
                    <td>
                      <Time value={p.lastUpdateTime} showRelative={false} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No collateral deposited.</p>
          )}
          <Actions view={view} panelId="collateral" address={address} />
        </Card>

        <Card title="Auto-payment">
          <dl className="stats">
            <Stat label="Enabled">{view.autoPayment.enabled ? 'yes' : 'no'}</Stat>
            <Stat label="ETH pool">
              <Amount value={view.autoPayment.ethBalance} />
            </Stat>
          </dl>
          {view.autoPayment.tokenBalances.length > 0 ? (
            <ul className="totals">
              {view.autoPayment.tokenBalances.map((b) => (
                <li key={b.tokenAddress}>
                  <Amount value={b.balance} />
                </li>
              ))}
            </ul>
          ) : null}
          <Actions view={view} panelId="autoPayment" address={address} />
        </Card>

        <Card title="Outstanding">
          {/* Grouped by currency, never summed. A buyer with one ETH and one USDC agreement has two
              totals; adding them produces a number that is not merely mis-formatted, it is
              meaningless. See present.js sumByCurrency. */}
          <Totals totals={s.outstandingByCurrency} />
          <dl className="stats">
            <Stat label="Active">{s.active}</Stat>
            <Stat label="Completed">{s.completed}</Stat>
            <Stat label="Defaulted">{s.defaulted}</Stat>
            <Stat label="Relics held">{s.relicsHeld}</Stat>
          </dl>
        </Card>
      </div>

      {flagged.size > 0 ? (
        <div className="notice notice-warn">
          <h2>Needs attention</h2>
          <ul>
            {s.overdue.length > 0 ? <li>{s.overdue.length} overdue</li> : null}
            {s.atRisk.length > 0 ? <li>{s.atRisk.length} past the grace period and defaultable</li> : null}
            {s.underfunded.length > 0 ? (
              <li>{s.underfunded.length} whose payment method cannot cover the next installment</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <h2 className="section">Agreements ({s.total})</h2>
      {view.agreements.length === 0 ? (
        <p className="muted">No agreements found for this address at this block.</p>
      ) : (
        view.agreements.map((a) => (
          <AgreementCard key={a.id} agreement={a} viewer="buyer" view={view} address={address} />
        ))
      )}
    </>
  );
}
