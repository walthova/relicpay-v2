// @relicpay/checkout (v0.1, v2.2 groundwork)
//
// Merchant-facing helpers for "Pay with Relic Pay". Everything here mirrors the
// on-chain program so a checkout page can show the exact schedule and reject bad
// input BEFORE the buyer signs. Constants must stay in sync with
// programs/relicpay/src/constants.rs (a test pins them).

import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 12;
export const MAX_PRODUCT_ID_LEN = 64;
export const MAX_MERCHANT_NAME_LEN = 64;
export const CANCEL_FEE_BPS = 1_000n;
export const GRACE_PERIOD_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_YIELD_RATE_BPS = 300n;
const BPS_DIVISOR = 10_000n;
const SECONDS_PER_YEAR = 31_536_000n;

export interface CheckoutRequest {
  /** Total price in USDC base units (6 decimals). */
  totalPrice: bigint;
  installmentCount: number;
  intervalSeconds: number;
  /** Merchant SKU or order id. Part of the agreement PDA seed. */
  productId: string;
  merchantName: string;
}

export interface Installment {
  index: number; // 1-based
  amount: bigint;
  /**
   * Seconds after agreement start when it falls due. Installment 1 is the
   * upfront charge (offset 0); installment N >= 2 is due at N * interval,
   * matching pay_installment.rs (installment 2 is NOT due after one interval).
   */
  dueOffsetSeconds: number;
}

export interface Quote {
  installments: Installment[];
  /** Charged to the buyer in the creating transaction. */
  upfront: bigint;
  /** Fee the merchant keeps if the buyer cancels early (10%). */
  cancelFeeIfCancelledNow: bigint;
  /** Simple-interest yield the buyer would earn if every installment sits in escrow to the end. */
  estimatedYieldAtSimulatedRate: bigint;
}

/** Returns a list of human-readable problems; empty means the request is valid. */
export function validateCheckout(req: CheckoutRequest, maxAgreementDeposit: bigint = 0n): string[] {
  const errs: string[] = [];
  if (req.totalPrice <= 0n) errs.push("totalPrice must be greater than zero");
  if (!Number.isInteger(req.installmentCount) || req.installmentCount < MIN_INSTALLMENTS || req.installmentCount > MAX_INSTALLMENTS)
    errs.push(`installmentCount must be an integer between ${MIN_INSTALLMENTS} and ${MAX_INSTALLMENTS}`);
  if (!Number.isInteger(req.intervalSeconds) || req.intervalSeconds <= 0) errs.push("intervalSeconds must be a positive integer");
  if (Buffer.byteLength(req.productId) > MAX_PRODUCT_ID_LEN) errs.push(`productId exceeds ${MAX_PRODUCT_ID_LEN} bytes`);
  if (Buffer.byteLength(req.merchantName) > MAX_MERCHANT_NAME_LEN) errs.push(`merchantName exceeds ${MAX_MERCHANT_NAME_LEN} bytes`);
  if (maxAgreementDeposit > 0n && req.totalPrice > maxAgreementDeposit) errs.push("totalPrice exceeds the protocol per-agreement cap");
  return errs;
}

/** Exact installment schedule. The integer-division remainder lands on the final installment, as on-chain. */
export function quote(req: CheckoutRequest): Quote {
  const errs = validateCheckout(req);
  if (errs.length) throw new Error(`invalid checkout request: ${errs.join("; ")}`);
  const n = BigInt(req.installmentCount);
  const base = req.totalPrice / n;
  const installments: Installment[] = [];
  for (let i = 0; i < req.installmentCount; i++) {
    const last = i === req.installmentCount - 1;
    installments.push({
      index: i + 1,
      amount: last ? req.totalPrice - base * (n - 1n) : base,
      dueOffsetSeconds: i === 0 ? 0 : (i + 1) * req.intervalSeconds,
    });
  }
  // Escrow balance integrated over time: each installment sits from its due time to the final due time.
  const end = BigInt(req.installmentCount * req.intervalSeconds);
  let weighted = 0n;
  for (const it of installments) weighted += it.amount * (end - BigInt(it.dueOffsetSeconds));
  return {
    installments,
    upfront: base,
    cancelFeeIfCancelledNow: (req.totalPrice * CANCEL_FEE_BPS) / BPS_DIVISOR,
    estimatedYieldAtSimulatedRate: (weighted * DEFAULT_YIELD_RATE_BPS) / (BPS_DIVISOR * SECONDS_PER_YEAR),
  };
}

export function agreementAddress(programId: PublicKey, buyer: PublicKey, productId: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("agreement"), buyer.toBuffer(), Buffer.from(productId)], programId)[0];
}

export function escrowAddress(programId: PublicKey, agreement: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("escrow"), agreement.toBuffer()], programId)[0];
}

