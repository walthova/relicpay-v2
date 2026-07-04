"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { UserStakeView } from "../hooks/useStakePool";

interface Props {
  stake: UserStakeView | null;
  loading?: boolean;
}

function maskWallet(addr: string): string {
  if (!addr) return "•••• •••• •••• ••••";
  const compact = addr.replace(/[^A-Za-z0-9]/g, "");
  const last4 = compact.slice(-4).toUpperCase();
  return `•••• •••• •••• ${last4}`;
}

function formatUsdc(units: number, decimals = 2): string {
  return (units / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function VirtualCard({ stake, loading }: Props) {
  const { publicKey } = useWallet();
  const [tickYield, setTickYield] = useState(0);

  // Force a re-render every second so the live yield ticks visibly
  useEffect(() => {
    if (!stake) return;
    const id = setInterval(() => setTickYield((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [stake]);

  const tier = stake?.tier;
  const stakedUsd = stake?.stakedUsd ?? 0;
  const totalYieldUsd = (stake?.totalYieldUnits ?? 0) / 1_000_000;

  // Recompute live yield each tick
  let liveYield = stake?.totalYieldUnits ?? 0;
  if (stake) {
    const elapsedSec = Math.max(0, Math.floor(Date.now() / 1000) - stake.lastUpdate);
    const live = Math.floor((stake.stakedUnits * 300 * elapsedSec) / (10_000 * 31_536_000));
    liveYield = stake.yieldAccruedUnits + live;
  }

  const purchasingPower = stakedUsd + (tier ? (stakedUsd * tier.discount_bps) / 10_000 : 0);
  const isActive = !!stake && stake.stakedUnits > 0;

  return (
    <div className={`virtual-card ${isActive ? "active" : "inactive"}`}>
      <div className="card-shimmer" />
      <div className="card-top">
        <div className="card-brand">
          <span className="card-logo">◈</span>
          <span className="card-brand-text">RELIC PAY</span>
        </div>
        {tier && (
          <div className="tier-badge" style={{ borderColor: tier.color, color: tier.color }}>
            {tier.name.toUpperCase()}
          </div>
        )}
      </div>

      <div className="card-number">
        {publicKey ? maskWallet(publicKey.toBase58()) : "•••• •••• •••• ••••"}
      </div>

      <div className="card-stats">
        <div className="card-stat">
          <span className="stat-label">Staked</span>
          <span className="stat-value">${formatUsdc(stake?.stakedUnits ?? 0)}</span>
        </div>
        <div className="card-stat">
          <span className="stat-label">Yield earned</span>
          <span className="stat-value yield-pulse">
            +${formatUsdc(liveYield, 6)}
          </span>
        </div>
        <div className="card-stat">
          <span className="stat-label">Discount</span>
          <span className="stat-value">
            {tier ? (tier.discount_bps / 100).toFixed(1) : "0.0"}%
          </span>
        </div>
      </div>

      <div className="card-bottom">
        <div className="card-power">
          <span className="power-label">Purchasing power</span>
          <span className="power-value">${purchasingPower.toFixed(2)}</span>
        </div>
        <div className="card-network">
          <span>SOLANA · DEVNET</span>
        </div>
      </div>

      {loading && <div className="card-loading-overlay">Updating…</div>}

      <style jsx>{`
        .virtual-card {
          position: relative;
          width: 100%;
          max-width: 420px;
          aspect-ratio: 1.586 / 1;
          padding: 24px;
          border-radius: 18px;
          color: #fff;
          background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%);
          box-shadow: 0 30px 60px -20px rgba(49, 46, 129, 0.45);
          overflow: hidden;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          transition: box-shadow 0.4s ease, transform 0.4s ease;
        }
        .virtual-card.active {
          box-shadow:
            0 30px 60px -20px rgba(34, 197, 94, 0.35),
            0 0 0 1px rgba(34, 197, 94, 0.4);
        }
        .card-shimmer {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            circle at 20% 0%,
            rgba(99, 102, 241, 0.35),
            transparent 40%
          );
          pointer-events: none;
        }
        .card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: relative;
          z-index: 1;
        }
        .card-brand {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .card-logo {
          font-size: 1.5rem;
          color: #c4b5fd;
        }
        .card-brand-text {
          font-weight: 700;
          letter-spacing: 0.2em;
          font-size: 0.85rem;
        }
        .tier-badge {
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid;
          font-size: 0.7rem;
          letter-spacing: 0.15em;
          font-weight: 700;
        }
        .card-number {
          margin-top: 22px;
          letter-spacing: 0.18em;
          font-size: 1.1rem;
          color: #e0e7ff;
          position: relative;
          z-index: 1;
        }
        .card-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-top: 18px;
          position: relative;
          z-index: 1;
        }
        .card-stat {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .stat-label {
          font-size: 0.65rem;
          letter-spacing: 0.12em;
          color: #a5b4fc;
          text-transform: uppercase;
        }
        .stat-value {
          font-size: 1rem;
          font-weight: 600;
        }
        .yield-pulse {
          color: #4ade80;
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.65; }
        }
        .card-bottom {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          margin-top: 14px;
          position: relative;
          z-index: 1;
        }
        .card-power {
          display: flex;
          flex-direction: column;
        }
        .power-label {
          font-size: 0.65rem;
          letter-spacing: 0.12em;
          color: #a5b4fc;
          text-transform: uppercase;
        }
        .power-value {
          font-size: 1.4rem;
          font-weight: 700;
          color: #fff;
        }
        .card-network {
          font-size: 0.65rem;
          letter-spacing: 0.18em;
          color: #c4b5fd;
        }
        .card-loading-overlay {
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.85rem;
          letter-spacing: 0.1em;
        }
      `}</style>
    </div>
  );
}
