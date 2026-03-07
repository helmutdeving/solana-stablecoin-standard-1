use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Burn, Token2022};

use crate::errors::SssError;
use crate::events::TokensBurned;
use crate::state::*;

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    #[account(mut)]
    pub burn_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"sss-config", mint.key().as_ref()],
        bump = config.bump,
        has_one = mint,
        constraint = config.burn_authority == burn_authority.key() @ SssError::Unauthorized,
        constraint = !config.paused @ SssError::Paused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: Validated via config
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    /// Token account to burn from
    /// CHECK: Validated by token program
    #[account(mut)]
    pub holder_token_account: AccountInfo<'info>,

    /// SSS-2: whitelist record for holder (optional)
    pub holder_whitelist: Option<Account<'info, WhitelistRecord>>,

    /// SSS-2: freeze record for holder (optional)
    pub holder_freeze: Option<Account<'info, FreezeRecord>>,

    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::InvalidAmount);

    let config = &mut ctx.accounts.config;

    // SSS-2 compliance checks
    if config.is_sss2() {
        if let Some(whitelist) = &ctx.accounts.holder_whitelist {
            let clock = Clock::get()?;
            require!(whitelist.active, SssError::SenderNotWhitelisted);
            if whitelist.expires_at > 0 {
                require!(
                    whitelist.expires_at > clock.unix_timestamp,
                    SssError::WhitelistExpired
                );
            }
        }

        if let Some(freeze) = &ctx.accounts.holder_freeze {
            require!(!freeze.active, SssError::AccountFrozen);
        }
    }

    // CPI burn
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.holder_token_account.to_account_info(),
            authority: ctx.accounts.burn_authority.to_account_info(),
        },
    );
    token_2022::burn(cpi_ctx, amount)?;

    config.circulating_supply = config
        .circulating_supply
        .checked_sub(amount)
        .ok_or(SssError::Overflow)?;
    config.total_burned = config
        .total_burned
        .checked_add(amount)
        .ok_or(SssError::Overflow)?;

    let clock = Clock::get()?;
    emit!(TokensBurned {
        mint: config.mint,
        holder: ctx.accounts.holder_token_account.key(),
        amount,
        new_supply: config.circulating_supply,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
