import { strict as assert } from "node:assert";
import { parseUsdcAmount, validateUsdcUnits } from "../app/src/lib/usdc";

describe("app USDC amounts", () => {
  it("keeps the checkout catalog price in raw units without a decimal round trip", () => {
    assert.equal(validateUsdcUnits(1_000_001), 1_000_001);
    assert.equal(validateUsdcUnits(300_000_000), 300_000_000);
  });

  it("rejects a fractional, zero, or unsafe catalog price", () => {
    for (const price of [1_123_456.7, 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => validateUsdcUnits(price), /invalid USDC price/);
    }
  });

  it("preserves every supported decimal digit in a stake amount", () => {
    for (const [amount, units] of [
      ["1.000001", "1000001"],
      ["0.000001", "1"],
      [".5", "500000"],
      ["50", "50000000"],
      ["50.", "50000000"],
    ]) {
      assert.equal(parseUsdcAmount(amount), BigInt(units), amount);
    }
  });

  it("rejects excess precision instead of truncating or sending zero", () => {
    for (const amount of ["1.1234567", "0.0000001"]) {
      assert.throws(() => parseUsdcAmount(amount), /up to 6 decimal places/);
    }
  });

  it("rejects zero, negatives and non-decimal input", () => {
    for (const amount of ["0", "0.000000", "", ".", "-1", "1e-6", "1abc", "1.2.3"]) {
      assert.throws(() => parseUsdcAmount(amount), /Enter a positive USDC amount/);
    }
  });

  it("converts exactly up to the u64 limit and rejects overflow", () => {
    assert.equal(parseUsdcAmount("18446744073709.551615"), BigInt("18446744073709551615"));
    assert.throws(() => parseUsdcAmount("18446744073709.551616"), /too large/);
  });
});
