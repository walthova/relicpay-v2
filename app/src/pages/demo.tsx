import Head from "next/head";
import { useReducer, useRef, useState } from "react";
import type { Dispatch, ReactNode, Ref } from "react";
import {
  AGENTS, CAP_OPTIONS, COLLATERAL, CREDIT_LIMIT, MERCHANT, PAYMENT_AMOUNT, PURCHASE_PRICE,
  REPAYMENTS, getBalances, getCap, getPurchaseBlock, initialDemo, reduceDemo,
} from "../lib/creditDemo";
import type { Action, AgentId, Demo } from "../lib/creditDemo";
import styles from "./demo.module.css";

const steps = ["Set up credit", "Authorize purchase", "Repay the draw", "Review the record"];
const views = ["Owner workspace", "Merchant view", "Activity"] as const;
const agentIds = Object.keys(AGENTS) as AgentId[];
const yieldSnapshots = ["0.00", "0.12", "0.23", "0.31"];

const icons = {
  logo: "M12 2 22 7.5v9L12 22 2 16.5v-9L12 2Zm0 0v20M2 7.5l10 5.5 10-5.5",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  down: "M12 4v15m-6-6 6 6 6-6",
  check: "m5 12 4 4L19 6",
  wallet: "M4 6h15a1 1 0 0 1 1 1v12H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13m3 6h-5a2 2 0 0 0 0 4h5",
  shield: "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-11 2 2 4-4",
  bolt: "m13 2-9 12h7l-1 8 10-12h-7l1-8Z",
  spark: "M12 2c0 6 4 10 10 10-6 0-10 4-10 10 0-6-4-10-10-10 6 0 10-4 10-10Z",
  activity: "M3 12h4l3-7 4 14 3-7h4",
  reset: "M4 11a8 8 0 1 1 2 6M4 5v6h6",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-11v5m0-9h.01",
} as const;

function Icon({ name, size = 18 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={icons[name]} />
    </svg>
  );
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "paid" | "blocked" }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="intro-title">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>RELIC PAY STUDIO</p>
        <h1 id="intro-title">Agent credit.<br /><em>Owner control.</em></h1>
        <p>Give your agents buying power without handing over your collateral. You set the rules, the merchant gets paid up front, and you repay on your schedule.</p>
        <a className={styles.primary} href="#workspace">Try the demo <Icon name="down" size={16} /></a>
      </div>
      <div className={styles.heroArt} aria-hidden="true">
        <svg viewBox="0 0 420 320" fill="none">
          <defs>
            <linearGradient id="edge" x1="38" y1="44" x2="388" y2="285" gradientUnits="userSpaceOnUse">
              <stop stopColor="#2a615a" />
              <stop offset=".54" stopColor="#8ff4c5" />
              <stop offset="1" stopColor="#254241" />
            </linearGradient>
            <radialGradient id="core">
              <stop stopColor="#4aecb5" stopOpacity=".28" />
              <stop offset="1" stopColor="#4aecb5" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="214" cy="160" r="135" fill="url(#core)" />
          <circle cx="214" cy="160" r="119" stroke="url(#edge)" strokeDasharray="2 7" />
          <circle cx="214" cy="160" r="92" stroke="#396257" strokeOpacity=".55" />
          <ellipse cx="214" cy="160" rx="177" ry="66" transform="rotate(-24 214 160)" stroke="url(#edge)" />
          <ellipse cx="214" cy="160" rx="177" ry="66" transform="rotate(24 214 160)" stroke="url(#edge)" strokeOpacity=".6" />
          <path d="M214 78 287 120v80l-73 42-73-42v-80l73-42Z" fill="#112925" stroke="url(#edge)" />
          <path d="m214 95 57 32v66l-57 32-57-32v-66l57-32Z" fill="#173a33" stroke="#79c8a9" />
          <path d="m214 117 38 22v42l-38 22-38-22v-42l38-22Z" stroke="#5b9d8b" />
          <path d="M214 137 234 148v23l-20 12-20-12v-23l20-11Zm0 0v46m-20-35 20 12 20-12" stroke="#a6f5d1" strokeWidth="2" />
          <circle cx="82" cy="232" r="5" fill="#9cf2ce" />
          <circle cx="347" cy="92" r="5" fill="#9cf2ce" />
          <circle cx="374" cy="198" r="3" fill="#9cf2ce" />
          <circle cx="117" cy="79" r="3" fill="#9cf2ce" />
        </svg>
        <span className={styles.artTop}>01 / CREDIT LAB</span>
        <span className={styles.artBottom}>OWNER → AGENT → MERCHANT</span>
      </div>
    </section>
  );
}

