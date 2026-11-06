import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";
import {
  getMerchantDashboard,
  toDashboardView,
  MerchantDashboardView,
} from "../../../packages/checkout/src";
import idl from "../lib/relicpay.json";

// Same SSR guard as the buyer page: wallet adapters must not run on the server.
const ConnectionProvider = dynamic(
  () => import("@solana/wallet-adapter-react").then((m) => m.ConnectionProvider),
  { ssr: false }
);
const WalletProvider = dynamic(
  () => import("@solana/wallet-adapter-react").then((m) => m.WalletProvider),
  { ssr: false }
);
const WalletModalProvider = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletModalProvider),
  { ssr: false }
);
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

require("@solana/wallet-adapter-react-ui/styles.css");

const TONE_COLOR: Record<string, string> = {
  ok: "#16a34a",
  due: "#ca8a04",
  overdue: "#ea580c",
  danger: "#dc2626",
  done: "#6b7280",
};

const ACTION_COPY: Record<string, string> = {
  withdraw: "Withdraw payout",
  default: "Trigger default",
};

function MerchantDashboard() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [view, setView] = useState<MerchantDashboardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!wallet.publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
      const program = new Program(idl as any, provider);
      const { rows, summary } = await getMerchantDashboard(program, wallet.publicKey);
      setView(toDashboardView(rows, summary));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load agreements");
    } finally {
      setLoading(false);
    }
  }, [connection, wallet.publicKey]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      <p style={{ textTransform: "uppercase", letterSpacing: 1, fontSize: 12, opacity: 0.7 }}>Relic Pay / Merchant</p>
      <h1>Merchant dashboard</h1>
      <p>Connect the merchant payout wallet to see its agreements, expected payouts, and default exposure.</p>
      <WalletMultiButton />

      {!wallet.publicKey && <p style={{ marginTop: 24 }}>Wallet not connected.</p>}
      {loading && <p style={{ marginTop: 24 }}>Loading agreements...</p>}
      {error && <p role="alert" style={{ marginTop: 24, color: "#dc2626" }}>{error}</p>}

      {view && (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, margin: "24px 0" }}>
            {view.headline.map((h) => (
              <div key={h.label} style={{ border: "1px solid #3f3f46", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{h.label}</div>
                <strong style={{ fontSize: 22 }}>{h.value}</strong>
              </div>
            ))}
          </section>

          {view.rows.length === 0 ? (
            <p>No agreements for this wallet yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th>Product</th>
                  <th>Buyer</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Owed (USDC)</th>
                  <th>Next due</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.address} style={{ borderTop: "1px solid #3f3f46" }}>
                    <td>{r.productId}</td>
                    <td title={r.buyer}>{r.buyer.slice(0, 4)}...{r.buyer.slice(-4)}</td>
                    <td style={{ color: TONE_COLOR[r.tone] }}>{r.label}</td>
                    <td>{r.progress}</td>
                    <td>{r.owed}</td>
                    <td>{r.nextDueAt ? new Date(r.nextDueAt * 1000).toLocaleDateString() : "none"}</td>
                    <td>{r.action !== "none" ? <em title="Transaction actions land in the next increment">{ACTION_COPY[r.action]} (soon)</em> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button onClick={load} style={{ marginTop: 16 }}>Refresh</button>
        </>
      )}
    </main>
  );
}

export default function MerchantPage() {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl(WalletAdapterNetwork.Devnet),
    []
  );
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <MerchantDashboard />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
