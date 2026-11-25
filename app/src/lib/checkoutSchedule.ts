// Match create_agreement / pay_installment: the first payment is immediate,
// later payments use their 1-based installment number, and the last takes dust.
export function checkoutSchedule(totalUnits: number, count: number, intervalDays: number) {
  const installmentUnits = Math.floor(totalUnits / count);
  return Array.from({ length: count }, (_, index) => ({
    amountUnits: index === count - 1
      ? totalUnits - installmentUnits * (count - 1)
      : installmentUnits,
    dueDay: index === 0 ? 0 : (index + 1) * intervalDays,
  }));
}

export function checkoutAmount(amountUnits: number) {
  const approximate = amountUnits % 10_000 !== 0;
  return `${approximate ? "≈" : ""}$${(amountUnits / 1_000_000).toFixed(2)}`;
}
