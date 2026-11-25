import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import { clusterApiUrl } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  getMerchantDashboard,
  toDashboardView,
  MerchantDashboardView,
} from "../../../packages/checkout/src";
import idl from "../lib/relicpay.json";
import styles from "./merchant.module.css";

// Wallet adapters must not run on the server.
const ConnectionProvider = dynamic(
  () =>
    import("@solana/wallet-adapter-react").then((m) => m.ConnectionProvider),
  { ssr: false },
);
const WalletProvider = dynamic(
  () => import("@solana/wallet-adapter-react").then((m) => m.WalletProvider),
  { ssr: false },
);
const WalletModalProvider = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (m) => m.WalletModalProvider,
    ),
  { ssr: false },
);
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

require("@solana/wallet-adapter-react-ui/styles.css");

const METRICS = [
  { label: "Active agreements", detail: "Installment plans in progress" },
  {
    label: "Outstanding receivable (USDC)",
    detail: "Remaining buyer payments",
  },
  {
    label: "Pending payouts (USDC)",
    detail: "Completed plans awaiting payout",
  },
  {
    label: "Overdue exposure (USDC)",
    detail: "Unpaid balance on overdue plans",
  },
  {
    label: "Recoverable on default (USDC)",
    detail: "Escrow available on default",
  },
];
const ACTION_COPY: Record<string, string> = {
  withdraw: "Withdraw payout",
  default: "Trigger default",
};

function Icon({ name }: { name: "logo" | "wallet" | "arrow" | "receipt" | "refresh" }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "logo" && (
        <path d="M12 2 22 7.5v9L12 22 2 16.5v-9L12 2Zm0 0v20M2 7.5l10 5.5 10-5.5" />
      )}
      {name === "wallet" && (
        <>
          <path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7" />
          <path d="M20 12h-5v4h5M17 14h.01" />
        </>
      )}
      {name === "arrow" && <path d="M5 12h14m-5-5 5 5-5 5" />}
      {name === "receipt" && (
        <>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
          <path d="M9 8h6M9 12h6" />
        </>
      )}
      {name === "refresh" && (
        <>
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17" />
        </>
      )}
    </svg>
  );
}

