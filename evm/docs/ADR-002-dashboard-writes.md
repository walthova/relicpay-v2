# ADR-002: how the dashboard handles a pending write

Status: accepted, 2026-09-17
Context: roadmap "Next.js buyer/seller dashboard, part c", which opens with the question part b1
left standing: a pending write invalidates the pinned block snapshot the whole read layer is built
on, and nothing in b2 answers that.

## The question

ADR-001 made one invariant load-bearing for every number on the dashboard: **one render is one
block.** `getBuyerDashboard` takes a block number once and threads it through twenty eth_calls, so a
credit line and the payment schedule that consumed it can never come from different blocks.

A write breaks that by construction. The user clicks Pay at block N, the transaction mines at block
N+3, and for those seconds the page is showing block N while the chain has moved. Whatever the
dashboard renders in that window is either stale or invented, and this is a screen that tells people
what they owe.

## Decision

**The snapshot is immutable. A write never patches it; a write replaces it.**

Three rules follow, and together they are the whole mechanism.

1. **No optimistic mutation.** Nothing in the view model is edited in place to anticipate a
   transaction's effect.
2. **Pending is a scope, not a spinner.** Every action declares which parts of the view its
   transaction can move. While it is in flight, those scopes are marked pending: they still render
   their block-N values, labelled as of block N, and every action inside them is disabled. The rest
   of the page is untouched and stays usable.
3. **Reload at the receipt's block, never at latest.** When the transaction confirms, the page
   re-pins at `receipt.blockNumber` and reloads through the same `loadDashboard` path a fresh visit
   uses.

## Why not optimistic updates

This is the option a dashboard normally reaches for, and it is wrong here specifically.

Almost nothing on this page is stored. `availableCredit`, `creditUtilization`, `isOverLimit`,
`settlement.ready`, `shortfall`, `isOverdue`, `defaultable`, `summary.underfunded` and
`summary.atRisk` are all derived, most of them from several storage slots at once and some of them
from the block timestamp. Optimistically decrementing an auto-payment balance after a payment leaves
every one of those computed against the old balance. The page does not go blank or throw. It renders
a consistent-looking set of numbers that disagree with the chain, which is the exact failure mode
ADR-001 introduced the pin to prevent, reintroduced one layer up.

To patch the snapshot correctly you would have to reimplement the reader's derivations against a
hypothetical post-transaction state. That is a second implementation of the protocol's accounting,
in JavaScript, in the browser, unprovable against ganache because it never touches a chain. Two
surfaces drift, and this pair would drift silently and in the user's favour.

And the premise is not even true for four of the eight buyer actions. A `Collateral` or `Auto`
payment moves collateral positions, yield, the credit line and the schedule at once; `triggerDefault`
moves all of that plus the relic's ownership. There is no optimistic edit for those, only a guess.

## Why not freeze the page

The other easy answer: disable everything until the write settles. Rejected because the unit is too
coarse. A buyer topping up their auto-payment pool should not lose the ability to read the schedule
on an unrelated agreement, and a seller withdrawing an ETH balance has not touched their USDC one.

Scopes are what make rule 2 usable. They are declared per action and are deliberately
over-inclusive: `payInstallment` on a `Collateral` agreement claims the credit line, the collateral
list and the agreement, because it really does move all three. Claiming too much costs a disabled
button; claiming too little leaves a live button over a stale number.

## Why the receipt's block and not latest

This one was nearly a bug. The obvious reload trigger is "transaction sent, refetch", and the
obvious refetch is at `latest`. Both are wrong.

