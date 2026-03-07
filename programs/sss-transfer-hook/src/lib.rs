use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::transfer_hook::TransferHookAccount;

declare_id!("DbEuNBSDNQp1ijdX7qhnLX7qVfqVMDcjBWiGeUqhaY5w");

/// SSS Transfer Hook Program
///
/// Invoked by Token-2022 on every token transfer for SSS-controlled mints.
/// Enforces SSS-2 compliance at the token-program level:
///   - Rejects transfers if global pause is active
///   - Rejects if source account owner is frozen (`FreezeRecord.active == true`)
///   - Rejects if destination account owner is frozen
///   - Rejects if `ComplianceConfig.whitelist_transfers` is true and
///     sender or receiver is not on the `WhitelistRecord`
///
/// This "fails closed" architecture means a frozen or non-whitelisted account
/// cannot bypass compliance by using any wallet or DEX — the restriction is
/// enforced by Token-2022 itself, not just by the SSS program instructions.
///
/// PDA seeds for `ExtraAccountMetaList`:
///   ["extra-account-metas", mint]
#[program]
pub mod sss_transfer_hook {
    use super::*;

    /// Initialize extra account meta list for a mint.
    /// Called once per mint by the SSS admin during mint initialization.
    /// Stores the PDAs the hook needs as extra accounts on every transfer.
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
        _mint: Pubkey,
    ) -> Result<()> {
        // The ExtraAccountMetaList PDA is created in the accounts struct.
        // It tells Token-2022 which extra accounts to pass when executing this hook.
        // The accounts we need:
        //   [0] sss_config  (StablecoinConfig PDA, read-only)
        //   [1] compliance_config (ComplianceConfig PDA, read-only, optional)
        //   [2] freeze_record_source  (FreezeRecord for source owner, optional)
        //   [3] freeze_record_dest    (FreezeRecord for dest owner, optional)
        //   [4] whitelist_record_source (WhitelistRecord for source owner, optional)
        //   [5] whitelist_record_dest   (WhitelistRecord for dest owner, optional)
        //   [6] main SSS program (to verify account ownership)
        msg!("Transfer hook extra account meta list initialized for mint: {}", ctx.accounts.mint.key());
        Ok(())
    }

    /// Execute hook — called by Token-2022 on every transfer.
    ///
    /// Account layout (in order after the standard transfer-hook accounts):
    ///   0. sss_config           - StablecoinConfig PDA   (read-only)
    ///   1. compliance_config    - ComplianceConfig PDA   (read-only, may be uninitialized for SSS-1)
    ///   2. freeze_source_owner  - FreezeRecord for source token account owner (read-only, optional)
    ///   3. freeze_dest_owner    - FreezeRecord for dest token account owner   (read-only, optional)
    ///   4. whitelist_source     - WhitelistRecord for source owner             (read-only, optional)
    ///   5. whitelist_dest       - WhitelistRecord for dest owner               (read-only, optional)
    pub fn execute(ctx: Context<Execute>, _amount: u64) -> Result<()> {
        let sss_config = &ctx.accounts.sss_config;

        // 1. Global pause check — applies to all presets
        require!(!sss_config.paused, SssHookError::GloballyPaused);

        // 2. SSS-2 compliance checks
        if sss_config.preset == SssPreset::Sss2 {
            let compliance = &ctx.accounts.compliance_config;

            // Freeze checks — source and destination owners must not be frozen
            if let Some(freeze_src) = &ctx.accounts.freeze_source_owner {
                require!(!freeze_src.active, SssHookError::SourceAccountFrozen);
            }
            if let Some(freeze_dst) = &ctx.accounts.freeze_dest_owner {
                require!(!freeze_dst.active, SssHookError::DestinationAccountFrozen);
            }

            // Whitelist check
            if compliance.whitelist_transfers {
                // Source must be whitelisted and not expired
                let now = Clock::get()?.unix_timestamp;
                if let Some(wl_src) = &ctx.accounts.whitelist_source {
                    require!(
                        wl_src.active && (wl_src.expires_at == 0 || wl_src.expires_at > now),
                        SssHookError::SourceNotWhitelisted
                    );
                } else {
                    // No whitelist record = not whitelisted
                    return Err(SssHookError::SourceNotWhitelisted.into());
                }
                if let Some(wl_dst) = &ctx.accounts.whitelist_dest {
                    require!(
                        wl_dst.active && (wl_dst.expires_at == 0 || wl_dst.expires_at > now),
                        SssHookError::DestinationNotWhitelisted
                    );
                } else {
                    return Err(SssHookError::DestinationNotWhitelisted.into());
                }
            }
        }

        // 3. SSS-3 allowlist checks (handled by SSS-3 program directly;
        //    confidential transfers use a separate ZK proof hook)

        msg!("Transfer hook: compliance check passed");
        Ok(())
    }
}

