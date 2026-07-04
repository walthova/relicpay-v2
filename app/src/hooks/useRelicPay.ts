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

  /**
   * Pay the next installment on an active agreement.
   */
  const payInstallment = async (agreementPda: string) => {
    const provider = getProvider();
    const buyer = wallet.publicKey!;
    const agreementKey = new PublicKey(agreementPda);

    // Fetch agreement to get product_id
    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (!idl) throw new Error("IDL not found");

    const program = new Program(idl, provider);
    const agreement = await (program.account as any).bnplAgreement.fetch(agreementKey);

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), agreementKey.toBuffer()],
      PROGRAM_ID
    );

    const buyerUsdc = await getAssociatedTokenAddress(USDC_MINT, buyer);

    const tx = await (program.methods as any)
      .payInstallment()
      .accounts({
        agreement: agreementKey,
        buyer,
        buyerUsdc,
        escrowUsdc: escrowPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return { tx };
  };

  /**
   * Fetch all agreements for the connected wallet.
   */
  const getMyAgreements = async () => {
    const provider = getProvider();
    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (!idl) return [];

    const program = new Program(idl, provider);
    const accounts = await (program.account as any).bnplAgreement.all([
      {
        memcmp: {
          offset: 8, // after discriminator
          bytes: wallet.publicKey!.toBase58(),
        },
      },
    ]);

    return accounts.map((a: any) => ({
      publicKey: a.publicKey.toBase58(),
      ...a.account,
    }));
  };

  /**
   * Cancel an active agreement. Buyer gets 90% back; merchant keeps 10%.
   */
  const cancelAgreement = async (agreementPda: string) => {
    const provider = getProvider();
    const buyer = wallet.publicKey!;
    const agreementKey = new PublicKey(agreementPda);

    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (!idl) throw new Error("IDL not found");

    const program = new Program(idl, provider);
    const agreement = await (program.account as any).bnplAgreement.fetch(agreementKey);

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), agreementKey.toBuffer()],
      PROGRAM_ID
    );

    const buyerUsdc = await getAssociatedTokenAddress(USDC_MINT, buyer);
    const merchantUsdc = await getAssociatedTokenAddress(USDC_MINT, agreement.merchant);

    const tx = await (program.methods as any)
      .cancelAgreement()
      .accounts({
        agreement: agreementKey,
        buyer,
        buyerUsdc,
        escrowUsdc: escrowPda,
        merchantUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return { tx };
  };

  /**
   * Merchant withdraws full payment after agreement completes.
   */
  const merchantWithdraw = async (agreementPda: string) => {
    const provider = getProvider();
    const merchant = wallet.publicKey!;
    const agreementKey = new PublicKey(agreementPda);

    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (!idl) throw new Error("IDL not found");

    const program = new Program(idl, provider);
    const agreement = await (program.account as any).bnplAgreement.fetch(agreementKey);

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), agreementKey.toBuffer()],
      PROGRAM_ID
    );

    const merchantUsdc = await getAssociatedTokenAddress(USDC_MINT, merchant);

    const tx = await (program.methods as any)
      .merchantWithdraw()
      .accounts({
        agreement: agreementKey,
        merchant,
        escrowUsdc: escrowPda,
        merchantUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return { tx };
  };

  /**
   * Buyer claims earned yield after agreement completes.
   * v1: records claim on-chain; actual USDC from protocol reserve.
   */
  const claimYield = async (agreementPda: string) => {
    const provider = getProvider();
    const buyer = wallet.publicKey!;
    const agreementKey = new PublicKey(agreementPda);

    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (!idl) throw new Error("IDL not found");

    const program = new Program(idl, provider);

    const tx = await (program.methods as any)
      .claimYield()
      .accounts({
        agreement: agreementKey,
        buyer,
      })
      .rpc();

    return { tx };
  };

  return { createAgreement, payInstallment, cancelAgreement, merchantWithdraw, claimYield, getMyAgreements };
}
