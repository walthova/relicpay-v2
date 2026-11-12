// The control surface: every button and form the dashboard offers, as plain data.
//
// Part c2 of the "Next.js buyer/seller dashboard" roadmap item, and the reason that item ships two
// things rather than one. The item asks for React components that send transactions, and the suite
// cannot render React. So everything a component decides lives here instead, as a value: which
// controls exist for this viewer, which are disabled, why, and what each one will send. The
// components under dashboard/app/app/write/ are then renderers with no judgement in them, and the
// judgement is provable against ganache like the rest of this directory.
//
// writes.js answers "what would this action send". This answers the three questions a screen adds
// on top of that, none of which writes.js can see:
//
//   1. Who is connected? Every planner takes a `from`, and `from` is the wallet, which only the
//      browser knows. The dashboard renders whatever address is in the route, so the wallet and the
//      subject of the page are routinely different people. See SELF_SCOPED below: that difference
//      is not cosmetic, it decides whether a button is safe to offer at all.
//   2. What is in flight? ADR-002 makes pending a scope rather than a page-wide spinner, which only
//      means something if some controls are disabled and others are not. `pending` is that input.
//   3. Has the user typed the number yet? writes.js refuses to plan a deposit of zero, correctly,
//      but a form that has not been filled in is not a rejected action, it is an empty field.
//
// Framework free, like everything in dashboard/lib: no React, no next/*, no wagmi.

const {
  ACTIONS,
  SCOPES,
  agreementScope,
  autoBalanceOf,
  isPlanStale,
  nextInstallmentOf,
  pendingScopes,
  planAction,
  resolveAfter,
  sellerBalanceOf,
} = require('./writes');
const { dashboardPath } = require('./routes');

class PanelError extends Error {}

const NATIVE_LABEL = 'ETH';

/**
 * Actions the contract applies to `msg.sender`, not to the address this page is about.
 *
 * This list is the one genuinely new safety rule in part c2, and it only becomes visible once the
 * write layer is attached to a route that can render any address. `setAutoPayment`,
 * `depositAutoPaymentFunds`, `withdrawAutoPaymentFunds`, `withdrawSellerBalance`,
 * `setSettlementPreference` and both collateral deposits all read `msg.sender` and never take an
 * account argument. So on a page showing someone else's dashboard, every one of these buttons is
 * live, correctly encoded, and operates on the connected wallet's own account instead of the one on
 * screen. It does not revert. It succeeds, quietly, against numbers that are nowhere on the page,
 * and then the reload re-renders the subject's unchanged figures, which reads as a transaction that
 * did nothing.
 *
 * Refusing to offer them to a viewer who is not the subject is the only reading that is not a trap.
 *
 * Deliberately excluded: `payInstallment` and `processOverduePayments`, which are permissionless by
 * construction and which ADR-002 already decided to allow with a `payerIsNotBuyer` note rather than
 * refuse, and `triggerDefault`, which writes.js already rejects for anyone but the seller. Those
 * three act on an agreement passed by id, so the page and the transaction agree about the subject.
 */
const SELF_SCOPED = Object.freeze(new Set([
  'depositEthCollateral',
  'depositTokenCollateral',
  // withdrawCollateral names its position by id, which looks like the agreement case below, and is
  // not. It reaches `collateralPositions[msg.sender][positionId]`, so on someone else's dashboard
  // the id on screen is the subject's and the position the call reaches is the viewer's. The id is
  // keccak(owner, asset, tag), so a stranger's id is never one of yours and the lookup lands on an
  // empty position: the button is a guaranteed revert dressed as a live control, sitting under a
  // row of numbers it could never have moved. Refused for that reason rather than offered to fail.
  'withdrawCollateral',
  'fundAutoPayment',
  'withdrawAutoPayment',
  'setAutoPayment',
  'withdrawSellerBalance',
  'setSettlementPreference',
]));

