import { assert } from "chai";
import { checkoutAmount, checkoutSchedule } from "../app/src/lib/checkoutSchedule";
import { IBG_MERCHANT, INSTALLMENT_OPTIONS } from "../app/src/lib/constants";
import { quote } from "../packages/checkout/src";

describe("checkout payment summary", () => {
  for (const product of IBG_MERCHANT.products) {
    for (const option of INSTALLMENT_OPTIONS) {
      it(`matches the protocol quote for ${product.name}, ${option.label}`, () => {
        const totalUnits = product.price_usdc;
        const count = option.count;
        const intervalDays = option.interval_days;
        const schedule = checkoutSchedule(product, option);
        const expected = quote({
          totalPrice: BigInt(totalUnits),
          installmentCount: count,
          intervalSeconds: intervalDays * 86_400,
          productId: product.id,
          merchantName: IBG_MERCHANT.name,
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
    const schedule = checkoutSchedule(
      { id: "rounding", price_usdc: 500_000_000 },
      { count: 3, interval_days: 30 },
    );
    assert.deepEqual(schedule.map(payment => payment.amountUnits), [166_666_666, 166_666_666, 166_666_668]);
    assert.equal(checkoutAmount(schedule[0].amountUnits), "≈$166.67");
    assert.equal(checkoutAmount(schedule[2].amountUnits), "≈$166.67");
    assert.equal(checkoutAmount(500_000_000), "$500.00");
    assert.equal(checkoutAmount(75_000_000), "$75.00");
  });
});
