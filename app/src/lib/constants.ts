import { PublicKey } from "@solana/web3.js";

// Devnet USDC mint (Circle's official devnet USDC)
export const USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

// Program ID — update after anchor deploy
export const PROGRAM_ID = new PublicKey(
  "5GPVYpyzdosbzWcdttcCdziJVqUCCARf98J857C3T6Gi"
);

// Demo merchant: IBG Collection
// SECURITY: Replace wallet placeholder before mainnet deployment
const IBG_WALLET = "IBGMerchantWalletxxxxxxxxxxxxxxxxxxxxxxxx";
if (typeof window !== "undefined" && IBG_WALLET.includes("xxxxxxxx")) {
  console.warn("[Relic Pay] IBG merchant wallet is still a placeholder — do not deploy to mainnet.");
}

export const IBG_MERCHANT = {
  name: "IBG Collection",
  wallet: IBG_WALLET,
  products: [
    {
      id: "optic-relic-hoodie-001",
      name: "Optic Relic — The Unity Hoodie",
      description: "First edition framed Optic Relic. Cultural artifact. Limited 1/50.",
      price_usdc: 300_000_000, // $300 USDC (6 decimals)
      image: "/images/unity-hoodie.jpg",
    },
    {
      id: "optic-relic-bomber-001",
      name: "Optic Relic — The Archive Bomber",
      description: "Preserved streetwear artifact. Documents the cultural moment.",
      price_usdc: 500_000_000, // $500 USDC
      image: "/images/archive-bomber.jpg",
    },
  ],
};

export const INSTALLMENT_OPTIONS = [
  { count: 3, label: "Pay in 3", interval_days: 30 },
  { count: 4, label: "Pay in 4", interval_days: 14 },
];

// ─── Stake Pool ──────────────────────────────────────────────────────────────
//
// Tier thresholds mirror the on-chain `compute_tier()` in lib.rs. Discount bps
// are read by the browser extension to overlay "Relic Pay Price" on any site.

export const STAKE_POOL_SEED = "stake_pool";
export const POOL_VAULT_SEED = "pool_vault";
export const USER_STAKE_SEED = "user_stake";

export const YIELD_RATE_BPS_ANNUAL = 300; // 3% APY
export const SECONDS_PER_YEAR = 31_536_000;

export interface Tier {
  level: 0 | 1 | 2 | 3 | 4;
  name: string;
  threshold_usdc: number;     // human dollars
  threshold_units: number;    // USDC units (6 decimals)
  discount_bps: number;       // 100 = 1%
  color: string;
}

export const TIERS: Tier[] = [
  { level: 0, name: "Unstaked",  threshold_usdc: 0,    threshold_units: 0,            discount_bps: 0,   color: "#6b7280" },
  { level: 1, name: "Bronze",    threshold_usdc: 10,   threshold_units: 10_000_000,   discount_bps: 50,  color: "#b45309" },
  { level: 2, name: "Silver",    threshold_usdc: 50,   threshold_units: 50_000_000,   discount_bps: 100, color: "#9ca3af" },
  { level: 3, name: "Gold",      threshold_usdc: 200,  threshold_units: 200_000_000,  discount_bps: 200, color: "#eab308" },
  { level: 4, name: "Platinum",  threshold_usdc: 500,  threshold_units: 500_000_000,  discount_bps: 300, color: "#22d3ee" },
];

export function tierFor(stakedUnits: number): Tier {
  return [...TIERS].reverse().find((t) => stakedUnits >= t.threshold_units) ?? TIERS[0];
}

export function nextTier(currentLevel: number): Tier | null {
  return TIERS.find((t) => t.level === currentLevel + 1) ?? null;
}
