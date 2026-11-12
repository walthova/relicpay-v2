'use client';

// The pending registry: which scopes currently have a transaction in flight.
//
// Rule 2 of docs/ADR-002-dashboard-writes.md is "pending is a scope, not a spinner", and a scope is
// page-wide state by nature: a payment planned inside one agreement card claims the credit line and
// the collateral list, which are rendered by different components in a different part of the tree.
// So the in-flight plans live in one context and every control asks it.
//
// This holds plans, not booleans. `pendingSetOf` in ../../../lib/panels.js turns a plan list into
// the scope set, so the mapping from action to scopes stays in the data layer where it is tested,
// and a component never spells a scope string itself.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const PendingContext = createContext(null);

let nextId = 0;

export function PendingProvider({ children }) {
  const [entries, setEntries] = useState([]);

  const begin = useCallback((plan) => {
    const id = `w${(nextId += 1)}`;
    setEntries((prev) => [...prev, { id, plan }]);
    return id;
  }, []);

  const end = useCallback((id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const value = useMemo(
    () => ({ plans: entries.map((e) => e.plan), begin, end }),
    [entries, begin, end]
  );

  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}

/**
 * The in-flight plans, for passing to `controlSurface({ pending })`.
 *
 * Returns an empty list outside a provider rather than throwing. A control rendered without the
 * provider is then never disabled for pendingness, which is the wrong behaviour but not a blank
 * page; the structural suite asserts the provider is mounted in the layout so this stays theory.
 */
export function usePendingPlans() {
  const ctx = useContext(PendingContext);
  return ctx ? ctx.plans : [];
}

export function usePendingRegistry() {
  const ctx = useContext(PendingContext);
  if (!ctx) {
    return { plans: [], begin: () => null, end: () => {} };
  }
  return ctx;
}