export interface BuildCreateAgreementParams {
  /** An Anchor Program loaded with the Relic Pay IDL. */
  program: any;
  request: CheckoutRequest;
  buyer: PublicKey;
  merchant: PublicKey;
  usdcMint: PublicKey;
  buyerUsdc: PublicKey;
}

export interface BuiltCheckout {
  instruction: TransactionInstruction;
  agreement: PublicKey;
  escrow: PublicKey;
  quote: Quote;
}

/** Validates, quotes, and returns the unsigned create_agreement instruction. The buyer's wallet signs and sends it. */
export async function buildCreateAgreement(p: BuildCreateAgreementParams): Promise<BuiltCheckout> {
  const q = quote(p.request); // throws on invalid input
  const agreement = agreementAddress(p.program.programId, p.buyer, p.request.productId);
  const escrow = escrowAddress(p.program.programId, agreement);
  const bn = (v: bigint | number) => new (require("bn.js"))(v.toString());
  const instruction: TransactionInstruction = await p.program.methods
    .createAgreement(bn(p.request.totalPrice), p.request.installmentCount, bn(p.request.intervalSeconds), p.request.productId, p.request.merchantName)
    .accounts({
      agreement,
      buyer: p.buyer,
      merchant: p.merchant,
      usdcMint: p.usdcMint,
      buyerUsdc: p.buyerUsdc,
      escrowUsdc: escrow,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
  return { instruction, agreement, escrow, quote: q };
}

// ---------------------------------------------------------------------------
// Status reader and event decoding (v2.2 SDK slice 2)
// ---------------------------------------------------------------------------

export type AgreementPhase = "active" | "completed" | "defaulted" | "cancelled";
export type YieldSource = "simulated" | "kamino";

export interface AgreementStatus {
  phase: AgreementPhase;
  yieldSource: YieldSource;
  paidInstallments: number;
  installmentCount: number;
  /** USDC base units the buyer still owes (0 unless active). */
  remainingToPay: bigint;
  /** Null once no further installment is expected. */
  nextInstallmentNumber: number | null;
  nextDueAt: number | null;
  graceExpiresAt: number | null;
  /** True when the next installment can be paid right now. */
  payable: boolean;
  overdue: boolean;
  /** True when anyone may call trigger_default. */
  defaultable: boolean;
  /** Completed, not yet withdrawn by the merchant. */
  merchantPayoutPending: boolean;
  yieldAccrued: bigint;
}

const num = (v: any): number => (typeof v === "number" ? v : Number(v.toString()));
const big = (v: any): bigint => BigInt(v.toString());

/** Pure: derives a merchant-facing status from a fetched BnplAgreement account and a unix time. */
export function deriveStatus(acct: any, nowUnix: number): AgreementStatus {
  const phase = Object.keys(acct.state)[0] as AgreementPhase;
  const paid = num(acct.paidInstallments);
  const count = num(acct.installmentCount);
  const interval = num(acct.intervalSeconds);
  const start = num(acct.startTime);
  const total = big(acct.totalPrice);
  const per = big(acct.installmentAmount);
  const active = phase === "active" && paid < count;
  const nextNo = active ? paid + 1 : null;
  const nextDueAt = nextNo === null ? null : start + nextNo * interval;
  const graceExpiresAt = nextDueAt === null ? null : nextDueAt + GRACE_PERIOD_SECONDS;
  const paidSoFar = paid >= count ? total : per * BigInt(paid);
  return {
    phase,
    yieldSource: num(acct.yieldSource) === 1 ? "kamino" : "simulated",
    paidInstallments: paid,
    installmentCount: count,
    remainingToPay: phase === "active" ? total - paidSoFar : 0n,
    nextInstallmentNumber: nextNo,
    nextDueAt,
    graceExpiresAt,
    payable: nextDueAt !== null && nowUnix >= nextDueAt,
    overdue: nextDueAt !== null && nowUnix > nextDueAt,
    defaultable: graceExpiresAt !== null && nowUnix > graceExpiresAt,
    merchantPayoutPending: phase === "completed" && !acct.merchantWithdrawn,
    yieldAccrued: big(acct.yieldAccrued),
  };
}

/** Fetches the agreement and derives its status. Returns null if the account does not exist (never created or closed). */
export async function getAgreementStatus(program: any, agreement: PublicKey, nowUnix: number = Math.floor(Date.now() / 1000)): Promise<AgreementStatus | null> {
  const acct = await program.account.bnplAgreement.fetchNullable(agreement);
  return acct ? deriveStatus(acct, nowUnix) : null;
}

export interface DecodedEvent {
  name: string;
  data: any;
}

/** Decodes Relic Pay events from transaction log lines (webhook / indexer helper). Unknown programs' logs are ignored. */
export function decodeEvents(program: any, logs: string[]): DecodedEvent[] {
  const { EventParser } = require("@coral-xyz/anchor");
  const parser = new EventParser(program.programId, program.coder);
  return Array.from(parser.parseLogs(logs)).map((e: any) => ({ name: e.name, data: e.data }));
}
