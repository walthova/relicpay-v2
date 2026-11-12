// The dashboard write layer: every transaction a buyer or seller can send, as plain data.
//
// See docs/ADR-002-dashboard-writes.md for the decision this implements. Framework free like the
// rest of this directory, and for the same reason: a plan is a value, so the exact request the
// browser will hand to wagmi can be built here and sent through ethers against ganache in the
// characterization suite. Nothing in this file signs, sends, or waits.
//
// Four ideas carry the whole module.
//
// 1. A plan is a list of steps, not a call.
//    Paying a token-settled installment is approve-then-pay, and depositing ERC20 collateral is
//    approve-then-deposit. Returning one request and leaving the approval to the UI puts the
//    two-step dance in a component, where it gets written twice and one of the copies forgets it.
//    Every plan is a list, usually of length one.
//
// 2. A plan declares what it can move.
//    `scopes` is the set of view regions the transaction can change. The UI disables actions in
//    those scopes while it is in flight rather than patching their values. Scopes are deliberately
//    over-inclusive: claiming too much costs a greyed-out button, claiming too little leaves a live
//    button over a number that is about to be wrong.
//
// 3. A plan remembers the block it was planned at.
//    `plannedAt` is the snapshot's pin. `isPlanStale` compares it to a later view, which is what
//    catches a plan built before a background reload and clicked after it.
//
// 4. The preflight is advisory and says why.
//    It runs against a pinned snapshot and the transaction executes later, so a passing preflight
//    can still revert; time alone is enough to move an agreement into defaultable between the
//    render and the click. Every rejection carries a sentence, because the UI shows it to a person.
//    The suite's other half proves the converse, which is the one that matters: each rejection
//    reason is sent to the chain anyway and must actually revert, so the preflight can never be the
//    reason someone cannot pay a bill they could have paid.

const { relicPayAbi } = require('./abis');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

class WriteError extends Error {}

// Minimal ERC20 write surface. Not generated from build/v2 for the same reason tokens.js does not
// generate its metadata ABI: settlement tokens are third-party contracts the protocol never
// deploys, so there is no artifact to generate from.
const erc20WriteAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
];

/**
 * View regions a transaction can invalidate.
 *
 * `agreement:<id>` is generated per agreement rather than listed here, since agreements are
 * discovered at runtime. AGREEMENTS covers "the set itself changed", which no current action does,
 * and is kept so a future createAgreement flow has somewhere to declare itself.
 */
const SCOPES = Object.freeze({
  CREDIT: 'credit',
  COLLATERAL: 'collateral',
  AUTO_PAYMENT: 'autoPayment',
  AGREEMENTS: 'agreements',
  SELLER_BALANCES: 'sellerBalances',
  SELLER_PREFERENCE: 'sellerPreference',
  RELIC: 'relic',
});

function agreementScope(id) {
  return `agreement:${String(id).toLowerCase()}`;
}

function lower(a) {
  return String(a).toLowerCase();
}

function sameAddress(a, b) {
  return Boolean(a) && Boolean(b) && lower(a) === lower(b);
}

function requireAddress(value, what) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new WriteError(`${what} must be an address, got ${String(value)}`);
  }
  return value;
}

/**
 * Amounts arrive from form inputs, so they are strings far more often than BigInts, and a UI that
 * does `BigInt(input)` on an empty field throws a SyntaxError three layers from the field. Anything
 * that is not a whole non-negative integer is refused by name here.
 */
function amountOf(value, what) {
  let n;
  if (typeof value === 'bigint') n = value;
  else if (typeof value === 'number' && Number.isInteger(value)) n = BigInt(value);
  else if (typeof value === 'string' && /^\d+$/.test(value.trim())) n = BigInt(value.trim());
  else throw new WriteError(`${what} must be a whole number of base units, got ${String(value)}`);
  if (n < 0n) throw new WriteError(`${what} cannot be negative`);
  return n;
}

function rejection(code, reason, extra = {}) {
  return { ok: false, code, reason, ...extra };
}

// ---------------------------------------------------------------------------
// The action catalogue
// ---------------------------------------------------------------------------

/**
 * Every write the dashboard offers, with the role that sees it and the scopes it can move.
 *
 * `role` is who the action belongs to on screen, not who the contract permits. Several of these are
 * permissionless on chain (see payInstallment) and the planner does not pretend otherwise; this
 * field decides which page shows the button.
 */