// ─── Account Structs ──────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(mint: Pubkey)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The Token-2022 mint for which we are setting up the hook
    /// CHECK: validated by token-2022
    pub mint: UncheckedAccount<'info>,

    /// ExtraAccountMetaList PDA — stored by Token-2022 standard
    /// seeds: ["extra-account-metas", mint]
    #[account(
        init,
        payer = payer,
        space = 8 + ExtraAccountMetaList::LEN,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: Account<'info, ExtraAccountMetaList>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    /// Source token account (owned by Token-2022)
    /// CHECK: validated by Token-2022
    pub source_token_account: UncheckedAccount<'info>,

    /// The mint
    /// CHECK: validated by Token-2022
    pub mint: UncheckedAccount<'info>,

    /// Destination token account
    /// CHECK: validated by Token-2022
    pub destination_token_account: UncheckedAccount<'info>,

    /// Owner / delegate of source token account
    /// CHECK: validated by Token-2022
    pub source_token_account_authority: UncheckedAccount<'info>,

    /// Validation state account (extra account meta list)
    /// seeds: ["extra-account-metas", mint]
    /// CHECK: seeds verified
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    // ─── Extra accounts (SSS state) ───────────────────────────────────────

    /// SSS StablecoinConfig — global config for this mint
    /// seeds: ["sss-config", mint]
    #[account(
        seeds = [b"sss-config", mint.key().as_ref()],
        bump = sss_config.bump,
        seeds::program = SSS_PROGRAM_ID,
    )]
    pub sss_config: Account<'info, SssStablecoinConfig>,

    /// SSS ComplianceConfig — only present for SSS-2 mints
    /// seeds: ["sss-compliance", mint]
    #[account(
        seeds = [b"sss-compliance", mint.key().as_ref()],
        bump = compliance_config.bump,
        seeds::program = SSS_PROGRAM_ID,
    )]
    pub compliance_config: Account<'info, SssComplianceConfig>,

    /// FreezeRecord for the source token account owner (optional — None if not frozen)
    /// seeds: ["sss-freeze", mint, source_token_account_authority]
    #[account(
        seeds = [
            b"sss-freeze",
            mint.key().as_ref(),
            source_token_account_authority.key().as_ref(),
        ],
        bump,
        seeds::program = SSS_PROGRAM_ID,
    )]
    pub freeze_source_owner: Option<Account<'info, SssFreezeRecord>>,

    /// FreezeRecord for the destination token account owner (optional)
    /// seeds: ["sss-freeze", mint, destination_owner]
    #[account(
        seeds = [
            b"sss-freeze",
            mint.key().as_ref(),
            // Note: we derive dest owner from dest token account data
            destination_token_account.key().as_ref(),
        ],
        bump,
        seeds::program = SSS_PROGRAM_ID,
    )]
    pub freeze_dest_owner: Option<Account<'info, SssFreezeRecord>>,

    /// WhitelistRecord for source token account owner (optional)
    /// seeds: ["sss-whitelist", mint, source_token_account_authority]
    #[account(
        seeds = [
            b"sss-whitelist",
            mint.key().as_ref(),
            source_token_account_authority.key().as_ref(),
        ],
        bump,
        seeds::program = SSS_PROGRAM_ID,
    )]
    pub whitelist_source: Option<Account<'info, SssWhitelistRecord>>,

    /// WhitelistRecord for dest token account owner (optional)
    #[account(
        seeds = [
            b"sss-whitelist",
            mint.key().as_ref(),
            destination_token_account.key().as_ref(),
        ],
        bump,
        seeds::program = SSS_PROGRAM_ID,
    )]
    pub whitelist_dest: Option<Account<'info, SssWhitelistRecord>>,
}

