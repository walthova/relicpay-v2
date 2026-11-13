// @relicpay/checkout (v0.1, v2.2 groundwork)
//
// Merchant-facing helpers for "Pay with Relic Pay". Everything here mirrors the
// on-chain program so a checkout page can show the exact schedule and reject bad
// input BEFORE the buyer signs. Constants must stay in sync with
// programs/relicpay/src/constants.rs (a test pins them).

import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

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

// ---------------------------------------------------------------------------
// Merchant dashboard data layer (v2.2 merchant surface)
// ---------------------------------------------------------------------------

/** Byte offset of `merchant` in a BnplAgreement account (8 discriminator + 32 buyer). */
export const AGREEMENT_MERCHANT_OFFSET = 40;

export interface MerchantAgreementRow {
  address: PublicKey;
  buyer: PublicKey;
  productId: string;
  totalPrice: bigint;
  /** Escrow balance the merchant would receive if the agreement defaulted now. */
  escrowDeposited: bigint;
  status: AgreementStatus;
}

export interface MerchantSummary {
  counts: Record<AgreementPhase, number>;
  /** Active agreements where the next installment is past due. */
  overdueCount: number;
  /** Active agreements the merchant (or anyone) can default right now. */
  defaultableCount: number;
  /** Sum of remainingToPay across active agreements: what buyers still owe. */
  outstandingReceivable: bigint;
  /** Unpaid balance on overdue agreements: the merchant's default exposure. */
  overdueExposure: bigint;
  /** Escrow the merchant would recover from defaultable agreements right now. */
  recoverableOnDefault: bigint;
  /** Total price of completed agreements awaiting merchant_withdraw. */
  pendingPayouts: bigint;
  /** Next unpaid due time across active agreements, or null. */
  nextDueAt: number | null;
}

/** Pure: aggregates merchant-facing numbers from derived rows. */
export function summarizeMerchant(rows: MerchantAgreementRow[]): MerchantSummary {
  const out: MerchantSummary = {
    counts: { active: 0, completed: 0, defaulted: 0, cancelled: 0 },
    overdueCount: 0,
    defaultableCount: 0,
    outstandingReceivable: 0n,
    overdueExposure: 0n,
    recoverableOnDefault: 0n,
    pendingPayouts: 0n,
    nextDueAt: null,
  };
  for (const r of rows) {
    const st = r.status;
    out.counts[st.phase] += 1;
    out.outstandingReceivable += st.remainingToPay;
    if (st.overdue) {
      out.overdueCount += 1;
      out.overdueExposure += st.remainingToPay;
    }
    if (st.defaultable) {
      out.defaultableCount += 1;
      out.recoverableOnDefault += r.escrowDeposited;
    }
    if (st.merchantPayoutPending) out.pendingPayouts += r.totalPrice;
    if (st.nextDueAt !== null && (out.nextDueAt === null || st.nextDueAt < out.nextDueAt)) out.nextDueAt = st.nextDueAt;
  }
  return out;
}

/** Pure: maps fetched `{publicKey, account}` pairs to dashboard rows. Sorted by next due time, finished agreements last. */
export function toMerchantRows(accounts: { publicKey: PublicKey; account: any }[], nowUnix: number): MerchantAgreementRow[] {
  return accounts
    .map(({ publicKey, account }) => ({
      address: publicKey,
      buyer: account.buyer as PublicKey,
      productId: account.productId as string,
      totalPrice: big(account.totalPrice),
      escrowDeposited: big(account.escrowDeposited),
      status: deriveStatus(account, nowUnix),
    }))
    .sort((a, b) => (a.status.nextDueAt ?? Infinity) - (b.status.nextDueAt ?? Infinity));
}

/** Fetches every agreement for a merchant wallet (memcmp filter on the merchant field) with derived status and totals. */
export async function getMerchantDashboard(
  program: any,
  merchant: PublicKey,
  nowUnix: number = Math.floor(Date.now() / 1000)
): Promise<{ rows: MerchantAgreementRow[]; summary: MerchantSummary }> {
  const accounts = await program.account.bnplAgreement.all([
    { memcmp: { offset: AGREEMENT_MERCHANT_OFFSET, bytes: merchant.toBase58() } },
  ]);
  const rows = toMerchantRows(accounts, nowUnix);
  return { rows, summary: summarizeMerchant(rows) };
}

// ---------------------------------------------------------------------------
// Merchant action builders (v2.2): unsigned instructions for the dashboard
// ---------------------------------------------------------------------------

export interface BuildMerchantActionParams {
  /** An Anchor Program loaded with the Relic Pay IDL. */
  program: any;
  agreement: PublicKey;
  /** Merchant token account for the payout. Defaults to the merchant's associated USDC account. */
  merchantUsdc?: PublicKey;
  nowUnix?: number;
}