const ACTIONS = Object.freeze({
  depositEthCollateral: {
    role: 'buyer',
    summary: 'Post ETH as collateral, optionally staked for yield',
    scopes: [SCOPES.COLLATERAL, SCOPES.CREDIT],
  },
  depositTokenCollateral: {
    role: 'buyer',
    summary: 'Post an authorized ERC20 as collateral',
    scopes: [SCOPES.COLLATERAL, SCOPES.CREDIT],
  },
  withdrawCollateral: {
    role: 'buyer',
    summary: 'Take unencumbered collateral back out of a position',
    // Withdrawing lowers the collateral value the credit limit is derived from, so CREDIT moves
    // even when the withdrawal is of a position backing nothing.
    scopes: [SCOPES.COLLATERAL, SCOPES.CREDIT],
  },
  fundAutoPayment: {
    role: 'buyer',
    summary: 'Add to the auto-payment pool, in ETH or a settlement token',
    scopes: [SCOPES.AUTO_PAYMENT],
  },
  withdrawAutoPayment: {
    role: 'buyer',
    summary: 'Take funds back out of the auto-payment pool',
    scopes: [SCOPES.AUTO_PAYMENT],
  },
  setAutoPayment: {
    role: 'buyer',
    summary: 'Turn the auto-payment preference on or off',
    scopes: [SCOPES.AUTO_PAYMENT],
  },
  payInstallment: {
    role: 'buyer',
    summary: 'Pay the next installment on an agreement',
    // Every source a payment can draw from, because which one it draws from depends on the payment
    // method, and completing an agreement also transfers the relic and releases credit.
    scopes: [SCOPES.AUTO_PAYMENT, SCOPES.COLLATERAL, SCOPES.CREDIT, SCOPES.RELIC],
  },
  withdrawSellerBalance: {
    role: 'seller',
    summary: 'Withdraw settled proceeds, in ETH or a settlement token',
    scopes: [SCOPES.SELLER_BALANCES],
  },
  setSettlementPreference: {
    role: 'seller',
    summary: 'Choose the currency the next agreement will settle in',
    // Does not touch open agreements: the currency is snapshotted onto each at creation.
    scopes: [SCOPES.SELLER_PREFERENCE],
  },
  processOverduePayments: {
    role: 'seller',
    summary: 'Advance the stored schedule status on overdue installments',
    scopes: [SCOPES.COLLATERAL, SCOPES.CREDIT, SCOPES.RELIC],
  },
  triggerDefault: {
    role: 'seller',
    summary: 'Default an agreement past its grace period and seize collateral',
    scopes: [SCOPES.COLLATERAL, SCOPES.CREDIT, SCOPES.SELLER_BALANCES, SCOPES.RELIC],
  },
});

const ACTION_NAMES = Object.freeze(Object.keys(ACTIONS));

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

function call(address, functionName, args, value = 0n) {
  return {
    address,
    abi: relicPayAbi,
    functionName,
    args,
    value,
  };
}

function approveStep(token, spender, amount) {
  return {
    kind: 'approve',
    // The approval is why the plan is a list. It targets the token, not the protocol, so a UI that
    // assumes one address per plan sends it to the wrong contract.
    token,
    request: {
      address: token,
      abi: erc20WriteAbi,
      functionName: 'approve',
      args: [spender, amount],
      value: 0n,
    },
    describe: `Approve ${amount} of ${token} for the protocol`,
  };
}

function plan({ action, from, steps, scopes, at, notes = [], describe }) {
  return {
    ok: true,
    action,
    role: ACTIONS[action].role,
    from,
    steps,
    scopes: [...new Set(scopes)],
    plannedAt: at ? { blockNumber: at.blockNumber, timestamp: at.timestamp } : null,
    notes,
    describe,
  };
}

/**
 * The view's pin, normalized.
 *
 * present.js renders block numbers as strings so they survive the server/client boundary, while the
 * reader returns BigInt. A plan is built on both sides of that boundary depending on who is asking,
 * so accept either and keep the string form, which is what a plan must hold to stay serializable.
 */
function pinOf(view) {
  const at = view && view.at;
  if (!at) return null;
  const blockNumber = at.blockNumber === undefined || at.blockNumber === null ? null : String(at.blockNumber);
  const timestamp = at.timestamp === undefined || at.timestamp === null ? null : String(at.timestamp);
  if (blockNumber === null) return null;
  return { blockNumber, timestamp };
}

function findAgreement(view, agreementId) {
  const list = (view && view.agreements) || [];
  const want = lower(agreementId);
  return list.find((a) => lower(a.id) === want) || null;
}

/**
 * The settlement currency of an agreement, as a token address or null for native ETH.
 *
 * Never reads `settlement.tokenAddress`. That is the Active-only readiness block and it is absent
 * on a completed or defaulted agreement, which is the exact hole ADR-001 records the reader
 * plugging with an always-present field. Two shapes are accepted because a plan gets built on both
 * sides of the serialization boundary: the reader calls it `settlementToken`, the presenter folds
 * it into `currency` along with the symbol and decimals it resolved.
 */
function currencyOf(agreement) {
  if (!agreement) return null;
  let address = null;
  if (agreement.settlementToken !== undefined && agreement.settlementToken !== null) {
    const t = agreement.settlementToken;
    address = typeof t === 'object' ? t.address : t;
  } else if (agreement.currency && agreement.currency.address) {
    address = agreement.currency.address;
  }
  if (!address || lower(address) === ZERO_ADDRESS) return null;
  return address;
}

