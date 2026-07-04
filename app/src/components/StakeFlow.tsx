"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useStakePool, UserStakeView } from "../hooks/useStakePool";
import { TIERS, nextTier } from "../lib/constants";

interface Props {
  stake: UserStakeView | null;
  onAfterTx: () => void;
}

const QUICK_AMOUNTS = [10, 50, 200, 500];

export function StakeFlow({ stake, onAfterTx }: Props) {
  const { connected } = useWallet();
  const { stakeUsdc, unstakeUsdc } = useStakePool();
  const [amount, setAmount] = useState<string>("50");
  const [busy, setBusy] = useState<"stake" | "unstake" | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentTier = stake?.tier ?? TIERS[0];
  const next = nextTier(currentTier.level);
  const stakedUsd = stake?.stakedUsd ?? 0;

  const progressPct = (() => {
    if (!next) return 100;
    const span = next.threshold_usdc - currentTier.threshold_usdc;
    const filled = stakedUsd - currentTier.threshold_usdc;
    return Math.max(0, Math.min(100, (filled / span) * 100));
  })();

  const handleStake = async () => {
    if (!connected) return;
    const usd = parseFloat(amount);
    if (!Number.isFinite(usd) || usd <= 0) {
      setError("Enter a positive USDC amount");
      return;
    }
    setError(null);
    setBusy("stake");
    setTx(null);
    try {
      const res = await stakeUsdc(usd);
      setTx(res.tx);
      onAfterTx();
    } catch (e: any) {
      setError(e?.message ?? "Stake failed");
    } finally {
      setBusy(null);
    }
  };

  const handleUnstake = async () => {
    if (!connected || !stake || stake.stakedUnits === 0) return;
    setError(null);
    setBusy("unstake");
    setTx(null);
    try {
      const res = await unstakeUsdc(0); // 0 = unstake all
      setTx(res.tx);
      onAfterTx();
    } catch (e: any) {
      setError(e?.message ?? "Unstake failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stake-flow">
      <div className="stake-header">
        <h2>Stake to unlock Relic Pay discounts</h2>
        <p>
          Your USDC sits in a yield-bearing escrow earning 3% APY. Your stake
          tier unlocks discounts on every purchase across the web —
          automatically applied via the Relic Pay extension.
        </p>
      </div>

      {!connected && (
        <div className="connect-card">
          <p>Connect Phantom (devnet) to stake</p>
          <WalletMultiButton />
        </div>
      )}

      {connected && (
        <>
          <div className="tier-progress">
            <div className="progress-labels">
              <div>
                <span className="progress-current">{currentTier.name}</span>
                <span className="progress-amount">${stakedUsd.toFixed(2)}</span>
              </div>
              {next && (
                <div className="progress-next">
                  <span>{next.name}</span>
                  <span className="next-threshold">${next.threshold_usdc}</span>
                </div>
              )}
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${progressPct}%`,
                  background: `linear-gradient(90deg, ${currentTier.color}, ${next?.color ?? currentTier.color})`,
                }}
              />
            </div>
            {next && (
              <p className="progress-hint">
                Stake ${(next.threshold_usdc - stakedUsd).toFixed(2)} more to unlock {next.name} ({(next.discount_bps / 100).toFixed(1)}% discount)
              </p>
            )}
            {!next && <p className="progress-hint">Max tier reached — top discount unlocked</p>}
          </div>

          <div className="stake-input">
            <label htmlFor="stake-amount">Stake amount (devnet USDC)</label>
            <div className="input-row">
              <span className="prefix">$</span>
              <input
                id="stake-amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy !== null}
              />
            </div>
            <div className="quick-amounts">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  className={`quick-btn ${parseFloat(amount) === q ? "active" : ""}`}
                  onClick={() => setAmount(String(q))}
                  disabled={busy !== null}
                >
                  ${q}
                </button>
              ))}
            </div>
          </div>

          <div className="action-row">
            <button
              className="stake-btn primary"
              onClick={handleStake}
              disabled={busy !== null}
            >
              {busy === "stake" ? "Staking…" : `Stake $${amount}`}
            </button>
            <button
              className="stake-btn secondary"
              onClick={handleUnstake}
              disabled={busy !== null || !stake || stake.stakedUnits === 0}
            >
              {busy === "unstake" ? "Unstaking…" : "Unstake all"}
            </button>
          </div>

          <p className="airdrop-hint">
            Need devnet USDC? Visit{" "}
            <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
              faucet.circle.com
            </a>{" "}
            and select Solana Devnet.
          </p>

          {error && <p className="error-msg">{error}</p>}
          {tx && (
            <a
              href={`https://solscan.io/tx/${tx}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="tx-link"
            >
              View transaction on Solscan →
            </a>
          )}
        </>
      )}

      <style jsx>{`
        .stake-flow {
          background: rgba(15, 23, 42, 0.65);
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 18px;
          padding: 28px;
          color: #e2e8f0;
          max-width: 480px;
          width: 100%;
        }
        .stake-header h2 {
          margin: 0 0 8px;
          font-size: 1.35rem;
          letter-spacing: -0.01em;
        }
        .stake-header p {
          margin: 0;
          font-size: 0.92rem;
          color: #94a3b8;
          line-height: 1.5;
        }
        .connect-card {
          margin-top: 24px;
          padding: 24px;
          border-radius: 12px;
          background: rgba(99, 102, 241, 0.08);
          border: 1px dashed rgba(165, 180, 252, 0.3);
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
        }
        .tier-progress {
          margin-top: 24px;
        }
        .progress-labels {
          display: flex;
          justify-content: space-between;
          font-size: 0.85rem;
          margin-bottom: 8px;
        }
        .progress-current {
          font-weight: 700;
          letter-spacing: 0.05em;
          margin-right: 8px;
        }
        .progress-amount {
          color: #a5b4fc;
        }
        .progress-next {
          text-align: right;
          color: #94a3b8;
          display: flex;
          flex-direction: column;
        }
        .next-threshold {
          font-size: 0.75rem;
          opacity: 0.7;
        }
        .progress-bar {
          height: 10px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.18);
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          transition: width 0.5s ease;
        }
        .progress-hint {
          margin-top: 8px;
          font-size: 0.8rem;
          color: #cbd5e1;
        }
        .stake-input {
          margin-top: 22px;
        }
        .stake-input label {
          display: block;
          font-size: 0.78rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #94a3b8;
          margin-bottom: 6px;
        }
        .input-row {
          display: flex;
          align-items: center;
          background: rgba(15, 23, 42, 0.85);
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 10px;
          padding: 0 14px;
        }
        .input-row .prefix {
          color: #a5b4fc;
          font-weight: 600;
          margin-right: 6px;
        }
        .input-row input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: #fff;
          font-size: 1.2rem;
          padding: 12px 0;
          font-variant-numeric: tabular-nums;
        }
        .quick-amounts {
          display: flex;
          gap: 8px;
          margin-top: 10px;
        }
        .quick-btn {
          flex: 1;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(99, 102, 241, 0.08);
          border: 1px solid rgba(165, 180, 252, 0.18);
          color: #c7d2fe;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .quick-btn:hover { background: rgba(99, 102, 241, 0.18); }
        .quick-btn.active {
          background: rgba(99, 102, 241, 0.25);
          border-color: rgba(165, 180, 252, 0.5);
          color: #fff;
        }
        .action-row {
          display: flex;
          gap: 12px;
          margin-top: 20px;
        }
        .stake-btn {
          flex: 1;
          padding: 14px;
          border-radius: 10px;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          transition: transform 0.15s ease, opacity 0.15s ease;
        }
        .stake-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .stake-btn:not(:disabled):hover { transform: translateY(-1px); }
        .stake-btn.primary {
          background: linear-gradient(135deg, #6366f1, #4f46e5);
          color: white;
          border: none;
        }
        .stake-btn.secondary {
          background: transparent;
          color: #cbd5e1;
          border: 1px solid rgba(148, 163, 184, 0.3);
        }
        .airdrop-hint {
          margin-top: 14px;
          font-size: 0.82rem;
          color: #94a3b8;
        }
        .airdrop-hint a {
          color: #a5b4fc;
          text-decoration: none;
        }
        .airdrop-hint a:hover { text-decoration: underline; }
        .error-msg {
          margin-top: 12px;
          padding: 10px 12px;
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(248, 113, 113, 0.3);
          border-radius: 8px;
          color: #fca5a5;
          font-size: 0.85rem;
        }
        .tx-link {
          display: inline-block;
          margin-top: 12px;
          color: #4ade80;
          font-size: 0.85rem;
          text-decoration: none;
        }
      `}</style>
    </div>
  );
}
