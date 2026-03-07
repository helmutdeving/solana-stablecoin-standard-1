use anchor_lang::prelude::*;

use crate::errors::SssError;
use crate::events::WhitelistUpdated;
use crate::state::*;

// ─── Add to Whitelist ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(entry: WhitelistEntry)]
pub struct WhitelistAdd<'info> {
    #[account(mut)]
    pub compliance_officer: Signer<'info>,

    #[account(
        seeds = [b"sss-config", config.mint.as_ref()],
        bump = config.bump,
        constraint = config.is_sss2() @ SssError::NotSss2,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [b"sss-compliance", config.mint.as_ref()],
        bump = compliance.bump,
        constraint = compliance.compliance_officer == compliance_officer.key() @ SssError::Unauthorized,
    )]
    pub compliance: Account<'info, ComplianceConfig>,

    /// The wallet to whitelist
    /// CHECK: Just an address
    pub wallet: AccountInfo<'info>,

    #[account(
        init,
        payer = compliance_officer,
        space = WhitelistRecord::LEN,
        seeds = [b"sss-whitelist", config.mint.as_ref(), wallet.key().as_ref()],
        bump,
    )]
    pub whitelist_record: Account<'info, WhitelistRecord>,

    pub system_program: Program<'info, System>,
}

pub fn handler_add(ctx: Context<WhitelistAdd>, entry: WhitelistEntry) -> Result<()> {
    let record = &mut ctx.accounts.whitelist_record;
    let clock = Clock::get()?;

    record.mint = ctx.accounts.config.mint;
    record.wallet = ctx.accounts.wallet.key();
    record.kyc_ref = entry.kyc_ref;
    record.added_at = clock.unix_timestamp;
    record.expires_at = entry.expires_at;
    record.added_by = ctx.accounts.compliance_officer.key();
    record.active = true;
    record.bump = ctx.bumps.whitelist_record;

    emit!(WhitelistUpdated {
        mint: record.mint,
        wallet: record.wallet,
        action: 1,
        actor: ctx.accounts.compliance_officer.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ─── Remove from Whitelist ───────────────────────────────────────────────────

#[derive(Accounts)]
pub struct WhitelistRemove<'info> {
    pub compliance_officer: Signer<'info>,

    #[account(
        seeds = [b"sss-config", config.mint.as_ref()],
        bump = config.bump,
        constraint = config.is_sss2() @ SssError::NotSss2,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [b"sss-compliance", config.mint.as_ref()],
        bump = compliance.bump,
        constraint = compliance.compliance_officer == compliance_officer.key() @ SssError::Unauthorized,
    )]
    pub compliance: Account<'info, ComplianceConfig>,

    /// CHECK: Just an address
    pub wallet: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"sss-whitelist", config.mint.as_ref(), wallet.key().as_ref()],
        bump = whitelist_record.bump,
        constraint = whitelist_record.active @ SssError::NotWhitelisted,
    )]
    pub whitelist_record: Account<'info, WhitelistRecord>,
}

pub fn handler_remove(ctx: Context<WhitelistRemove>) -> Result<()> {
    ctx.accounts.whitelist_record.active = false;

    let clock = Clock::get()?;
    emit!(WhitelistUpdated {
        mint: ctx.accounts.config.mint,
        wallet: ctx.accounts.wallet.key(),
        action: 0,
        actor: ctx.accounts.compliance_officer.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
