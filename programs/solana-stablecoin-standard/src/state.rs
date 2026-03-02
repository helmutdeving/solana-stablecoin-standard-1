use anchor_lang::prelude::*;

/// Preset identifier stored on-chain
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum Preset {
    Sss1, // Minimal
    Sss2, // Compliant
}

impl Default for Preset {
    fn default() -> Self {
        Preset::Sss1
    }
}

/// ─── SSS-1 & SSS-2 shared stablecoin config ────────────────────────────────
///
/// PDA: ["sss-config", mint]
#[account]
#[derive(Default)]
pub struct StablecoinConfig {
    /// Which preset is active
    pub preset: Preset,
    /// Token mint
    pub mint: Pubkey,
    /// Current total supply (tracked off-chain via SPL but mirrored here for fast queries)
    pub circulating_supply: u64,
    /// Maximum supply cap (0 = uncapped)
    pub supply_cap: u64,
    /// Mint authority (can create new tokens)
    pub mint_authority: Pubkey,
    /// Burn authority (can destroy tokens)
    pub burn_authority: Pubkey,
    /// Admin authority (governs config updates)
    pub admin: Pubkey,
    /// Pending admin (two-step transfer)
    pub pending_admin: Option<Pubkey>,
    /// Whether the stablecoin is globally paused
    pub paused: bool,
    /// Decimals
    pub decimals: u8,
    /// Name (max 32 chars)
    pub name: [u8; 32],
    /// Symbol (max 8 chars)
    pub symbol: [u8; 8],
    /// Creation timestamp
    pub created_at: i64,
    /// Total lifetime minted
    pub total_minted: u64,
    /// Total lifetime burned
    pub total_burned: u64,
    /// Bump seed
    pub bump: u8,
}

impl StablecoinConfig {
    pub const LEN: usize = 8  // discriminator
        + 1   // preset
        + 32  // mint
        + 8   // circulating_supply
        + 8   // supply_cap
        + 32  // mint_authority
        + 32  // burn_authority
        + 32  // admin
        + 33  // pending_admin (Option<Pubkey>)
        + 1   // paused
        + 1   // decimals
        + 32  // name
        + 8   // symbol
        + 8   // created_at
        + 8   // total_minted
        + 8   // total_burned
        + 1;  // bump

    pub fn is_sss2(&self) -> bool {
        self.preset == Preset::Sss2
    }
}

/// ─── SSS-2 Compliance Config ────────────────────────────────────────────────
///
/// PDA: ["sss-compliance", mint]
/// Only created for SSS-2 stablecoins.
#[account]
#[derive(Default)]
pub struct ComplianceConfig {
    /// Associated stablecoin mint
    pub mint: Pubkey,
    /// Compliance officer authority (can add/remove whitelist, issue freezes)
    pub compliance_officer: Pubkey,
    /// Whether transfers require both sender + recipient to be whitelisted
    pub whitelist_transfers: bool,
    /// Whether minting requires recipient to be whitelisted
    pub whitelist_mints: bool,
    /// Whether burning requires holder to be whitelisted
    pub whitelist_burns: bool,
    /// Address of the compliance vault (receives seized funds)
    pub compliance_vault: Pubkey,
    /// Total number of whitelist entries
    pub whitelist_count: u32,
    /// Total number of freeze records
    pub freeze_count: u32,
    /// Total number of compliance events logged
    pub event_count: u64,
    /// Bump seed
    pub bump: u8,
}

impl ComplianceConfig {
    pub const LEN: usize = 8  // discriminator
        + 32  // mint
        + 32  // compliance_officer
        + 1   // whitelist_transfers
        + 1   // whitelist_mints
        + 1   // whitelist_burns
        + 32  // compliance_vault
        + 4   // whitelist_count
        + 4   // freeze_count
        + 8   // event_count
        + 1;  // bump
}

