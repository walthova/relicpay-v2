'use client';

// Running one plan: send its steps in order, wait for each receipt, then re-pin the page.
//
// This is the only file in the app that sends a transaction, and it is deliberately small, because
// every decision it could have made has already been made somewhere it can be tested. The requests
// come from writes.js. Which control may be clicked comes from panels.js. Where to navigate
// afterwards comes from panels.reloadAfter. What is left here is sequencing and the three pieces of
// state a person watching a two-step approval needs to see.
//
// Three things worth stating.
//
// Steps run strictly in sequence, each awaiting its receipt before the next is sent. The second
// step of an approve-then-pay plan depends on the first having landed, so firing both and letting
// the nonces sort it out means the payment can reach the contract before the allowance does and
// revert for a reason the user has already handled.
//
// The reload is a navigation, not a refetch. `router.replace` to the `?at=<receipt block>` route
// re-renders the server component through the same `loadDashboard` path a fresh visit uses, so
// there is exactly one read path in this app and no cache to invalidate. See ADR-002.
//
// The plan is re-checked for staleness immediately before sending. A plan is built during render
// against the pinned block; if a reload has moved the pin since, the preflight behind that plan was
// run against a block the user is no longer looking at.

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConfig, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';

import { isPlanStale, reloadAfter } from '../../../lib/panels.js';

const IDLE = { phase: 'idle', stepIndex: 0, hash: null, error: null };

/**
 * @param {object} options
 * @param {'buyer'|'seller'} options.role the dashboard this control lives on
 * @param {string} options.address the address in the route, which the reload must preserve
 * @param {object} options.registry the pending registry from PendingScopes
 * @param {object} [options.view] the current view, for the staleness re-check before sending
 */
export function useActionRunner({ role, address, registry, view }) {
  const router = useRouter();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState(IDLE);
  // A ref as well as state: the guard has to reject a second click in the same tick, before React
  // has re-rendered with the new state, which is exactly what a double-click on a slow wallet is.
  const running = useRef(false);

  const reset = useCallback(() => setState(IDLE), []);

  const run = useCallback(
    async (plan) => {
      if (!plan || !plan.ok || running.current) return null;
      if (view && isPlanStale(plan, view)) {
        setState({
          phase: 'stale',
          stepIndex: 0,
          hash: null,
          error: new Error('This page reloaded while the action was open. Try it again against the current block.'),
        });
        return null;
      }

      running.current = true;
      const token = registry.begin(plan);
      let receipt = null;

      try {
        for (let i = 0; i < plan.steps.length; i += 1) {
          const step = plan.steps[i];
          setState({ phase: 'signing', stepIndex: i, hash: null, error: null });
          const hash = await writeContractAsync({ ...step.request, account: plan.from });
          setState({ phase: 'confirming', stepIndex: i, hash, error: null });
          receipt = await waitForTransactionReceipt(config, { hash });
          if (receipt.status !== 'success') {
            // A reverted step stops the plan. Sending step two after step one reverted is sending a
            // payment whose approval never happened.
            setState({
              phase: 'reverted',
              stepIndex: i,
              hash,
              error: new Error('The transaction was mined but reverted. Nothing was changed.'),
            });
            return receipt;
          }
        }

        const next = reloadAfter(plan, receipt, { role, address });
        setState({ phase: 'confirmed', stepIndex: plan.steps.length - 1, hash: receipt.transactionHash, error: null });
        if (next.reload && next.path) router.replace(next.path);
        return receipt;
      } catch (error) {
        // A user rejecting in their wallet lands here, and it is not a failure worth a red box.
        const rejected = error && (error.name === 'UserRejectedRequestError' || /rejected/i.test(String(error.shortMessage || error.message)));
        setState({
          phase: rejected ? 'cancelled' : 'failed',
          stepIndex: state.stepIndex,
          hash: null,
          error,
        });
        return null;
      } finally {
        running.current = false;
        // Released whatever happened. Leaving a scope pending after a revert disables the controls
        // over numbers that never moved, and nothing would ever re-enable them.
        registry.end(token);
      }
    },
    // state.stepIndex is read only inside the catch for reporting, so it is not a dependency worth
    // re-creating the callback for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, registry, role, address, router, view, writeContractAsync]
  );

  return { run, reset, ...state, busy: state.phase === 'signing' || state.phase === 'confirming' };
}
