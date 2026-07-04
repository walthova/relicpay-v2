"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useRelicPay } from "../hooks/useRelicPay";
import { IBG_MERCHANT, INSTALLMENT_OPTIONS } from "../lib/constants";

interface Product {
  id: string;
  name: string;
  description: string;
  price_usdc: number;
  image: string;
}

export function BuyNowPayLater({ product }: { product: Product }) {
  const { connected, publicKey } = useWallet();
  const { createAgreement } = useRelicPay();
  const [selectedOption, setSelectedOption] = useState(INSTALLMENT_OPTIONS[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ tx: string; agreementPda: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const priceUsd = product.price_usdc / 1_000_000;
  const installmentUsd = priceUsd / selectedOption.count;

  const handleBuy = async () => {
    if (!connected) return;
    setLoading(true);
    setError(null);

    try {
      const res = await createAgreement({
        merchantWallet: IBG_MERCHANT.wallet,
        productId: product.id,
        merchantName: IBG_MERCHANT.name,
        totalPriceUsdc: priceUsd,
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
      <div className="relic-pay-success">
        <div className="success-icon">✓</div>
        <h3>You're a steward now.</h3>
        <p>First payment of <strong>${installmentUsd.toFixed(2)} USDC</strong> sent.</p>
        <p className="muted">
          {selectedOption.count - 1} more payment{selectedOption.count - 1 > 1 ? "s" : ""} of ${installmentUsd.toFixed(2)} every {selectedOption.interval_days} days.
        </p>
        <a
          href={`https://solscan.io/tx/${result.tx}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="tx-link"
        >
          View on Solscan →
        </a>
      </div>
    );
  }

  return (
    <div className="relic-pay-widget">
      <div className="product-header">
        <h2>{product.name}</h2>
        <p className="product-description">{product.description}</p>
        <p className="total-price">${priceUsd.toFixed(2)} USDC</p>
      </div>

      <div className="installment-selector">
        <p className="selector-label">Choose your plan:</p>
        <div className="options">
          {INSTALLMENT_OPTIONS.map((option) => (
            <button
              key={option.count}
              className={`option-btn ${selectedOption.count === option.count ? "selected" : ""}`}
              onClick={() => setSelectedOption(option)}
            >
              <span className="option-label">{option.label}</span>
              <span className="option-amount">
                ${(priceUsd / option.count).toFixed(2)}/mo
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="payment-breakdown">
        <div className="breakdown-row">
          <span>Pay today</span>
          <strong>${installmentUsd.toFixed(2)} USDC</strong>
        </div>
        <div className="breakdown-row muted">
          <span>Then {selectedOption.count - 1}x ${installmentUsd.toFixed(2)}</span>
          <span>every {selectedOption.interval_days} days</span>
        </div>
        <div className="breakdown-row total">
          <span>Total</span>
          <strong>${priceUsd.toFixed(2)} USDC</strong>
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}

      {connected ? (
        <button
          className="buy-btn"
          onClick={handleBuy}
          disabled={loading}
        >
          {loading ? "Processing..." : `Pay $${installmentUsd.toFixed(2)} USDC now →`}
        </button>
      ) : (
        <div className="wallet-connect">
          <p className="connect-prompt">Connect your wallet to get started</p>
          <WalletMultiButton />
        </div>
      )}

      <p className="powered-by">
        Powered by <strong>Relic Pay</strong> — decentralized BNPL on Solana
      </p>
    </div>
  );
}
