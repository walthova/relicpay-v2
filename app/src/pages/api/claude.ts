import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// In-memory rate limiter: 10 req/min per IP
const rateLimits = new Map<string, { count: number; reset: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const limit = rateLimits.get(ip);
  if (!limit || now > limit.reset) {
    rateLimits.set(ip, { count: 1, reset: now + 60_000 });
    return true;
  }
  if (limit.count >= 10) return false;
  limit.count++;
  return true;
}

const SYSTEM_PROMPT = `You are the Relic Pay assistant — an expert guide for a decentralized Buy Now Pay Later protocol built on Solana.

WHAT RELIC PAY IS:
- A BNPL protocol where crypto holders use USDC as collateral to buy things in installments
- The locked funds earn 3% APY yield while the buyer pays (the core differentiator)
- No banks, no credit checks, no selling crypto
- Built on Solana using Anchor (Rust smart contracts)

THE THREE ROLES:
- BUYER: splits payments into 2-12 installments, earns yield on locked funds
- MERCHANT: receives full payment when buyer completes all installments
- STAKER: deposits USDC to earn yield and unlock browser extension discounts (tiers 1-4)

KEY MECHANICS:
- Funds held in PDA escrow (Program Derived Address) — no human key can drain it
- Yield math: principal × (rate_bps/10000) × (elapsed_seconds/31536000)
- Grace period: 7 days past due date before default can be triggered
- Cancel option: buyer exits early, pays 10% fee, merchant keeps it, buyer gets 90% back
- Browser extension reads UserStake.tier on-chain to show "Relic Pay Price" overlays

SMART CONTRACT INSTRUCTIONS:
create_agreement → pay_installment (×N) → merchant_withdraw + claim_yield
OR: cancel_agreement OR: trigger_default

DISCOUNT TIERS (browser extension):
Tier 0: <$10 staked → 0%
Tier 1: $10+ → 0.5% off
Tier 2: $50+ → 1.0% off
Tier 3: $200+ → 2.0% off
Tier 4: $500+ → 3.0% off

You should:
- Answer questions about how Relic Pay works clearly and concisely
- Explain technical concepts (PDAs, escrow, yield math) in plain English first, then go deeper if asked
- Walk users through the demo flow step by step if they ask
- Be encouraging — this is an early prototype and users are exploring
- Keep answers under 150 words unless the question is complex
- Never make up features that don't exist yet`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Rate limit by IP
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Too many requests — wait a minute and try again." });
  }

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }

  // Input validation
  if (messages.length > 20) {
    return res.status(400).json({ error: "Too many messages (max 20)" });
  }
  for (const msg of messages) {
    if (!["user", "assistant"].includes(msg.role)) {
      return res.status(400).json({ error: "Invalid message role" });
    }
    if (typeof msg.content !== "string" || msg.content.length > 2000) {
      return res.status(400).json({ error: "Message content too long (max 2000 chars)" });
    }
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return res.status(200).json({ text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}
