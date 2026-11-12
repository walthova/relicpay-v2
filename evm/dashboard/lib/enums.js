// Enum decoding for the dashboard.
//
// Every enum the contracts return crosses the ABI boundary as a bare uint8. A dashboard that
// renders `state: 2` is useless, and a dashboard that hardcodes `state === 2 ? 'Defaulted' : ...`
// at four call sites is one reordered enum away from telling a buyer their completed agreement
// defaulted. Decoding lives here, once, and the ordering is asserted against the compiled ABI in
// test/dashboard.test.js so a reorder in the .sol fails the suite rather than the UI.
//
// The values mirror contracts/RelicPay.sol. Order is the contract's order and is load-bearing.

const BNPL_STATE = ['Active', 'Completed', 'Defaulted'];
const COLLATERAL_TYPE = ['ETH', 'ERC20', 'StakedETH', 'LiquidStakingToken'];
const PAYMENT_METHOD = ['Manual', 'Auto', 'Collateral', 'AutoWithCollateral'];
const PAYMENT_STATUS = ['Pending', 'Paid', 'Overdue', 'Defaulted'];

class EnumError extends Error {}

function decoder(name, labels) {
  return function decode(value) {
    const i = Number(value);
    const label = labels[i];
    // An out-of-range value means the chain returned an enum variant this build does not know
    // about, which is the ABI-drift case: the dashboard is pointed at a newer contract than it was
    // generated from. Throwing names that; returning 'Unknown' would render a plausible-looking
    // page from a stale ABI.
    if (label === undefined) throw new EnumError(`${name}: unknown variant ${value}`);
    return label;
  };
}

const decodeBnplState = decoder('BnplState', BNPL_STATE);
const decodeCollateralType = decoder('CollateralType', COLLATERAL_TYPE);
const decodePaymentMethod = decoder('PaymentMethod', PAYMENT_METHOD);
const decodePaymentStatus = decoder('PaymentStatus', PAYMENT_STATUS);

// Encode back to uint8 for write calls (part c) and for test fixtures.
function encoder(name, labels) {
  return function encode(label) {
    const i = labels.indexOf(label);
    if (i < 0) throw new EnumError(`${name}: unknown label ${label}`);
    return i;
  };
}

const encodePaymentMethod = encoder('PaymentMethod', PAYMENT_METHOD);
const encodeCollateralType = encoder('CollateralType', COLLATERAL_TYPE);

// Which payment methods draw from the buyer's pre-funded pools rather than a wallet transaction.
// The UI needs this to decide whether to show a "Pay now" button or a "Top up" one; deriving it
// from the label at the call site would scatter the same conditional through the app.
const PULLS_FROM_AUTO_BALANCE = new Set(['Auto', 'AutoWithCollateral']);
const PULLS_FROM_COLLATERAL = new Set(['Collateral', 'AutoWithCollateral']);

function paymentMethodTraits(label) {
  if (!PAYMENT_METHOD.includes(label)) throw new EnumError(`PaymentMethod: unknown label ${label}`);
  return {
    label,
    usesAutoBalance: PULLS_FROM_AUTO_BALANCE.has(label),
    usesCollateral: PULLS_FROM_COLLATERAL.has(label),
    // Manual is the only method where the buyer must send the transaction themselves; every other
    // method can be processed by anyone once the pools are funded.
    requiresBuyerTransaction: label === 'Manual',
  };
}

module.exports = {
  BNPL_STATE,
  COLLATERAL_TYPE,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  EnumError,
  decodeBnplState,
  decodeCollateralType,
  decodePaymentMethod,
  decodePaymentStatus,
  encodePaymentMethod,
  encodeCollateralType,
  paymentMethodTraits,
};