function methodLabelOf(agreement) {
  const m = agreement && agreement.paymentMethod;
  if (!m) return null;
  return typeof m === 'object' ? m.label : m;
}

function nextInstallmentOf(agreement) {
  // paidInstallments is the only field that is correct for this on every agreement shape the
  // presenter emits; `next` is absent once an agreement leaves Active, which is a state the
  // preflight has to reject with a reason rather than crash on.
  const paid = Number(
    agreement && agreement.progress ? agreement.progress.paid : agreement && agreement.paidInstallments
  );
  if (!Number.isInteger(paid)) return null;
  return BigInt(paid + 1);
}

function installmentAmountOf(agreement, installmentNumber) {
  const schedule = (agreement && agreement.schedule) || [];
  const entry = schedule[Number(installmentNumber) - 1];
  if (!entry) return null;
  const raw = entry.amount && typeof entry.amount === 'object' ? entry.amount.raw : entry.amount;
  if (raw === undefined || raw === null) return null;
  return amountOf(raw, 'installment amount');
}

// ---------------------------------------------------------------------------
// The planners
// ---------------------------------------------------------------------------

function planDepositEthCollateral({ relicPay, from, amount, stakeForYield = false, view, protocol }) {
  const value = amountOf(amount, 'amount');
  if (value === 0n) {
    return rejection('ZERO_AMOUNT', 'Enter an amount to deposit.');
  }
  // minCollateralAmount is a governance parameter and lives on getProtocolInfo, not on either
  // dashboard. When the caller has not supplied it the check is skipped, and skipped is not the
  // same as passed: the transaction can still revert on it. Stated here rather than silently.
  const min = protocol && protocol.params ? protocol.params.minCollateralAmount : undefined;
  if (min !== undefined && min !== null && value < amountOf(min, 'minCollateralAmount')) {
    return rejection(
      'BELOW_MINIMUM',
      `The protocol requires at least ${String(min)} base units of collateral per deposit.`,
      { minimum: String(min) }
    );
  }
  return plan({
    action: 'depositEthCollateral',
    from,
    at: pinOf(view),
    scopes: ACTIONS.depositEthCollateral.scopes,
    steps: [{ kind: 'call', request: call(relicPay, 'depositETHCollateral', [Boolean(stakeForYield)], value) }],
    notes: min === undefined || min === null ? ['minimum-collateral-unchecked'] : [],
    describe: `Deposit ${value} wei as ${stakeForYield ? 'staked ' : ''}collateral`,
  });
}

function planDepositTokenCollateral({ relicPay, from, token, amount, allowance, view, protocol }) {
  requireAddress(token, 'token');
  const value = amountOf(amount, 'amount');
  if (value === 0n) return rejection('ZERO_AMOUNT', 'Enter an amount to deposit.');

  const min = protocol && protocol.params ? protocol.params.minCollateralAmount : undefined;
  if (min !== undefined && min !== null && value < amountOf(min, 'minCollateralAmount')) {
    return rejection(
      'BELOW_MINIMUM',
      `The protocol requires at least ${String(min)} base units of collateral per deposit.`,
      { minimum: String(min) }
    );
  }

  const steps = [];
  const have = allowance === undefined || allowance === null ? null : amountOf(allowance, 'allowance');
  if (have === null || have < value) {
    steps.push(approveStep(token, relicPay, value));
  }
  steps.push({ kind: 'call', request: call(relicPay, 'depositERC20Collateral', [token, value]) });

  return plan({
    action: 'depositTokenCollateral',
    from,
    at: pinOf(view),
    scopes: ACTIONS.depositTokenCollateral.scopes,
    steps,
    // authorizedTokens is not on either dashboard view either, so the same honesty applies as for
    // the minimum: an unauthorized token reverts and the preflight cannot see it coming.
    notes: ['token-authorization-unchecked'],
    describe: `Deposit ${value} base units of ${token} as collateral`,
  });
}

/**
 * One collateral position out of either view shape, by id.
 *
 * bytes32 ids are compared case-insensitively for the same reason addresses are: the reader hands
 * back whatever the node rendered and a form hands back whatever the user pasted.
 */
function findPosition(view, positionId) {
  const list = (view && view.collateral) || [];
  const want = lower(positionId);
  return list.find((p) => lower(p.id) === want) || null;
}

/** An amount off a presented position (`{raw}`) or a reader position (a BigInt). */
function positionAmount(position, field, what) {
  if (!position) return null;
  const value = position[field];
  if (value === undefined || value === null) return null;
  const raw = typeof value === 'object' ? value.raw : value;
  if (raw === undefined || raw === null) return null;
  return amountOf(raw, what);
}

