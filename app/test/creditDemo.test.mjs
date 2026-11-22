import assert from "node:assert/strict";
import test from "node:test";
import { getBalances, initialDemo, reduceDemo } from "../src/lib/creditDemo.ts";

const open = (demo = initialDemo()) => reduceDemo(demo, { type: "open" });
const buy = (demo, agent = "atlas") => reduceDemo(demo, { type: "attempt", agent });
const repay = (demo) => reduceDemo(demo, { type: "repay" });

test("opening the line locks collateral without paying the merchant", () => {
  assert.deepEqual(getBalances(open()), {
    collateral: 500, available: 400, merchantPaid: 0, paid: 0, outstanding: 0, day: 0,
  });
  const initial = initialDemo();
  assert.equal(buy(initial), initial);
});

test("an allowed draw pays the merchant immediately without spending collateral", () => {
  const funded = buy(open());
  assert.deepEqual(getBalances(funded), {
    collateral: 500, available: 220, merchantPaid: 180, paid: 0, outstanding: 180, day: 0,
  });
  assert.equal(buy(funded), funded);
});

test("merchant and cap rules block a draw without moving funds", () => {
  const demo = open(reduceDemo(initialDemo(), { type: "set-cap", cap: 120 }));
  const wrongMerchant = buy(demo, "nova");
  assert.match(wrongMerchant.events.at(-1).detail, /merchant list/);
  const tooLarge = buy(wrongMerchant);
  assert.match(tooLarge.events.at(-1).detail, /spending cap/);
  assert.deepEqual(getBalances(tooLarge), getBalances(demo));
});

test("revoking one agent does not revoke the other or unwind a draw", () => {
  const demo = reduceDemo(open(), { type: "revoke", agent: "nova" });
  assert.equal(buy(demo, "nova").events.at(-1).tone, "blocked");
  const funded = buy(demo);
  const revoked = reduceDemo(funded, { type: "revoke", agent: "atlas" });
  assert.deepEqual(getBalances(revoked), getBalances(funded));
  assert.equal(getBalances(repay(revoked)).outstanding, 120);
});

test("an expired mandate blocks payment without drawing credit", () => {
  const expired = reduceDemo(open(), { type: "advance" });
  const blocked = buy(expired);
  assert.match(blocked.events.at(-1).detail, /spending window/);
  assert.deepEqual(getBalances(blocked), getBalances(expired));
});

test("repayments restore credit over three installments without paying the merchant twice", () => {
  const first = repay(buy(open()));
  assert.deepEqual(getBalances(first), {
    collateral: 500, available: 280, merchantPaid: 180, paid: 60, outstanding: 120, day: 30,
  });
  const complete = repay(repay(first));
  assert.deepEqual(getBalances(complete), {
    collateral: 500, available: 400, merchantPaid: 180, paid: 180, outstanding: 0, day: 90,
  });
  assert.equal(repay(complete), complete);
  assert.deepEqual(reduceDemo(complete, { type: "reset" }), initialDemo());
});
