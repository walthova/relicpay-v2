#!/usr/bin/env node
// Monitoring and alerting for RelicPay v2. Three parts, all driven by the compiled ABI so nothing
// is hand-listed twice:
//
//   catalog  every event of every in-scope contract classified as page, warn or info, written to
//            monitoring/alerts.json (the file an alert router or a Tenderly/Forta style setup loads).
//            An event added to a contract with no rule here fails the build.
//   scan     decode logs for a block range and return the alerts they raise. Stateless apart from
//            one in-memory price memory used for the oracle deviation rule.
//   health   state checks events cannot show: a wired oracle gone stale, the governor role and
//            ownership drifting from the expected addresses.
//
// Severity meaning (see docs/MONITORING.md for routing and response times):
//   page  a human looks now. Funds at risk, authority changed, or a safety net is down.
//   warn  review within one working day. Unusual but the protocol is behaving as designed.
//   info  recorded for dashboards and the audit trail. Never notifies anyone.
//
// Run: npm run monitor:catalog   regenerates monitoring/alerts.json
//      npm run monitor:check     exits non-zero if the committed file is stale or a rule is missing
//      node tools/monitor.js scan --rpc URL --deployments deployments/<network>.txt [--from N] [--to N]
//      node tools/monitor.js health --rpc URL --deployments deployments/<network>.txt
// Requires `npm run compile` (build/v2).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build', 'v2');
const OUT = path.join(ROOT, 'monitoring', 'alerts.json');

// Same scope and order as the audit pack: what holds funds or authority.
const SCOPE = [
  'RelicPay', 'RelicPayGovernance', 'Governable', 'RelicRegistry',
  'PriceOracle', 'ChainlinkPriceAdapter', 'DeFiIntegration',
];

const SEVERITIES = ['page', 'warn', 'info'];

