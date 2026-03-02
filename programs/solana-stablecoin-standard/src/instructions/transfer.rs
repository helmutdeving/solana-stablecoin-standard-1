use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Transfer, Token2022};

use crate::errors::SssError;
use crate::events::TokensTransferred;
use crate::state::*;

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        seeds = [b"sss-config", mint.key().as_ref()],
        bump = config.bump,
        has_one = mint,
        constraint = !config.paused @ SssError::Paused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: Validated via config
    pub mint: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Validated by token program
    pub sender_token_account: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Validated by token program
    pub recipient_token_account: AccountInfo<'info>,

    // SSS-2 optional compliance accounts
    pub sender_whitelist: Option<Account<'info, WhitelistRecord>>,
    pub recipient_whitelist: Option<Account<'info, WhitelistRecord>>,
    pub sender_freeze: Option<Account<'info, FreezeRecord>>,
    pub recipient_freeze: Option<Account<'info, FreezeRecord>>,

    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::InvalidAmount);

    let config = &ctx.accounts.config;

    // SSS-2 compliance checks
    if config.is_sss2() {
        let clock = Clock::get()?;

        if let Some(wl) = &ctx.accounts.sender_whitelist {
            require!(wl.active, SssError::SenderNotWhitelisted);
            if wl.expires_at > 0 {
                require!(wl.expires_at > clock.unix_timestamp, SssError::WhitelistExpired);
            }
        }

        if let Some(wl) = &ctx.accounts.recipient_whitelist {
            require!(wl.active, SssError::RecipientNotWhitelisted);
            if wl.expires_at > 0 {
                require!(wl.expires_at > clock.unix_timestamp, SssError::WhitelistExpired);
            }
        }

        if let Some(fr) = &ctx.accounts.sender_freeze {
            require!(!fr.active, SssError::AccountFrozen);
        }

        if let Some(fr) = &ctx.accounts.recipient_freeze {
            require!(!fr.active, SssError::AccountFrozen);
        }
    }

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.sender_token_account.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.sender.to_account_info(),
        },
    );
    token_2022::transfer(cpi_ctx, amount)?;

    let clock = Clock::get()?;
    emit!(TokensTransferred {
        mint: config.mint,
        from: ctx.accounts.sender_token_account.key(),
        to: ctx.accounts.recipient_token_account.key(),
        amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
