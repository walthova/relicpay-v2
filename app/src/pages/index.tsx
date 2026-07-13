import { useEffect, useMemo, useState, useCallback } from "react";
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
  useEffect(() => {
    fetchStake();
    const id = setInterval(fetchStake, 5000);
    return () => clearInterval(id);
  }, [fetchStake]);

  return (
    <main className="main">
      <header className="header">
        <p className="eyebrow">IBG pilot / Relic Pay v2 devnet demo</p>
        <h1 className="logo">Relic Pay</h1>
        <p className="tagline">
          The only BNPL where your payment plan makes you money.
        </p>
        <p className="hero-copy">
          Split an IBG Collection purchase into installments while the USDC locked for repayment
          is modeled as yield-bearing capital. Today's demo uses simulated devnet yield; Kamino
          Lend CPI is the next step for real in-protocol yield.
        </p>
        <div className="hero-actions">
          <a className="primary-link" href="#ibg-demo">Try the IBG checkout</a>
          <a className="secondary-link" href="#v2-story">See the v2 story</a>
        </div>
        <div className="story-grid" aria-label="Relic Pay v2 highlights">
          <div className="story-card">
            <span className="story-label">Pilot</span>
            <strong>IBG Collection first</strong>
            <p>A real merchant drop is the proof surface, not a fake checkout or generic demo.</p>
          </div>
          <div className="story-card">
            <span className="story-label">Demo now</span>
            <strong>Simulated yield</strong>
            <p>Devnet agreements show the buyer benefit today with transparent simulated APY.</p>
          </div>
          <div className="story-card">
            <span className="story-label">Next</span>
            <strong>Kamino yield</strong>
            <p>v2.1 routes escrow USDC into Kamino Lend, with a raw-USDC fallback path.</p>
          </div>
          <div className="story-card">
            <span className="story-label">Shipped 2026-07-06</span>
            <strong>Pause + caps</strong>
            <p>ProtocolConfig adds emergency pause and per-agreement deposit caps before real yield.</p>
          </div>
        </div>
      </header>

      <section className="dashboard">
        <div className="section-heading">
          <p className="section-kicker">Demo wallet</p>
          <h2>Start with stake, then buy in installments.</h2>
          <p>
            Stake devnet USDC to see the Relic Pay card, live yield counter, and discount tier
            before trying the IBG checkout below.
          </p>
        </div>
        <div className="dashboard-row">
          <VirtualCard stake={stake} loading={stakeLoading} />
          <StakeFlow stake={stake} onAfterTx={fetchStake} />
        </div>
      </section>

      <section className="products-section" id="ibg-demo">
        <p className="section-kicker">IBG pilot checkout</p>
        <h2>Buy an IBG Collection piece without selling your crypto.</h2>
        <p className="products-intro">
          Pick a piece, choose pay-in-3 or pay-in-4, and create an on-chain BNPL agreement.
          The merchant gets a cleaner checkout story; the buyer sees locked payments earn
          instead of sitting idle.
        </p>
        <div className="products">
          {IBG_MERCHANT.products.map((product) => (
            <div key={product.id} className="product-card">
              <div className="product-image-placeholder">
                <span className="product-drop">IBG / Optic Relic</span>
                <span className="product-artifact">{product.name.replace("Optic Relic — ", "")}</span>
              </div>
              <BuyNowPayLater product={product} />
            </div>
          ))}
        </div>
      </section>

      <section className="how-it-works" id="v2-story">
        <p className="section-kicker">How v2 works</p>
        <h2>Yield-bearing BNPL, explained for a first run.</h2>
        <div className="steps">
          <div className="step">
            <span className="step-num">1</span>
            <h3>Choose an IBG item</h3>
            <p>No bank account, credit bureau, or card network gate. The demo starts from a wallet.</p>
          </div>
          <div className="step">
            <span className="step-num">2</span>
            <h3>Lock the first payment</h3>
            <p>The agreement escrows USDC on Solana and records the installment schedule on-chain.</p>
          </div>
          <div className="step">
            <span className="step-num">3</span>
            <h3>Earn while paying</h3>
            <p>Today this page simulates yield so the checkout story is easy to demo and verify.</p>
          </div>
          <div className="step">
            <span className="step-num">4</span>
            <h3>Route to Kamino next</h3>
            <p>v2.1 replaces simulation with Kamino Lend deposits, while keeping checkout resilient.</p>
          </div>
        </div>
      </section>

      <section className="controls-section">
        <div className="section-heading compact">
          <p className="section-kicker">Risk controls</p>
          <h2>Guardrails shipped before real yield touches escrow.</h2>
          <p>
            The 2026-07-06 v2.1 risk-control slice introduced ProtocolConfig so governance can
            pause new deposits and cap agreement size before Kamino integration expands the risk
            surface.
          </p>
        </div>
        <div className="control-list">
          <div className="control-item">
            <strong>Emergency pause</strong>
            <span>Blocks new agreement creation when the protocol needs to stop fresh risk.</span>
          </div>
          <div className="control-item">
            <strong>Per-agreement cap</strong>
            <span>Rejects oversized deposits at creation instead of relying on off-chain policy.</span>
          </div>
          <div className="control-item">
            <strong>Tests as spec</strong>
            <span>Pause, cap, authority gating, and permissive reset paths are covered in v2 tests.</span>
          </div>
        </div>
      </section>

      <footer className="footer">
        <p>Built on <strong>Solana</strong> · Payments in <strong>USDC</strong> · Open source v2 demo</p>
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
              padding: 40px 20px 56px;
            }
            .header {
              text-align: center;
              margin-bottom: 72px;
            }
            .eyebrow,
            .section-kicker,
            .story-label {
              margin: 0 0 12px;
              color: #67e8f9;
              font-size: 0.78rem;
              font-weight: 800;
              letter-spacing: 0.08em;
              text-transform: uppercase;
            }
            .logo {
              font-size: clamp(3rem, 7vw, 5.4rem);
              line-height: 0.95;
              font-weight: 900;
              letter-spacing: 0;
              margin: 0 0 18px;
              background: linear-gradient(135deg, #a5b4fc 0%, #22d3ee 100%);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
            }
            .tagline {
              font-size: clamp(1.55rem, 3vw, 2.65rem);
              line-height: 1.1;
              color: #f8fafc;
              margin: 0;
              max-width: 780px;
              margin: 0 auto;
              font-weight: 800;
            }
            .hero-copy {
              color: #cbd5e1;
              font-size: 1.05rem;
              line-height: 1.7;
              max-width: 760px;
              margin: 20px auto 0;
            }
            .hero-actions {
              display: flex;
              flex-wrap: wrap;
              justify-content: center;
              gap: 12px;
              margin-top: 28px;
            }
            .primary-link,
            .secondary-link {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              min-height: 44px;
              padding: 0 18px;
              border-radius: 10px;
              font-weight: 800;
              text-decoration: none;
              transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
            }
            .primary-link {
              color: #0f172a;
              background: #67e8f9;
              border: 1px solid #67e8f9;
            }
            .secondary-link {
              color: #e0e7ff;
              background: rgba(15, 23, 42, 0.35);
              border: 1px solid rgba(148, 163, 184, 0.35);
            }
            .primary-link:focus-visible,
            .secondary-link:focus-visible {
              outline: 3px solid rgba(103, 232, 249, 0.9);
              outline-offset: 3px;
            }
            .primary-link:hover,
            .secondary-link:hover {
              transform: translateY(-1px);
            }
            .story-grid {
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              gap: 16px;
              margin-top: 44px;
              text-align: left;
            }
            .story-card {
              min-height: 188px;
              padding: 20px;
              border-radius: 12px;
              background: rgba(30, 27, 75, 0.52);
              border: 1px solid rgba(148, 163, 184, 0.2);
            }
            .story-label {
              display: block;
              margin-bottom: 16px;
              font-size: 0.68rem;
            }
            .story-card strong {
              display: block;
              color: #f8fafc;
              font-size: 1.08rem;
              line-height: 1.25;
            }
            .story-card p {
              margin: 10px 0 0;
              color: #cbd5e1;
              font-size: 0.93rem;
              line-height: 1.55;
            }
            .section-heading {
              max-width: 760px;
              margin: 0 auto;
              text-align: center;
              margin-bottom: 32px;
            }
            .section-heading.compact {
              max-width: 820px;
            }
            .section-heading h2,
            .products-section h2,
            .how-it-works h2,
            .controls-section h2 {
              color: #f8fafc;
              font-size: clamp(1.75rem, 3vw, 2.45rem);
              line-height: 1.15;
              margin: 0;
              letter-spacing: 0;
            }
            .section-heading p:not(.section-kicker) {
              color: #cbd5e1;
              margin: 12px 0 0;
              line-height: 1.65;
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
              margin-bottom: 76px;
            }
            .products-intro {
              color: #cbd5e1;
              margin-bottom: 32px;
              max-width: 780px;
              line-height: 1.65;
            }
            .products {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
              gap: 32px;
            }
            .product-card {
              border-radius: 12px;
              overflow: hidden;
              background: rgba(30, 27, 75, 0.65);
              border: 1px solid rgba(148, 163, 184, 0.18);
              transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease;
            }
            .product-card:hover {
              border-color: rgba(165, 180, 252, 0.4);
              box-shadow: 0 20px 40px rgba(99, 102, 241, 0.15);
              transform: translateY(-2px);
            }
            .product-image-placeholder {
              min-height: 260px;
              aspect-ratio: 4 / 3;
              background:
                linear-gradient(135deg, rgba(99, 102, 241, 0.22), rgba(34, 211, 238, 0.16)),
                repeating-linear-gradient(45deg, rgba(248, 250, 252, 0.06) 0 1px, transparent 1px 18px);
              display: flex;
              flex-direction: column;
              gap: 10px;
              align-items: center;
              justify-content: center;
              text-align: center;
              color: #e0e7ff;
              border-bottom: 1px solid rgba(148, 163, 184, 0.18);
              padding: 24px;
            }
            .product-drop {
              color: #67e8f9;
              font-size: 0.72rem;
              font-weight: 800;
              letter-spacing: 0.08em;
              text-transform: uppercase;
            }
            .product-artifact {
              max-width: 14rem;
              font-size: 1.35rem;
              font-weight: 900;
              line-height: 1.1;
            }
            .how-it-works {
              margin: 80px 0 72px;
              text-align: center;
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
              border-radius: 10px;
              text-align: center;
            }
            .step-num {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 48px;
              height: 48px;
              background: linear-gradient(135deg, #0891b2, #4f46e5);
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
            .controls-section {
              margin: 0 0 80px;
              padding: 32px;
              border-radius: 12px;
              background: rgba(15, 23, 42, 0.72);
              border: 1px solid rgba(103, 232, 249, 0.22);
            }
            .control-list {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 16px;
            }
            .control-item {
              padding: 18px;
              border-radius: 10px;
              background: rgba(30, 27, 75, 0.52);
              border: 1px solid rgba(148, 163, 184, 0.18);
            }
            .control-item strong {
              display: block;
              color: #f8fafc;
              margin-bottom: 8px;
            }
            .control-item span {
              display: block;
              color: #cbd5e1;
              font-size: 0.94rem;
              line-height: 1.55;
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
            @media (prefers-reduced-motion: reduce) {
              .primary-link,
              .secondary-link,
              .product-card {
                transition: none;
              }
              .primary-link:hover,
              .secondary-link:hover,
              .product-card:hover {
                transform: none;
              }
            }
            @media (max-width: 980px) {
              .story-grid,
              .control-list {
                grid-template-columns: repeat(2, minmax(0, 1fr));
              }
            }
            @media (max-width: 640px) {
              .main {
                padding: 28px 16px 44px;
              }
              .header {
                margin-bottom: 56px;
              }
              .hero-actions {
                align-items: stretch;
                flex-direction: column;
              }
              .primary-link,
              .secondary-link {
                width: 100%;
              }
              .story-grid,
              .control-list {
                grid-template-columns: 1fr;
              }
              .story-card {
                min-height: auto;
              }
              .products {
                grid-template-columns: 1fr;
              }
              .controls-section {
                padding: 24px 18px;
              }
            }
          `}</style>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