/**
 * Why a control is disabled, most permanent first, and the order is the point.
 *
 * More than one reason applies constantly: a viewer looking at someone else's seller dashboard,
 * during a pending write, with an empty amount field, satisfies three at once. Showing the wrong
 * one is not a cosmetic bug. "Waiting for your transaction" on a button that will still be dead
 * afterwards sends someone to watch a spinner for a problem the spinner cannot fix.
 *
 * So the reason shown is the one that will not clear on its own:
 *
 *   NOT_CONNECTED     there is no wallet to send from. Nothing else on the list can be true yet.
 *   NOT_YOUR_ACCOUNT  needs a different wallet or a different page. Nothing else clears it.
 *   PENDING           clears when the transaction settles. It outranks the two below because while
 *                     a write is in flight the numbers a rejection was computed from are the ones
 *                     ADR-002 says not to trust, so quoting a rejection here quotes a stale figure.
 *   NEEDS_INPUT       clears when the user types.
 *   rejection code    clears when the chain moves, or does not; writes.js supplies the sentence.
 */
const DISABLED_PRECEDENCE = Object.freeze([
  'NOT_CONNECTED',
  'NOT_YOUR_ACCOUNT',
  'PENDING',
  'NEEDS_INPUT',
  'REJECTED',
]);

function lower(a) {
  return String(a || '').toLowerCase();
}

function sameAddress(a, b) {
  return Boolean(a) && Boolean(b) && lower(a) === lower(b);
}

/**
 * The pending scope set, from either a list of scope strings or a list of in-flight plans.
 *
 * The runner holds plans, the tests mostly want to name a scope, and accepting both keeps a caller
 * from hand-rolling the mapping and getting `agreement:<id>` casing wrong.
 */
function pendingSetOf(pending) {
  const list = pending || [];
  const scopes = new Set();
  const plans = [];
  for (const entry of list) {
    if (typeof entry === 'string') scopes.add(entry);
    else if (entry) plans.push(entry);
  }
  for (const s of pendingScopes(plans)) scopes.add(s);
  return scopes;
}

function anyPending(pendingSet, scopes) {
  return (scopes || []).some((s) => pendingSet.has(s));
}

/**
 * A plan's steps, flattened into something a component can render and a test can assert on.
 *
 * The two-step approve-then-call is the reason this exists as data rather than as JSX. A plan's
 * approve step targets the *token*, and the call step targets the protocol; a UI that renders one
 * address for the whole plan shows the user an approval pointed at RelicPay, which is not what
 * their wallet is about to ask them to sign. `target` is per step for that reason, and there is a
 * test that the approve step's target is never the protocol.
 *
 * Serializable on purpose: no BigInt. `value` is a decimal string, because this crosses into React
 * props and BigInt does not survive that trip, the same constraint present.js exists for.
 */
