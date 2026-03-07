import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import bs58 from "bs58";
import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadKeypair(base58PrivateKey: string): Keypair {
  try {
    const decoded = bs58.decode(base58PrivateKey);
    return Keypair.fromSecretKey(decoded);
  } catch (err) {
    throw new Error(
      `Invalid OPERATOR_KEYPAIR: must be a base58-encoded 64-byte secret key. ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

const rpcUrl = process.env["RPC_URL"] ?? clusterApiUrl("devnet");

export const connection = new Connection(rpcUrl, {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 60_000,
});

let _operatorKeypair: Keypair | null = null;

export function getOperatorKeypair(): Keypair {
  if (_operatorKeypair) return _operatorKeypair;
  _operatorKeypair = loadKeypair(requireEnv("OPERATOR_KEYPAIR"));
  return _operatorKeypair;
}

export function getProvider(): AnchorProvider {
  const keypair = getOperatorKeypair();
  const wallet = new Wallet(keypair);
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
}

export function parsePubkey(value: string, fieldName: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`Invalid public key for field '${fieldName}': ${value}`);
  }
}

export function parseTokenAmount(
  decimalString: string,
  decimals: number
): bigint {
  const trimmed = decimalString.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(
      `Invalid amount '${decimalString}': must be a non-negative decimal number`
    );
  }

  const [integerPart, fractionalPart = ""] = trimmed.split(".");
  const paddedFraction = fractionalPart.padEnd(decimals, "0").slice(0, decimals);
  const combined = `${integerPart}${paddedFraction}`;

  return BigInt(combined);
}

export function formatTokenAmount(raw: bigint, decimals: number): string {
  const rawStr = raw.toString().padStart(decimals + 1, "0");
  const intPart = rawStr.slice(0, rawStr.length - decimals);
  const fracPart = rawStr.slice(rawStr.length - decimals);
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

export function explorerTxUrl(signature: string): string {
  const cluster = process.env["RPC_URL"]?.includes("mainnet")
    ? ""
    : "?cluster=devnet";
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}
