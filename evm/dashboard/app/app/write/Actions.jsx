'use client';

// The only interactive surface on the dashboard, and the thinnest thing that could be.
//
// Everything this renders is computed by ../../../lib/panels.js: which controls exist, which are
// disabled, the sentence saying why, the fields to collect, and the steps a plan will send. There
// is no protocol knowledge in this file and there must not be, for the reason part b2's structural
// tests exist: the suite cannot render React, so a rule that lives in JSX is a rule nothing checks.
// If a condition belongs on a button, it belongs in panels.js.
//
// What is genuinely here: form state, and the wiring from a click to useActionRunner.
//
// Note what this does *not* import. No reader, no client, no present: per ADR-001 a client
// component never reads protocol state, and the view arrives as props from the server render. It
// does import writes/panels and through them abis, which is new in part c2 and is the one thing a
// write layer cannot avoid, because encoding a call needs its ABI and the wallet, not our RPC
// endpoint, is what sends it.

import { useId, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';

import { controlSurface } from '../../../lib/panels.js';
import { usePendingPlans, usePendingRegistry } from './PendingScopes.jsx';
import { useActionRunner } from './useActionRunner.js';

function Field({ field, value, onChange, disabled }) {
  const id = useId();
  if (field.kind === 'boolean') {
    return (
      <label className="field field-boolean" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(field.name, e.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  }
  if (field.kind === 'currency') {
    return (
      <label className="field" htmlFor={id}>
        <span>{field.label}</span>
        <select
          id={id}
          value={value === null || value === undefined ? '' : value}
          disabled={disabled}
          onChange={(e) => onChange(field.name, e.target.value === '' ? null : e.target.value)}
        >
          {field.options.map((o) => (
            <option key={o.value || 'native'} value={o.value === null ? '' : o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="field" htmlFor={id}>
      <span>{field.label}</span>
      <input
        id={id}
        type="text"
        inputMode={field.kind === 'amount' ? 'numeric' : 'text'}
        // Not type="number". A wei amount exceeds what a number input can hold exactly, and it
        // silently rounds; these are base units and every digit is load bearing.
        value={value === null || value === undefined ? '' : value}
        placeholder={field.kind === 'amount' ? '0' : '0x...'}
        disabled={disabled}
        onChange={(e) => onChange(field.name, e.target.value)}
      />
      {field.unit ? <span className="field-unit">{field.unit}</span> : null}
      {field.help ? <span className="hint">{field.help}</span> : null}
    </label>
  );
}

/**
 * The step list for a multi-step plan.
 *
 * Rendered as steps whenever there is more than one, which is the roadmap item's "the
 * approve-then-call two-step rendered as two steps". A single step needs no list; two wallet
 * prompts arriving for one click, with no warning that the first was not the payment, is how
 * someone signs an approval and then closes the window thinking they are done.
 */
function Steps({ steps, runner }) {
  if (!steps || steps.length < 2) return null;
  return (
    <ol className="steps">
      {steps.map((s) => {
        const active = runner.busy && runner.stepIndex === s.index - 1;
        const done = runner.stepIndex > s.index - 1 || runner.phase === 'confirmed';
        return (
          <li key={s.index} className={`step${active ? ' step-active' : ''}${done ? ' step-done' : ''}`}>
            <span className="step-index">
              {s.index}/{s.of}
            </span>
            <span className="step-label">{s.label}</span>
            <span className="muted"> {s.describe}</span>
            {active ? (
              <span className="muted"> — {runner.phase === 'signing' ? 'confirm in your wallet' : 'confirming'}</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Status({ runner }) {
  if (runner.phase === 'idle') return null;
  if (runner.phase === 'signing') return <p className="muted">Confirm in your wallet.</p>;
  if (runner.phase === 'confirming') return <p className="muted">Waiting for the transaction to confirm.</p>;
  if (runner.phase === 'confirmed') return <p className="ok-line">Confirmed. Reloading at the block it landed in.</p>;
  if (runner.phase === 'cancelled') return <p className="muted">Cancelled in the wallet. Nothing was sent.</p>;
  return (
    <p className="warn-line">
      {runner.error && runner.error.message ? runner.error.message : 'The transaction did not go through.'}
    </p>
  );
}

function Control({ control, role, address, view }) {
  const registry = usePendingRegistry();
  const runner = useActionRunner({ role, address, registry, view });

  const disabled = control.disabled || runner.busy;

  return (
    <div className={`control${disabled ? ' control-disabled' : ''}`} data-action={control.action}>
      <div className="control-row">
        <button
          type="button"
          className="button"
          disabled={disabled}
          title={control.summary}
          onClick={() => {
            if (!control.plan) return;
            runner.run(control.plan);
          }}
        >
          {runner.busy ? 'Sending...' : control.label}
        </button>
        {control.reason ? (
          <span className={control.code === 'PENDING' ? 'muted' : 'control-reason'}>{control.reason}</span>
        ) : null}
      </div>
      {/* Notes are the planner telling the truth about what it could not check, plus the one case
          ADR-002 allows rather than refuses: paying someone else's installment. Surfacing them is
          the difference between a preflight that passed and a preflight that was skipped. */}
      {control.notes && control.notes.length > 0 ? (
        <ul className="notes">
          {control.notes.map((n) => (
            <li key={n} className="muted">
              {NOTE_TEXT[n] || n}
            </li>
          ))}
        </ul>
      ) : null}
      <Steps steps={control.steps} runner={runner} />
      <Status runner={runner} />
    </div>
  );
}

const NOTE_TEXT = {
  payerIsNotBuyer: 'You are not the buyer on this agreement. The protocol allows anyone to pay it; the money will be yours.',
  'pool-funded': 'This settles from a pool the contract holds, so no funds are attached to the transaction.',
  'minimum-collateral-unchecked': 'The protocol minimum for a deposit is not on this page, so it was not checked.',
  'token-authorization-unchecked': 'Whether this token is authorized as collateral was not checked; an unauthorized one reverts.',
  'settlement-token-authorization-unchecked': 'Whether this token is an authorized settlement currency was not checked.',
  'pool-balance-unknown': 'The pool balance could not be read from this view, so it was not checked.',
  'seller-balance-unknown': 'The settled balance could not be read from this view, so it was not checked.',
  'withdrawable-unknown': 'The withdrawable ceiling could not be read from this view, so it was not checked.',
  'withdrawable-is-a-floor':
    'This position has yield waiting to be settled, which the withdrawal settles on its way in. The ceiling shown is a floor; the chain may accept more.',
  'above-reported-withdrawable':
    'This is above the ceiling the view reported. It is offered because pending yield raises that ceiling when the withdrawal settles it, but the transaction may still revert.',
};

/**
 * One panel of controls.
 *
 * @param {object} props
 * @param {object} props.view the serializable view model, from the server render
 * @param {string} props.panelId a panel id from controlSurface, e.g. 'autoPayment'
 * @param {string} props.address the address in the route, which the reload has to preserve
 */
export function Actions({ view, panelId, address }) {
  const { address: from } = useAccount();
  const pending = usePendingPlans();
  const [inputs, setInputs] = useState({});

  const surface = useMemo(
    () => controlSurface(view, { from: from || null, pending, inputs }),
    [view, from, pending, inputs]
  );

  const panel = surface.panels.find((p) => p.id === panelId);
  if (!panel) return null;

  // Keyed by control.inputKey, not control.action. Most controls set it to the action and nothing
  // changes; the per-position withdraw controls do not, because several of them share one action
  // and keying by action would make every position's amount field the same field.
  const onChange = (key) => (name, value) =>
    setInputs((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), [name]: value } }));

  return (
    <div className="actions">
      {panel.controls.map((control) => (
        <div key={control.id} className="action">
          {control.fields.length > 0 ? (
            <div className="fields">
              {control.fields.map((field) => (
                <Field
                  key={field.name}
                  field={field}
                  value={(inputs[control.inputKey] || {})[field.name]}
                  onChange={onChange(control.inputKey)}
                  disabled={control.pending}
                />
              ))}
            </div>
          ) : null}
          <Control control={control} role={surface.role} address={address} view={view} />
        </div>
      ))}
    </div>
  );
}

/** The action panel for one agreement card. Same component, addressed by agreement id. */
export function AgreementActions({ view, agreementId, address }) {
  return <Actions view={view} panelId={`agreement:${agreementId}`} address={address} />;
}
