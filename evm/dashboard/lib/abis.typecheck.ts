// Compile-only proof that the generated abis.d.ts still gives viem real type inference.
//
// abis.js is JavaScript, so nothing in the repo type-checks it. The .d.ts beside it is the only
// thing standing between the part b app and every readContract silently degrading to `any`, and a
// .d.ts that is subtly wrong (a mutable array instead of a readonly tuple, say) fails open: it
// compiles, inference quietly widens to `string`, and nobody notices until a typo'd function name
// ships. This file makes that failure loud. Run with `npm run abi:typecheck`.
//
// It is never imported at runtime and deliberately exports nothing useful.

import type { Abi, ExtractAbiFunctionNames, ExtractAbiEventNames } from 'abitype';
import { relicPayAbi, relicRegistryAbi, priceOracleAbi } from './abis';

// The generated shape is assignable to viem's Abi. If toReadonlyType ever emits something that is
// not a valid ABI literal, this is where it stops.
const _assignable: readonly [Abi, Abi, Abi] = [relicPayAbi, relicRegistryAbi, priceOracleAbi];

// Inference is live: function and event names are literal types, not `string`.
type RelicPayFn = ExtractAbiFunctionNames<typeof relicPayAbi>;
type RelicPayEvent = ExtractAbiEventNames<typeof relicPayAbi>;

const _readFn: RelicPayFn = 'getAgreement';
const _writeFn: RelicPayFn = 'processPayment';
const _event: RelicPayEvent = 'AgreementCreated';
const _registryFn: ExtractAbiFunctionNames<typeof relicRegistryAbi> = 'mintRelic';

// @ts-expect-error a function RelicPay does not have must not type-check. If the ABI widened to
// string this line stops erroring and the directive itself becomes the error, which is the point.
const _typo: RelicPayFn = 'getAgreementt';

export type { RelicPayFn, RelicPayEvent };
export { _assignable, _readFn, _writeFn, _event, _registryFn, _typo };