function Metric({ label, value, detail, icon }: {
  label: string; value: number | null; detail: string; icon: keyof typeof icons;
}) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}><Icon name={icon} />{label}</span>
      <p>{value === null ? "—" : <>{value} <span>USDC</span></>}</p>
      <small>{detail}</small>
    </div>
  );
}

function AgentCard({ id, demo, dispatch, capSelectRef }: {
  id: AgentId; demo: Demo; dispatch: Dispatch<Action>; capSelectRef?: Ref<HTMLSelectElement>;
}) {
  const agent = AGENTS[id];
  const revoked = demo.revoked[id];
  const expired = demo.day > agent.expiry;
  const status = revoked ? "Revoked" : expired ? "Expired" : demo.opened ? "Authorized" : "Draft";
  return (
    <article className={styles.agent}>
      <div className={styles.agentHeader}>
        <span className={styles.avatar} data-agent={id}><Icon name={id === "atlas" ? "bolt" : "spark"} /></span>
        <div><h3>{agent.name}</h3><p>{agent.role}</p></div>
        <Badge tone={revoked || expired ? "blocked" : demo.opened ? "paid" : "neutral"}>{status}</Badge>
      </div>
      <dl>
        <div>
          <dt>{!demo.opened && id === "atlas" ? <label htmlFor="atlas-cap">Spend cap</label> : "Spend cap"}</dt>
          <dd>{!demo.opened && id === "atlas" ? (
            <select ref={capSelectRef} id="atlas-cap" value={demo.atlasCap} onChange={(event) => {
              const cap = CAP_OPTIONS.find((option) => String(option) === event.target.value);
              if (cap !== undefined) dispatch({ type: "set-cap", cap });
            }}>
              {CAP_OPTIONS.map((cap) => <option key={cap} value={cap}>{cap} USDC</option>)}
            </select>
          ) : `${getCap(demo, id)} USDC`}</dd>
        </div>
        <div><dt>Allowed merchant</dt><dd>{agent.merchant}</dd></div>
        <div><dt>Spending window</dt><dd>Through day {agent.expiry}</dd></div>
      </dl>
      {demo.opened && !revoked && !expired && (
        <button type="button" className={styles.textButton} onClick={() => dispatch({ type: "revoke", agent: id })}>
          Revoke {agent.name}
        </button>
      )}
    </article>
  );
}

