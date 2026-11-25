const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const { deflateSync } = require("node:zlib");
const { AnchorProvider, BN, Program } = require("@coral-xyz/anchor");
const { idlAddress } = require("@coral-xyz/anchor/dist/cjs/idl");
const { ConnectionContext, WalletContext } = require("@solana/wallet-adapter-react");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { JSDOM } = require("jsdom");
const { act, createElement } = require("react");
const { createRoot } = require("react-dom/client");
const { ModuleKind, transpileModule } = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const { outputText } = transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true },
  });
  module._compile(outputText, filename);
};

const programId = new PublicKey(new Uint8Array(32).fill(10));
process.env.NEXT_PUBLIC_PROGRAM_ID = programId.toBase58();
const { useStakePool } = require("../src/hooks/useStakePool.ts");
const { useRelicPay } = require("../src/hooks/useRelicPay.ts");
const bundledIdl = require("../src/lib/relicpay.json");

function mountHooks(t) {
  const dom = new JSDOM("<div id='root'></div>");
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById("root"));
  t.after(() => {
    act(() => root.unmount());
    dom.window.close();
    delete global.window;
    delete global.document;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  let hooks;
  function Probe() {
    hooks = { ...useStakePool(), ...useRelicPay() };
    return null;
  }
  return (connection, publicKey) => {
    act(() => root.render(createElement(ConnectionContext.Provider, { value: { connection } },
      createElement(WalletContext.Provider, { value: { publicKey } }, createElement(Probe)))));
    return hooks;
  };
}

async function rpcFixture() {
  const calls = [];
  const idlKey = (await idlAddress(programId)).toBase58();
  const idl = { ...bundledIdl, address: programId.toBase58() };
  const program = new Program(idl, {});
  const compressedIdl = deflateSync(JSON.stringify(idl));
  const idlHeader = Buffer.alloc(44);
  programId.toBuffer().copy(idlHeader, 8);
  idlHeader.writeUInt32LE(compressedIdl.length, 40);
  const idlData = Buffer.concat([idlHeader, compressedIdl]);
  const accounts = new Map([[idlKey, idlData]]);
  const connection = new Connection("http://localhost:8899", {
    commitment: "confirmed",
    fetch: async (_, { body }) => {
      const { id, method, params: [address] } = JSON.parse(body);
      assert.equal(method, "getAccountInfo");
      calls.push(address === idlKey ? "IDL" : address);
      const data = accounts.get(address);
      const value = data ? {
        data: [data.toString("base64"), "base64"],
        owner: programId.toBase58(), executable: false, lamports: 1, rentEpoch: 0,
      } : null;
      return Response.json({ jsonrpc: "2.0", id, result: { context: { slot: 1 }, value } });
    },
  });
  return { calls, connection, accounts, program };
}

test("stake callback is stable until the wallet or connection changes", async (t) => {
  const { connection } = await rpcFixture();
  const { connection: otherConnection } = await rpcFixture();
  const owner = Keypair.generate().publicKey;
  const render = mountHooks(t);
  const first = render(connection, owner).getUserStake;
  assert.equal(render(connection, owner).getUserStake, first);
  const switched = render(connection, Keypair.generate().publicKey).getUserStake;
  assert.notEqual(switched, first);
  const disconnected = render(connection, null).getUserStake;
  assert.notEqual(disconnected, switched);
  assert.equal(await disconnected(), null);
  assert.notEqual(render(otherConnection, null).getUserStake, disconnected);
});

test("stake reads use one account RPC and do not fetch an on-chain IDL", async (t) => {
  const { calls, connection, accounts, program } = await rpcFixture();
  const owner = Keypair.generate().publicKey;
  const { getUserStake, userStakePda } = mountHooks(t)(connection, owner);
  const stakeKey = userStakePda(owner).toBase58();
  accounts.set(stakeKey, await program.coder.accounts.encode("userStake", {
    owner, stakedAmount: new BN(25_000_000), yieldAccrued: new BN(10),
    lastUpdate: new BN(0), tier: 0, bump: 255,
  }));
  assert.equal((await getUserStake()).stakedUsd, 25);
  accounts.delete(stakeKey);
  assert.equal(await getUserStake(), null);
  assert.deepEqual(calls, [stakeKey, stakeKey]);
});

test("checkout can construct a transaction without fetching an on-chain IDL", async (t) => {
  const { calls, connection } = await rpcFixture();
  const owner = Keypair.generate().publicKey;
  const { createAgreement } = mountHooks(t)(connection, owner);
  const send = t.mock.method(AnchorProvider.prototype, "sendAndConfirm", async () => "fixture-tx");
  const { tx } = await createAgreement({
    merchantWallet: Keypair.generate().publicKey.toBase58(),
    productId: "test-item", merchantName: "Test merchant", totalPriceUnits: 100_000_000,
    installmentCount: 4, intervalDays: 14,
  });
  assert.equal(tx, "fixture-tx");
  assert.deepEqual(calls, []);
  const [instruction] = send.mock.calls[0].arguments[0].instructions;
  const [protocolConfig] = PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], programId);
  assert.ok(instruction.programId.equals(programId));
  assert.deepEqual(instruction.keys.at(-1), { pubkey: protocolConfig, isSigner: false, isWritable: true });
});
