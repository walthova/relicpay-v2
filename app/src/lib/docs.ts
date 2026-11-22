export const REPOSITORY_URL = "https://github.com/walthova/relicpay-v2";

// Explicitly list published documents; route parameters never become file paths.
export const documents = [
  {
    slug: "WHITEPAPER",
    title: "Whitepaper",
    label: "The big picture",
    description: "The original vision for yield-bearing payments. Explore the purchase flow, economics, and protocol design.",
    topics: "Protocol vision · Payment flows · Economics",
  },
  {
    slug: "TECHNICAL_BREAKDOWN",
    title: "Technical Breakdown",
    label: "Under the hood",
    description: "Follow a purchase from checkout to smart contract. A practical guide to accounts, instructions, and yield math.",
    topics: "Smart contracts · Code examples · Glossary",
  },
] as const;

export type DocumentInfo = (typeof documents)[number];

export function sourceUrl(document: DocumentInfo) {
  return `${REPOSITORY_URL}/blob/main/docs/${document.slug}.md`;
}