function PurchaseCard({ demo, dispatch, onReview, onReset }: {
  demo: Demo; dispatch: Dispatch<Action>; onReview: () => void; onReset: () => void;
}) {
  const { paid, outstanding } = getBalances(demo);
  const latest = demo.events.at(-1);
  const blockedFeedback = latest?.tone === "blocked" ? latest : null;
  const count = demo.draw?.installmentsPaid ?? 0;
  const nextDay = (demo.draw?.openedDay ?? 0) + REPAYMENTS[count];
  const complete = demo.draw && outstanding === 0;
  const block = demo.opened && !demo.draw ? getPurchaseBlock(demo, "atlas") : null;
  const label = !demo.opened ? "Open demo credit line" : !demo.draw ? "Simulate Atlas purchase" :
    complete ? "Review activity" : `Repay ${PAYMENT_AMOUNT} USDC · day ${nextDay}`;
  const description = !demo.opened
    ? `Lock ${COLLATERAL} demo USDC as collateral and authorize both agents under one ${CREDIT_LIMIT} USDC line.`
    : !demo.draw
      ? "Try as Nova to see a blocked request, then simulate an approved Atlas purchase."
      : complete
        ? "The line is restored. The merchant was paid at purchase, not at the end of the plan."
        : "The lending pool already paid the merchant. Each repayment reduces what the owner owes.";
  function takeNextStep() {
    if (!demo.opened) dispatch({ type: "open" });
    else if (!demo.draw) dispatch({ type: "attempt", agent: "atlas" });
    else if (!complete) dispatch({ type: "repay" });
    else onReview();
  }

  return (
    <section className={styles.panel} aria-labelledby="purchase-title">
      <div className={styles.panelHeading}>
        <h2 id="purchase-title">Atlas purchase</h2>
        <Badge tone={block ? "blocked" : demo.draw ? "paid" : "neutral"}>{block ? "Blocked" : complete ? "Repaid" : demo.draw ? "Merchant paid" : "Not purchased"}</Badge>
      </div>
      <div className={styles.product}>
        <span className={styles.productArt}><Icon name="logo" size={26} /></span>
        <div><strong>Optic Relic #001</strong><p>{MERCHANT} · Digital collectible</p></div>
        <span className={styles.productPrice}>{PURCHASE_PRICE} <small>USDC</small></span>
      </div>
      <h3 className={styles.scheduleTitle}>Repayment schedule</h3>
      <ol className={styles.schedule}>
        {REPAYMENTS.map((day, i) => (
          <li key={day}>
            <span className={styles.scheduleIndex}>{i < count ? <Icon name="check" size={15} /> : `0${i + 1}`}</span>
            <span>Day {(demo.draw?.openedDay ?? 0) + day}</span>
            <span>{PAYMENT_AMOUNT} USDC</span>
            <span className={i < count ? styles.goodText : styles.muted}>{i < count ? "Paid" : demo.draw && i === count ? "Next" : "Scheduled"}</span>
          </li>
        ))}
      </ol>
      {demo.draw && <progress className={styles.progress} aria-label="Repayment progress" value={paid} max={PURCHASE_PRICE} />}
      <div className={styles.nextAction}>
        {block && <div className={styles.purchaseBlock}>
          <div className={styles.purchaseBlockHeading}><Icon name="shield" size={17} /><h3>{block.title}</h3></div>
          <p>{block.detail}</p>
          <p>{demo.atlasCap < PURCHASE_PRICE
            ? `Reset to choose a cap of at least ${PURCHASE_PRICE} USDC and reopen the credit line.`
            : "Reset to return to day 0 and authorize Atlas again."} This clears the demo session.</p>
          <button type="button" className={styles.primary} onClick={onReset}>Reset &amp; review permissions <Icon name="reset" size={16} /></button>
        </div>}
        <div role="status" aria-atomic="true">
          {blockedFeedback && <div id="purchase-feedback" className={`${styles.notice} ${styles.purchaseFeedback}`} data-tone="blocked">
            <Icon name="shield" />
            <div>
              <span className={styles.noticeLabel}>Latest action · Day {blockedFeedback.day}</span>
              <p><strong>{blockedFeedback.title}.</strong> {blockedFeedback.detail}</p>
            </div>
          </div>}
        </div>
        {!block && <>
          {!blockedFeedback && <p>{description}</p>}
          <button type="button" className={styles.primary} onClick={takeNextStep} aria-describedby={blockedFeedback ? "purchase-feedback" : undefined}>{label} <Icon name="arrow" size={16} /></button>
        </>}
        {demo.opened && !demo.draw && <div className={styles.secondaryActions}>
          <button type="button" className={styles.textButton} onClick={() => dispatch({ type: "attempt", agent: "nova" })} aria-describedby={blockedFeedback ? "purchase-feedback" : undefined}>Try as Nova</button>
          {demo.day <= AGENTS.atlas.expiry && <button type="button" className={styles.textButton} onClick={() => dispatch({ type: "advance" })}>Skip past expiry</button>}
        </div>}
      </div>
    </section>
  );
}

