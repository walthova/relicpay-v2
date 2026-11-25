"use client";

import { useId, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useRelicPay } from "../hooks/useRelicPay";
import { IBG_MERCHANT, INSTALLMENT_OPTIONS, getMerchantWallet } from "../lib/constants";
import { checkoutAmount, checkoutSchedule } from "../lib/checkoutSchedule";
import styles from "./BuyNowPayLater.module.css";

interface Product {
  id: string;
  name: string;
  description: string;
  price_usdc: number;
  image: string;
}

export function BuyNowPayLater({ product }: { product: Product }) {
  const { connected } = useWallet();
  const planId = useId();
  const { createAgreement } = useRelicPay();
  const [selectedOption, setSelectedOption] = useState(INSTALLMENT_OPTIONS[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ tx: string; agreementPda: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schedule = checkoutSchedule(product.price_usdc, selectedOption.count, selectedOption.interval_days);
  const payToday = checkoutAmount(schedule[0].amountUnits);
  const roundedAmounts = schedule.some(payment => payment.amountUnits % 10_000 !== 0);

  const handleBuy = async () => {
    if (!connected) return;
    setLoading(true);
    setError(null);

    try {
      const res = await createAgreement({
        merchantWallet: getMerchantWallet().toBase58(),
        productId: product.id,
        merchantName: IBG_MERCHANT.name,
        totalPriceUnits: product.price_usdc,
        installmentCount: selectedOption.count,
        intervalDays: selectedOption.interval_days,
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className={styles.success}>
        <div className={styles.successIcon} aria-hidden="true">✓</div>
        <h3>You're a steward now.</h3>
        <p>First payment of <strong>{payToday} USDC</strong> sent.</p>
        <p className={styles.description}>
          Remaining payments are due on days {schedule.slice(1).map(payment => payment.dueDay).join(", ")} after purchase.
        </p>
        <a
          href={`https://solscan.io/tx/${result.tx}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.txLink}
        >
          View on Solscan →
        </a>
      </div>
    );
  }

  return (
    <div className={styles.widget}>
      <div className={styles.productHeader}>
        <p className={styles.eyebrow}>IBG Collection <span> / Checkout</span></p>
        <h3>{product.name}</h3>
        <p className={styles.description}>{product.description}</p>
      </div>

      <fieldset className={styles.selector} disabled={loading}>
        <legend>Choose your plan<span className={styles.srOnly}> for {product.name}</span></legend>
        <div className={styles.options}>
          {INSTALLMENT_OPTIONS.map((option) => {
            const optionSchedule = checkoutSchedule(product.price_usdc, option.count, option.interval_days);
            const amount = optionSchedule[0].amountUnits;
            const nextDueDay = optionSchedule[1].dueDay;
            return (
              <label key={option.count} className={`${styles.option} ${selectedOption.count === option.count ? styles.selected : ""}`}>
                <span className={styles.optionHeading}>
                  <span>{option.label}</span>
                  <input
                    type="radio"
                    name={planId}
                    value={option.count}
                    checked={selectedOption.count === option.count}
                    onChange={() => setSelectedOption(option)}
                    aria-label={`${option.label}, ${checkoutAmount(amount)} USDC per payment, next on day ${nextDueDay}, then every ${option.interval_days} days`}
                  />
                </span>
                <span className={styles.optionAmount}>{checkoutAmount(amount)}</span>
                <span className={styles.optionCurrency}>USDC per payment</span>
                <span className={styles.optionInterval}>
                  Next on day {nextDueDay}
                  <span>Then every {option.interval_days} days</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className={styles.summary} aria-live="polite" aria-atomic="true">
        <div className={styles.summaryHeading}>
          <h4>Payment schedule</h4>
          <span>USDC</span>
        </div>
        <dl className={styles.breakdown}>
          {schedule.map((payment, index) => (
            <div key={payment.dueDay} className={index === 0 ? styles.today : styles.paymentRow}>
              <dt>{index === 0 ? "Pay today" : `Day ${payment.dueDay}`}</dt>
              <dd>{checkoutAmount(payment.amountUnits)}</dd>
            </div>
          ))}
          <div className={styles.total}>
            <dt>Total price</dt>
            <dd>{checkoutAmount(product.price_usdc)}</dd>
          </div>
        </dl>
        <p className={styles.scheduleNote}>Days shown are after purchase.{roundedAmounts && " ≈ Rounded to cents; final payment includes any remainder."}</p>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {connected ? (
        <button
          className={styles.buyButton}
          onClick={handleBuy}
          disabled={loading}
        >
          {loading ? "Processing..." : `Pay ${payToday} USDC now →`}
        </button>
      ) : (
        <div className={styles.walletConnect}>
          <p>Connect your wallet to start your plan.</p>
          <WalletMultiButton />
        </div>
      )}

      <p className={styles.poweredBy}>
        Powered by <strong>Relic Pay</strong><span aria-hidden="true"> · </span>Payments on Solana
      </p>
    </div>
  );
}
