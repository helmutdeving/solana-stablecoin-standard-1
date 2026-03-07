/**
 * @solana-stablecoin-standard/sdk
 *
 * TypeScript SDK for the Solana Stablecoin Standard
 * Supports SSS-1 (minimal), SSS-2 (compliant), and SSS-3 (private) presets
 */

export { SSSClient, PROGRAM_ID } from "./client";
export { PDAs } from "./pdas";
export {
  SSS3Client,
  deriveSss3ConfigPDA,
  deriveSss3AllowlistPDA,
  generateCommitmentHash,
  verifyCommitmentHash,
} from "./sss3";
export type { ElGamalPubkey, ConfidentialMintProof, ConfidentialTransferProof } from "./sss3";
export * from "./types";
export * from "./utils";
