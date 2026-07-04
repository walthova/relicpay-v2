import { useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";

// Dynamic imports prevent Ledger/Solana wallet adapters from running during SSR
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
const BuyNowPayLater = dynamic(
  () => import("../components/BuyNowPayLater").then((m) => m.BuyNowPayLater),
  { ssr: false }
);
const VirtualCard = dynamic(
  () => import("../components/VirtualCard").then((m) => m.VirtualCard),
  { ssr: false }
);
const StakeFlow = dynamic(
  () => import("../components/StakeFlow").then((m) => m.StakeFlow),
  { ssr: false }
);

import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";
import { useStakePool } from "../hooks/useStakePool";
import { IBG_MERCHANT } from "../lib/constants";

require("@solana/wallet-adapter-react-ui/styles.css");

function DashboardContent() {
  const { getUserStake } = useStakePool();
  const [stake, setStake] = useState(null);
  const [stakeLoading, setStakeLoading] = useState(false);

  const fetchStake = useCallback(async () => {
    setStakeLoading(true);
    try {
      const s = await getUserStake();
      setStake(s);
    } catch (e) {
      console.error("Failed to fetch stake:", e);
    } finally {
      setStakeLoading(false);
    }
  }, [getUserStake]);

  // Poll on mount
  useMemo(() => {
    fetchStake();
    const id = setInterval(fetchStake, 5000);
    return () => clearInterval(id);
  }, [fetchStake]);

  return (
    <main className="main">
      <header className="header">
        <div className="logo">Relic Pay</div>
        <p className="tagline">
          Yield-bearing BNPL. Stake to unlock discounts across the web.
        </p>
      </header>

      <section className="dashboard">
        <div className="dashboard-row">
          <VirtualCard stake={stake} loading={stakeLoading} />
          <StakeFlow stake={stake} onAfterTx={fetchStake} />
        </div>
      </section>

      <section className="products-section">
        <h2>Buy with Relic Pay</h2>
        <p className="products-intro">
          Complete a BNPL agreement on any IBG Collection piece. Your staked collateral earns yield while you pay.
        </p>
        <div className="products">
          {IBG_MERCHANT.products.map((product) => (
            <div key={product.id} className="product-card">
              <div className="product-image-placeholder">
                <span>Optic Relic</span>
              </div>
              <BuyNowPayLater product={product} />
            </div>
          ))}
        </div>
      </section>

      <section className="how-it-works">
        <h2>How Relic Pay Works</h2>
        <div className="steps">
          <div className="step">
            <span className="step-num">1</span>
            <h3>Stake USDC</h3>
            <p>Deposit USDC into our yield pool. Earn 3% APY while staking.</p>
          </div>
          <div className="step">
            <span className="step-num">2</span>
            <h3>Unlock Tiers</h3>
            <p>Each tier unlocks greater discounts. Stake $500+ for max 3% off.</p>
          </div>
          <div className="step">
            <span className="step-num">3</span>
            <h3>Shop with Extension</h3>
            <p>Install the Relic Pay extension. See your discount on any e-commerce site.</p>
          </div>
          <div className="step">
            <span className="step-num">4</span>
            <h3>Buy with BNPL</h3>
            <p>Split purchases into 3–4 installments. Escrow earns yield for you.</p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <p>Built on <strong>Solana</strong> · Payments in <strong>USDC</strong> (Circle) · Open source</p>
        <p className="mission">
          Relic Pay exists to give underrepresented communities access to buying power —
          without banks, without credit scores, without exploitation.
        </p>
      </footer>
    </main>
  );
}

export default function Home() {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets = useMemo(() => {
    if (typeof window === "undefined") return [];
    // Import PhantomWalletAdapter only on client side to avoid SSR issues
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PhantomWalletAdapter } = require("@solana/wallet-adapter-phantom");
    return [new PhantomWalletAdapter()];
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <DashboardContent />
          <style jsx global>{`
            body, html {
              margin: 0;
              padding: 0;
              background: #0f172a;
              color: #e2e8f0;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            }
            .main {
              max-width: 1280px;
              margin: 0 auto;
              padding: 40px 20px;
            }
            .header {
              text-align: center;
              margin-bottom: 60px;
            }
            .logo {
              font-size: 2.5rem;
              font-weight: 900;
              letter-spacing: -0.03em;
              margin-bottom: 12px;
              background: linear-gradient(135deg, #a5b4fc 0%, #22d3ee 100%);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
            }
            .tagline {
              font-size: 1.1rem;
              color: #cbd5e1;
              margin: 0;
              max-width: 600px;
              margin: 0 auto;
            }
            .dashboard {
              margin-bottom: 80px;
            }
            .dashboard-row {
              display: flex;
              gap: 32px;
              align-items: flex-start;
              flex-wrap: wrap;
              justify-content: center;
            }
            .products-section {
              margin-bottom: 60px;
            }
            .products-section h2 {
              font-size: 1.8rem;
              margin-bottom: 8px;
            }
            .products-intro {
              color: #94a3b8;
              margin-bottom: 32px;
            }
            .products {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
              gap: 32px;
            }
            .product-card {
              border-radius: 16px;
              overflow: hidden;
              background: rgba(30, 27, 75, 0.65);
              border: 1px solid rgba(148, 163, 184, 0.18);
              transition: all 0.3s ease;
            }
            .product-card:hover {
              border-color: rgba(165, 180, 252, 0.4);
              box-shadow: 0 20px 40px rgba(99, 102, 241, 0.15);
            }
            .product-image-placeholder {
              aspect-ratio: 1;
              background: linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(34, 211, 238, 0.15));
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 1.2rem;
              color: #a5b4fc;
              border-bottom: 1px solid rgba(148, 163, 184, 0.18);
            }
            .how-it-works {
              margin: 80px 0;
            }
            .how-it-works h2 {
              font-size: 1.8rem;
              text-align: center;
              margin-bottom: 48px;
            }
            .steps {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
              gap: 32px;
            }
            .step {
              padding: 24px;
              background: rgba(30, 27, 75, 0.5);
              border: 1px solid rgba(148, 163, 184, 0.18);
              border-radius: 12px;
              text-align: center;
            }
            .step-num {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 48px;
              height: 48px;
              background: linear-gradient(135deg, #6366f1, #4f46e5);
              border-radius: 50%;
              font-weight: 700;
              font-size: 1.2rem;
              margin-bottom: 16px;
            }
            .step h3 {
              margin: 12px 0 8px;
              font-size: 1.1rem;
            }
            .step p {
              margin: 0;
              color: #cbd5e1;
              font-size: 0.95rem;
              line-height: 1.5;
            }
            .footer {
              text-align: center;
              padding-top: 60px;
              border-top: 1px solid rgba(148, 163, 184, 0.18);
              color: #94a3b8;
            }
            .footer p {
              margin: 8px 0;
            }
            .mission {
              font-size: 0.95rem;
              max-width: 600px;
              margin: 16px auto 0;
              line-height: 1.6;
            }
          `}</style>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