// Contract.Event -> { sev, why }. `why` is the sentence the alert carries, so whoever is paged
// does not have to open the source to learn what the event means.
const RULES = {
  // RelicPay: authority and configuration
  'RelicPay.GovernanceUpdated': { sev: 'warn', why: 'Credit limit ratio, default grace or minimum collateral changed.' },
  'RelicPay.PriceOracleUpdated': { sev: 'page', why: 'The oracle that values collateral was swapped. A bad oracle misprices every ERC20 position.' },
  'RelicPay.MaxAgreementDurationUpdated': { sev: 'warn', why: 'Maximum agreement duration changed. Applies to new agreements only.' },
  'RelicPay.SettlementTokenAuthorized': { sev: 'warn', why: 'A settlement stablecoin was authorized or revoked.' },
  'RelicPay.SettlementPreferenceUpdated': { sev: 'info', why: 'A seller chose a settlement token.' },
  // RelicPay: lifecycle
  'RelicPay.AgreementCreated': { sev: 'info', why: 'New agreement. Owner-only call, so volume here is the owner acting.' },
  'RelicPay.PaymentScheduled': { sev: 'info', why: 'Installment scheduled.' },
  'RelicPay.PaymentProcessed': { sev: 'info', why: 'Installment paid.' },
  'RelicPay.AutoPaymentEnabled': { sev: 'info', why: 'Buyer toggled auto payment.' },
  'RelicPay.AutoPaymentTokensDeposited': { sev: 'info', why: 'Buyer funded a token auto-payment balance.' },
  'RelicPay.AutoPaymentTokensWithdrawn': { sev: 'info', why: 'Buyer withdrew a token auto-payment balance.' },
  'RelicPay.CollateralDeposited': { sev: 'info', why: 'Collateral deposited.' },
  'RelicPay.CollateralWithdrawn': { sev: 'info', why: 'Collateral withdrawn within the withdrawable floor.' },
  'RelicPay.YieldAccrued': { sev: 'info', why: 'Simulated yield bookkeeping. Backed by no asset (ADR-010).' },
  'RelicPay.CreditLineUpdated': { sev: 'info', why: 'Credit line recomputed.' },
  'RelicPay.SellerBalanceUpdated': { sev: 'info', why: 'Seller balance changed.' },
  'RelicPay.SellerWithdrawal': { sev: 'info', why: 'Seller withdrew settlement funds. Large withdrawals are escalated by the size rule.' },
  'RelicPay.SettlementCredited': { sev: 'info', why: 'A payment was credited to a seller in the settlement token.' },
  // RelicPay: loss events
  'RelicPay.AgreementDefaulted': { sev: 'warn', why: 'A seller declared a default. Collateral is being seized.' },
  'RelicPay.CollateralSeized': { sev: 'warn', why: 'Buyer collateral moved to a seller balance by default seizure.' },
  // Governance
  'RelicPayGovernance.ProposalCreated': { sev: 'info', why: 'New governance proposal.' },
  'RelicPayGovernance.VoteCast': { sev: 'info', why: 'Vote cast.' },
  'RelicPayGovernance.ProposalQueued': { sev: 'warn', why: 'A proposal entered the timelock. This is the window to cancel it.' },
  'RelicPayGovernance.ProposalExecuted': { sev: 'page', why: 'A governed parameter change was executed against a live target.' },
  'RelicPayGovernance.ProposalCanceled': { sev: 'warn', why: 'A proposal was canceled during or before the delay.' },
  'RelicPayGovernance.TimelockParametersUpdated': { sev: 'page', why: 'Execution delay or grace period changed. Shortening the delay removes the cancel window.' },
  'RelicPayGovernance.ParameterUpdated': { sev: 'warn', why: 'A governed parameter took a new value.' },
  'RelicPayGovernance.ActionAllowanceUpdated': { sev: 'page', why: 'The target and selector allowlist changed. It bounds what governance can call.' },
  // Governable
  'Governable.GovernorUpdated': { sev: 'page', why: 'The governor role moved. The governor can call every onlyGovernance setter.' },
  // Registry
  'RelicRegistry.IssuerSet': { sev: 'warn', why: 'An issuer was added or removed. Issuers can mint relics.' },
  'RelicRegistry.Transfer': { sev: 'info', why: 'Relic NFT moved (mint, custody into RelicPay, or transfer to a buyer).' },
  'RelicRegistry.Approval': { sev: 'info', why: 'Relic approval set.' },
  'RelicRegistry.ApprovalForAll': { sev: 'info', why: 'Operator approval set on the registry.' },
  'RelicRegistry.MetadataUpdate': { sev: 'info', why: 'Relic metadata URI set. Also emitted at mint, so it is not an alert on its own.' },
  'RelicRegistry.BatchMetadataUpdate': { sev: 'warn', why: 'A range of relic metadata URIs changed.' },
  'RelicRegistry.RelicMinted': { sev: 'info', why: 'Relic minted.' },
  // Oracle
  'PriceOracle.PriceUpdated': { sev: 'info', why: 'Price pushed. Large moves are escalated by the deviation rule.' },
  'PriceOracle.AssetAdded': { sev: 'warn', why: 'A priced asset was added.' },
  'PriceOracle.AssetRemoved': { sev: 'page', why: 'A priced asset was removed. Positions in it can no longer be valued.' },
  'PriceOracle.OracleAuthorized': { sev: 'page', why: 'A new address may push prices.' },
  'PriceOracle.OracleDeauthorized': { sev: 'warn', why: 'A price pusher was removed. If it was the keeper, prices will go stale.' },
  'PriceOracle.MaxPriceAgeUpdated': { sev: 'warn', why: 'Staleness window changed. A long window hides a dead keeper.' },
  // Chainlink adapter
  'ChainlinkPriceAdapter.FeedRegistered': { sev: 'page', why: 'A Chainlink feed was pointed at an asset. A wrong feed misprices it.' },
  'ChainlinkPriceAdapter.FeedRemoved': { sev: 'warn', why: 'A feed was removed. That asset stops updating.' },
  'ChainlinkPriceAdapter.SequencerFeedSet': { sev: 'page', why: 'The L2 sequencer uptime feed or grace period changed. Disabling it removes the protection against stale post-restart prices.' },
  'ChainlinkPriceAdapter.PricePushed': { sev: 'info', why: 'Keeper pushed a feed price.' },
  'ChainlinkPriceAdapter.PushSkipped': { sev: 'warn', why: 'The adapter refused to push (stale, bad round or out of range). Repeats mean the feed is unhealthy.' },
  // DeFi integration
  'DeFiIntegration.YieldPositionCreated': { sev: 'info', why: 'Yield position opened.' },
  'DeFiIntegration.YieldPositionClosed': { sev: 'info', why: 'Yield position closed.' },
  'DeFiIntegration.YieldClaimed': { sev: 'info', why: 'Yield claimed.' },
  'DeFiIntegration.ProtocolAuthorized': { sev: 'warn', why: 'An external protocol was authorized or its APY changed.' },
  'DeFiIntegration.ProtocolDeauthorized': { sev: 'warn', why: 'An external protocol was removed.' },
};
// RelicPay.OwnershipTransferred exists twice: the OpenZeppelin ownership event and the agreement
// level NFT transfer to the buyer. They share a name, so they are keyed by full signature.
const SIGNATURE_RULES = {
  // Inherited from OpenZeppelin Ownable by every scoped contract that has an owner.
  'Ownable.OwnershipTransferred(address,address)': { sev: 'page', why: 'Contract ownership moved. The owner controls the privileged setters.' },
  'RelicPay.OwnershipTransferred(bytes32,address,address,uint256)': { sev: 'info', why: 'Relic ownership transferred to the buyer on final payment.' },
};