Refetching on send races the miner and usually lands at a block *before* the transaction, so the
buyer watches their payment not appear and pays again. Refetching at `latest` after confirmation is
right by accident: `latest` is at or ahead of the receipt, and "ahead" means the reload can also
pick up a third party's transaction, which is fine, but it makes the page's own claim ("as of block
N+3") untestable, because nothing ties the rendered block to the transaction that caused the reload.

Pinning to `receipt.blockNumber` gives an exact postcondition, and it is the postcondition the tests
assert: the transaction's effect is visible in the reload, because the reload is read at the block
the transaction mined in. `loadDashboard` already accepts `blockNumber`, and the `?at=` route from
b2 already renders a pinned past block, so the mechanism exists. Part c only has to point it at the
receipt.

## What the preflight is, and what it is not

`writes.js` checks an action against the snapshot before building a request: enough balance,
agreement still Active, caller is the seller when the contract demands it, allowance covers a token
payment. This catches the mistakes worth catching without a round trip.

It is **advisory, and pinned.** It is computed from block N and the transaction executes at block
N+k, so a preflight that passed can still revert, and this is not an edge case: an agreement can
become defaultable between the render and the click purely because time passed. The contract is the
only authority. The preflight exists so the common failures surface as a disabled button with a
reason instead of a wallet-level revert, and every rejection reason it produces is a sentence, not a
code, because someone has to read it.

The corollary is the other half of this module's tests: a rejection has to name a condition that
really does revert. `assertRejectionsRevert` in the suite takes each rejected plan, sends it anyway,
and requires the chain to refuse it. A preflight rule that blocks a transaction which would have
succeeded is a dashboard that will not let someone pay their bill.

## Two contract facts the write layer has to carry

Found while building this, both invisible from the read layer.

**`processPayment` is payable but only checks `msg.value` on one branch.** `_settleManual` requires
`msg.value == amount` exactly for an ETH-settled agreement and `msg.value == 0` for a token-settled
one. The `Collateral`, `Auto` and `AutoWithCollateral` branches never read `msg.value` at all, so
ETH attached to one of those payments is accepted by the transaction and credited to nobody. It is
not refunded and there is no function that can retrieve it. A UI that attaches the installment
amount to every Pay button, which is the natural thing to write, silently destroys the buyer's money
on three of the four payment methods. `planPayInstallment` therefore computes `value` from the
settlement currency and the payment method together, and emits exactly `0n` everywhere except
ETH-settled Manual.

**A Manual payment may be sent by anyone.** `_settleManual` pulls ETH from `msg.value` and tokens
from `msg.sender`; there is no check that the caller is the buyer. A third party can pay someone
else's installment, and the non-Manual methods are permissionless by design, so a seller can push a
`Collateral` payment through themselves. The planner allows all of this and reports it as
`payerIsNotBuyer` rather than refusing, because refusing would be the write layer inventing a rule
the protocol does not have. The UI decides whether to confirm it.

## Consequence: the roadmap item asks for a flow the contract does not have

Part c lists "deposit and withdraw collateral". **RelicPay has no collateral withdrawal function.**
`depositETHCollateral` and `depositERC20Collateral` exist with no counterpart. `Bnpl.sol` has
`withdrawCollateral(agreementId)` and `EnhancedBnpl.sol` has
`withdrawCollateral(positionId, amount)`, but RelicPay, the contract this dashboard reads, has
neither, and collateral only ever leaves it through a payment draw or a default seizure.

So collateral posted to RelicPay is returnable only by spending it. A buyer who over-collateralises,
or who completes every agreement, cannot get the remainder back. This is a protocol gap, not a
dashboard gap, and it is out of scope for a UI item: adding the function needs the v1 bug it would
reintroduce designed around first, since V1-BUG-2 in the spec is precisely
`EnhancedBnpl.withdrawCollateral` ignoring open credit, and v2's stated fix is to block withdrawal
below required backing. That fix has to exist in RelicPay before a button can call it.

Filed as its own roadmap item under Phase 2. Part c ships the seven write flows that do exist.

## Revisit if

The protocol gains a write whose effect is genuinely local to one stored field with nothing derived
from it, in which case an optimistic edit for that one action is arguable. Or if reload-at-receipt
proves too slow on a public network, in which case the next step is rendering the pending scope from
the receipt's own event log, which is still chain truth, and still not a guess.

---

# Addendum, part c2: wiring it into the app

Added 2026-09-19, when the write layer was attached to React. Three things the decision above did
not have to answer, because nothing had a viewer yet.

## The control surface is data, not JSX

The suite cannot render React. So a rule that lives in a component is a rule nothing checks, and
this page's rules are the kind worth checking: who may click a button, what the button says when it
is dead, whether a pending payment should grey out an unrelated agreement.

`dashboard/lib/panels.js` therefore computes the whole control surface as a value, and the
components render it. It takes the view, the connected wallet, the in-flight plans and the form
state, and returns every control with its disabled state, its reason, its fields and its steps. The
components hold form state and nothing else. `test/dashboard-panels.test.js` asserts on that value
against ganache, the same way the rest of `dashboard/lib` is proved.

## A dashboard can show any address, and most writes ignore it

This is the substantive finding of part c2, and it is a trap rather than a bug.

`setAutoPayment`, `depositAutoPaymentFunds`, `withdrawAutoPaymentFunds`, `depositETHCollateral`,
`depositERC20Collateral`, `withdrawSellerBalance` and `setSettlementPreference` all act on
`msg.sender`. None takes an account argument. The route, meanwhile, renders whatever address is in
the URL, which is the whole point of part b2: a dashboard is a link you can send someone.

Put those two together and every one of those buttons is live on a stranger's dashboard, correctly
encoded, operating on the connected wallet's own account. It does not revert. It succeeds against
numbers that are nowhere on screen, and then the reload re-renders the subject's unchanged figures,
which reads as a transaction that did nothing. A seller checking a buyer's page and clicking
Withdraw has withdrawn their own balance while looking at someone else's zero.

**Decision: an action that reads `msg.sender` is offered only when the connected wallet is the
subject of the page.** `SELF_SCOPED` in panels.js is that list. The three agreement actions are
deliberately not on it: `payInstallment` and `processOverduePayments` are permissionless by
construction and this ADR already decided to allow them with a note, and `triggerDefault` is already
refused to anyone but the seller. Those three name their agreement by id, so the page and the
transaction agree about the subject and there is nothing to protect anyone from.

## The pinned reload needs a way back

Rule 3 says reload at the receipt's block, and the `?at=` route is the mechanism. The consequence
only shows up once someone uses it twice: after a payment the URL names a fixed block, so the page
never advances again, and that URL is the one people bookmark or send to their seller. The reload
quietly converts a live dashboard into a snapshot of the instant they paid.

The header now renders "view the latest block" whenever the route carries a pin. Small, and the
mechanism is broken without it.

## Precedence among disabled reasons

Several reasons are true at once constantly. Showing the wrong one is not cosmetic: "waiting for
your transaction" on a button that will still be dead afterwards sends someone to watch a spinner
for a problem the spinner cannot fix. The order is most permanent first, and `DISABLED_PRECEDENCE`
records it: not connected, not your account, pending, needs input, then the planner's own rejection.
Pending outranks a rejection specifically because a rejection is computed from figures that are in
flight, which are the figures this ADR says not to trust.

## One bug in the write layer itself, found by feeding it a presented view

`autoBalanceOf` and `sellerBalanceOf` read their per-token balances out of an object keyed by
address, which is the reader's shape. `present.js` renders the same data as an array of
`{tokenAddress, balance}`. An array's keys are `'0'`, `'1'`, so the lookup missed and the balance
came back `null` — and `null` is the documented "the caller did not supply it" case, which skips the
check entirely and notes it.

So both token balance preflights were live in the suite, which mostly plans from reader output, and
silently absent in the browser, which is the only place a preflight is for. Fixed by accepting both
shapes in one `balanceLookup`, with a test that asserts the same figure comes back from both and
that the chain really does refuse the withdrawal the preflight now rejects.

The general lesson is the one part c1's own tests were reaching for: "both view shapes are accepted"
has to be asserted per function, not per module.
