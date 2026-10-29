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
  /** Unix seconds offset from agreement start when it falls due. */
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
      dueOffsetSeconds: i * req.intervalSeconds,
    });
  }
  // Escrow balance integrated over time: each installment sits from its due time to the final due time.
  const end = BigInt((req.installmentCount - 1) * req.intervalSeconds);
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
