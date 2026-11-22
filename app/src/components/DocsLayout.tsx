import Head from "next/head";
import Link from "next/link";
import type { ReactNode } from "react";
import { documents, REPOSITORY_URL } from "../lib/docs";
import styles from "./DocsLayout.module.css";

export default function DocsLayout({ title, active, children }: {
  title: string;
  active?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <Head>
        <title>{title} | Relic Pay Docs</title>
        <meta name="description" content="Explore Relic Pay’s original protocol design and technical documentation." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <a href="#docs-content" className={styles.skipLink}>Skip to content</a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Relic Pay home">
          <span className={styles.brandMark} aria-hidden="true">R</span> Relic Pay
        </Link>
        <span className={styles.headerLabel}>/ Docs</span>
        <Link href="/demo" className={styles.backLink}>← Back to demo</Link>
      </header>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <nav aria-label="Documentation">
            <p className={styles.navLabel}>Explore the protocol</p>
            <Link href="/docs" aria-current={!active ? "page" : undefined}>Overview</Link>
            {documents.map((document) => (
              <Link key={document.slug} href={`/docs/${document.slug}`}
                aria-current={active === document.slug ? "page" : undefined}>
                {document.title}
              </Link>
            ))}
          </nav>
          <div className={styles.sidebarNote}>
            <span className={styles.statusDot} /> Open source on Solana
            <a href={REPOSITORY_URL}>Explore the repository ↗</a>
          </div>
        </aside>
        <main id="docs-content" className={styles.main} tabIndex={-1}>{children}</main>
      </div>
      <footer className={styles.footer}>
        <span>Relic Pay <span aria-hidden="true">/</span> Documentation</span>
        <Link href="/demo">Return to the interactive demo →</Link>
      </footer>
    </div>
  );
}

export function DocsVersionNote() {
  return (
    <aside className={styles.versionNote} aria-label="Document version">
      <strong>Original v1 documentation</strong>
      <p>These documents describe the original design, not the current product status.
        See the <a href={`${REPOSITORY_URL}/blob/main/RELICPAY_V2.md`}>current v2 scope</a> and{" "}
        <a href={`${REPOSITORY_URL}/blob/main/SECURITY.md`}>security limitations</a> for what is built today.</p>
    </aside>
  );
}