// Numeric rules layered over the table. Each takes (decoded event, memory) and returns an
// escalation { sev, why } or null. Defaults are conservative and overridable per call.
const DEFAULT_THRESHOLDS = {
  sellerWithdrawalWei: 50n * 10n ** 18n,    // one withdrawal of 50 ETH or more
  priceDeviationBps: 2000n,                 // 20 percent move between consecutive pushes
};

// Governable is abstract and has no artifact; its events show up in the ABI of each child.
function loadAbi(name) {
  if (!fs.existsSync(path.join(BUILD, name + '.json'))) return [];
  return JSON.parse(fs.readFileSync(path.join(BUILD, name + '.json'), 'utf8')).abi;
}

function eventSig(ev) {
  return ev.name + '(' + ev.inputs.map(i => i.type).join(',') + ')';
}

function ruleFor(contract, ev) {
  const sig = eventSig(ev);
  return SIGNATURE_RULES[contract + '.' + sig] || RULES[contract + '.' + ev.name]
    || SIGNATURE_RULES['Ownable.' + sig] || RULES['Governable.' + ev.name] || null;
}

// Every event of every scoped contract with its classification. `missing` lists events that have
// no rule, which the check and the tests treat as a failure.
function buildCatalog() {
  const contracts = {};
  const missing = [];
  for (const name of SCOPE) {
    const events = loadAbi(name).filter(x => x.type === 'event');
    contracts[name] = events.map(ev => {
      const rule = ruleFor(name, ev);
      if (!rule) missing.push(name + '.' + eventSig(ev));
      return {
        event: ev.name,
        signature: eventSig(ev),
        severity: rule ? rule.sev : null,
        why: rule ? rule.why : null,
      };
    }).sort((a, b) => a.signature.localeCompare(b.signature));
  }
  return { catalog: { schema: 1, severities: SEVERITIES, thresholds: serializeThresholds(DEFAULT_THRESHOLDS), contracts }, missing };
}

function serializeThresholds(t) {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.toString()]));
}

function render() {
  const { catalog, missing } = buildCatalog();
  if (missing.length) throw new Error('events with no monitoring rule: ' + missing.join(', '));
  return JSON.stringify(catalog, null, 2) + '\n';
}

// Rules with no matching ABI event are dead weight and hide renames, so report them.
function staleRules() {
  const live = new Set();
  for (const name of SCOPE) {
    for (const ev of loadAbi(name).filter(x => x.type === 'event')) {
      live.add(name + '.' + ev.name);
      live.add(name + '.' + eventSig(ev));
      live.add('Governable.' + ev.name);
      live.add('Ownable.' + eventSig(ev));
    }
  }
  return [...Object.keys(RULES), ...Object.keys(SIGNATURE_RULES)].filter(k => !live.has(k));
}

function escalate(contract, name, args, mem, th) {
  if (contract === 'RelicPay' && name === 'SellerWithdrawal' && args.amount >= th.sellerWithdrawalWei) {
    return { sev: 'page', why: 'Seller withdrawal of ' + args.amount + ' wei is above the large withdrawal threshold.' };
  }
  if (contract === 'PriceOracle' && name === 'PriceUpdated') {
    const key = String(args.asset).toLowerCase();
    const prev = mem.prices.get(key);
    mem.prices.set(key, args.price);
    if (prev && prev > 0n) {
      const diff = args.price > prev ? args.price - prev : prev - args.price;
      const bps = diff * 10000n / prev;
      if (bps >= th.priceDeviationBps) {
        return { sev: 'page', why: 'Price moved ' + bps + ' bps between consecutive pushes (' + prev + ' to ' + args.price + ').' };
      }
    }
  }
  return null;
}