/**
 * Take collateral back out.
 *
 * The counterpart to the two deposits, and the only planner whose whole job is telling three
 * reverts apart. `withdrawCollateral` can fail three ways and the contract names them separately on
 * purpose, because they are three different problems with three different fixes:
 *
 *   InsufficientCollateral        the position does not hold that much. Deposit more, or ask for
 *                                 less.
 *   ExceedsWithdrawablePrincipal  the position holds it, but part of the holding is simulated yield
 *                                 backed by nothing, so only the deposited principal can leave.
 *                                 Nothing the buyer does frees the rest; it is not theirs to take.
 *   CollateralBacksOpenCredit     the principal is there and unencumbered-looking, but taking it
 *                                 would leave an open agreement's credit uncovered. Pay the
 *                                 agreement down and the same request succeeds.
 *
 * Collapsing those into one "withdrawal failed" would waste the distinction the contract went to
 * the trouble of making, and would send a buyer to deposit more collateral to fix a problem that
 * more collateral does fix (case three) or does not fix at all (case two).
 *
 * The checks are in the contract's own order, so the predicted code is the one the chain would
 * emit. Both of the first two genuinely revert whatever happens between the plan and the send:
 * principal never rises, and `amount > position.amount` implies `amount > principal` since
 * principal is bounded by amount, so an accrual that lifts the position past the request still
 * leaves the principal gate closed.
 *
 * The third is the one that can come untrue, and it is not rejected when it can. `withdrawCollateral`
 * settles yield on its way in, so on an auto-reinvesting position with a live yield rate the
 * accrual raises the collateral value and with it the credit headroom; the figure the view reported
 * was a floor. Rejecting there would be the preflight refusing a withdrawal the chain would have
 * allowed, which is the one failure ADR-002 says this module must not have. So that case is planned
 * with a note instead, and the note says the transaction may still revert.
 */
function planWithdrawCollateral({ relicPay, from, positionId, amount, view }) {
  if (typeof positionId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(positionId)) {
    throw new WriteError(`positionId must be a bytes32, got ${String(positionId)}`);
  }
  const value = amountOf(amount, 'amount');
  // The contract's own guard is `require(amount > 0)`, a bare string revert. Named here so the
  // empty-field case gets a sentence rather than a wallet-level failure.
  if (value === 0n) return rejection('ZERO_AMOUNT', 'Enter an amount to withdraw.');

  const position = findPosition(view, positionId);
  if (!position) {
    return rejection('POSITION_NOT_FOUND', 'That collateral position is not on this dashboard.');
  }

  const held = positionAmount(position, 'amount', 'position amount');
  if (held !== null && value > held) {
    return rejection(
      'INSUFFICIENT_COLLATERAL',
      `This position holds ${held} base units and this would withdraw ${value}.`,
      { available: String(held), requested: String(value) }
    );
  }

  const principal = positionAmount(position, 'principal', 'position principal');
  if (principal !== null && value > principal) {
    return rejection(
      'EXCEEDS_WITHDRAWABLE_PRINCIPAL',
      `Only the ${principal} base units deposited as principal can be withdrawn; the rest of this position is accrued yield, which is simulated and cannot be paid out.`,
      { principal: String(principal), requested: String(value) }
    );
  }

  const withdrawable = positionAmount(position, 'withdrawable', 'withdrawable collateral');
  const isFloor = position.isFloor === true || position.mayAccrue === true;
  const notes = [];
  if (withdrawable === null) {
    notes.push('withdrawable-unknown');
  } else if (value > withdrawable) {
    if (!isFloor) {
      return rejection(
        'COLLATERAL_BACKS_OPEN_CREDIT',
        `Withdrawing more than ${withdrawable} base units would leave an open agreement's credit uncovered. Pay the agreement down to free the rest.`,
        { withdrawable: String(withdrawable), requested: String(value) }
      );
    }
    // Above the reported ceiling on a position whose pending yield will raise it. Offered, with the
    // risk stated, because refusing it would be refusing a withdrawal the chain may well accept.
    notes.push('above-reported-withdrawable');
  }
  if (isFloor) notes.push('withdrawable-is-a-floor');

  return plan({
    action: 'withdrawCollateral',
    from,
    at: pinOf(view),
    scopes: ACTIONS.withdrawCollateral.scopes,
    steps: [{ kind: 'call', request: call(relicPay, 'withdrawCollateral', [positionId, value]) }],
    notes,
    describe: `Withdraw ${value} base units from collateral position ${positionId}`,
  });
}

