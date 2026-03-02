import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// ─── Preset Enum ──────────────────────────────────────────────────────────────

export enum Preset {
  SSS1 = "sss1",
  SSS2 = "sss2",
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
