import { assert } from "chai";
import { checkoutAmount, checkoutSchedule } from "../app/src/lib/checkoutSchedule";
import { quote } from "../packages/checkout/src";

describe("checkout payment summary", () => {
  for (const totalUnits of [300_000_000, 500_000_000]) {
    for (const [count, intervalDays] of [[3, 30], [4, 14]]) {
      it(`matches the protocol quote for ${totalUnits / 1_000_000} USDC in ${count}`, () => {
        const schedule = checkoutSchedule(totalUnits, count, intervalDays);
        const expected = quote({
          totalPrice: BigInt(totalUnits),
          installmentCount: count,
          intervalSeconds: intervalDays * 86_400,
          productId: "checkout-summary",
          merchantName: "IBG Collection",
        });
        assert.deepEqual(schedule.map(payment => BigInt(payment.amountUnits)),
          expected.installments.map(payment => payment.amount));
        assert.deepEqual(schedule.map(payment => payment.dueDay * 86_400),
          expected.installments.map(payment => payment.dueOffsetSeconds));
        assert.equal(schedule.reduce((sum, payment) => sum + payment.amountUnits, 0), totalUnits);
      });
    }
  }

  it("labels cent-rounded amounts as approximate instead of implying a larger total", () => {
    const schedule = checkoutSchedule(500_000_000, 3, 30);
    assert.deepEqual(schedule.map(payment => payment.amountUnits), [166_666_666, 166_666_666, 166_666_668]);
    assert.equal(checkoutAmount(schedule[0].amountUnits), "≈$166.67");
    assert.equal(checkoutAmount(schedule[2].amountUnits), "≈$166.67");
    assert.equal(checkoutAmount(500_000_000), "$500.00");
    assert.equal(checkoutAmount(75_000_000), "$75.00");
  });
});
