// ─── API Response Types ───────────────────────────────────────────────────────

export type Preset = "SSS1" | "SSS2" | "SSS3";

export interface SupplyResponse {
  preset: Preset;
  mint: string;
  totalSupply: string;
  decimals: number;
  mintCap: string;
  mintCapUsedPct: number;
  mintAuthority: string;
  freezeAuthority: string | null;
  paused: boolean;
  programId: string;
  slot: number;
  timestamp: string;
}

export interface MintRequest {
  mint: string;
  recipient: string;
  amount: string;
  signer: string;
}

export interface BurnRequest {
  mint: string;
  owner: string;
  amount: string;
  signer: string;
}

export interface TransferRequest {
  mint: string;
  from: string;
  to: string;
  amount: string;
  signer: string;
}

export interface TxResponse {
  signature: string;
  slot: number;
  err: null | unknown;
}

// ─── Compliance Types ─────────────────────────────────────────────────────────

export interface ComplianceStatus {
  address: string;
  frozen: boolean;
  whitelisted: boolean;
  balance: string;
  lastActivity: string | null;
}

export interface FreezeRequest {
  mint: string;
  account: string;
  freeze: boolean;
  authority: string;
}

export interface WhitelistRequest {
  mint: string;
  account: string;
  add: boolean;
  authority: string;
}

// ─── Event Types ─────────────────────────────────────────────────────────────

export type EventKind =
  | "Minted"
  | "Burned"
  | "Transferred"
  | "Frozen"
  | "Unfrozen"
  | "WhitelistAdded"
  | "WhitelistRemoved"
  | "Paused"
  | "Unpaused"
  | "OwnershipTransferred";

export interface SSSEvent {
  id: string;
  kind: EventKind;
  mint: string;
  slot: number;
  signature: string;
  timestamp: string;
  data: Record<string, string | number | boolean>;
}

// ─── Oracle Types ─────────────────────────────────────────────────────────────

export interface OraclePrice {
  symbol: string;
  price: number;
  confidence: number;
  source: "pyth" | "switchboard" | "coingecko";
  timestamp: string;
  stale: boolean;
}

// ─── App Settings ─────────────────────────────────────────────────────────────

export interface AppSettings {
  apiUrl: string;
  wsUrl: string;
  authToken: string;
  rpcUrl: string;
}