function describeSteps(plan) {
  if (!plan || !plan.ok || !Array.isArray(plan.steps)) return [];
  const of = plan.steps.length;
  return plan.steps.map((step, i) => ({
    index: i + 1,
    of,
    kind: step.kind,
    target: step.request.address,
    functionName: step.request.functionName,
    value: step.request.value === undefined || step.request.value === null ? '0' : String(step.request.value),
    label: step.kind === 'approve' ? 'Approve' : 'Confirm',
    describe: step.describe || plan.describe || '',
  }));
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function amountField({ label = 'Amount', help = null } = {}) {
  return { name: 'amount', kind: 'amount', label, required: true, unit: 'base units', help };
}

function currencyField(options, { label = 'Currency' } = {}) {
  return { name: 'token', kind: 'currency', label, required: false, options };
}

function booleanField(name, label) {
  return { name, kind: 'boolean', label, required: false };
}

function nativeOption() {
  return { value: null, label: NATIVE_LABEL };
}

function optionFor(entry) {
  const address = entry.tokenAddress;
  const balance = entry.balance;
  const symbol = balance && balance.currency && balance.currency.known ? balance.symbol : null;
  return { value: address, label: symbol || address };
}

/** Currencies the buyer's auto-payment pool can hold: ETH plus whatever it already holds. */
function autoCurrencyOptions(view) {
  const balances = (view && view.autoPayment && view.autoPayment.tokenBalances) || [];
  const rows = Array.isArray(balances)
    ? balances
    : Object.keys(balances).map((tokenAddress) => ({ tokenAddress, balance: balances[tokenAddress] }));
  return [nativeOption(), ...rows.map(optionFor)];
}

/** Currencies the contract is holding proceeds in for this seller. */
function sellerCurrencyOptions(view) {
  const tokens = (view && view.balances && view.balances.tokens) || [];
  const rows = Array.isArray(tokens)
    ? tokens
    : Object.keys(tokens).map((tokenAddress) => ({ tokenAddress, balance: tokens[tokenAddress] }));
  return [nativeOption(), ...rows.map(optionFor)];
}

/**
 * Has a required field been filled in?
 *
 * Blank is not zero. `writes.js` rejects zero with "Enter an amount to deposit", which is the right
 * sentence for a typed 0 and the wrong state for an untouched form, since it paints a red rejection
 * on a field nobody has visited yet.
 */
function missingFields(fields, values) {
  const out = [];
  for (const field of fields) {
    if (!field.required) continue;
    const v = values ? values[field.name] : undefined;
    if (v === undefined || v === null || String(v).trim() === '') out.push(field);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/**
 * One control, resolved against this viewer, this input and this pending set.
 *
 * Always returns a control. A control that cannot be used is a disabled control with a sentence,
 * never an absent one: a button that vanishes when it stops working teaches nothing, and on this
 * page the reason is usually the actual information the person needed.
 */
function buildControl({ id, action, label, kind, fields = [], extraScopes = [], params = {}, inputKey, ctx }) {
  const meta = ACTIONS[action];
  if (!meta) throw new PanelError(`unknown action "${action}"`);
  const scopes = [...meta.scopes, ...extraScopes];
  // Form state is keyed by this, not by the action, because withdrawCollateral is rendered once per
  // position and every one of those controls carries the same action name. Keyed by action, typing
  // an amount into one position's field would fill in every other position's field with it, and the
  // control the user was not looking at is the one whose plan would be wrong. Defaults to the action
  // for every control there is only ever one of, so nothing else has to know this exists.
  const key = inputKey || action;
  const control = {
    id,
    action,
    inputKey: key,
    label,
    kind,
    summary: meta.summary,
    fields,
    scopes,
    pending: anyPending(ctx.pendingSet, scopes),
    disabled: false,
    code: null,
    reason: null,
    notes: [],
    plan: null,
    steps: [],
  };

  const deny = (code, reason) => {
    control.disabled = true;
    control.code = code;
    control.reason = reason;
    return control;
  };

  // Before anything else, because every planner requires a `from` and would throw on a null one,
  // and "that input could not be used" is a poor way to say "no wallet is connected".
  if (!ctx.from) {
    return deny('NOT_CONNECTED', 'Connect a wallet to send this transaction.');
  }

  if (SELF_SCOPED.has(action) && !ctx.viewingSelf) {
    return deny(
      'NOT_YOUR_ACCOUNT',
      'This acts on the connected wallet, not on the address this page is showing. Switch to your own dashboard to use it.'
    );
  }

  if (control.pending) {
    return deny('PENDING', 'A transaction affecting these figures is still confirming.');
  }

  const missing = missingFields(fields, ctx.inputs[key]);
  if (missing.length > 0) {
    return deny('NEEDS_INPUT', `Enter ${missing.map((f) => f.label.toLowerCase()).join(' and ')} first.`);
  }

  let planned;
  try {
    planned = planAction(action, params, {
      relicPay: ctx.contract,
      view: ctx.view,
      protocol: ctx.protocol,
      from: ctx.from,
    });
  } catch (error) {
    // A planner throw is a caller error by its own contract (bad address, non-integer amount), and
    // half of those arrive from a form. Rendering it as a disabled control with the message keeps a
    // typed character out of an error boundary.
    return deny('INVALID_INPUT', error && error.message ? error.message : 'That input could not be used.');
  }

  if (!planned.ok) {
    control.disabled = true;
    control.code = planned.code;
    control.reason = planned.reason;
    return control;
  }

  control.plan = planned;
  control.notes = planned.notes || [];
  control.steps = describeSteps(planned);
  return control;
}

/** The form-state key for one position's withdraw control. */
function withdrawInputKey(positionId) {
  return `withdrawCollateral:${lower(positionId)}`;
}

/** An amount off a presented position (`{raw, display}`) or a reader position (a BigInt). */
function rawOf(value) {
  if (value === undefined || value === null) return null;
  const raw = typeof value === 'object' ? value.raw : value;
  return raw === undefined || raw === null ? null : String(raw);
}

/**
 * A withdraw control per collateral position.
 *
 * Per position and not one control with a position picker, because the useful thing on screen is
 * the ceiling, and the ceiling is per position. A picker would put the number the user needs one
 * selection away from the field they type it into, and would make "max" ambiguous across positions
 * with different principals.
 *
 * `max` is `getWithdrawableCollateral`, and `maxIsFloor` is the warning that has to travel with it.
 * The contract's view does not settle pending yield, so on a position with an accrual waiting the
 * figure is a lower bound: the chain may accept more. Presenting it as a hard maximum would be a
 * promise the protocol does not make, and this is the one thing the roadmap item singled out. The
 * help text says which of the two it is rather than making the reader infer it from a flag.
 */
function withdrawControls(ctx) {
  const positions = (ctx.view && ctx.view.collateral) || [];
  return positions.map((position) => {
    const max = rawOf(position.withdrawable);
    const isFloor = position.isFloor === true || position.mayAccrue === true;
    const help = max === null
      ? 'The withdrawable ceiling could not be read from this view.'
      : isFloor
        ? `At least ${max} base units can be withdrawn. Pending yield on this position raises the ceiling when the transaction settles it, so this is a floor and not an exact maximum.`
        : `Up to ${max} base units can be withdrawn.`;
    return buildControl({
      id: `collateral.withdraw.${position.id}`,
      action: 'withdrawCollateral',
      label: 'Withdraw',
      kind: 'form',
      inputKey: withdrawInputKey(position.id),
      fields: [amountField({ label: 'Amount', help })],
      params: {
        positionId: position.id,
        amount:
          ctx.inputs[withdrawInputKey(position.id)] &&
          ctx.inputs[withdrawInputKey(position.id)].amount,
      },
      ctx,
    });
  }).map((control, i) => ({
    // The position is on the control so a renderer can put it next to the right table row without
    // re-deriving the id out of the control id string.
    ...control,
    positionId: positions[i].id,
    withdrawable: rawOf(positions[i].withdrawable),
    maxIsFloor: positions[i].isFloor === true || positions[i].mayAccrue === true,
  }));
}

function buyerPanels(ctx) {
  const view = ctx.view;
  const autoOptions = autoCurrencyOptions(view);

  const collateral = {
    id: 'collateral',
    title: 'Collateral',
    scopes: [SCOPES.COLLATERAL, SCOPES.CREDIT],
    controls: [
      buildControl({
        id: 'collateral.depositEth',
        action: 'depositEthCollateral',
        label: 'Deposit ETH',
        kind: 'form',
        fields: [
          amountField({ label: 'Amount', help: 'In wei.' }),
          booleanField('stakeForYield', 'Stake for yield'),
        ],
        params: {
          amount: ctx.inputs.depositEthCollateral && ctx.inputs.depositEthCollateral.amount,
          stakeForYield: Boolean(ctx.inputs.depositEthCollateral && ctx.inputs.depositEthCollateral.stakeForYield),
        },
        ctx,
      }),
      buildControl({
        id: 'collateral.depositToken',
        action: 'depositTokenCollateral',
        label: 'Deposit token',
        kind: 'form',
        fields: [
          { name: 'token', kind: 'address', label: 'Token', required: true },
          amountField({ help: 'In the token’s own base units.' }),
        ],
        params: {
          token: ctx.inputs.depositTokenCollateral && ctx.inputs.depositTokenCollateral.token,
          amount: ctx.inputs.depositTokenCollateral && ctx.inputs.depositTokenCollateral.amount,
          allowance: ctx.inputs.depositTokenCollateral && ctx.inputs.depositTokenCollateral.allowance,
        },
        ctx,
      }),
      ...withdrawControls(ctx),
    ],
  };

  const autoPayment = {
    id: 'autoPayment',
    title: 'Auto-payment',
    scopes: [SCOPES.AUTO_PAYMENT],
    controls: [
      buildControl({
        id: 'autoPayment.fund',
        action: 'fundAutoPayment',
        label: 'Add funds',
        kind: 'form',
        fields: [currencyField(autoOptions), amountField()],
        params: {
          token: (ctx.inputs.fundAutoPayment && ctx.inputs.fundAutoPayment.token) || null,
          amount: ctx.inputs.fundAutoPayment && ctx.inputs.fundAutoPayment.amount,
          allowance: ctx.inputs.fundAutoPayment && ctx.inputs.fundAutoPayment.allowance,
        },
        ctx,
      }),
      buildControl({
        id: 'autoPayment.withdraw',
        action: 'withdrawAutoPayment',
        label: 'Withdraw',
        kind: 'form',
        fields: [currencyField(autoOptions), amountField()],
        params: {
          token: (ctx.inputs.withdrawAutoPayment && ctx.inputs.withdrawAutoPayment.token) || null,
          amount: ctx.inputs.withdrawAutoPayment && ctx.inputs.withdrawAutoPayment.amount,
        },
        ctx,
      }),
      buildControl({
        id: 'autoPayment.toggle',
        action: 'setAutoPayment',
        // The label names the effect, not the state. "Auto-payment: on" as a button is ambiguous
        // about whether it reports or acts.
        label: view.autoPayment && view.autoPayment.enabled ? 'Turn off auto-payment' : 'Turn on auto-payment',
        kind: 'toggle',
        fields: [],
        params: { enabled: !(view.autoPayment && view.autoPayment.enabled) },
        ctx,
      }),
    ],
  };

  return [collateral, autoPayment];
}

function sellerPanels(ctx) {
  const view = ctx.view;
  const options = sellerCurrencyOptions(view);
  const selectedWithdraw = (ctx.inputs.withdrawSellerBalance && ctx.inputs.withdrawSellerBalance.token) || null;

  return [
    {
      id: 'balances',
      title: 'Withdrawable',
      scopes: [SCOPES.SELLER_BALANCES],
      controls: [
        buildControl({
          id: 'balances.withdraw',
          action: 'withdrawSellerBalance',
          label: 'Withdraw',
          kind: 'form',
          // No amount: both withdrawals take the whole balance, and offering a field the contract
          // ignores is a promise the protocol does not keep.
          fields: [currencyField(options)],
          params: { token: selectedWithdraw },
          ctx,
        }),
      ],
    },
    {
      id: 'preference',
      title: 'Settlement preference',
      scopes: [SCOPES.SELLER_PREFERENCE],
      controls: [
        buildControl({
          id: 'preference.set',
          action: 'setSettlementPreference',
          label: 'Set currency',
          kind: 'form',
          fields: [currencyField(options, { label: 'Settle new agreements in' })],
          params: { token: (ctx.inputs.setSettlementPreference && ctx.inputs.setSettlementPreference.token) || null },
          ctx,
        }),
      ],
    },
  ];
}

/**
 * The controls attached to one agreement.
 *
 * Separate from the account-level panels because the agreement list is rendered per agreement and
 * each card is its own island: a pending payment on one agreement must not disable the Pay button
 * on another, which is `agreement:<id>` in the scope list doing its job.
 */
function agreementPanelFor(agreement, ctx) {
  const id = agreement.id;
  const scope = agreementScope(id);
  const controls = [];

  if (ctx.role === 'buyer') {
    const next = nextInstallmentOf(agreement);
    controls.push(buildControl({
      id: `agreement.${id}.pay`,
      action: 'payInstallment',
      label: next === null ? 'Pay installment' : `Pay installment ${next}`,
      kind: 'button',
      extraScopes: [scope],
      params: {
        agreementId: id,
        allowance: ctx.inputs.payInstallment && ctx.inputs.payInstallment.allowance,
      },
      ctx,
    }));
  } else {
    controls.push(buildControl({
      id: `agreement.${id}.processOverdue`,
      action: 'processOverduePayments',
      label: 'Update overdue status',
      kind: 'button',
      extraScopes: [scope],
      params: { agreementId: id },
      ctx,
    }));
    controls.push(buildControl({
      id: `agreement.${id}.default`,
      action: 'triggerDefault',
      label: 'Default and seize collateral',
      kind: 'button',
      extraScopes: [scope],
      params: { agreementId: id },
      ctx,
    }));
  }

  return { id: `agreement:${id}`, agreementId: id, title: 'Actions', scopes: [scope], controls };
}

/**
 * Every control on a dashboard, for this viewer.
 *
 * @param {object} view a presented dashboard (present.js) or a reader dashboard; both work, the
 *   same as for writes.planAction
 * @param {object} options
 * @param {string|null} options.from the connected wallet, or null when none is connected
 * @param {Array<string|object>} options.pending in-flight scopes, or the in-flight plans themselves
 * @param {object} options.inputs form state, keyed by action name
 * @param {object|null} options.protocol getProtocolInfo output, when the caller has it
 */
function controlSurface(view, { from = null, pending = [], inputs = {}, protocol = null, contract = null } = {}) {
  if (!view || !view.role) throw new PanelError('controlSurface needs a dashboard view with a role');
  const role = view.role;
  if (role !== 'buyer' && role !== 'seller') throw new PanelError(`unknown role "${role}"`);

  const ctx = {
    view,
    role,
    from,
    // loadDashboard folds the protocol address onto the view; a reader dashboard built directly in
    // the suite has no `contract`, so the caller may pass one.
    contract: contract || view.contract,
    protocol,
    inputs: inputs || {},
    pendingSet: pendingSetOf(pending),
    // A disconnected visitor is never the subject. Every self-scoped control is refused rather than
    // planned, which is also what keeps planAction from throwing on a null `from`.
    viewingSelf: Boolean(from) && sameAddress(from, view.address),
  };

  const panels = role === 'buyer' ? buyerPanels(ctx) : sellerPanels(ctx);
  const agreementPanels = (view.agreements || []).map((a) => agreementPanelFor(a, ctx));

  return {
    role,
    subject: view.address,
    contract: ctx.contract,
    at: view.at || null,
    viewingSelf: ctx.viewingSelf,
    connected: Boolean(from),
    panels: [...panels, ...agreementPanels],
    // Flat index so a component can ask for one control without walking the tree, and so a test can
    // assert on the whole surface at once.
    byId: Object.fromEntries(
      [...panels, ...agreementPanels].flatMap((p) => p.controls.map((c) => [c.id, c]))
    ),
  };
}

/** One panel out of a surface, by id. Returns null rather than throwing; a role may not have it. */
function panelById(surface, id) {
  if (!surface) return null;
  return (surface.panels || []).find((p) => p.id === id) || null;
}

/** The agreement panel for one agreement id, which is what an agreement card asks for. */
function agreementPanel(surface, agreementId) {
  return panelById(surface, `agreement:${agreementId}`);
}

// ---------------------------------------------------------------------------
// The reload contract
// ---------------------------------------------------------------------------

/**
 * Where to send the browser once a transaction confirms.
 *
 * ADR-002 says re-pin at the receipt's block, and the `?at=` route from part b2 is already the
 * mechanism for rendering a pinned block. This composes the two, and it is the whole of part c2's
 * reload: no refetch, no cache invalidation, a navigation to a URL that names the block the
 * transaction mined in. The server render then loads that block through the same path a fresh visit
 * uses, which is what makes the postcondition testable: the effect is visible because the read
 * happens at the block the write landed in.
 *
 * A reverted receipt is not a reload. Nothing changed, so re-pinning would move the page off the
 * block the user is reading for no reason; the caller releases the scopes and reports the failure.
 */
function reloadAfter(plan, receipt, { role, address } = {}) {
  const resolved = resolveAfter(plan, receipt);
  if (!resolved.reload) return { ...resolved, path: null };
  const target = address || (plan && plan.from);
  return {
    ...resolved,
    path: dashboardPath({ role: role || (plan && plan.role), address: target, block: resolved.blockNumber }),
  };
}

/**
 * The same dashboard with no block pin.
 *
 * Needed because of what reloadAfter does. Pinning the route to the receipt's block is right for
 * the moment after a payment and wrong forever: the URL now names a fixed block, so the page never
 * advances again, and that URL is what the user bookmarks or sends to their seller. Without a way
 * back to latest the reload quietly converts a live dashboard into a snapshot of the instant
 * someone paid. The header renders this as a link whenever the route carries a block.
 */
function livePath({ role, address } = {}) {
  return dashboardPath({ role, address });
}

module.exports = {
  DISABLED_PRECEDENCE,
  NATIVE_LABEL,
  PanelError,
  SELF_SCOPED,
  agreementPanel,
  autoCurrencyOptions,
  buildControl,
  controlSurface,
  describeSteps,
  isPlanStale,
  livePath,
  missingFields,
  panelById,
  pendingSetOf,
  reloadAfter,
  sellerCurrencyOptions,
  withdrawControls,
  withdrawInputKey,
};
