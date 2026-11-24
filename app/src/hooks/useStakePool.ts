import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  PROGRAM_ID,
  USDC_MINT,
  STAKE_POOL_SEED,
  POOL_VAULT_SEED,
  USER_STAKE_SEED,
  tierFor,
  Tier,
} from "../lib/constants";
import { parseUsdcAmount } from "../lib/usdc";

export interface UserStakeView {
  pubkey: string;
  owner: string;
  stakedUnits: number;       // raw USDC units (6 decimals)
  stakedUsd: number;         // human dollars
  yieldAccruedUnits: number; // includes the persisted on-chain value
  tier: Tier;
}

export function useStakePool() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const getProvider = () => {
    if (!wallet.publicKey) throw new Error("Wallet not connected");
    return new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
  };

  const stakePoolPda = (): PublicKey =>
    PublicKey.findProgramAddressSync(
      [Buffer.from(STAKE_POOL_SEED)],
      PROGRAM_ID,
    )[0];

  const poolVaultPda = (poolPda: PublicKey): PublicKey =>
    PublicKey.findProgramAddressSync(
      [Buffer.from(POOL_VAULT_SEED), poolPda.toBuffer()],
      PROGRAM_ID,
    )[0];

  const userStakePda = (owner: PublicKey): PublicKey =>
    PublicKey.findProgramAddressSync(
      [Buffer.from(USER_STAKE_SEED), owner.toBuffer()],
      PROGRAM_ID,
    )[0];

  const stakeUsdc = async (amountUsd: string) => {
    const amountUnits = parseUsdcAmount(amountUsd);
    const provider = getProvider();
    const user = wallet.publicKey!;
    const pool = stakePoolPda();
    const vault = poolVaultPda(pool);
    const stake = userStakePda(user);
    const userUsdc = await getAssociatedTokenAddress(USDC_MINT, user);

    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (!idl) throw new Error("IDL not found — deploy program first");

    const program = new Program(idl, provider);

    const tx = await (program.methods as any)
      .stakeUsdc(new BN(amountUnits.toString()))
      .accounts({
        stakePool: pool,
        userStake: stake,
        user,
        userUsdc,
        poolVault: vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    return { tx, userStake: stake.toBase58() };
  };

  const unstakeUsdc = async (amountUsd?: string) => {
    const amountUnits = amountUsd === undefined ? 0n : parseUsdcAmount(amountUsd);
    const provider = getProvider();
    const user = wallet.publicKey!;
    const pool = stakePoolPda();
    const vault = poolVaultPda(pool);
    const stake = userStakePda(user);
    const userUsdc = await getAssociatedTokenAddress(USDC_MINT, user);

    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (!idl) throw new Error("IDL not found");

    const program = new Program(idl, provider);

    const tx = await (program.methods as any)
      .unstakeUsdc(new BN(amountUnits.toString()))
      .accounts({
        stakePool: pool,
        userStake: stake,
        user,
        userUsdc,
        poolVault: vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return { tx };
  };

  const getUserStake = async (): Promise<UserStakeView | null> => {
    if (!wallet.publicKey) return null;
    const provider = getProvider();
    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (!idl) return null;

    const program = new Program(idl, provider);
    const stake = userStakePda(wallet.publicKey);

    try {
      const account: any = await (program.account as any).userStake.fetch(stake);
      const stakedUnits = Number(account.stakedAmount?.toString() ?? "0");
      const yieldAccruedUnits = Number(account.yieldAccrued?.toString() ?? "0");

      return {
        pubkey: stake.toBase58(),
        owner: account.owner.toBase58(),
        stakedUnits,
        stakedUsd: stakedUnits / 1_000_000,
        yieldAccruedUnits,
        tier: tierFor(stakedUnits),
      };
    } catch {
      // No stake account yet
      return null;
    }
  };

  return {
    stakeUsdc,
    unstakeUsdc,
    getUserStake,
    stakePoolPda,
    userStakePda,
  };
}