// Decode every log the scoped contracts emitted in [fromBlock, toBlock] and return the alerts at
// or above minSeverity, oldest first. `addresses` maps contract name to its deployed address.
// A single memory object can be reused across calls so the price rule sees the previous window.
async function scan(provider, addresses, fromBlock, toBlock, opts = {}) {
  const { ethers } = require('ethers');
  const th = Object.assign({}, DEFAULT_THRESHOLDS, opts.thresholds || {});
  const mem = opts.memory || { prices: new Map() };
  const min = SEVERITIES.indexOf(opts.minSeverity || 'warn');
  const alerts = [];
  for (const [name, address] of Object.entries(addresses)) {
    if (!SCOPE.includes(name)) throw new Error('not a scoped contract: ' + name);
    const iface = new ethers.Interface(loadAbi(name));
    const logs = await provider.getLogs({ address, fromBlock, toBlock });
    for (const log of logs) {
      let parsed;
      try { parsed = iface.parseLog(log); } catch (e) { parsed = null; }
      if (!parsed) {
        alerts.push(mk('warn', name, 'UnknownLog', 'Log with an unknown topic from a scoped contract.', log, {}));
        continue;
      }
      const rule = ruleFor(name, parsed.fragment);
      const args = Object.fromEntries(parsed.fragment.inputs.map((inp, i) => [inp.name, parsed.args[i]]));
      let sev = rule ? rule.sev : 'warn';
      let why = rule ? rule.why : 'Event with no monitoring rule.';
      const esc = escalate(name, parsed.name, args, mem, th);
      if (esc && SEVERITIES.indexOf(esc.sev) < SEVERITIES.indexOf(sev)) { sev = esc.sev; why = esc.why; }
      alerts.push(mk(sev, name, parsed.name, why, log, args));
    }
  }
  alerts.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  return alerts.filter(a => SEVERITIES.indexOf(a.severity) <= min);
}

function mk(severity, contract, event, why, log, args) {
  return {
    severity, contract, event, why,
    blockNumber: Number(log.blockNumber), logIndex: Number(log.index !== undefined ? log.index : log.logIndex),
    txHash: log.transactionHash, args: stringifyArgs(args),
  };
}

function stringifyArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === 'bigint' ? v.toString() : (v && typeof v === 'object' && !Array.isArray(v) ? stringifyArgs(Object.assign({}, v)) : v);
  }
  return out;
}

// State checks. `targets` = { relicPay, priceOracle?, governance?, expected?: { owner, governor } }.
// Returns findings { severity, check, why }; an empty list means healthy.
async function health(provider, targets, opts = {}) {
  const { ethers } = require('ethers');
  const findings = [];
  const staleWarnFraction = opts.staleWarnFraction === undefined ? 0.8 : opts.staleWarnFraction;
  const rp = new ethers.Contract(targets.relicPay, loadAbi('RelicPay'), provider);
  const wired = await rp.priceOracle();
  if (wired === ethers.ZeroAddress) {
    findings.push({ severity: 'info', check: 'ORACLE_UNWIRED', why: 'RelicPay has no oracle. Mixed-decimal collateral is valued raw (ADR-009 legacy mode).' });
  } else {
    if (targets.priceOracle && wired.toLowerCase() !== targets.priceOracle.toLowerCase()) {
      findings.push({ severity: 'page', check: 'ORACLE_MISMATCH', why: 'RelicPay points at ' + wired + ', expected ' + targets.priceOracle + '.' });
    }
    // ADR-009: a stale ETH price blocks credit-line refreshes for ERC20 holders, including
    // payment completion and triggerDefault, so ETH is the asset that matters.
    const oracle = new ethers.Contract(wired, loadAbi('PriceOracle'), provider);
    const data = await oracle.getPriceData(ethers.ZeroAddress);
    const info = await oracle.getAssetInfo(ethers.ZeroAddress);
    // Raw RPC read: ethers caches the "latest" block for its poll interval, which would make a
    // freshly stale oracle look fresh.
    const latest = await provider.send('eth_getBlockByNumber', ['latest', false]);
    const age = BigInt(opts.now !== undefined ? opts.now : latest.timestamp) - data.timestamp;
    const max = info.maxPriceAge;
    if (age > max) {
      findings.push({ severity: 'page', check: 'ORACLE_STALE', why: 'ETH price is ' + age + 's old, past the ' + max + 's window. ERC20 collateral holders cannot refresh credit lines.' });
    } else if (Number(age) > Number(max) * staleWarnFraction) {
      findings.push({ severity: 'warn', check: 'ORACLE_STALE_SOON', why: 'ETH price is ' + age + 's old, within ' + Math.round((1 - staleWarnFraction) * 100) + ' percent of the ' + max + 's window. Check the keeper.' });
    }
  }
  if (targets.expected) {
    const owner = await rp.owner();
    if (targets.expected.owner && owner.toLowerCase() !== targets.expected.owner.toLowerCase()) {
      findings.push({ severity: 'page', check: 'OWNER_DRIFT', why: 'RelicPay owner is ' + owner + ', expected ' + targets.expected.owner + '.' });
    }
    if (targets.expected.governor) {
      const gov = await rp.governor();
      if (gov.toLowerCase() !== targets.expected.governor.toLowerCase()) {
        findings.push({ severity: 'page', check: 'GOVERNOR_DRIFT', why: 'RelicPay governor is ' + gov + ', expected ' + targets.expected.governor + '.' });
      }
    }
  }
  return findings;
}