function MerchantWorkspace() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [view, setView] = useState<MerchantDashboardView | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(Boolean(wallet.publicKey));
  const [refresh, setRefresh] = useState(0);
  const connected = Boolean(wallet.publicKey);

  useEffect(() => {
    if (!wallet.publicKey) return;
    let active = true;
    setLoading(true);
    setError(false);
    setView(null);
    async function load() {
      try {
        const provider = new AnchorProvider(connection, wallet as any, {
          commitment: "confirmed",
        });
        const program = new Program(idl as any, provider);
        const { rows, summary } = await getMerchantDashboard(
          program,
          wallet.publicKey,
        );
        if (active) setView(toDashboardView(rows, summary));
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [connection, wallet.publicKey, refresh]);

  return (
    <div className={styles.page}>
      <Head>
        <title>Merchant dashboard | Relic Pay</title>
        <meta
          name="description"
          content="Track your Relic Pay agreements, buyer payments, and merchant payouts."
        />
      </Head>
      <a className={styles.skipLink} href="#merchant-main">
        Skip to dashboard
      </a>
      <header className={styles.topbar}>
        <div className={styles.navInner}>
          <Link href="/" className={styles.brand} aria-label="Relic Pay home">
            <span className={styles.brandMark} aria-hidden="true">
              <Icon name="logo" />
            </span>
            Relic Pay
          </Link>
          <nav aria-label="Main navigation" className={styles.nav}>
            <Link href="/checkout">Buyer checkout</Link>
            <Link href="/demo">Credit simulation</Link>
            <Link href="/merchant" aria-current="page">
              Merchant
            </Link>
          </nav>
          <span className={styles.network}>
            <span />
            {process.env.NEXT_PUBLIC_RPC_URL ? "Custom RPC" : "Devnet"}
          </span>
        </div>
      </header>
      <main
        id="merchant-main"
        className={`${styles.main} ${!connected ? styles.onboarding : ""}`}
      >
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>Merchant workspace</p>
            <h1>Merchant dashboard</h1>
            <p className={styles.intro}>
              A clear view of your agreements. A closer eye on every payout.
            </p>
          </div>
          <div className={styles.walletControl}>
            <span className={styles.walletLabel}>
              {connected ? "Merchant payout wallet" : "Your payout wallet"}
            </span>
            <WalletMultiButton>
              {!connected ? "Connect wallet" : undefined}
            </WalletMultiButton>
          </div>
        </div>
        <section aria-label="Agreement summary" className={styles.metrics}>
          {METRICS.map((metric) => (
            <div key={metric.label} className={styles.metric}>
              <p className={styles.metricLabel}>
                {metric.label.replace(" (USDC)", "")}
              </p>
              <div className={styles.metricValue}>
                <strong>
                  {view?.headline.find((h) => h.label === metric.label)
                    ?.value ?? "—"}
                </strong>
                {metric.label.includes("USDC") && <span>USDC</span>}
              </div>
              <p className={styles.metricDetail}>{metric.detail}</p>
            </div>
          ))}
        </section>
        <div className={styles.workspace}>
          <section
            className={styles.agreements}
            aria-labelledby="agreements-title"
            aria-busy={loading}
          >
            <div className={styles.panelHeading}>
              <div>
                <h2 id="agreements-title">Agreements</h2>
                <p>Buyer activity, from first payment to payout.</p>
              </div>
              {connected ? (
                <button
                  className={styles.refresh}
                  onClick={() => setRefresh((n) => n + 1)}
                  disabled={loading}
                >
                  <Icon name="refresh" />
                  {loading ? "Loading…" : "Refresh"}
                </button>
              ) : (
                <span className={styles.readOnly}>Read-only view</span>
              )}
            </div>
            {!connected ? (
              <div className={styles.empty}>
                <div className={styles.emptyArtwork} aria-hidden="true">
                  <span />
                  <span />
                  <div>
                    <Icon name="wallet" />
                  </div>
                </div>
                <p className={styles.eyebrow}>Start here</p>
                <h3>Connect your payout wallet</h3>
                <p>
                  Use the wallet you receive Relic Pay payments with to see your
                  agreements and expected payouts.
                </p>
                <WalletMultiButton>
                  Connect wallet
                  <Icon name="arrow" />
                </WalletMultiButton>
                <span className={styles.connectionNote}>
                  Viewing agreements won’t request a transaction.
                </span>
                <a
                  className={styles.textLink}
                  href="https://phantom.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Need a wallet? Get Phantom <span aria-hidden="true">↗</span>
                </a>
              </div>
            ) : loading ? (
              <div className={styles.empty} role="status">
                <div className={styles.stateIcon}>
                  <Icon name="refresh" />
                </div>
                <h3>Loading your agreements</h3>
                <p>Checking this payout wallet for Relic Pay activity.</p>
              </div>
            ) : error ? (
              <div className={styles.empty} role="alert">
                <div className={styles.stateIcon}>
                  <Icon name="receipt" />
                </div>
                <h3>We couldn’t load your agreements</h3>
                <p>
                  Your wallet is connected. Check that your network matches your
                  checkout, then try again.
                </p>
                <button
                  className={styles.primaryButton}
                  onClick={() => setRefresh((n) => n + 1)}
                >
                  Try again
                  <Icon name="refresh" />
                </button>
              </div>
            ) : view?.rows.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.stateIcon}>
                  <Icon name="receipt" />
                </div>
                <h3>Your first agreement starts at checkout</h3>
                <p>
                  No agreements were found for this wallet on the configured
                  network. Use this payout address in your checkout integration,
                  then refresh after a buyer creates a plan.
                </p>
                <Link href="/checkout" className={styles.primaryButton}>
                  Open buyer checkout
                  <Icon name="arrow" />
                </Link>
                <span className={styles.connectionNote}>
                  Already accepting payments? Check you connected the right
                  wallet.
                </span>
              </div>
            ) : view ? (
              <div
                className={styles.tableScroll}
                tabIndex={0}
                role="region"
                aria-label="Merchant agreements table"
              >
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Product / Buyer</th>
                      <th scope="col">Status</th>
                      <th scope="col">Progress</th>
                      <th scope="col">Owed (USDC)</th>
                      <th scope="col">Next due</th>
                      <th scope="col">Action availability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((row) => (
                      <tr key={row.address}>
                        <td>
                          <strong>{row.productId}</strong>
                          <span className={styles.buyer} title={row.buyer}>
                            {row.buyer.slice(0, 4)}…{row.buyer.slice(-4)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`${styles.badge} ${styles[row.tone]}`}
                          >
                            {row.label}
                          </span>
                        </td>
                        <td>{row.progress}</td>
                        <td>{row.owed}</td>
                        <td>
                          {row.nextDueAt
                            ? new Date(
                                row.nextDueAt * 1000,
                              ).toLocaleDateString()
                            : "—"}
                        </td>
                        <td>
                          {row.action !== "none" ? (
                            <span className={styles.actionHint}>
                              {ACTION_COPY[row.action]}
                              <small>Not available in this dashboard</small>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
          <aside className={styles.guide} aria-labelledby="guide-title">
            <p className={styles.eyebrow}>The essentials</p>
            <h2 id="guide-title">Your first merchant session</h2>
            <ol className={styles.steps}>
              <li>
                <span
                  className={
                    connected ? styles.stepComplete : styles.stepNumber
                  }
                >
                  {connected ? "✓" : "01"}
                </span>
                <div>
                  <h3>Bring your payout wallet</h3>
                  <p>
                    Connect Phantom using the same address configured in your
                    checkout.
                  </p>
                </div>
              </li>
              <li>
                <span className={styles.stepNumber}>02</span>
                <div>
                  <h3>Follow each payment plan</h3>
                  <p>
                    Agreements appear here after a buyer starts a plan for your
                    wallet.
                  </p>
                </div>
              </li>
              <li>
                <span className={styles.stepNumber}>03</span>
                <div>
                  <h3>Keep track of what’s due</h3>
                  <p>
                    Review remaining payments, overdue balances, and completed
                    plans.
                  </p>
                </div>
              </li>
            </ol>
            <div className={styles.payoutNote}>
              <Icon name="receipt" />
              <p>
                <strong>When do I get paid?</strong>In this version, payouts
                become available after all installments are paid. This dashboard
                tracks them; it doesn’t submit withdrawals.
              </p>
            </div>
            <p className={styles.simulationNote}>
              Curious about agent credit? The simulation previews a separate,
              planned credit flow. This dashboard shows current installment
              agreements.
            </p>
            <Link href="/demo" className={styles.demoLink}>
              Explore the agent credit simulation
              <Icon name="arrow" />
            </Link>
          </aside>
        </div>
        <footer className={styles.footer}>
          <span>
            Relic Pay <span aria-hidden="true">/</span> Merchant workspace
          </span>
          <span>Development preview · Use test funds only</span>
        </footer>
      </main>
      <style jsx global>{`
        html,
        body {
          margin: 0;
          padding: 0;
          background: #0c1115;
        }
      `}</style>
    </div>
  );
}

function MerchantDashboard() {
  const { publicKey } = useWallet();
  // Never retain a previous merchant's data after switching or disconnecting.
  return <MerchantWorkspace key={publicKey?.toBase58() ?? "disconnected"} />;
}

export default function MerchantPage() {
  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_RPC_URL ??
      clusterApiUrl(WalletAdapterNetwork.Devnet),
    [],
  );
  const wallets = useMemo(() => {
    if (typeof window === "undefined") return [];
    const { PhantomWalletAdapter } = require("@solana/wallet-adapter-phantom");
    return [new PhantomWalletAdapter()];
  }, []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <MerchantDashboard />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
