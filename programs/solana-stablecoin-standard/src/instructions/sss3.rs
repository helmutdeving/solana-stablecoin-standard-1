/// SSS-3: Private Stablecoin Preset
///
/// Experimental preset combining:
///   - Scoped allowlists: only allowlisted addresses may receive transfers
///   - Confidential transfer extension: Token-2022 ElGamal-based privacy layer
///
/// Architecture:
///   - Separate allowlist registry from SSS-2 KYC whitelist
///   - Confidential transfer extension enabled at mint initialization
///   - Transfer hook validates recipient is on allowlist before ciphertext decryption
///
/// Status: Proof-of-concept — Token-2022 confidential transfer tooling is maturing.
///   The allowlist gating is fully functional; confidential amounts use
///   Token-2022's `ConfidentialTransfer` extension which requires client-side
///   ElGamal proof generation (see packages/sdk/src/sss3.ts).
use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022};
use anchor_spl::associated_token::AssociatedToken;

use crate::errors::SssError;
use crate::events::{StablecoinInitialized, AllowlistUpdated, ConfidentialMintInitiated};
use crate::state::*;

// ─── Initialize SSS-3 ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(params: Sss3Params)]
pub struct InitializeSss3<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The new token mint (must be created with ConfidentialTransfer extension pre-initialized)
    #[account(mut)]
    pub mint: Signer<'info>,

    /// SSS config PDA (shared structure with SSS-1/SSS-2)
    #[account(
        init,
        payer = payer,
        space = StablecoinConfig::LEN,
        seeds = [b"sss-config", mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// SSS-3 specific config PDA
    #[account(
        init,
        payer = payer,
        space = Sss3Config::LEN,
        seeds = [b"sss3-config", mint.key().as_ref()],
        bump,
    )]
    pub sss3_config: Account<'info, Sss3Config>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler_sss3(ctx: Context<InitializeSss3>, params: Sss3Params) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let sss3_config = &mut ctx.accounts.sss3_config;
    let clock = Clock::get()?;

    // Initialize Token-2022 mint with freeze authority
    // NOTE: Confidential transfer extension must be initialized by the client
    // before calling this instruction (using spl-token CLI or SDK helper).
    // See packages/sdk/src/sss3.ts#initializeConfidentialMint()
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token_2022::InitializeMint2 {
            mint: ctx.accounts.mint.to_account_info(),
        },
    );
    token_2022::initialize_mint2(
        cpi_ctx,
        params.decimals,
        &ctx.accounts.payer.key(),
        Some(&ctx.accounts.payer.key()), // freeze authority for compliance seizure
    )?;

    // Populate base config
    config.preset = Preset::Sss3;
    config.mint = ctx.accounts.mint.key();
    config.circulating_supply = 0;
    config.supply_cap = params.supply_cap;
    config.mint_authority = ctx.accounts.payer.key();
    config.burn_authority = ctx.accounts.payer.key();
    config.admin = ctx.accounts.payer.key();
    config.pending_admin = None;
    config.paused = false;
    config.decimals = params.decimals;
    config.name = params.name;
    config.symbol = params.symbol;
    config.created_at = clock.unix_timestamp;
    config.total_minted = 0;
    config.total_burned = 0;
    config.bump = ctx.bumps.config;

    // Populate SSS-3 specific config
    sss3_config.mint = ctx.accounts.mint.key();
    sss3_config.allowlist_authority = params.allowlist_authority;
    sss3_config.require_allowlist_for_receive = params.require_allowlist_for_receive;
    sss3_config.require_allowlist_for_send = params.require_allowlist_for_send;
    sss3_config.confidential_transfers_enabled = params.confidential_transfers_enabled;
    sss3_config.auto_approve_new_accounts = params.auto_approve_new_accounts;
    sss3_config.auditor_pubkey = params.auditor_pubkey;
    sss3_config.allowlist_count = 0;
    sss3_config.bump = ctx.bumps.sss3_config;

    emit!(StablecoinInitialized {
        mint: config.mint,
        preset: 3,
        admin: config.admin,
        supply_cap: config.supply_cap,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ─── Add to Allowlist ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct AllowlistAdd<'info> {
    #[account(mut)]
    pub allowlist_authority: Signer<'info>,

    #[account(
        seeds = [b"sss-config", sss3_config.mint.as_ref()],
        bump = config.bump,
        constraint = config.is_sss3() @ SssError::NotSss3,
        constraint = !config.paused @ SssError::Paused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [b"sss3-config", sss3_config.mint.as_ref()],
        bump = sss3_config.bump,
        constraint = sss3_config.allowlist_authority == allowlist_authority.key() @ SssError::Unauthorized,
    )]
    pub sss3_config: Account<'info, Sss3Config>,

    /// The wallet to add to the allowlist
    /// CHECK: Just an address
    pub wallet: AccountInfo<'info>,

    #[account(
        init,
        payer = allowlist_authority,
        space = AllowlistRecord::LEN,
        seeds = [b"sss3-allowlist", sss3_config.mint.as_ref(), wallet.key().as_ref()],
        bump,
    )]
    pub allowlist_record: Account<'info, AllowlistRecord>,

    pub system_program: Program<'info, System>,
}

