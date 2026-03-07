import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// ─── Preset Enum ──────────────────────────────────────────────────────────────

export enum Preset {
  SSS1 = "sss1",
  SSS2 = "sss2",
  SSS3 = "sss3",
}

// ─── On-chain Account Types ───────────────────────────────────────────────────

export interface StablecoinConfig {
  preset: Preset;
  mint: PublicKey;
  circulatingSupply: BN;
  supplyCap: BN;
  mintAuthority: PublicKey;
  burnAuthority: PublicKey;
  admin: PublicKey;
  pendingAdmin: PublicKey | null;
  paused: boolean;
  decimals: number;
  name: string;
  symbol: string;
  createdAt: BN;
  totalMinted: BN;
  totalBurned: BN;
  bump: number;
}

export interface ComplianceConfig {
  mint: PublicKey;
  complianceOfficer: PublicKey;
  whitelistTransfers: boolean;
  whitelistMints: boolean;
  whitelistBurns: boolean;
  complianceVault: PublicKey;
  whitelistCount: number;
  freezeCount: number;
  eventCount: BN;
  bump: number;
}

export interface WhitelistRecord {
  mint: PublicKey;
  wallet: PublicKey;
  kycRef: string; // hex encoded
  addedAt: BN;
  expiresAt: BN;
  addedBy: PublicKey;
  active: boolean;
  bump: number;
}

export interface FreezeRecord {
  mint: PublicKey;
  wallet: PublicKey;
  reason: string;
  frozenAt: BN;
  frozenBy: PublicKey;
  unfrozenAt: BN | null;
  active: boolean;
  bump: number;
}

export interface ComplianceEventRecord {
  mint: PublicKey;
  eventId: BN;
  eventType: ComplianceEventType;
  subject: PublicKey;
  actor: PublicKey;
  amount: BN | null;
  note: string;
  timestamp: BN;
  bump: number;
}

export enum ComplianceEventType {
  WhitelistAdded = "whitelistAdded",
  WhitelistRemoved = "whitelistRemoved",
  AccountFrozen = "accountFrozen",
  AccountUnfrozen = "accountUnfrozen",
  FundsSeized = "fundsSeized",
  MintBlocked = "mintBlocked",
  TransferBlocked = "transferBlocked",
  BurnBlocked = "burnBlocked",
  ComplianceReportGenerated = "complianceReportGenerated",
}

// ─── Parameter Types ──────────────────────────────────────────────────────────

export interface Sss1Params {
  name: string;
  symbol: string;
  decimals: number;
  supplyCap: BN; // 0 = uncapped
}

export interface Sss2Params extends Sss1Params {
  compliance: Sss2ComplianceParams;
}

export interface Sss2ComplianceParams {
  complianceOfficer: PublicKey;
  whitelistTransfers: boolean;
  whitelistMints: boolean;
  whitelistBurns: boolean;
}

export interface WhitelistEntryParams {
  kycRef: string; // max 64 bytes hex
  expiresAt?: BN; // 0 = no expiry
}

// ─── SDK Return Types ─────────────────────────────────────────────────────────

export interface StablecoinInfo extends StablecoinConfig {
  address: PublicKey;
  compliance?: ComplianceConfig;
  isSSS2: boolean;
}

export interface SupplyInfo {
  circulating: BN;
  cap: BN;
  capped: boolean;
  utilizationPct: number;
}

// ─── SSS-3 On-chain Account Types ────────────────────────────────────────────

export interface Sss3Config {
  mint: PublicKey;
  allowlistAuthority: PublicKey;
  requireAllowlistForReceive: boolean;
  requireAllowlistForSend: boolean;
  confidentialTransfersEnabled: boolean;
  autoApproveNewAccounts: boolean;
  auditorPubkey: Uint8Array | null; // 32 bytes ElGamal pubkey, or null
  allowlistCount: number;
  bump: number;
}

export interface Sss3AllowlistRecord {
  mint: PublicKey;
  wallet: PublicKey;
  addedAt: BN;
  expiresAt: BN; // 0 = no expiry
  addedBy: PublicKey;
  active: boolean;
  note: string; // UTF-8 decoded from [u8; 64]
  bump: number;
}

// ─── SSS-3 Parameter Types ────────────────────────────────────────────────────

export interface Sss3Params {
  name: string;
  symbol: string;
  decimals: number;
  supplyCap: BN;
  allowlistAuthority: PublicKey;
  requireAllowlistForReceive: boolean;
  requireAllowlistForSend: boolean;
  confidentialTransfersEnabled: boolean;
  autoApproveNewAccounts: boolean;
  auditorPubkey?: Uint8Array; // 32-byte ElGamal pubkey
}

export interface AllowlistEntryParams {
  expiry: BN; // 0 = no expiry
  note: string; // max 64 bytes UTF-8
}

// ─── SSS-3 SDK Return Types ───────────────────────────────────────────────────

export interface Sss3Info {
  address: PublicKey;
  mint: PublicKey;
  config: Sss3Config;
  allowlistCount: number;
}

export interface AllowlistStatus {
  wallet: PublicKey;
  isAllowlisted: boolean;
  record: Sss3AllowlistRecord | null;
  isExpired: boolean;
}

// ─── SSS-3 Events ─────────────────────────────────────────────────────────────

export interface AllowlistUpdatedEvent {
  mint: PublicKey;
  wallet: PublicKey;
  action: 0 | 1; // 0=removed, 1=added
  actor: PublicKey;
  timestamp: BN;
}

export interface ConfidentialMintInitiatedEvent {
  mint: PublicKey;
  recipientAllowlistRecord: PublicKey;
  commitmentHash: Uint8Array; // [u8; 32]
  initiator: PublicKey;
  timestamp: BN;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface MintEvent {
  mint: PublicKey;
  recipient: PublicKey;
  amount: BN;
  newSupply: BN;
  timestamp: BN;
}

export interface BurnEvent {
  mint: PublicKey;
  holder: PublicKey;
  amount: BN;
  newSupply: BN;
  timestamp: BN;
}

export interface TransferEvent {
  mint: PublicKey;
  from: PublicKey;
  to: PublicKey;
  amount: BN;
  timestamp: BN;
}
