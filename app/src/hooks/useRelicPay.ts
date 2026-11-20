import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { PROGRAM_ID, USDC_MINT } from "../lib/constants";

export function useRelicPay() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const getProvider = () => {
    if (!wallet.publicKey) throw new Error("Wallet not connected");
    return new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
  };

  /**
   * Create a BNPL agreement and pay the first installment.
   */
  const createAgreement = async ({
    merchantWallet,
    productId,
    merchantName,
    totalPriceUsdc,
    installmentCount,
    intervalDays,
  }: {
    merchantWallet: string;
    productId: string;
    merchantName: string;
    totalPriceUsdc: number; // in USDC units (e.g. 300 for $300)
    installmentCount: number;
    intervalDays: number;
  }) => {
    const provider = getProvider();
    const buyer = wallet.publicKey!;
    const merchant = new PublicKey(merchantWallet);

    // Derive PDAs
    const [agreementPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("agreement"),
        buyer.toBuffer(),
        Buffer.from(productId),
      ],
      PROGRAM_ID
    );

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), agreementPda.toBuffer()],
      PROGRAM_ID
    );

    const buyerUsdc = await getAssociatedTokenAddress(USDC_MINT, buyer);

    const totalPriceLamports = totalPriceUsdc * 1_000_000; // USDC has 6 decimals
    const intervalSeconds = intervalDays * 24 * 60 * 60;

    // Load IDL and call program
    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (!idl) throw new Error("IDL not found — deploy program first");

    const program = new Program(idl, provider);

    const tx = await (program.methods as any)
      .createAgreement(
        new BN(totalPriceLamports),
        installmentCount,
        new BN(intervalSeconds),
        productId,
        merchantName
      )
      .accounts({
        agreement: agreementPda,
        buyer,
        merchant,
        usdcMint: USDC_MINT,
        buyerUsdc,
        escrowUsdc: escrowPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    return { tx, agreementPda: agreementPda.toBase58() };
  };

  return { createAgreement };
}