export interface BuiltMerchantAction {
  instruction: TransactionInstruction;
  agreement: PublicKey;
  merchantUsdc: PublicKey;
}

async function loadForMerchantAction(p: BuildMerchantActionParams) {
  const acct = await p.program.account.bnplAgreement.fetchNullable(p.agreement);
  if (!acct) throw new Error("agreement not found");
  const status = deriveStatus(acct, p.nowUnix ?? Math.floor(Date.now() / 1000));
  if (status.yieldSource === "kamino") {
    // Kamino agreements may hold collateral outside the escrow; the plain instructions would under-pay. Use the reconciled instructions.
    throw new Error("kamino-sourced agreement: use the reconciled instruction (not yet in the SDK)");
  }
  const merchant = acct.merchant as PublicKey;
  const merchantUsdc = p.merchantUsdc ?? getAssociatedTokenAddressSync(acct.usdcMint as PublicKey, merchant);
  const escrow = escrowAddress(p.program.programId, p.agreement);
  return { acct, status, merchant, merchantUsdc, escrow };
}

/** Unsigned merchant_withdraw. The merchant wallet signs. Throws unless the agreement is completed and unwithdrawn. */
export async function buildMerchantWithdraw(p: BuildMerchantActionParams): Promise<BuiltMerchantAction> {
  const { status, merchant, merchantUsdc, escrow } = await loadForMerchantAction(p);
  if (!status.merchantPayoutPending) throw new Error("nothing to withdraw: agreement is not completed or already withdrawn");
  const instruction: TransactionInstruction = await p.program.methods
    .merchantWithdraw()
    .accounts({
      agreement: p.agreement,
      merchant,
      escrowUsdc: escrow,
      merchantUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
      protocolConfig: protocolConfigAddress(p.program.programId),
    })
    .instruction();
  return { instruction, agreement: p.agreement, merchantUsdc };
}

/** Unsigned trigger_default (permissionless; `caller` pays the fee). Throws before the grace period has expired. */
export async function buildTriggerDefault(p: BuildMerchantActionParams & { caller: PublicKey }): Promise<BuiltMerchantAction> {
  const { status, merchantUsdc, escrow } = await loadForMerchantAction(p);
  if (!status.defaultable) throw new Error("not defaultable: agreement is not active or the grace period has not expired");
  const instruction: TransactionInstruction = await p.program.methods
    .triggerDefault()
    .accounts({
      agreement: p.agreement,
      caller: p.caller,
      escrowUsdc: escrow,
      merchantUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
      protocolConfig: protocolConfigAddress(p.program.programId),
    })
    .instruction();
  return { instruction, agreement: p.agreement, merchantUsdc };
}

// ---------------------------------------------------------------------------
// Merchant dashboard view model (pure formatting, consumed by the Next.js app)
// ---------------------------------------------------------------------------

/** Formats USDC base units (6 decimals) as a fixed 2-decimal dollar string, e.g. 1234500000n -> "1,234.50". Truncates sub-cent dust. */
export function formatUsdc(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const cents = abs / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export type RowTone = "ok" | "due" | "overdue" | "danger" | "done";

export interface MerchantRowView {
  address: string;
  buyer: string;
  productId: string;
  label: string;
  tone: RowTone;
  progress: string; // "2/3 paid"
  owed: string; // formatted USDC the buyer still owes
  nextDueAt: number | null;
  action: "none" | "withdraw" | "default";
}

export interface MerchantDashboardView {
  headline: { label: string; value: string }[];
  rows: MerchantRowView[];
}

/** Pure: turns dashboard rows and a summary into display-ready strings and an action hint per row. */
export function toDashboardView(rows: MerchantAgreementRow[], summary: MerchantSummary): MerchantDashboardView {
  const headline = [
    { label: "Active agreements", value: String(summary.counts.active) },
    { label: "Outstanding receivable (USDC)", value: formatUsdc(summary.outstandingReceivable) },
    { label: "Pending payouts (USDC)", value: formatUsdc(summary.pendingPayouts) },
    { label: "Overdue exposure (USDC)", value: formatUsdc(summary.overdueExposure) },
    { label: "Recoverable on default (USDC)", value: formatUsdc(summary.recoverableOnDefault) },
  ];
  const view = rows.map((r): MerchantRowView => {
    const st = r.status;
    let label = "On schedule";
    let tone: RowTone = "ok";
    let action: MerchantRowView["action"] = "none";
    if (st.phase === "completed") {
      label = st.merchantPayoutPending ? "Payout ready" : "Settled";
      tone = st.merchantPayoutPending ? "due" : "done";
      if (st.merchantPayoutPending) action = "withdraw";
    } else if (st.phase === "defaulted") {
      label = "Defaulted";
      tone = "danger";
    } else if (st.phase === "cancelled") {
      label = "Cancelled";
      tone = "done";
    } else if (st.defaultable) {
      label = "Past grace, can default";
      tone = "danger";
      action = "default";
    } else if (st.overdue) {
      label = "Overdue, in grace";
      tone = "overdue";
    } else if (st.payable) {
      label = "Installment due";
      tone = "due";
    }
    return {
      address: r.address.toBase58(),
      buyer: r.buyer.toBase58(),
      productId: r.productId,
      label,
      tone,
      progress: `${st.paidInstallments}/${st.installmentCount} paid`,
      owed: formatUsdc(st.remainingToPay),
      nextDueAt: st.nextDueAt,
      action,
    };
  });
  return { headline, rows: view };
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

// ---------------------------------------------------------------------------
// Kamino-aware builder (v2.2 SDK slice 3)
// ---------------------------------------------------------------------------

export function kaminoConfigAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("kamino_config")], programId)[0];
}