function MerchantView({ demo }: { demo: Demo }) {
  const { merchantPaid } = getBalances(demo);
  return (
    <section className={`${styles.panel} ${styles.viewPanel}`} aria-labelledby="merchant-title">
      <div className={styles.panelHeading}><h2 id="merchant-title">{MERCHANT}</h2><Badge>Simulated merchant</Badge></div>
      <p>The merchant receives the full purchase amount from a separate lending pool when a draw is approved. Owner collateral stays locked; later repayments go back to that pool, not to the merchant.</p>
      <div className={styles.receipt}>
        <div><span className={styles.eyebrow}>OPTIC RELIC #001</span><h3>{merchantPaid} <small>USDC received</small></h3></div>
        <Badge tone={merchantPaid ? "paid" : "neutral"}>{merchantPaid ? "Paid up front" : "Awaiting approved purchase"}</Badge>
      </div>
      {demo.draw && <dl className={styles.receiptDetails}>
        <div><dt>Accountable party</dt><dd>Demo owner</dd></div>
        <div><dt>Requested by</dt><dd>{AGENTS[demo.draw.agent].name}</dd></div>
        <div><dt>Payment source</dt><dd>Lending pool</dd></div>
        <div><dt>Paid on</dt><dd>Day {demo.draw.openedDay}</dd></div>
      </dl>}
    </section>
  );
}

function ActivityView({ demo }: { demo: Demo }) {
  return (
    <section className={`${styles.panel} ${styles.viewPanel}`} aria-labelledby="activity-title">
      <div className={styles.panelHeading}><h2 id="activity-title">Activity record</h2><Badge>Session only</Badge></div>
      {demo.events.length === 0 ? <p>No activity yet. Open the demo credit line to start recording actions.</p> : (
        <ol className={styles.events}>
          {demo.events.map((event, index) => (
            <li key={index} className={styles.event}>
              <span className={styles.eventIcon} data-tone={event.tone}><Icon name={event.tone === "paid" ? "check" : event.tone === "blocked" ? "shield" : "activity"} size={16} /></span>
              <div><strong>{event.title}</strong><p>{event.detail}</p></div>
              <span className={styles.eventDay}>Day {event.day}</span>
            </li>
          )).reverse()}
        </ol>
      )}
    </section>
  );
}