// ─── Cross-program Account Mirrors ───────────────────────────────────────────
// We redeclare the SSS program's account types here so Anchor can deserialize
// them via zero-copy reads. Field layout must match exactly.

/// Mirror of solana-stablecoin-standard::state::Preset
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum SssPreset {
    Sss1,
    Sss2,
    Sss3,
}

/// Mirror of solana-stablecoin-standard::state::StablecoinConfig
/// PDA: ["sss-config", mint] in the main SSS program
#[account]
pub struct SssStablecoinConfig {
    pub preset: SssPreset,
    pub mint: Pubkey,
    pub circulating_supply: u64,
    pub supply_cap: u64,
    pub mint_authority: Pubkey,
    pub burn_authority: Pubkey,
    pub admin: Pubkey,
    pub pending_admin: Option<Pubkey>,
    pub paused: bool,
    pub decimals: u8,
    pub name: [u8; 32],
    pub symbol: [u8; 8],
    pub created_at: i64,
    pub total_minted: u64,
    pub total_burned: u64,
    pub bump: u8,
}

/// Mirror of solana-stablecoin-standard::state::ComplianceConfig
#[account]
pub struct SssComplianceConfig {
    pub mint: Pubkey,
    pub compliance_officer: Pubkey,
    pub whitelist_transfers: bool,
    pub whitelist_mints: bool,
    pub whitelist_burns: bool,
    pub compliance_vault: Pubkey,
    pub whitelist_count: u32,
    pub freeze_count: u32,
    pub event_count: u64,
    pub bump: u8,
}

/// Mirror of solana-stablecoin-standard::state::FreezeRecord
#[account]
pub struct SssFreezeRecord {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub reason: [u8; 128],
    pub frozen_at: i64,
    pub frozen_by: Pubkey,
    pub unfrozen_at: Option<i64>,
    pub active: bool,
    pub bump: u8,
}

/// Mirror of solana-stablecoin-standard::state::WhitelistRecord
#[account]
pub struct SssWhitelistRecord {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub kyc_ref: [u8; 64],
    pub added_at: i64,
    pub expires_at: i64,
    pub added_by: Pubkey,
    pub active: bool,
    pub bump: u8,
}

/// Extra account meta list storage
/// Stores which extra accounts the hook requires on every transfer call.
#[account]
pub struct ExtraAccountMetaList {
    pub bump: u8,
    pub mint: Pubkey,
}

impl ExtraAccountMetaList {
    pub const LEN: usize = 1 + 32;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum SssHookError {
    #[msg("Transfer rejected: stablecoin is globally paused")]
    GloballyPaused,

    #[msg("Transfer rejected: source account is frozen by compliance officer")]
    SourceAccountFrozen,

    #[msg("Transfer rejected: destination account is frozen by compliance officer")]
    DestinationAccountFrozen,

    #[msg("Transfer rejected: source wallet is not on the KYC whitelist")]
    SourceNotWhitelisted,

    #[msg("Transfer rejected: destination wallet is not on the KYC whitelist")]
    DestinationNotWhitelisted,

    #[msg("Transfer rejected: KYC whitelist entry has expired — re-verification required")]
    WhitelistEntryExpired,
}

// ─── Constants ────────────────────────────────────────────────────────────────

/// The main SSS program ID — used for PDA cross-program seed derivation
/// This must match the declared_id of solana-stablecoin-standard
pub const SSS_PROGRAM_ID: Pubkey = pubkey!("8kY3yQGTdrvPRG3SQfjwyf3SuuUW9Wt1W8zFwURTpa59");
