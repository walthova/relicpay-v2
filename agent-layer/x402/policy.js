// RelicPay x402 reference client: policy and flow. TESTNET DESIGN CODE, not live.
//
// Reads an x402 v2 `PAYMENT-REQUIRED` challenge, decides whether the agent's mandate allows paying
// it, and builds the single-use payment ref the on-chain charge records. Signing and sending are
// injected (`deps.charge`), so this file depends on no SDK version. See docs/AGENT_CREDIT_LAYER.md.
"use strict";

const crypto = require("node:crypto");

// CAIP-2 ids from docs.cdp.coinbase.com/x402/core-concepts/facilitator (read 2026-11-12).
const NETWORKS = {
  "eip155:8453": { chain: "base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  "eip155:84532": { chain: "base-sepolia", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": { chain: "solana", usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": { chain: "solana-devnet", usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
};

function decodeHeader(value) {
  if (!value) throw new Error("missing PAYMENT-REQUIRED header");
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** 32-byte single-use ref: sha256 of the canonical requirement plus the resource it unlocks. */
function paymentRef(requirement, resource) {
  return crypto.createHash("sha256").update(stable({ requirement, resource })).digest();
}

function sameAddress(a, b) {
  if (!a || !b) return false;
  return a.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Pick the first requirement the mandate allows, or explain why none is allowed.
 * mandate: { networks: string[], allowedPayees: string[], perTxCap: bigint, periodRemaining: bigint,
 *            approvalThreshold: bigint (0 = never), ownerApproved?: (req) => boolean }
 */
function decide(challenge, mandate) {
  const accepts = Array.isArray(challenge?.accepts) ? challenge.accepts : [];
  const reasons = [];
  for (const req of accepts) {
    const net = NETWORKS[req.network];
    const amount = BigInt(req.amount ?? req.maxAmountRequired ?? -1); // v2 `amount`, v1 `maxAmountRequired`
    if (!net || !mandate.networks.includes(req.network)) { reasons.push(`network ${req.network} not enabled`); continue; }
    if (!["exact", "upto"].includes(req.scheme)) { reasons.push(`scheme ${req.scheme} unsupported`); continue; }
    if (!sameAddress(req.asset, net.usdc)) { reasons.push(`asset ${req.asset} is not USDC on ${net.chain}`); continue; }
    if (!mandate.allowedPayees.some((p) => sameAddress(p, req.payTo))) { reasons.push(`payTo ${req.payTo} not allowlisted`); continue; }
    if (amount <= 0n) { reasons.push("non-positive amount"); continue; }
    if (amount > mandate.perTxCap) { reasons.push("over per-transaction cap"); continue; }
    if (amount > mandate.periodRemaining) { reasons.push("over remaining period cap"); continue; }
    const needsOwner = mandate.approvalThreshold > 0n && amount > mandate.approvalThreshold;
    if (needsOwner && !(mandate.ownerApproved && mandate.ownerApproved(req))) { reasons.push("owner approval required"); continue; }
    return { ok: true, requirement: req, amount, chain: net.chain, needsOwner, ref: paymentRef(req, challenge.resource) };
  }
  return { ok: false, reasons };
}

/**
 * One request with at most one payment. deps: { fetch, mandate, charge(decision) -> {txId} }.
 * Never retries a payment: a failed charge or a second 402 for the same ref stops here.
 */
async function fetchWithRelic(url, init, deps) {
  const first = await deps.fetch(url, init);
  if (first.status !== 402) return first;
  const decision = decide(decodeHeader(first.headers.get("PAYMENT-REQUIRED")), deps.mandate);
  if (!decision.ok) {
    const err = new Error(`x402 payment refused: ${decision.reasons.join("; ")}`);
    err.decision = decision;
    throw err;
  }
  const { txId } = await deps.charge(decision);
  const payload = {
    x402Version: 2,
    scheme: "relicpay-credit", // proposed scheme: the merchant verifies the on-chain AgentCharge event (Q5)
    network: decision.requirement.network,
    payload: { txId, ref: decision.ref.toString("hex") },
  };
  const headers = { ...(init?.headers || {}), "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64") };
  return deps.fetch(url, { ...init, headers });
}

module.exports = { NETWORKS, decide, decodeHeader, paymentRef, fetchWithRelic, stable };