function planFundAutoPayment({ relicPay, from, token = null, amount, allowance, view }) {
  const value = amountOf(amount, 'amount');
  if (value === 0n) return rejection('ZERO_AMOUNT', 'Enter an amount to add.');

  if (!token) {
    return plan({
      action: 'fundAutoPayment',
      from,
      at: pinOf(view),
      scopes: ACTIONS.fundAutoPayment.scopes,
      steps: [{ kind: 'call', request: call(relicPay, 'depositAutoPaymentFunds', [], value) }],
      describe: `Add ${value} wei to the ETH auto-payment pool`,
    });
  }

  requireAddress(token, 'token');
  const steps = [];
  const have = allowance === undefined || allowance === null ? null : amountOf(allowance, 'allowance');
  if (have === null || have < value) steps.push(approveStep(token, relicPay, value));
  steps.push({ kind: 'call', request: call(relicPay, 'depositAutoPaymentTokens', [token, value]) });

  return plan({
    action: 'fundAutoPayment',
    from,
    at: pinOf(view),
    scopes: ACTIONS.fundAutoPayment.scopes,
    steps,
    describe: `Add ${value} base units of ${token} to the auto-payment pool`,
  });
}

/**
 * A per-token balance out of either view shape.
 *
 * The reader returns these keyed by address (`{'0xabc': 500n}`); present.js turns the same data
 * into an array of `{tokenAddress, balance}`, because an object keyed by a checksummed address is
 * awkward to render and the presenter resolves each one's symbol and decimals on the way past. Both
 * shapes reach this module: the suite mostly plans from reader output, and the app plans from the
 * presented view.
 *
 * Reading only the keyed form, which is what this did until part c2, is worse than an error. An
 * array's keys are '0', '1', '2', so the lookup misses, the balance comes back `null`, and `null`
 * is the documented "caller did not supply it" case that skips the check entirely. Every token
 * balance preflight was therefore live in the suite and silently absent in the one place it is for,
 * which is a person clicking Withdraw on a browser page. Found by feeding a presented view through
 * the planner while wiring part c2.
 */
function balanceLookup(container, token, what) {
  if (!container) return null;
  let entry;
  if (Array.isArray(container)) {
    const row = container.find((b) => b && sameAddress(b.tokenAddress, token));
    entry = row ? row.balance : undefined;
  } else {
    const key = Object.keys(container).find((k) => sameAddress(k, token));
    entry = key === undefined ? undefined : container[key];
  }
  if (entry === undefined || entry === null) return null;
  const raw = typeof entry === 'object' ? entry.raw : entry;
  return raw === undefined || raw === null ? null : amountOf(raw, what);
}

/** The pool balance a buyer view reports for a currency, in base units. */
function autoBalanceOf(view, token) {
  const auto = (view && view.autoPayment) || {};
  if (!token) {
    const eth = auto.ethBalance;
    const raw = eth && typeof eth === 'object' ? eth.raw : eth;
    return raw === undefined || raw === null ? null : amountOf(raw, 'ethBalance');
  }
  return balanceLookup(auto.tokenBalances, token, 'tokenBalance');
}

function planWithdrawAutoPayment({ relicPay, from, token = null, amount, view }) {
  const value = amountOf(amount, 'amount');
  if (value === 0n) return rejection('ZERO_AMOUNT', 'Enter an amount to withdraw.');

  const balance = autoBalanceOf(view, token);
  if (balance !== null && value > balance) {
    return rejection(
      'INSUFFICIENT_POOL_BALANCE',
      `The pool holds ${balance} base units and this would withdraw ${value}.`,
      { available: String(balance), requested: String(value) }
    );
  }

  const request = token
    ? call(relicPay, 'withdrawAutoPaymentTokens', [requireAddress(token, 'token'), value])
    : call(relicPay, 'withdrawAutoPaymentFunds', [value]);

  return plan({
    action: 'withdrawAutoPayment',
    from,
    at: pinOf(view),
    scopes: ACTIONS.withdrawAutoPayment.scopes,
    steps: [{ kind: 'call', request }],
    notes: balance === null ? ['pool-balance-unknown'] : [],
    describe: `Withdraw ${value} base units from the ${token || 'ETH'} auto-payment pool`,
  });
}

function planSetAutoPayment({ relicPay, from, enabled, view }) {
  if (typeof enabled !== 'boolean') {
    throw new WriteError(`enabled must be a boolean, got ${String(enabled)}`);
  }
  return plan({
    action: 'setAutoPayment',
    from,
    at: pinOf(view),
    scopes: ACTIONS.setAutoPayment.scopes,
    steps: [{ kind: 'call', request: call(relicPay, 'setAutoPayment', [enabled]) }],
    describe: enabled ? 'Enable auto-payment' : 'Disable auto-payment',
  });
}

/**
 * Pay the next installment.
 *
 * Two contract facts shape this one, both of them invisible from the read layer and both recorded
 * in ADR-002.
 *
 * `processPayment` is payable, but `_settleManual` is the only branch that reads `msg.value`: it
 * requires exactly the installment amount for an ETH-settled agreement and exactly zero for a
 * token-settled one. The Collateral, Auto and AutoWithCollateral branches never look at it, so ETH
 * attached to one of those is accepted and credited to nobody, with no path to recover it. Hence
 * `value` is derived from currency and method together, and is 0n everywhere except ETH Manual.
 *
 * And there is no check that the caller is the buyer. A Manual payment pulls ETH from msg.value and
 * tokens from msg.sender, so a third party paying on someone's behalf works, and the other three
 * methods are permissionless by construction. Reported as a note, not refused.
 */
