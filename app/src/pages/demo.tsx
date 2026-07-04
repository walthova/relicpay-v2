import { useState, useEffect } from "react";
import { ClaudeGuide } from "../components/ClaudeGuide";

// Simulated purchase: $300 IBG Collection item, 3 installments, 30-day intervals
// For demo purposes we compress time: each "month" advances on button click.

const TOTAL_PRICE = 300;
const INSTALLMENT_COUNT = 3;
const INSTALLMENT_AMOUNT = 100;
const APY_BPS = 300; // 3%
const INTERVAL_DAYS = 30;

type AgreementState = "idle" | "active" | "completed" | "cancelled" | "defaulted";

interface Installment {
  number: number;
  amount: number;
  status: "pending" | "paid" | "due";
  dueDay: number;
  paidAt?: number; // simulated "day"
}

function calcYield(principal: number, daysSinceDeposit: number): number {
  // simple interest: principal × (bps/10000) × (days/365)
  return principal * (APY_BPS / 10_000) * (daysSinceDeposit / 365);
}

function fmt(n: number) {
  return n.toFixed(4);
}

export default function Demo() {
  const [state, setState] = useState<AgreementState>("idle");
  const [day, setDay] = useState(0); // simulated current day
  const [escrow, setEscrow] = useState(0);
  const [yieldAccrued, setYieldAccrued] = useState(0);
  const [paidCount, setPaidCount] = useState(0);
  const [merchantReceived, setMerchantReceived] = useState(0);
  const [buyerYield, setBuyerYield] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);

  // Tick yield every second in demo (represents time passing)
  useEffect(() => {
    if (state !== "active") return;
    const id = setInterval(() => {
      // Each second = 1 simulated minute of yield accrual for visual effect
      setYieldAccrued((prev) => {
        const perSecond = escrow * (APY_BPS / 10_000) / (365 * 24 * 60 * 60);
        return prev + perSecond * 60; // 1 second = 60 simulated minutes
      });
    }, 1000);
    return () => clearInterval(id);
  }, [state, escrow]);

  const addLog = (msg: string) => setLog((prev) => [...prev, msg]);

  const handleCreate = () => {
    const installs: Installment[] = Array.from({ length: INSTALLMENT_COUNT }, (_, i) => ({
      number: i + 1,
      amount: INSTALLMENT_AMOUNT,
      status: i === 0 ? "paid" : "pending",
      dueDay: (i + 1) * INTERVAL_DAYS,
    }));
    installs[0].paidAt = 0;

    setInstallments(installs);
    setEscrow(INSTALLMENT_AMOUNT);
    setPaidCount(1);
    setDay(0);
    setYieldAccrued(0);
    setState("active");
    addLog(`Day 0 — Agreement created. Installment 1 ($${INSTALLMENT_AMOUNT}) → escrow.`);
  };

  const handlePayNext = () => {
    const nextNum = paidCount + 1;
    if (nextNum > INSTALLMENT_COUNT) return;

    const newDay = nextNum * INTERVAL_DAYS;

    // Accrue yield for this window
    const elapsedDays = newDay - day;
    const windowYield = calcYield(escrow, elapsedDays);
    const totalYield = yieldAccrued + windowYield;

    const newEscrow = escrow + INSTALLMENT_AMOUNT;
    const newPaid = nextNum;

    setYieldAccrued(totalYield);
    setEscrow(newEscrow);
    setPaidCount(newPaid);
    setDay(newDay);

    setInstallments((prev) =>
      prev.map((inst) =>
        inst.number === nextNum ? { ...inst, status: "paid", paidAt: newDay } : inst
      )
    );

    addLog(
      `Day ${newDay} — Installment ${nextNum} ($${INSTALLMENT_AMOUNT}) paid. Yield accrued this window: $${fmt(windowYield)}. Total yield: $${fmt(totalYield)}.`
    );

    if (newPaid === INSTALLMENT_COUNT) {
      setState("completed");
      addLog(`Day ${newDay} — Agreement COMPLETED. Merchant can now withdraw $${TOTAL_PRICE}. Buyer can claim $${fmt(totalYield)} yield.`);
    }
  };

  const handleMerchantWithdraw = () => {
    setMerchantReceived(TOTAL_PRICE);
    setEscrow((prev) => prev - TOTAL_PRICE);
    addLog(`Merchant withdrew $${TOTAL_PRICE} USDC. Buyer yield ($${fmt(yieldAccrued)}) remains claimable.`);
  };

  const handleClaimYield = () => {
    setBuyerYield(yieldAccrued);
    setYieldAccrued(0);
    addLog(`Buyer claimed $${fmt(buyerYield || yieldAccrued)} USDC yield from protocol reserve.`);
  };

  const handleCancel = () => {
    const fee = escrow * 0.1;
    const refund = escrow - fee;
    setEscrow(0);
    setState("cancelled");
    addLog(`Agreement cancelled. Merchant received $${fmt(fee)} (10% fee). Buyer refunded $${fmt(refund)}.`);
  };

  const handleReset = () => {
    setState("idle");
    setDay(0);
    setEscrow(0);
    setYieldAccrued(0);
    setPaidCount(0);
    setMerchantReceived(0);
    setBuyerYield(0);
    setLog([]);
    setInstallments([]);
  };

  const nextInstallmentDue = state === "active" && paidCount < INSTALLMENT_COUNT
    ? installments[paidCount]?.dueDay
    : null;

  return (
    <div style={page}>
      <nav style={nav}>
        <a href="/" style={navLink}>Relic Pay</a>
        <span style={{ color: "#64748b" }}>/ Demo</span>
        <a href="/docs" style={{ ...navLink, marginLeft: "auto", fontSize: 13 }}>Docs</a>
      </nav>

      <h1 style={h1}>Interactive Demo</h1>
      <p style={subtitle}>
        No wallet needed. This simulates a $300 IBG Collection purchase split into 3 monthly installments.
        Watch yield accrue in real time. Ask Claude anything using the guide below.
      </p>

      <div style={grid}>
        {/* LEFT: Simulation */}
        <div style={panel}>
          <div style={panelHeader}>
            <span>Agreement Simulator</span>
            <span style={stateTag(state)}>{state.toUpperCase()}</span>
          </div>

          {/* Item card */}
          <div style={itemCard}>
            <div style={itemImage}>
              <span style={{ fontSize: 32 }}>◼◯▲</span>
            </div>
            <div style={itemInfo}>
              <div style={itemName}>IBG Collection — Optic Relic #001</div>
              <div style={itemPrice}>${TOTAL_PRICE}.00</div>
              <div style={itemSub}>3 × ${INSTALLMENT_AMOUNT}/month · 3% APY yield on escrow</div>
            </div>
          </div>

          {/* Installment schedule */}
          {installments.length > 0 && (
            <div style={scheduleBox}>
              <div style={scheduleTitle}>Payment Schedule</div>
              {installments.map((inst) => (
                <div key={inst.number} style={scheduleRow(inst.status)}>
                  <span style={{ fontWeight: 600 }}>#{inst.number}</span>
                  <span>${inst.amount}</span>
                  <span>Day {inst.dueDay}</span>
                  <span style={scheduleStatus(inst.status)}>
                    {inst.status === "paid" ? `Paid day ${inst.paidAt}` : `Pending`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Stats */}
          {state !== "idle" && (
            <div style={statsGrid}>
              <Stat label="Escrow Balance" value={`$${fmt(escrow)}`} color="#22d3ee" />
              <Stat label="Yield Accrued" value={`$${fmt(yieldAccrued)}`} color="#a5b4fc" />
              <Stat label="Simulated Day" value={`${day}`} color="#94a3b8" />
              {merchantReceived > 0 && (
                <Stat label="Merchant Received" value={`$${merchantReceived}`} color="#4ade80" />
              )}
            </div>
          )}

          {/* Actions */}
          <div style={actions}>
            {state === "idle" && (
              <Btn onClick={handleCreate} color="#6366f1">
                Start Agreement — Pay Installment 1
              </Btn>
            )}

            {state === "active" && paidCount < INSTALLMENT_COUNT && (
              <>
                <Btn onClick={handlePayNext} color="#6366f1">
                  Advance to Day {nextInstallmentDue} — Pay Installment {paidCount + 1}
                </Btn>
                <Btn onClick={handleCancel} color="#ef4444" outline>
                  Cancel Agreement (10% fee)
                </Btn>
              </>
            )}

            {state === "completed" && (
              <>
                {merchantReceived === 0 && (
                  <Btn onClick={handleMerchantWithdraw} color="#4ade80">
                    Merchant: Withdraw $300
                  </Btn>
                )}
                {yieldAccrued > 0 && (
                  <Btn onClick={handleClaimYield} color="#a5b4fc">
                    Buyer: Claim ${fmt(yieldAccrued)} Yield
                  </Btn>
                )}
                {merchantReceived > 0 && yieldAccrued === 0 && (
                  <div style={{ color: "#4ade80", textAlign: "center", padding: 12, fontSize: 14 }}>
                    All done. Merchant received ${merchantReceived}. Buyer earned ${fmt(buyerYield)} yield.
                  </div>
                )}
              </>
            )}

            {(state === "cancelled" || state === "defaulted") && (
              <Btn onClick={handleReset} color="#64748b">
                Reset Demo
              </Btn>
            )}

            {state === "completed" && merchantReceived > 0 && yieldAccrued === 0 && (
              <Btn onClick={handleReset} color="#64748b" outline>
                Run Again
              </Btn>
            )}
          </div>

          {/* Activity log */}
          {log.length > 0 && (
            <div style={logBox}>
              <div style={logTitle}>Activity Log</div>
              {log.map((entry, i) => (
                <div key={i} style={logEntry}>{entry}</div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Claude Guide */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ClaudeGuide />
          <div style={linksBox}>
            <a href="/docs/WHITEPAPER" style={docLink}>Read Whitepaper</a>
            <a href="/docs/TECHNICAL_BREAKDOWN" style={docLink}>Technical Breakdown</a>
            <a href="https://github.com/walthova/relicpay-claude" style={docLink} target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </div>
      </div>

      <style jsx global>{`
        body, html { margin: 0; padding: 0; background: #0f172a; color: #e2e8f0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; }
        input { font-family: inherit; }
        button { font-family: inherit; }
      `}</style>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Btn({
  onClick,
  color,
  outline,
  children,
}: {
  onClick: () => void;
  color: string;
  outline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: outline ? "transparent" : color,
        border: `1px solid ${color}`,
        color: outline ? color : "white",
        borderRadius: 10,
        padding: "11px 20px",
        fontSize: 13.5,
        fontWeight: 600,
        cursor: "pointer",
        width: "100%",
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const page: React.CSSProperties = {
  maxWidth: 1280,
  margin: "0 auto",
  padding: "24px 20px 80px",
};

const nav: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 40,
  paddingBottom: 16,
  borderBottom: "1px solid rgba(148,163,184,0.12)",
};

const navLink: React.CSSProperties = {
  color: "#a5b4fc",
  textDecoration: "none",
  fontWeight: 700,
};

const h1: React.CSSProperties = {
  fontSize: "2rem",
  fontWeight: 900,
  letterSpacing: "-0.03em",
  margin: "0 0 8px",
  background: "linear-gradient(135deg, #a5b4fc, #22d3ee)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
};

const subtitle: React.CSSProperties = {
  color: "#94a3b8",
  marginBottom: 40,
  maxWidth: 680,
  lineHeight: 1.6,
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 480px",
  gap: 32,
  alignItems: "start",
};

const panel: React.CSSProperties = {
  background: "rgba(15, 23, 42, 0.8)",
  border: "1px solid rgba(148, 163, 184, 0.15)",
  borderRadius: 16,
  overflow: "hidden",
};

const panelHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "14px 20px",
  borderBottom: "1px solid rgba(148,163,184,0.12)",
  fontWeight: 600,
  fontSize: 14,
  color: "#cbd5e1",
};

function stateTag(s: AgreementState): React.CSSProperties {
  const colors: Record<AgreementState, string> = {
    idle: "#64748b",
    active: "#22d3ee",
    completed: "#4ade80",
    cancelled: "#f59e0b",
    defaulted: "#ef4444",
  };
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: colors[s],
    border: `1px solid ${colors[s]}`,
    borderRadius: 20,
    padding: "2px 10px",
  };
}

const itemCard: React.CSSProperties = {
  display: "flex",
  gap: 16,
  padding: 20,
  borderBottom: "1px solid rgba(148,163,184,0.12)",
};

const itemImage: React.CSSProperties = {
  width: 80,
  height: 80,
  background: "linear-gradient(135deg, rgba(99,102,241,0.25), rgba(34,211,238,0.15))",
  borderRadius: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const itemInfo: React.CSSProperties = { flex: 1 };
const itemName: React.CSSProperties = { fontWeight: 600, marginBottom: 4, fontSize: 15 };
const itemPrice: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: "#22d3ee",
  marginBottom: 4,
};
const itemSub: React.CSSProperties = { fontSize: 12, color: "#64748b" };

const scheduleBox: React.CSSProperties = {
  padding: "16px 20px",
  borderBottom: "1px solid rgba(148,163,184,0.12)",
};

const scheduleTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#64748b",
  letterSpacing: "0.08em",
  marginBottom: 10,
};

function scheduleRow(status: string): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "32px 60px 60px 1fr",
    gap: 8,
    padding: "6px 0",
    fontSize: 13,
    color: status === "paid" ? "#e2e8f0" : "#64748b",
    borderBottom: "1px solid rgba(148,163,184,0.06)",
  };
}

function scheduleStatus(status: string): React.CSSProperties {
  return {
    color: status === "paid" ? "#4ade80" : "#64748b",
    fontSize: 12,
  };
}

const statsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 12,
  padding: "16px 20px",
  borderBottom: "1px solid rgba(148,163,184,0.12)",
};

const actions: React.CSSProperties = {
  padding: "16px 20px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const logBox: React.CSSProperties = {
  padding: "16px 20px",
  borderTop: "1px solid rgba(148,163,184,0.12)",
  maxHeight: 200,
  overflowY: "auto",
};

const logTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#64748b",
  letterSpacing: "0.08em",
  marginBottom: 10,
};

const logEntry: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
  paddingBottom: 6,
  marginBottom: 6,
  borderBottom: "1px solid rgba(148,163,184,0.06)",
  lineHeight: 1.5,
};

const linksBox: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const docLink: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  textDecoration: "none",
  background: "rgba(30,27,75,0.5)",
  border: "1px solid rgba(148,163,184,0.15)",
  borderRadius: 8,
  padding: "6px 12px",
  transition: "all 0.15s",
};
