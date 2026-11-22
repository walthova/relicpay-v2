import type { GetStaticPaths, GetStaticProps, InferGetStaticPropsType } from "next";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import DocsLayout, { DocsVersionNote } from "../../components/DocsLayout";
import styles from "../../components/DocsLayout.module.css";
import { documents, sourceUrl, type DocumentInfo } from "../../lib/docs";

type Props = { document: DocumentInfo; markdown: string };

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: documents.map(({ slug }) => ({ params: { slug } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  const document = documents.find(({ slug }) => slug === params?.slug);
  if (!document) return { notFound: true };

  // Read the canonical repo file at build time, not a copy in the app bundle.
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const markdown = await readFile(path.join(process.cwd(), "..", "docs", `${document.slug}.md`), "utf8");
  return { props: { document, markdown } };
};

export default function DocumentPage({ document, markdown }: InferGetStaticPropsType<typeof getStaticProps>) {
  const nextDocument = documents.find(({ slug }) => slug !== document.slug);
  return (
    <DocsLayout title={document.title} active={document.slug}>
      <div className={styles.readerMeta}>
        <p className={styles.eyebrow}>{document.label} / v1</p>
        <a href={sourceUrl(document)}>View source ↗</a>
      </div>
      <DocsVersionNote />
      <article className={styles.prose} aria-label={document.title}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={{
          pre: ({ node, ...props }) => <pre {...props} tabIndex={0} aria-label="Code example" />,
          table: ({ node, ...props }) => (
            <div className={styles.tableScroll} role="region" aria-label="Scrollable table" tabIndex={0}>
              <table {...props} />
            </div>
          ),
        }}>{markdown}</ReactMarkdown>
      </article>
      <nav className={styles.readNext} aria-label="Continue reading">
        <Link href="/docs">← All documentation</Link>
        <Link href={`/docs/${nextDocument.slug}`}>{nextDocument.title} →</Link>
      </nav>
    </DocsLayout>
  );
}
