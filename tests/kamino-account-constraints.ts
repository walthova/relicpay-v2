import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Kamino deposit account constraints", () => {
  const targets = {
    kamino_program: "kamino_program",
    kamino_lending_market: "lending_market",
    kamino_lending_market_authority: "lending_market_authority",
    kamino_reserve: "reserve",
    kamino_reserve_liquidity_supply: "reserve_liquidity_supply",
    kamino_reserve_collateral_mint: "reserve_collateral_mint",
  };

  for (const instruction of ["create_agreement_kamino", "pay_installment_kamino"]) {
    it(`${instruction} binds every Kamino account before the handler runs`, () => {
      const source = readFileSync(resolve(
        __dirname, "../programs/relicpay/src/instructions", `${instruction}.rs`
      ), "utf8");
      const addressConstraints = new Map(
        [...source.matchAll(
          /#\[account\(\s*(?:mut,\s*)?address\s*=\s*config\.(\w+)\s*@\s*RelicPayError::KaminoAccountMismatch,?\s*\)\]\s*pub\s+(\w+):/g
        )].map(([, configField, account]) => [account, configField])
      );
      assert.deepEqual(Object.fromEntries(addressConstraints), targets);
    });
  }
});
