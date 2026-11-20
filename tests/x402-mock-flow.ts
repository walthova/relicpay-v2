import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { assert } from "chai";
import { resolve } from "node:path";
import { rejects } from "node:assert/strict";
import { TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import { runFlow, INITIAL_TOKENS, PRICE, RelicpayProgram } from "../scripts/x402-mock/flow";
import { safeKeypairDir } from "../scripts/x402-mock/keys";
import { assertCluster, GENESIS } from "../scripts/x402-mock/cluster";

describe("mock x402 BNPL credit flow", () => {
  it("accepts the full devnet genesis and rejects public-cluster mismatches", () => {
    assert.doesNotThrow(() => assertCluster("devnet", GENESIS.devnet));
    assert.doesNotThrow(() => assertCluster("localnet", "fresh-local-validator"));
    assert.throws(() => assertCluster("localnet", GENESIS.devnet), "does not match");
    assert.throws(() => assertCluster("devnet", "fresh-local-validator"), "does not match");
    assert.throws(() => assertCluster("devnet", ""), "does not match");
    for (const cluster of ["localnet", "devnet"] as const) {
      assert.throws(() => assertCluster(cluster, GENESIS.mainnet), "not supported");
      assert.throws(() => assertCluster(cluster, GENESIS.testnet), "not supported");
    }
  });

  it("requests 402, funds escrow via mandate, unlocks once, rejects mismatches and settles", async function () {
    this.timeout(120_000);
    const provider = anchor.AnchorProvider.env();
    const report = await runFlow({ program: anchor.workspace.Relicpay as RelicpayProgram,
      payer: (provider.wallet as anchor.Wallet).payer,
      owner: Keypair.generate(), agent: Keypair.generate(), merchant: Keypair.generate(), cluster: "localnet",
      outputDir: resolve(__dirname, "../scripts/x402-mock/out/tests"), log: () => {} });
    assert.equal(report.status, "passed");
    for (const name of ["initial402", "requirementsMatch", "malformedProof402", "wrongNonce402", "unrelatedTransaction402",
      "wrongPrice402", "wrongMerchant402", "paid200", "concurrentReplay402", "replay402", "completed", "revoked",
      "merchantPaid", "ownerDebited", "delegateCleared", "agreementClosed", "escrowClosed", "mandateClosed"]) assert.isTrue(report.checks[name], name);
    assert.equal(report.balances.merchantMockUsdcBaseUnits, String(PRICE));
    assert.equal(report.balances.ownerMockUsdcBaseUnits, String(INITIAL_TOKENS - PRICE));
    assert.isAbove(report.transactions.length, 10);
    for (const tx of report.transactions) {
      assert.isNotEmpty(tx.signature);
      assert.isNotEmpty(tx.logs);
    }
  });

  it("refuses the standard Solana key directory before reading keys", async () => {
    try {
      await safeKeypairDir("~/.config/solana");
      assert.fail("Expected forbidden key directory rejection");
    } catch (error) {
      assert.include(String(error), "Refusing ~/.config/solana");
    }
  });

  it("recovers a mandate left by a failed run and clears its old token delegate", async function () {
    this.timeout(120_000);
    const provider = anchor.AnchorProvider.env();
    const options = { program: anchor.workspace.Relicpay as RelicpayProgram,
      payer: (provider.wallet as anchor.Wallet).payer,
      owner: Keypair.generate(), agent: Keypair.generate(), merchant: Keypair.generate(), cluster: "localnet" as const,
      outputDir: resolve(__dirname, "../scripts/x402-mock/out/tests") };
    await rejects(runFlow({ ...options, log: (line) => {
      if (line.startsWith("request_credit_create_mandate:")) throw new Error("Injected failure after mandate creation");
    } }), /Injected failure after mandate creation/);
    const recovered = await runFlow({ ...options, log: () => {} });
    assert.equal(recovered.status, "passed");
    assert.isTrue(recovered.recoveredMandate);
    assert.includeMembers(recovered.transactions.map((tx: any) => tx.step), ["recover_revoke_mandate_1", "recover_close_mandate"]);
    const tokens = await provider.connection.getTokenAccountsByOwner(options.owner.publicKey, { programId: TOKEN_PROGRAM_ID }, "confirmed");
    for (const { pubkey, account } of tokens.value) assert.isNull(unpackAccount(pubkey, account).delegate);
  });
});
