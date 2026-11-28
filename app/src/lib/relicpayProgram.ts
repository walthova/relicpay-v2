import { Program, type Idl, type Provider } from "@coral-xyz/anchor";
import { PROGRAM_ID } from "./constants";
import relicpayIdl from "./relicpay.json";

const idl = { ...relicpayIdl, address: PROGRAM_ID.toBase58() } as Idl;

export function createRelicPayProgram(provider: Provider) {
  return new Program(idl, provider);
}