function planPayInstallment({ relicPay, from, agreementId, installmentNumber, allowance, view }) {
  const agreement = findAgreement(view, agreementId);
  if (!agreement) {
    return rejection('AGREEMENT_NOT_FOUND', 'That agreement is not on this dashboard.');
  }
  if (agreement.state !== 'Active') {
    return rejection(
      'AGREEMENT_NOT_ACTIVE',
      `This agreement is ${String(agreement.state).toLowerCase()}, so it takes no more payments.`
    );
  }

  const expected = nextInstallmentOf(agreement);
  if (expected === null) {
    return rejection('SCHEDULE_UNREADABLE', 'The payment schedule could not be read from this view.');
  }
  const total = Number(agreement.installmentCount);
  if (Number(expected) > total) {
    return rejection('SCHEDULE_COMPLETE', 'Every installment on this agreement is already paid.');
  }
  const wanted = installmentNumber === undefined || installmentNumber === null
    ? expected
    : amountOf(installmentNumber, 'installmentNumber');
  if (wanted !== expected) {
    // The contract enforces a strict sequence, so paying out of order is a revert and not a
    // prepayment. Prepaying the *next* installment early is allowed and is the expected case.
    return rejection(
      'OUT_OF_SEQUENCE',
      `Installments are paid in order; the next one due is ${expected}, not ${wanted}.`,
      { expected: String(expected) }
    );
  }

  const amount = installmentAmountOf(agreement, expected);
  if (amount === null) {
    return rejection('SCHEDULE_UNREADABLE', 'That installment is missing from the schedule in this view.');
  }

  const currency = currencyOf(agreement);
  const method = methodLabelOf(agreement);
  if (!method) return rejection('METHOD_UNREADABLE', 'The payment method could not be read from this view.');

  const isManual = method === 'Manual';
  const notes = [];
  if (!sameAddress(from, agreement.buyer)) notes.push('payerIsNotBuyer');

  const steps = [];
  let value = 0n;

  if (isManual && !currency) {
    // Exactly equal, not at least. `_settleManual` reverts on an overpayment too.
    value = amount;
  } else if (isManual && currency) {
    const have = allowance === undefined || allowance === null ? null : amountOf(allowance, 'allowance');
    if (have === null || have < amount) steps.push(approveStep(currency, relicPay, amount));
  } else if (!isManual) {
    // Pool-funded. The readiness block is the reader's own derivation of whether the draw will
    // succeed, so trust it rather than recomputing the same thing from balances here.
    const readiness = agreement.settlement;
    if (readiness && readiness.ready === false) {
      return rejection(
        'NOT_READY',
        `This agreement settles from ${method === 'Auto' ? 'the auto-payment pool' : 'collateral'} and there is not enough there to cover ${amount} base units.`,
        { required: String(amount) }
      );
    }
    notes.push('pool-funded');
  }

  steps.push({
    kind: 'call',
    request: call(relicPay, 'processPayment', [agreement.id, expected], value),
  });

  return plan({
    action: 'payInstallment',
    from,
    at: pinOf(view),
    scopes: [...ACTIONS.payInstallment.scopes, agreementScope(agreement.id)],
    steps,
    notes,
    describe: `Pay installment ${expected} of ${total}`,
  });
}

/** The seller balance a seller view reports for a currency, in base units. */
function sellerBalanceOf(view, token) {
  const balances = (view && view.balances) || {};
  if (!token) {
    const eth = balances.eth;
    const raw = eth && typeof eth === 'object' ? eth.raw : eth;
    return raw === undefined || raw === null ? null : amountOf(raw, 'sellerEthBalance');
  }
  return balanceLookup(balances.tokens, token, 'sellerTokenBalance');
}

function planWithdrawSellerBalance({ relicPay, from, token = null, view }) {
  const balance = sellerBalanceOf(view, token);
  // Both withdrawals require a strictly positive balance. Without this the seller's most common
  // click, on a page that is showing them zero, is a wallet-level revert.
  if (balance !== null && balance === 0n) {
    return rejection(
      'NOTHING_TO_WITHDRAW',
      `There is no settled ${token ? 'token' : 'ETH'} balance to withdraw.`
    );
  }
  const request = token
    ? call(relicPay, 'withdrawSellerTokenBalance', [requireAddress(token, 'token')])
    : call(relicPay, 'withdrawSellerBalance', []);
  return plan({
    action: 'withdrawSellerBalance',
    from,
    at: pinOf(view),
    scopes: ACTIONS.withdrawSellerBalance.scopes,
    steps: [{ kind: 'call', request }],
    notes: balance === null ? ['seller-balance-unknown'] : [],
    describe: `Withdraw the settled ${token || 'ETH'} balance`,
  });
}

