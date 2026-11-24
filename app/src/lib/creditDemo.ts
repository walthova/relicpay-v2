export const COLLATERAL = 500;
export const CREDIT_LIMIT = 400;
export const MERCHANT = "IBG Collection";
export const PURCHASE_PRICE = 180;
export const REPAYMENTS = [30, 60, 90] as const;
export const PAYMENT_AMOUNT = PURCHASE_PRICE / REPAYMENTS.length;
export const CAP_OPTIONS = [120, 200, 250] as const;
export const AGENTS = {
  atlas: { name: "Atlas", role: "Procurement agent", cap: 250, merchant: MERCHANT, expiry: 45 },
  nova: { name: "Nova", role: "Research agent", cap: 150, merchant: "Compute Supply", expiry: 30 },
} as const;

export type AgentId = keyof typeof AGENTS;
type Cap = (typeof CAP_OPTIONS)[number];
type Event = { title: string; detail: string; day: number; tone: "neutral" | "paid" | "blocked" };
type Draw = { agent: AgentId; openedDay: number; installmentsPaid: number };

export type Demo = {
  opened: boolean;
  day: number;
  atlasCap: Cap;
  revoked: Partial<Record<AgentId, true>>;
  draw: Draw | null;
  events: Event[];
};

export type Action =
  | { type: "set-cap"; cap: Cap }
  | { type: "open" }
  | { type: "attempt"; agent: AgentId }
  | { type: "advance" }
  | { type: "repay" }
  | { type: "revoke"; agent: AgentId }
  | { type: "reset" };

export function initialDemo(): Demo {
  return { opened: false, day: 0, atlasCap: 250, revoked: {}, draw: null, events: [] };
}

export function getBalances(demo: Demo) {
  const paid = (demo.draw?.installmentsPaid ?? 0) * PAYMENT_AMOUNT;
  const merchantPaid = demo.draw ? PURCHASE_PRICE : 0;
  const outstanding = merchantPaid - paid;
  return {
    collateral: demo.opened ? COLLATERAL : 0,
    available: demo.opened ? CREDIT_LIMIT - outstanding : 0,
    merchantPaid,
    paid,
    outstanding,
    day: demo.day,
  };
}

export function getCap(demo: Demo, agent: AgentId) {
  return agent === "atlas" ? demo.atlasCap : AGENTS[agent].cap;
}

function record(demo: Demo, title: string, detail: string, tone: Event["tone"] = "neutral"): Demo {
  return { ...demo, events: [...demo.events, { title, detail, day: getBalances(demo).day, tone }] };
}

export function reduceDemo(demo: Demo, action: Action): Demo {
  switch (action.type) {
    case "set-cap":
      return demo.opened ? demo : { ...demo, atlasCap: action.cap };
    case "open":
      if (demo.opened) return demo;
      return record({ ...demo, opened: true }, "Shared credit line opened", "The owner locked demo collateral and authorized Atlas and Nova.");
    case "advance":
      if (!demo.opened || demo.draw || demo.day > AGENTS.atlas.expiry) return demo;
      return record({ ...demo, day: AGENTS.atlas.expiry + 1 }, "Agent permissions expired", "The demo clock moved past both agents’ spending windows.");
    case "attempt": {
      if (!demo.opened || demo.draw) return demo;
      const agent = AGENTS[action.agent];
      const reason = demo.revoked[action.agent]
        ? "The owner revoked this agent’s permission."
        : demo.day > agent.expiry
          ? "This agent’s spending window has ended."
          : agent.merchant !== MERCHANT
          ? `${MERCHANT} is not on this agent’s merchant list.`
          : PURCHASE_PRICE > getCap(demo, action.agent)
            ? "This purchase exceeds the agent’s spending cap."
            : null;
      if (reason) return record(demo, `${agent.name}’s purchase blocked`, reason, "blocked");
      return record(
        { ...demo, draw: { agent: action.agent, openedDay: demo.day, installmentsPaid: 0 } },
        `${MERCHANT} paid up front`,
        `${agent.name} drew ${PURCHASE_PRICE} USDC. The lending pool paid the merchant, and the owner owes repayment.`,
        "paid",
      );
    }
    case "repay": {
      if (!demo.draw || demo.draw.installmentsPaid === REPAYMENTS.length) return demo;
      const installmentsPaid = demo.draw.installmentsPaid + 1;
      return record(
        { ...demo, day: demo.draw.openedDay + REPAYMENTS[installmentsPaid - 1], draw: { ...demo.draw, installmentsPaid } },
        installmentsPaid === REPAYMENTS.length ? "Credit draw repaid" : `Installment ${installmentsPaid} repaid`,
        `The owner returned ${PAYMENT_AMOUNT} USDC to the lending pool.`,
        "paid",
      );
    }
    case "revoke":
      if (!demo.opened || demo.revoked[action.agent]) return demo;
      return record(
        { ...demo, revoked: { ...demo.revoked, [action.agent]: true } },
        `${AGENTS[action.agent].name}’s access revoked`,
        "Other agent permissions and any existing repayment are unchanged.",
      );
    case "reset":
      return initialDemo();
  }
}
