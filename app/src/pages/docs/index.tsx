import Link from "next/link";
import DocsLayout, { DocsVersionNote } from "../../components/DocsLayout";
import styles from "../../components/DocsLayout.module.css";
import { documents } from "../../lib/docs";

export default function Docs() {
  return (
    <DocsLayout title="Documentation">
      <p className={styles.eyebrow}>The Relic Pay library</p>
      <h1 className={styles.title}>Understand <span>Relic Pay.</span></h1>
      <p className={styles.lead}>Protocol concepts, payment flows, and the code behind
        yield-bearing escrow on Solana. Start with the vision or dive into the details.</p>
      <DocsVersionNote />
      <div className={styles.sectionLabel}>
        <h2>Choose your starting point</h2><span>{String(documents.length).padStart(2, "0")} documents</span>
      </div>
      <div className={styles.cards}>
        {documents.map((document, index) => (
          <Link key={document.slug} href={`/docs/${document.slug}`} className={styles.card}>
            <span className={styles.cardNumber} aria-hidden="true">0{index + 1}</span>
            <span className={styles.cardLabel}>{document.label}</span>
            <h3>{document.title}</h3>
            <p>{document.description}</p>
            <span className={styles.cardTopics}>{document.topics}</span>
            <span className={styles.cardAction}>Read {document.title === "Whitepaper" ? "the whitepaper" : "the breakdown"}<span aria-hidden="true">↗</span></span>
          </Link>
        ))}
      </div>
    </DocsLayout>
  );
}
