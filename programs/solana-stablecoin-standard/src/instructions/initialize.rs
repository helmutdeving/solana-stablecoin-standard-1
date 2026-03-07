use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022};
use anchor_spl::associated_token::AssociatedToken;

use crate::errors::SssError;
use crate::events::StablecoinInitialized;
use crate::state::*;

// ─── SSS-1 Initialize ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(params: Sss1Params)]
pub struct InitializeSss1<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The new token mint. Caller creates and passes this in.
    #[account(mut)]
    pub mint: Signer<'info>,

    /// SSS config PDA
    #[account(
        init,
        payer = payer,
        space = StablecoinConfig::LEN,
        seeds = [b"sss-config", mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler_sss1(ctx: Context<InitializeSss1>, params: Sss1Params) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let clock = Clock::get()?;

    // Initialize the Token-2022 mint
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
        None, // freeze authority — SSS-1 has none
    )?;

    // Populate config
    config.preset = Preset::Sss1;
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

    emit!(StablecoinInitialized {
        mint: config.mint,
        preset: 1,
        admin: config.admin,
        supply_cap: config.supply_cap,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ─── SSS-2 Initialize ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(params: Sss2Params)]
pub struct InitializeSss2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub mint: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = StablecoinConfig::LEN,
        seeds = [b"sss-config", mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// SSS-2 compliance config PDA
    #[account(
        init,
        payer = payer,
        space = ComplianceConfig::LEN,
        seeds = [b"sss-compliance", mint.key().as_ref()],
        bump,
    )]
    pub compliance: Account<'info, ComplianceConfig>,

    /// Compliance vault — receives seized funds. Must be a token account for this mint.
    /// CHECK: Validated to be an ATA for compliance_officer during init
    #[account(mut)]
    pub compliance_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler_sss2(ctx: Context<InitializeSss2>, params: Sss2Params) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let compliance = &mut ctx.accounts.compliance;
    let clock = Clock::get()?;

    // Initialize Token-2022 mint with freeze authority (required for SSS-2)
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
        Some(&ctx.accounts.payer.key()), // freeze authority for SSS-2
    )?;

    // Populate config
    config.preset = Preset::Sss2;
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

    // Populate compliance config
    compliance.mint = ctx.accounts.mint.key();
    compliance.compliance_officer = params.compliance.compliance_officer;
    compliance.whitelist_transfers = params.compliance.whitelist_transfers;
    compliance.whitelist_mints = params.compliance.whitelist_mints;
    compliance.whitelist_burns = params.compliance.whitelist_burns;
    compliance.compliance_vault = ctx.accounts.compliance_vault.key();
    compliance.whitelist_count = 0;
    compliance.freeze_count = 0;
    compliance.event_count = 0;
    compliance.bump = ctx.bumps.compliance;

    emit!(StablecoinInitialized {
        mint: config.mint,
        preset: 2,
        admin: config.admin,
        supply_cap: config.supply_cap,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