function planSetSettlementPreference({ relicPay, from, token = null, view }) {
  const target = token ? requireAddress(token, 'token') : ZERO_ADDRESS;
  return plan({
    action: 'setSettlementPreference',
    from,
    at: pinOf(view),
    scopes: ACTIONS.setSettlementPreference.scopes,
    steps: [{ kind: 'call', request: call(relicPay, 'setSettlementPreference', [target]) }],
    // The registry of authorized settlement tokens is owner-controlled and is not on the seller
    // view, so an unauthorized token reverts with InvalidSettlementToken and the preflight cannot
    // see it. Setting it back to ETH always succeeds.
    notes: token ? ['settlement-token-authorization-unchecked'] : [],
    describe: token ? `Settle future agreements in ${target}` : 'Settle future agreements in ETH',
  });
}

function planProcessOverduePayments({ relicPay, from, agreementId, view }) {
  const agreement = findAgreement(view, agreementId);
  if (!agreement) return rejection('AGREEMENT_NOT_FOUND', 'That agreement is not on this dashboard.');
  if (agreement.state !== 'Active') {
    return rejection(
      'AGREEMENT_NOT_ACTIVE',
      `This agreement is ${String(agreement.state).toLowerCase()}, so there is nothing to advance.`
    );
  }
  return plan({
    action: 'processOverduePayments',
    from,
    at: pinOf(view),
    scopes: [...ACTIONS.processOverduePayments.scopes, agreementScope(agreement.id)],
    steps: [{ kind: 'call', request: call(relicPay, 'processOverduePayments', [agreement.id]) }],
    // A sweep with nothing past its grace period is a no-op, not a revert, so this is safe to offer
    // whenever the agreement is Active.
    notes: [],
    describe: 'Advance the stored status of any overdue installments',
  });
}

function planTriggerDefault({ relicPay, from, agreementId, view }) {
  const agreement = findAgreement(view, agreementId);
  if (!agreement) return rejection('AGREEMENT_NOT_FOUND', 'That agreement is not on this dashboard.');
  if (agreement.state !== 'Active') {
    return rejection(
      'AGREEMENT_NOT_ACTIVE',
      `This agreement is already ${String(agreement.state).toLowerCase()}.`
    );
  }
  if (!sameAddress(from, agreement.seller)) {
    return rejection('NOT_THE_SELLER', 'Only the seller on this agreement can default it.');
  }
  if (agreement.defaultable !== true) {
    // The reader derives this from the pinned timestamp against the schedule's own due date plus
    // grace, which is the same arithmetic the contract does. It is the one flag here that can flip
    // to true without any transaction, purely because time passed.
    return rejection(
      'GRACE_PERIOD_ACTIVE',
      'The grace period on the next installment has not expired yet.'
    );
  }
  return plan({
    action: 'triggerDefault',
    from,
    at: pinOf(view),
    scopes: [...ACTIONS.triggerDefault.scopes, agreementScope(agreement.id)],
    steps: [{ kind: 'call', request: call(relicPay, 'triggerDefault', [agreement.id]) }],
    describe: 'Default this agreement and seize the backing collateral',
  });
}

const PLANNERS = Object.freeze({
  depositEthCollateral: planDepositEthCollateral,
  depositTokenCollateral: planDepositTokenCollateral,
  withdrawCollateral: planWithdrawCollateral,
  fundAutoPayment: planFundAutoPayment,
  withdrawAutoPayment: planWithdrawAutoPayment,
  setAutoPayment: planSetAutoPayment,
  payInstallment: planPayInstallment,
  withdrawSellerBalance: planWithdrawSellerBalance,
  setSettlementPreference: planSetSettlementPreference,
  processOverduePayments: planProcessOverduePayments,
  triggerDefault: planTriggerDefault,
});

/**
 * Build a plan for one action.
 *
 * `view` is a presented dashboard (present.js output) or a raw reader dashboard; both are accepted,
 * since the planner reads `.raw` off an amount when it is there and the value itself when it is
 * not. That is what lets the suite plan against reader output and the app plan against the view
 * model without two code paths.
 *
 * Returns either `{ok: true, ...plan}` or `{ok: false, code, reason}`. It throws only for a caller
 * error, a malformed address or a non-integer amount, which are bugs in the calling code rather
 * than states a user can reach.
 */
function planAction(action, params = {}, { relicPay, view, protocol, from } = {}) {
  const planner = PLANNERS[action];
  if (!planner) throw new WriteError(`unknown action "${action}", expected one of ${ACTION_NAMES.join(', ')}`);
  const target = requireAddress(relicPay || (view && view.contract), 'relicPay');
  const sender = from || (view && view.address);
  requireAddress(sender, 'from');
  return planner({ ...params, relicPay: target, from: sender, view, protocol });
}

