use anchor_lang::prelude::*;

use crate::errors::SssError;
use crate::events::*;
use crate::state::*;

// ─── Update Supply Cap ────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"sss-config", config.mint.as_ref()],
        bump = config.bump,
        constraint = config.admin == admin.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

pub fn handler_update_supply_cap(ctx: Context<UpdateConfig>, new_cap: u64) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if new_cap > 0 {
        require!(
            new_cap >= config.circulating_supply,
            SssError::SupplyCapBelowCirculating
        );
    }

    let old_cap = config.supply_cap;
    config.supply_cap = new_cap;

    let clock = Clock::get()?;
    emit!(SupplyCapUpdated {
        mint: config.mint,
        old_cap,
        new_cap,
        admin: ctx.accounts.admin.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ─── Transfer Admin ───────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"sss-config", config.mint.as_ref()],
        bump = config.bump,
        constraint = config.admin == admin.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

pub fn handler_transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_admin = config.admin;

    // Two-step transfer: set pending first
    config.pending_admin = Some(new_admin);

    let clock = Clock::get()?;
    emit!(AdminTransferred {
        mint: config.mint,
        old_admin,
        new_admin,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

/// Accept admin transfer (called by the new admin)
#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"sss-config", config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

pub fn handler_accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;

    let pending = config.pending_admin.ok_or(SssError::NoPendingAdmin)?;
    require!(
        pending == ctx.accounts.new_admin.key(),
        SssError::Unauthorized
    );

    config.admin = pending;
    config.pending_admin = None;

    Ok(())
}

// ─── Upgrade SSS-1 → SSS-2 ────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpgradeToSss2<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"sss-config", config.mint.as_ref()],
        bump = config.bump,
        constraint = config.admin == admin.key() @ SssError::Unauthorized,
        // Must currently be SSS-1
        constraint = config.preset == crate::state::Preset::Sss1 @ SssError::CannotDowngrade,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: Validated via config
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    #[account(
        init,
        payer = admin,
        space = ComplianceConfig::LEN,
        seeds = [b"sss-compliance", config.mint.as_ref()],
        bump,
    )]
    pub compliance: Account<'info, ComplianceConfig>,

    /// CHECK: Compliance vault token account
    #[account(mut)]
    pub compliance_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler_upgrade_to_sss2(
    ctx: Context<UpgradeToSss2>,
    compliance_params: Sss2ComplianceParams,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let compliance = &mut ctx.accounts.compliance;
    let clock = Clock::get()?;

    // Upgrade config
    config.preset = Preset::Sss2;

    // Initialize compliance config
    compliance.mint = config.mint;
    compliance.compliance_officer = compliance_params.compliance_officer;
    compliance.whitelist_transfers = compliance_params.whitelist_transfers;
    compliance.whitelist_mints = compliance_params.whitelist_mints;
    compliance.whitelist_burns = compliance_params.whitelist_burns;
    compliance.compliance_vault = ctx.accounts.compliance_vault.key();
    compliance.whitelist_count = 0;
    compliance.freeze_count = 0;
    compliance.event_count = 0;
    compliance.bump = ctx.bumps.compliance;

    emit!(PresetUpgraded {
        mint: config.mint,
        from_preset: 1,
        to_preset: 2,
        admin: ctx.accounts.admin.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