export function protocolConfigAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], programId)[0];
}

export function kaminoCollateralAddress(programId: PublicKey, agreement: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("kamino_collateral"), agreement.toBuffer()], programId)[0];
}

export interface KaminoConfigView {
  enabled: boolean;
  kaminoProgram: PublicKey;
  lendingMarket: PublicKey;
  lendingMarketAuthority: PublicKey;
  reserve: PublicKey;
  reserveLiquiditySupply: PublicKey;
  reserveCollateralMint: PublicKey;
}

/** Reads the governance KaminoConfig. Returns null if it is not initialized or not enabled. */
export async function fetchKaminoConfig(program: any): Promise<KaminoConfigView | null> {
  const addr = kaminoConfigAddress(program.programId);
  const acct = await program.account.kaminoConfig.fetchNullable(addr);
  if (!acct || !acct.enabled) return null;
  return {
    enabled: true,
    kaminoProgram: acct.kaminoProgram,
    lendingMarket: acct.lendingMarket,
    lendingMarketAuthority: acct.lendingMarketAuthority,
    reserve: acct.reserve,
    reserveLiquiditySupply: acct.reserveLiquiditySupply,
    reserveCollateralMint: acct.reserveCollateralMint,
  };
}

/** Builds create_agreement_kamino, using the accounts governance approved in KaminoConfig. */
export async function buildCreateAgreementKamino(p: BuildCreateAgreementParams & { kaminoConfig: KaminoConfigView }): Promise<BuiltCheckout> {
  const q = quote(p.request);
  const agreement = agreementAddress(p.program.programId, p.buyer, p.request.productId);
  const escrow = escrowAddress(p.program.programId, agreement);
  const bn = (v: bigint | number) => new (require("bn.js"))(v.toString());
  const k = p.kaminoConfig;
  const instruction: TransactionInstruction = await p.program.methods
    .createAgreementKamino(bn(p.request.totalPrice), p.request.installmentCount, bn(p.request.intervalSeconds), p.request.productId, p.request.merchantName)
    .accounts({
      agreement,
      buyer: p.buyer,
      merchant: p.merchant,
      usdcMint: p.usdcMint,
      buyerUsdc: p.buyerUsdc,
      escrowUsdc: escrow,
      protocolConfig: protocolConfigAddress(p.program.programId),
      config: kaminoConfigAddress(p.program.programId),
      kaminoProgram: k.kaminoProgram,
      kaminoLendingMarket: k.lendingMarket,
      kaminoLendingMarketAuthority: k.lendingMarketAuthority,
      kaminoReserve: k.reserve,
      kaminoReserveLiquiditySupply: k.reserveLiquiditySupply,
      kaminoReserveCollateralMint: k.reserveCollateralMint,
      escrowKaminoCollateral: kaminoCollateralAddress(p.program.programId, agreement),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
  return { instruction, agreement, escrow, quote: q };
}

/**
 * One-call checkout: uses create_agreement_kamino when governance has an enabled KaminoConfig,
 * otherwise plain create_agreement. Never blocks a purchase on the DeFi dependency.
 */
export async function buildCheckout(p: BuildCreateAgreementParams): Promise<BuiltCheckout & { kamino: boolean }> {
  quote(p.request); // fail fast before any RPC
  let cfg: KaminoConfigView | null = null;
  try { cfg = await fetchKaminoConfig(p.program); } catch { cfg = null; }
  if (cfg) return { ...(await buildCreateAgreementKamino({ ...p, kaminoConfig: cfg })), kamino: true };
  return { ...(await buildCreateAgreement(p)), kamino: false };
}
