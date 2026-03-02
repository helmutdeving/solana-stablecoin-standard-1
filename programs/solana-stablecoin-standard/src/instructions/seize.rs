use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022, Transfer};

use crate::errors::SssError;
use crate::events::FundsSeized;
use crate::state::*;

#[derive(Accounts)]
pub struct SeizeFunds<'info> {
    pub compliance_officer: Signer<'info>,

    #[account(
        mut,
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

    /// The frozen wallet
    /// CHECK: Just an address
    pub wallet: AccountInfo<'info>,

    /// Token account of the frozen wallet
    #[account(mut)]
    /// CHECK: Validated by token program
    pub wallet_token_account: AccountInfo<'info>,

    /// Compliance vault token account
    #[account(mut)]
    /// CHECK: Validated by token program
    pub compliance_vault_token_account: AccountInfo<'info>,

    #[account(
        seeds = [b"sss-freeze", config.mint.as_ref(), wallet.key().as_ref()],
        bump = freeze_record.bump,
        constraint = freeze_record.active @ SssError::AccountNotFrozen,
    )]
    pub freeze_record: Account<'info, FreezeRecord>,

    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<SeizeFunds>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::InvalidAmount);

    // Transfer seized funds to compliance vault
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.wallet_token_account.to_account_info(),
            to: ctx.accounts.compliance_vault_token_account.to_account_info(),
            authority: ctx.accounts.compliance_officer.to_account_info(),
        },
    );
    token_2022::transfer(cpi_ctx, amount)?;

    let clock = Clock::get()?;
    emit!(FundsSeized {
        mint: ctx.accounts.config.mint,
        from: ctx.accounts.wallet.key(),
        vault: ctx.accounts.compliance_vault_token_account.key(),
        amount,
        actor: ctx.accounts.compliance_officer.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
