use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022};

use crate::errors::SssError;
use crate::events::AccountFreezeUpdated;
use crate::state::*;

// ─── Freeze Account ────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct FreezeAccount<'info> {
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

    /// CHECK: The wallet to freeze
    pub wallet: AccountInfo<'info>,

    /// CHECK: The token account to freeze via Token-2022
    #[account(mut)]
    pub wallet_token_account: AccountInfo<'info>,

    /// CHECK: Validated via config
    pub mint: AccountInfo<'info>,

    #[account(
        init,
        payer = compliance_officer,
        space = FreezeRecord::LEN,
        seeds = [b"sss-freeze", config.mint.as_ref(), wallet.key().as_ref()],
        bump,
    )]
    pub freeze_record: Account<'info, FreezeRecord>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler_freeze(ctx: Context<FreezeAccount>, reason: String) -> Result<()> {
    require!(reason.len() <= 128, SssError::ReasonTooLong);

    let clock = Clock::get()?;
    let record = &mut ctx.accounts.freeze_record;

    // Freeze via Token-2022 CPI
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token_2022::FreezeAccount {
            account: ctx.accounts.wallet_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.compliance_officer.to_account_info(),
        },
    );
    token_2022::freeze_account(cpi_ctx)?;

    // Populate freeze record
    record.mint = ctx.accounts.config.mint;
    record.wallet = ctx.accounts.wallet.key();
    let mut reason_bytes = [0u8; 128];
    let reason_slice = reason.as_bytes();
    reason_bytes[..reason_slice.len()].copy_from_slice(reason_slice);
    record.reason = reason_bytes;
    record.frozen_at = clock.unix_timestamp;
    record.frozen_by = ctx.accounts.compliance_officer.key();
    record.unfrozen_at = None;
    record.active = true;
    record.bump = ctx.bumps.freeze_record;

    emit!(AccountFreezeUpdated {
        mint: record.mint,
        wallet: record.wallet,
        frozen: true,
        actor: ctx.accounts.compliance_officer.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ─── Unfreeze Account ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UnfreezeAccount<'info> {
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

    /// CHECK: The wallet to unfreeze
    pub wallet: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Validated by token program
    pub wallet_token_account: AccountInfo<'info>,

    /// CHECK: Validated via config
    pub mint: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"sss-freeze", config.mint.as_ref(), wallet.key().as_ref()],
        bump = freeze_record.bump,
        constraint = freeze_record.active @ SssError::AccountNotFrozen,
    )]
    pub freeze_record: Account<'info, FreezeRecord>,

    pub token_program: Program<'info, Token2022>,
}

pub fn handler_unfreeze(ctx: Context<UnfreezeAccount>) -> Result<()> {
    let clock = Clock::get()?;

    // Thaw via Token-2022 CPI
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token_2022::ThawAccount {
            account: ctx.accounts.wallet_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.compliance_officer.to_account_info(),
        },
    );
    token_2022::thaw_account(cpi_ctx)?;

    ctx.accounts.freeze_record.active = false;
    ctx.accounts.freeze_record.unfrozen_at = Some(clock.unix_timestamp);

    emit!(AccountFreezeUpdated {
        mint: ctx.accounts.config.mint,
        wallet: ctx.accounts.wallet.key(),
        frozen: false,
        actor: ctx.accounts.compliance_officer.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