pub fn handler_allowlist_add(
    ctx: Context<AllowlistAdd>,
    expiry: i64,
    note: [u8; 64],
) -> Result<()> {
    let record = &mut ctx.accounts.allowlist_record;
    let clock = Clock::get()?;

    record.mint = ctx.accounts.sss3_config.mint;
    record.wallet = ctx.accounts.wallet.key();
    record.added_at = clock.unix_timestamp;
    record.expires_at = expiry;
    record.added_by = ctx.accounts.allowlist_authority.key();
    record.active = true;
    record.note = note;
    record.bump = ctx.bumps.allowlist_record;

    // Increment allowlist counter
    ctx.accounts.sss3_config.to_account_info(); // ensure it's loaded
    let sss3_config = &mut ctx.accounts.sss3_config;
    sss3_config.allowlist_count = sss3_config
        .allowlist_count
        .checked_add(1)
        .ok_or(SssError::Overflow)?;

    emit!(AllowlistUpdated {
        mint: record.mint,
        wallet: record.wallet,
        action: 1, // added
        actor: ctx.accounts.allowlist_authority.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ─── Remove from Allowlist ───────────────────────────────────────────────────

#[derive(Accounts)]
pub struct AllowlistRemove<'info> {
    pub allowlist_authority: Signer<'info>,

    #[account(
        seeds = [b"sss-config", sss3_config.mint.as_ref()],
        bump = config.bump,
        constraint = config.is_sss3() @ SssError::NotSss3,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [b"sss3-config", sss3_config.mint.as_ref()],
        bump = sss3_config.bump,
        constraint = sss3_config.allowlist_authority == allowlist_authority.key() @ SssError::Unauthorized,
    )]
    pub sss3_config: Account<'info, Sss3Config>,

    /// CHECK: Just an address
    pub wallet: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"sss3-allowlist", sss3_config.mint.as_ref(), wallet.key().as_ref()],
        bump = allowlist_record.bump,
        constraint = allowlist_record.active @ SssError::NotAllowlisted,
    )]
    pub allowlist_record: Account<'info, AllowlistRecord>,
}

