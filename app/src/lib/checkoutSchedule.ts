import { quote } from "../../../packages/checkout/src";
import { IBG_MERCHANT } from "./constants";

const SECONDS_PER_DAY = 86_400;

// Presentation adapter only: the SDK owns installment amounts and due offsets.
export function checkoutSchedule(
  product: { id: string; price_usdc: number },
  plan: { count: number; interval_days: number },
) {
  const { installments } = quote({
    totalPrice: BigInt(product.price_usdc),
    installmentCount: plan.count,
    intervalSeconds: plan.interval_days * SECONDS_PER_DAY,
    productId: product.id,
    merchantName: IBG_MERCHANT.name,
  });
  return installments.map(payment => ({
    amountUnits: Number(payment.amount),
    dueDay: payment.dueOffsetSeconds / SECONDS_PER_DAY,
  }));
}

export function checkoutAmount(amountUnits: number) {
  const approximate = amountUnits % 10_000 !== 0;
  return `${approximate ? "≈" : ""}$${(amountUnits / 1_000_000).toFixed(2)}`;
}