export default function CreditDemoPage() {
  const [demo, dispatch] = useReducer(reduceDemo, undefined, initialDemo);
  const [view, setView] = useState<(typeof views)[number]>(views[0]);
  const activityButton = useRef<HTMLButtonElement>(null);
  const atlasCapSelect = useRef<HTMLSelectElement>(null);
  const { available, collateral, outstanding, day } = getBalances(demo);
  const step = !demo.opened ? 0 : !demo.draw ? 1 : outstanding > 0 ? 2 : 3;
  const latest = demo.events.at(-1);

  return (
    <div className={styles.page}>
      <Head>
        <title>Relic Pay · Agent Credit Demo</title>
        <meta name="description" content="Try owner-controlled credit for AI agents in a wallet-free Relic Pay simulation." />
      </Head>
      <header className={styles.topbar}>
        <div className={styles.innerTopbar}>
          <a href="/" className={styles.brand}><span><Icon name="logo" size={20} /></span>Relic Pay</a>
          <span className={styles.mode}><i /> Local simulation</span>
        </div>
      </header>
      <main className={styles.shell}>
        <Hero />
        <aside className={styles.disclaimer}>
          <Icon name="info" />
          <p><strong>Demo only.</strong> Balances, agent permissions, merchant payments, and collateral yield are simulated. No wallet, real funds, or on-chain transactions.</p>
        </aside>
        <section className={styles.workspace} id="workspace" aria-labelledby="workspace-title">
          <div className={styles.workspaceHeader}>
            <div><p className={styles.eyebrow}>INTERACTIVE WALKTHROUGH</p><h2 id="workspace-title">Credit workspace</h2></div>
            <div className={styles.sessionControls}>
              <Badge>Day {day}</Badge>
              <button type="button" className={styles.subtle} disabled={!demo.opened && demo.atlasCap === AGENTS.atlas.cap}
                onClick={() => { dispatch({ type: "reset" }); setView(views[0]); }}>
                <Icon name="reset" size={16} /> Reset demo
              </button>
            </div>
          </div>
          <ol className={styles.steps} aria-label="Demo steps">
            {steps.map((label, index) => (
              <li key={label} aria-current={index === step ? "step" : undefined} data-done={index < step}>
                <span>{index < step ? <Icon name="check" size={15} /> : `0${index + 1}`}</span>{label}
              </li>
            ))}
          </ol>
          <div className={styles.metrics}>
            <Metric label="Available credit" value={demo.opened ? available : null} detail={`Shared line · ${CREDIT_LIMIT} USDC limit`} icon="bolt" />
            <Metric label="Collateral locked" value={demo.opened ? collateral : null} detail="Stays separate from the lending pool" icon="shield" />
            <Metric label="Owner owes" value={demo.opened ? outstanding : null} detail="Repaid to the lending pool" icon="wallet" />
          </div>
          <div className={styles.views} role="group" aria-label="Workspace view">
            {views.map((item) => (
              <button type="button" key={item} ref={item === "Activity" ? activityButton : undefined}
                aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>
            ))}
          </div>
          <div className={styles.noticeSlot} role="status" aria-atomic="true">
            {latest && !(view === "Owner workspace" && latest.tone === "blocked") && <div className={styles.notice} data-tone={latest.tone}>
              <Icon name={latest.tone === "blocked" ? "shield" : latest.tone === "paid" ? "check" : "info"} />
              <div>
                <span className={styles.noticeLabel}>Latest action · Day {latest.day}</span>
                <p><strong>{latest.title}.</strong> {latest.detail}</p>
              </div>
            </div>}
          </div>
          {view === "Owner workspace" ? (
            <div className={styles.workspaceGrid}>
              <section className={styles.panel} aria-labelledby="agent-title">
                <div className={styles.panelHeading}><h2 id="agent-title">Agent permissions</h2><Badge>One shared line</Badge></div>
                <p className={styles.panelDescription}>The owner remains responsible for every draw. Each agent gets its own cap, merchant, and spending window.</p>
                <div className={styles.agents}>{agentIds.map((id) => <AgentCard key={id} id={id} demo={demo} dispatch={dispatch} capSelectRef={id === "atlas" ? atlasCapSelect : undefined} />)}</div>
              </section>
              <PurchaseCard demo={demo} dispatch={dispatch} onReset={() => {
                dispatch({ type: "reset" });
                requestAnimationFrame(() => atlasCapSelect.current?.focus());
              }} onReview={() => {
                setView("Activity");
                activityButton.current?.focus();
              }} />
            </div>
          ) : view === "Merchant view" ? <MerchantView demo={demo} /> : <ActivityView demo={demo} />}
          <aside className={styles.yieldNote}>
            <span><Icon name="spark" /></span>
            <div><h3>Collateral yield · simulated</h3><p>Illustrative snapshots, not live returns. Yield is separate from credit and merchant payments.</p></div>
            <strong>{demo.opened ? `${yieldSnapshots[demo.draw?.installmentsPaid ?? 0]} USDC` : "—"}</strong>
          </aside>
        </section>
        <footer className={styles.footer}>
          <span>Relic Pay <span aria-hidden="true">/</span> Agent Credit Demo</span>
          <a href="https://github.com/walthova/relicpay-v2/blob/main/RELICPAY_V2.md">Product &amp; protocol notes <Icon name="arrow" size={14} /></a>
        </footer>
      </main>
    </div>
  );
}
