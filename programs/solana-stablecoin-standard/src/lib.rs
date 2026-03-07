use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

declare_id!("8kY3yQGTdrvPRG3SQfjwyf3SuuUW9Wt1W8zFwURTpa59");

/// Solana Stablecoin Standard (SSS)
///
/// A modular on-chain framework supporting three compliance tiers:
///   - SSS-1: Minimal preset — basic mint/burn, supply tracking, no regulatory overhead
///   - SSS-2: Compliant preset — adds KYC whitelist, freeze/seize, compliance reporting
///   - SSS-3: Private preset (experimental) — allowlist-gated + Token-2022 confidential transfers
///
/// Architecture layers:
///   L1 — Core ledger: mint authority, burn authority, supply cap
///   L2 — Compliance hooks: whitelist registry, freeze registry (SSS-2 only)
///   L3 — Privacy layer: allowlist registry, confidential transfer extension (SSS-3 only)
///   L4 — Governance: admin multi-sig, preset upgrade path
#[program]
pub mod solana_stablecoin_standard {
    use super::*;

    // ─── Initialization ───────────────────────────────────────────────────────

    /// Initialize a new SSS-1 stablecoin (minimal preset)
    pub fn initialize_sss1(
        ctx: Context<InitializeSss1>,
        params: Sss1Params,
    ) -> Result<()> {
        instructions::initialize::handler_sss1(ctx, params)
    }

    /// Initialize a new SSS-2 stablecoin (compliant preset)
    pub fn initialize_sss2(
        ctx: Context<InitializeSss2>,
        params: Sss2Params,
    ) -> Result<()> {
        instructions::initialize::handler_sss2(ctx, params)
    }

    // ─── Core operations (both presets) ──────────────────────────────────────

    /// Mint tokens to a recipient. SSS-2 enforces whitelist check.
    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        instructions::mint::handler(ctx, amount)
    }

    /// Burn tokens from an account. SSS-2 enforces whitelist check.
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        instructions::burn::handler(ctx, amount)
    }

    /// Transfer tokens between accounts. SSS-2 enforces both accounts on whitelist.
    pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
        instructions::transfer::handler(ctx, amount)
    }

    // ─── SSS-2 compliance operations ─────────────────────────────────────────

    /// Add an address to the KYC whitelist (SSS-2 only)
    pub fn whitelist_add(ctx: Context<WhitelistAdd>, entry: WhitelistEntry) -> Result<()> {
        instructions::whitelist::handler_add(ctx, entry)
    }

    /// Remove an address from the KYC whitelist (SSS-2 only)
    pub fn whitelist_remove(ctx: Context<WhitelistRemove>) -> Result<()> {
        instructions::whitelist::handler_remove(ctx)
    }

    /// Freeze an account — halts all transfers for that address (SSS-2 only)
    pub fn freeze_account(ctx: Context<FreezeAccount>, reason: String) -> Result<()> {
        instructions::freeze::handler_freeze(ctx, reason)
    }

    /// Unfreeze a previously frozen account (SSS-2 only)
    pub fn unfreeze_account(ctx: Context<UnfreezeAccount>) -> Result<()> {
        instructions::freeze::handler_unfreeze(ctx)
    }

    /// Seize funds from a frozen account to the compliance vault (SSS-2 only)
    pub fn seize_funds(ctx: Context<SeizeFunds>, amount: u64) -> Result<()> {
        instructions::seize::handler(ctx, amount)
    }

    /// Record a compliance event (audit trail) (SSS-2 only)
    pub fn record_compliance_event(
        ctx: Context<RecordComplianceEvent>,
        event: ComplianceEventData,
    ) -> Result<()> {
        instructions::compliance::handler(ctx, event)
    }

    // ─── Admin / governance ───────────────────────────────────────────────────

    /// Update supply cap
    pub fn update_supply_cap(ctx: Context<UpdateConfig>, new_cap: u64) -> Result<()> {
        instructions::admin::handler_update_supply_cap(ctx, new_cap)
    }

    /// Transfer admin authority
    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::handler_transfer_admin(ctx, new_admin)
    }

    /// Upgrade preset from SSS-1 to SSS-2 (one-way migration)
    pub fn upgrade_to_sss2(
        ctx: Context<UpgradeToSss2>,
        compliance_params: Sss2ComplianceParams,
    ) -> Result<()> {
        instructions::admin::handler_upgrade_to_sss2(ctx, compliance_params)
    }

    // ─── SSS-3: Private preset (experimental) ────────────────────────────────

    /// Initialize a new SSS-3 stablecoin (allowlist-gated + confidential transfers)
    ///
    /// The mint should have Token-2022 ConfidentialTransfer extension pre-initialized
    /// using the SDK helper `initializeConfidentialMint()` before calling this instruction.
    pub fn initialize_sss3(
        ctx: Context<InitializeSss3>,
        params: Sss3Params,
    ) -> Result<()> {
        instructions::sss3::handler_sss3(ctx, params)
    }

    /// Add a wallet to the SSS-3 allowlist
    pub fn allowlist_add(
        ctx: Context<AllowlistAdd>,
        expiry: i64,
        note: [u8; 64],
    ) -> Result<()> {
        instructions::sss3::handler_allowlist_add(ctx, expiry, note)
    }

    /// Remove a wallet from the SSS-3 allowlist
    pub fn allowlist_remove(ctx: Context<AllowlistRemove>) -> Result<()> {
        instructions::sss3::handler_allowlist_remove(ctx)
    }

    /// Transfer with SSS-3 allowlist enforcement (standard amounts)
    pub fn transfer_sss3(ctx: Context<TransferSss3>, amount: u64) -> Result<()> {
        instructions::sss3::handler_transfer_sss3(ctx, amount)
    }

    /// Initiate a confidential mint — validates authority and recipient allowlist,
    /// records commitment hash for auditor decryption
    pub fn confidential_mint_sss3(
        ctx: Context<ConfidentialMintSss3>,
        commitment_hash: [u8; 32],
    ) -> Result<()> {
        instructions::sss3::handler_confidential_mint(ctx, commitment_hash)
    }
}