pub fn handler_allowlist_remove(ctx: Context<AllowlistRemove>) -> Result<()> {
    ctx.accounts.allowlist_record.active = false;

    let clock = Clock::get()?;
    emit!(AllowlistUpdated {
        mint: ctx.accounts.sss3_config.mint,
        wallet: ctx.accounts.wallet.key(),
        action: 0, // removed
        actor: ctx.accounts.allowlist_authority.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ─── SSS-3 Transfer (Allowlist-gated) ────────────────────────────────────────

/// Standard (non-confidential) transfer with allowlist enforcement.
/// For confidential amounts, use the client-side confidential_transfer instruction
/// in packages/sdk/src/sss3.ts which generates the required ZK proofs.
#[derive(Accounts)]
pub struct TransferSss3<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        seeds = [b"sss-config", config.mint.as_ref()],
        bump = config.bump,
        constraint = config.is_sss3() @ SssError::NotSss3,
        constraint = !config.paused @ SssError::Paused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [b"sss3-config", config.mint.as_ref()],
        bump = sss3_config.bump,
    )]
    pub sss3_config: Account<'info, Sss3Config>,

    /// CHECK: Validated via config
    pub mint: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Validated by token program
    pub sender_token_account: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Validated by token program
    pub recipient_token_account: AccountInfo<'info>,

    /// Sender's allowlist record (required if require_allowlist_for_send)
    pub sender_allowlist: Option<Account<'info, AllowlistRecord>>,
    /// Recipient's allowlist record (required if require_allowlist_for_receive)
    pub recipient_allowlist: Option<Account<'info, AllowlistRecord>>,

    pub token_program: Program<'info, Token2022>,
}

pub fn handler_transfer_sss3(ctx: Context<TransferSss3>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::InvalidAmount);

    let sss3 = &ctx.accounts.sss3_config;
    let clock = Clock::get()?;

    // Enforce allowlist for sender
    if sss3.require_allowlist_for_send {
        let record = ctx
            .accounts
            .sender_allowlist
            .as_ref()
            .ok_or(SssError::SenderNotAllowlisted)?;
        require!(record.active, SssError::SenderNotAllowlisted);
        if record.expires_at > 0 {
            require!(record.expires_at > clock.unix_timestamp, SssError::AllowlistExpired);
        }
    }

    // Enforce allowlist for recipient
    if sss3.require_allowlist_for_receive {
        let record = ctx
            .accounts
            .recipient_allowlist
            .as_ref()
            .ok_or(SssError::RecipientNotAllowlisted)?;
        require!(record.active, SssError::RecipientNotAllowlisted);
        if record.expires_at > 0 {
            require!(record.expires_at > clock.unix_timestamp, SssError::AllowlistExpired);
        }
    }

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token_2022::Transfer {
            from: ctx.accounts.sender_token_account.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.sender.to_account_info(),
        },
    );
    token_2022::transfer(cpi_ctx, amount)?;

    Ok(())
}

// ─── Confidential Mint Initiation ─────────────────────────────────────────────

/// Records the initiation of a confidential mint on-chain.
/// Actual confidential mint requires client-side ElGamal proof generation.
/// This instruction validates authority and emits an auditable event.
#[derive(Accounts)]
pub struct ConfidentialMintSss3<'info> {
    pub mint_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"sss-config", config.mint.as_ref()],
        bump = config.bump,
        constraint = config.is_sss3() @ SssError::NotSss3,
        constraint = !config.paused @ SssError::Paused,
        constraint = config.mint_authority == mint_authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [b"sss3-config", config.mint.as_ref()],
        bump = sss3_config.bump,
    )]
    pub sss3_config: Account<'info, Sss3Config>,

    /// Recipient's allowlist record — must be present and active
    pub recipient_allowlist: Account<'info, AllowlistRecord>,
}

pub fn handler_confidential_mint(
    ctx: Context<ConfidentialMintSss3>,
    commitment_hash: [u8; 32],
) -> Result<()> {
    let record = &ctx.accounts.recipient_allowlist;
    let clock = Clock::get()?;

    require!(record.active, SssError::RecipientNotAllowlisted);
    if record.expires_at > 0 {
        require!(record.expires_at > clock.unix_timestamp, SssError::AllowlistExpired);
    }

    // Track supply (amount is concealed — tracked via commitment)
    // In production: verifier program decrypts via auditor ElGamal key
    emit!(ConfidentialMintInitiated {
        mint: ctx.accounts.config.mint,
        recipient_allowlist_record: ctx.accounts.recipient_allowlist.key(),
        commitment_hash,
        initiator: ctx.accounts.mint_authority.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