/// ─── Whitelist Entry ────────────────────────────────────────────────────────
///
/// PDA: ["sss-whitelist", mint, wallet]
#[account]
pub struct WhitelistRecord {
    /// Associated stablecoin mint
    pub mint: Pubkey,
    /// Whitelisted wallet
    pub wallet: Pubkey,
    /// Human-readable identifier (e.g. KYC provider + ID hash)
    pub kyc_ref: [u8; 64],
    /// When added (Unix timestamp)
    pub added_at: i64,
    /// When KYC expires (0 = no expiry)
    pub expires_at: i64,
    /// Who added this entry
    pub added_by: Pubkey,
    /// Is this entry active
    pub active: bool,
    /// Bump seed
    pub bump: u8,
}

impl WhitelistRecord {
    pub const LEN: usize = 8   // discriminator
        + 32  // mint
        + 32  // wallet
        + 64  // kyc_ref
        + 8   // added_at
        + 8   // expires_at
        + 32  // added_by
        + 1   // active
        + 1;  // bump
}

/// ─── Freeze Record ────────────────────────────────────────────────────────
///
/// PDA: ["sss-freeze", mint, wallet]
#[account]
pub struct FreezeRecord {
    /// Associated stablecoin mint
    pub mint: Pubkey,
    /// Frozen wallet
    pub wallet: Pubkey,
    /// Reason for freeze (max 128 chars)
    pub reason: [u8; 128],
    /// When frozen
    pub frozen_at: i64,
    /// Who froze this account
    pub frozen_by: Pubkey,
    /// If unfrozen, when
    pub unfrozen_at: Option<i64>,
    /// Is still frozen
    pub active: bool,
    /// Bump seed
    pub bump: u8,
}

impl FreezeRecord {
    pub const LEN: usize = 8   // discriminator
        + 32  // mint
        + 32  // wallet
        + 128 // reason
        + 8   // frozen_at
        + 32  // frozen_by
        + 9   // unfrozen_at (Option<i64>)
        + 1   // active
        + 1;  // bump
}

/// ─── Compliance Event ────────────────────────────────────────────────────────
///
/// PDA: ["sss-event", mint, event_id (u64 as [u8;8])]
/// Append-only log of compliance actions.
#[account]
pub struct ComplianceEventRecord {
    pub mint: Pubkey,
    pub event_id: u64,
    pub event_type: ComplianceEventType,
    pub subject: Pubkey,
    pub actor: Pubkey,
    pub amount: Option<u64>,
    pub note: [u8; 128],
    pub timestamp: i64,
    pub bump: u8,
}

impl ComplianceEventRecord {
    pub const LEN: usize = 8   // discriminator
        + 32  // mint
        + 8   // event_id
        + 1   // event_type
        + 32  // subject
        + 32  // actor
        + 9   // amount (Option<u64>)
        + 128 // note
        + 8   // timestamp
        + 1;  // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum ComplianceEventType {
    WhitelistAdded,
    WhitelistRemoved,
    AccountFrozen,
    AccountUnfrozen,
    FundsSeized,
    MintBlocked,
    TransferBlocked,
    BurnBlocked,
    ComplianceReportGenerated,
}

// ─── Instruction Parameter Types ─────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Sss1Params {
    pub name: [u8; 32],
    pub symbol: [u8; 8],
    pub decimals: u8,
    pub supply_cap: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Sss2Params {
    pub name: [u8; 32],
    pub symbol: [u8; 8],
    pub decimals: u8,
    pub supply_cap: u64,
    pub compliance: Sss2ComplianceParams,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Sss2ComplianceParams {
    pub compliance_officer: Pubkey,
    pub whitelist_transfers: bool,
    pub whitelist_mints: bool,
    pub whitelist_burns: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WhitelistEntry {
    pub kyc_ref: [u8; 64],
    pub expires_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ComplianceEventData {
    pub event_type: ComplianceEventType,
    pub subject: Pubkey,
    pub amount: Option<u64>,
    pub note: [u8; 128],
}
