#!/usr/bin/env node
// Initialize the two-chain parity singletons on Solana DEVNET. Called by deploy-solana-devnet.sh.
// Idempotent: anything that already exists is skipped. Refuses any RPC that is not devnet.
// Order matters (docs/CHAIN_PARITY.md, gap G-2): config, ext, accepted mint, then pools.
"use strict";

const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");

// Circle devnet USDC (developers.circle.com/stablecoins/usdc-contract-addresses, read 2026-11-12)
const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

async function main() {
  const url = process.env.ANCHOR_PROVIDER_URL || "";
  if (!url.includes("devnet")) throw new Error(`Refusing: ${url} is not devnet`);
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idl = require("../target/idl/relicpay.json");
  const program = new anchor.Program(idl, provider);
  const me = provider.wallet.publicKey;
  const pda = (...s) => PublicKey.findProgramAddressSync(s.map((x) => Buffer.from(x)), program.programId)[0];
  const exists = async (k) => (await provider.connection.getAccountInfo(k)) !== null;

  const config = pda("protocol_config");
  const ext = pda("protocol_config_ext");
  const stakePool = pda("stake_pool");
  const yieldReserve = pda("yield_reserve");
  const creditPool = pda("credit_pool");

  if (!(await exists(config))) {
    await program.methods.initProtocolConfig()
      .accounts({ config, authority: me, upgradeAuthority: me, systemProgram: SystemProgram.programId }).rpc();
    console.log("init_protocol_config: done");
  } else console.log("protocol_config exists: skipped");

  if (!(await exists(ext))) {
    await program.methods.initProtocolConfigExt()
      .accounts({ ext, authority: me, upgradeAuthority: me, systemProgram: SystemProgram.programId }).rpc();
    console.log("init_protocol_config_ext: done");
  } else console.log("protocol_config_ext exists: skipped");

  const extAcct = await program.account.protocolConfigExt.fetch(ext);
  if (!extAcct.acceptedMint.equals(DEVNET_USDC)) {
    await program.methods.setAcceptedMint(DEVNET_USDC).accounts({ ext, authority: me }).rpc();
    console.log("set_accepted_mint: devnet USDC");
  }

  if (!(await exists(stakePool))) {
    await program.methods.initStakePool().accounts({
      stakePool, authority: me, usdcMint: DEVNET_USDC, tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    }).rpc();
    console.log("init_stake_pool: done");
  } else {
    const pool = await program.account.stakePool.fetch(stakePool);
    console.log(`stake_pool exists (authority ${pool.authority.toBase58()}, mint ${pool.usdcMint.toBase58()})`);
    if (!pool.usdcMint.equals(DEVNET_USDC)) console.log("WARNING: existing devnet pool uses a different mint (audit NV-2).");
    if (!(await exists(yieldReserve))) {
      await program.methods.initYieldReserve().accounts({
        stakePool, yieldReserve, usdcMint: pool.usdcMint, payer: me, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
      }).rpc();
      console.log("init_yield_reserve: done (pre-existing pool)");
    }
  }

  if (!(await exists(creditPool))) {
    await program.methods.initCreditPool().accounts({
      ext, authority: me, usdcMint: DEVNET_USDC, tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    }).rpc();
    console.log("init_credit_pool: done (credit stays disabled until set_credit_params)");
  } else console.log("credit_pool exists: skipped");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
