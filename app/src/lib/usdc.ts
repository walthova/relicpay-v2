const USDC_DECIMALS = 6;
const MAX_U64 = 18_446_744_073_709_551_615n;

export function validateUsdcUnits(units: number): number {
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new Error("This product has an invalid USDC price.");
  }
  return units;
}

export function parseUsdcAmount(amount: string): bigint {
  const value = amount.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    throw new Error("Enter a positive USDC amount.");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > USDC_DECIMALS) {
    throw new Error("Enter a USDC amount with up to 6 decimal places.");
  }
  const units = BigInt(whole + fraction.padEnd(USDC_DECIMALS, "0"));
  if (units === 0n) {
    throw new Error("Enter a positive USDC amount.");
  }
  if (units > MAX_U64) {
    throw new Error("USDC amount is too large.");
  }
  return units;
}
