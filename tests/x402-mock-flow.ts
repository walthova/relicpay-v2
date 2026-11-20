import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { assert } from "chai";
import { resolve } from "node:path";
import { runFlow, INITIAL_TOKENS, PRICE, RelicpayProgram } from "../scripts/x402-mock/flow";
import { safeKeypairDir } from "../scripts/x402-mock/keys";

describe("mock x402 BNPL credit flow", () => {
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
});