// Actions whose request cannot be built without a number or a flag from the user. Listing them is
// what keeps availableActions from planning a deposit of zero and reporting it as unavailable.
const NEEDS_INPUT = new Set([
  'depositEthCollateral',
  'depositTokenCollateral',
  // Needs two things the catalogue cannot supply: which position, and how much. Position-scoped
  // rather than agreement-scoped, so AGREEMENT_SCOPED's `agreementId` hook does not fit it; the
  // panel layer is what pairs it with a position.
  'withdrawCollateral',
  'fundAutoPayment',
  'withdrawAutoPayment',
  'setAutoPayment',
  'setSettlementPreference',
]);

const AGREEMENT_SCOPED = new Set(['payInstallment', 'processOverduePayments', 'triggerDefault']);

/**
 * Every action for a role, each already planned or already rejected with its reason.
 *
 * The UI renders both: a rejected action is a disabled control with a sentence next to it, which is
 * the whole point of rejections carrying prose. Actions needing an amount the user has not typed
 * yet are returned as `needsInput` instead of being planned against a made-up number.
 */
function availableActions(view, { role, relicPay, from, protocol, agreementId } = {}) {
  const target = relicPay || (view && view.contract);
  const sender = from || (view && view.address);
  const out = [];
  for (const [name, meta] of Object.entries(ACTIONS)) {
    if (role && meta.role !== role) continue;
    const entry = { action: name, role: meta.role, summary: meta.summary, scopes: meta.scopes };
    if (NEEDS_INPUT.has(name)) {
      out.push({ ...entry, needsInput: true });
      continue;
    }
    if (AGREEMENT_SCOPED.has(name)) {
      if (!agreementId) {
        out.push({ ...entry, needsInput: true });
        continue;
      }
      out.push({ ...entry, ...planAction(name, { agreementId }, { relicPay: target, view, protocol, from: sender }) });
      continue;
    }
    out.push({ ...entry, ...planAction(name, {}, { relicPay: target, view, protocol, from: sender }) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Staleness and the reload contract
// ---------------------------------------------------------------------------

/**
 * Has the view moved on since this plan was built?
 *
 * The comparison is the block number and nothing else. A field-level diff would be smarter and
 * would be wrong: the plan was preflighted against a whole snapshot, including derivations like
 * `defaultable` that depend on the block timestamp rather than on any field the plan touches. If
 * the pin moved, the preflight was run against a block that is no longer what the user is looking
 * at, and the plan should be rebuilt. Rebuilding is cheap; it is a pure function.
 */
function isPlanStale(plan, view) {
  if (!plan || !plan.plannedAt) return true;
  const now = pinOf(view);
  if (!now) return true;
  return BigInt(now.blockNumber) !== BigInt(plan.plannedAt.blockNumber);
}

/**
 * Where to re-pin after a transaction confirms.
 *
 * At the receipt's block, never at latest, and never on send. See ADR-002: refetching on send races
 * the miner and renders a block from before the transaction, which looks to the buyer exactly like
 * a payment that did not happen. Pinning to the receipt gives the reload an exact postcondition,
 * which is what the tests assert against.
 *
 * A reverted receipt is not a reload: nothing changed, so the pin stays and the scopes are released
 * with the failure reported instead.
 */
function resolveAfter(plan, receipt) {
  if (!receipt || receipt.blockNumber === undefined || receipt.blockNumber === null) {
    throw new WriteError('resolveAfter needs a receipt with a blockNumber');
  }
  const succeeded = receipt.status === undefined
    ? true
    : receipt.status === 1 || receipt.status === 1n || receipt.status === 'success';
  return {
    reload: succeeded,
    blockNumber: String(receipt.blockNumber),
    scopes: plan && plan.scopes ? plan.scopes : [],
    status: succeeded ? 'success' : 'reverted',
  };
}

/**
 * The scopes to disable while `plans` are in flight, and a predicate for the UI.
 *
 * Pending is a scope rather than a page-wide spinner so that funding an auto-payment pool does not
 * take the agreement list down with it.
 */
function pendingScopes(plans) {
  const set = new Set();
  for (const p of plans || []) {
    if (!p || !p.ok) continue;
    for (const s of p.scopes || []) set.add(s);
  }
  return set;
}

function isScopePending(plans, scope) {
  return pendingScopes(plans).has(scope);
}

module.exports = {
  ACTIONS,
  ACTION_NAMES,
  AGREEMENT_SCOPED,
  NEEDS_INPUT,
  SCOPES,
  WriteError,
  ZERO_ADDRESS,
  agreementScope,
  autoBalanceOf,
  availableActions,
  balanceLookup,
  currencyOf,
  erc20WriteAbi,
  findPosition,
  isPlanStale,
  isScopePending,
  nextInstallmentOf,
  positionAmount,
  pendingScopes,
  planAction,
  resolveAfter,
  sellerBalanceOf,
};
