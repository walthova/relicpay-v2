"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { decide, paymentRef, fetchWithRelic, NETWORKS } = require("./policy");

const MERCHANT = "0x1111111111111111111111111111111111111111";
const BASE_SEPOLIA = "eip155:84532";
const usdc = NETWORKS[BASE_SEPOLIA].usdc;
const mandate = (o = {}) => ({
  networks: [BASE_SEPOLIA],
  allowedPayees: [MERCHANT],
  perTxCap: 5_000_000n,
  periodRemaining: 20_000_000n,
  approvalThreshold: 2_000_000n,
  ...o,
});
const req = (o = {}) => ({ scheme: "exact", network: BASE_SEPOLIA, amount: "1000000", asset: usdc, payTo: MERCHANT, ...o });
const challenge = (...accepts) => ({ x402Version: 2, resource: "https://api.example/data", accepts });

test("pays an allowlisted USDC requirement within caps", () => {
  const d = decide(challenge(req()), mandate());
  assert.equal(d.ok, true);
  assert.equal(d.amount, 1_000_000n);
  assert.equal(d.ref.length, 32);
});

test("refuses a non-USDC asset, an unknown payee, or a disabled network", () => {
  assert.equal(decide(challenge(req({ asset: "0x2222222222222222222222222222222222222222" })), mandate()).ok, false);
  assert.equal(decide(challenge(req({ payTo: "0x3333333333333333333333333333333333333333" })), mandate()).ok, false);
  assert.equal(decide(challenge(req({ network: "eip155:8453", asset: NETWORKS["eip155:8453"].usdc })), mandate()).ok, false);
});

test("address match ignores EVM checksum case", () => {
  assert.equal(decide(challenge(req({ payTo: MERCHANT.toUpperCase().replace("0X", "0x") })), mandate()).ok, true);
});

test("enforces the per-transaction cap, the remaining period cap, and the owner threshold", () => {
  assert.match(decide(challenge(req({ amount: "6000000" })), mandate()).reasons[0], /per-transaction/);
  assert.match(decide(challenge(req({ amount: "3000000" })), mandate({ periodRemaining: 2_500_000n })).reasons[0], /period/);
  assert.match(decide(challenge(req({ amount: "3000000" })), mandate()).reasons[0], /owner approval/);
  assert.equal(decide(challenge(req({ amount: "3000000" })), mandate({ ownerApproved: () => true })).needsOwner, true);
});

test("skips unusable options and takes the first allowed one", () => {
  const d = decide(challenge(req({ payTo: "0x9999999999999999999999999999999999999999" }), req({ amount: "500000" })), mandate());
  assert.equal(d.ok, true);
  assert.equal(d.amount, 500_000n);
});

test("accepts the v1 maxAmountRequired field", () => {
  const r = req();
  delete r.amount;
  r.maxAmountRequired = "700000";
  assert.equal(decide(challenge(r), mandate()).amount, 700_000n);
});

test("payment ref is stable under key order and differs per resource", () => {
  const a = paymentRef({ a: 1, b: 2 }, "r1");
  assert.deepEqual(a, paymentRef({ b: 2, a: 1 }, "r1"));
  assert.notDeepEqual(a, paymentRef({ a: 1, b: 2 }, "r2"));
});

test("fetchWithRelic pays once and retries with PAYMENT-SIGNATURE", async () => {
  const header = Buffer.from(JSON.stringify(challenge(req()))).toString("base64");
  const calls = [];
  let charges = 0;
  const fetch = async (url, init) => {
    calls.push(init?.headers || {});
    if (calls.length === 1) return { status: 402, headers: new Map([["PAYMENT-REQUIRED", header]]) };
    return { status: 200, headers: new Map() };
  };
  const res = await fetchWithRelic("https://api.example/data", {}, {
    fetch,
    mandate: mandate(),
    charge: async () => { charges++; return { txId: "0xabc" }; },
  });
  assert.equal(res.status, 200);
  assert.equal(charges, 1);
  const sent = JSON.parse(Buffer.from(calls[1]["PAYMENT-SIGNATURE"], "base64").toString());
  assert.equal(sent.payload.txId, "0xabc");
  assert.equal(sent.scheme, "relicpay-credit");
});

test("fetchWithRelic refuses without charging when the mandate says no", async () => {
  const header = Buffer.from(JSON.stringify(challenge(req({ amount: "9000000" })))).toString("base64");
  let charges = 0;
  await assert.rejects(
    fetchWithRelic("https://api.example/data", {}, {
      fetch: async () => ({ status: 402, headers: new Map([["PAYMENT-REQUIRED", header]]) }),
      mandate: mandate(),
      charge: async () => { charges++; return { txId: "x" }; },
    }),
    /payment refused/
  );
  assert.equal(charges, 0);
});