// deployments/<net>.txt is the key=value file DeployAll writes. Returns { ContractName: address }
// for the scoped contracts only; an unset or zero address (GOVERNANCE when no token was given) is
// left out.
const DEPLOYMENT_KEYS = {
  RELIC_REGISTRY: 'RelicRegistry', RELIC_PAY: 'RelicPay', PRICE_ORACLE: 'PriceOracle',
  DEFI_INTEGRATION: 'DeFiIntegration', GOVERNANCE: 'RelicPayGovernance', CHAINLINK_ADAPTER: 'ChainlinkPriceAdapter',
};
function parseDeployments(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(0x[0-9a-fA-F]{40})\s*$/);
    if (!m || !DEPLOYMENT_KEYS[m[1]]) continue;
    if (/^0x0{40}$/.test(m[2])) continue;
    out[DEPLOYMENT_KEYS[m[1]]] = m[2];
  }
  return out;
}

function cli(argv) {
  const cmd = argv[2];
  const flag = k => { const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : undefined; };
  if (cmd === 'check') {
    const stale = staleRules();
    if (stale.length) { console.error('rules with no matching event: ' + stale.join(', ')); process.exit(1); }
    let want;
    try { want = render(); } catch (e) { console.error(e.message); process.exit(1); }
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (have !== want) { console.error('monitoring/alerts.json is stale: run npm run monitor:catalog'); process.exit(1); }
    console.log('monitoring catalog current');
    return;
  }
  if (cmd === 'catalog') {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, render());
    console.log('wrote ' + path.relative(ROOT, OUT));
    return;
  }
  if (cmd === 'scan' || cmd === 'health') {
    const rpc = flag('rpc') || process.env.RPC_URL;
    const dep = flag('deployments');
    if (!rpc || !dep) { console.error('usage: monitor.js ' + cmd + ' --rpc URL --deployments FILE'); process.exit(2); }
    const { ethers } = require('ethers');
    const provider = new ethers.JsonRpcProvider(rpc);
    const book = parseDeployments(fs.readFileSync(dep, 'utf8'));
    const addresses = book;
    (async () => {
      if (cmd === 'health') {
        const f = await health(provider, { relicPay: book.RelicPay, priceOracle: book.PriceOracle, expected: { governor: book.RelicPayGovernance } });
        console.log(JSON.stringify(f, null, 2));
        process.exit(f.some(x => x.severity === 'page') ? 1 : 0);
      }
      const head = await provider.getBlockNumber();
      const to = flag('to') ? Number(flag('to')) : head;
      const from = flag('from') ? Number(flag('from')) : Math.max(0, to - 1000);
      const alerts = await scan(provider, addresses, from, to, { minSeverity: flag('min') || 'warn' });
      console.log(JSON.stringify(alerts, null, 2));
      process.exit(alerts.some(a => a.severity === 'page') ? 1 : 0);
    })().catch(e => { console.error(e.message); process.exit(2); });
    return;
  }
  console.error('usage: monitor.js catalog|check|scan|health');
  process.exit(2);
}

module.exports = {
  OUT, SCOPE, DEPLOYMENT_KEYS, SEVERITIES, RULES, SIGNATURE_RULES, DEFAULT_THRESHOLDS,
  buildCatalog, render, staleRules, scan, escalate, health, parseDeployments, eventSig,
};

if (require.main === module) cli(process.argv);
