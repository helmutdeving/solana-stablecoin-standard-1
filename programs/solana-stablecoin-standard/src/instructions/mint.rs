use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, MintTo, Token2022};
use anchor_spl::associated_token::AssociatedToken;

use crate::errors::SssError;
use crate::events::TokensMinted;
use crate::state::*;

#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(mut)]
    pub mint_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"sss-config", mint.key().as_ref()],
        bump = config.bump,
        has_one = mint,
        constraint = config.mint_authority == mint_authority.key() @ SssError::Unauthorized,
        constraint = !config.paused @ SssError::Paused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: Validated via config PDA
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    /// Recipient's token account
    /// CHECK: Validated as ATA by token program
    #[account(mut)]
    pub recipient_token_account: AccountInfo<'info>,

    // SSS-2 only: whitelist record for recipient
    // This account is optional — ignored for SSS-1 presets
    pub recipient_whitelist: Option<Account<'info, WhitelistRecord>>,

    // SSS-2 only: freeze record for recipient
    pub recipient_freeze: Option<Account<'info, FreezeRecord>>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::InvalidAmount);

    let config = &mut ctx.accounts.config;

    // Check supply cap
    if config.supply_cap > 0 {
        let new_supply = config
            .circulating_supply
            .checked_add(amount)
            .ok_or(SssError::Overflow)?;
        require!(new_supply <= config.supply_cap, SssError::SupplyCapExceeded);
    }

    // SSS-2 compliance checks
    if config.is_sss2() {
        // Check recipient whitelist if minting requires it
        // (compliance config would need to be passed in for a real impl;
        //  simplified here — whitelist check is performed if the record exists and is inactive)
        if let Some(whitelist) = &ctx.accounts.recipient_whitelist {
            let clock = Clock::get()?;
            require!(whitelist.active, SssError::RecipientNotWhitelisted);
            if whitelist.expires_at > 0 {
                require!(
                    whitelist.expires_at > clock.unix_timestamp,
                    SssError::WhitelistExpired
                );
            }
        }

        // Check recipient is not frozen
        if let Some(freeze) = &ctx.accounts.recipient_freeze {
            require!(!freeze.active, SssError::AccountFrozen);
        }
    }

    // Perform mint via CPI to Token-2022
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        },
    );
    token_2022::mint_to(cpi_ctx, amount)?;

    // Update supply tracking
    config.circulating_supply = config
        .circulating_supply
        .checked_add(amount)
        .ok_or(SssError::Overflow)?;
    config.total_minted = config
        .total_minted
        .checked_add(amount)
        .ok_or(SssError::Overflow)?;

    let clock = Clock::get()?;
    emit!(TokensMinted {
        mint: config.mint,
        recipient: ctx.accounts.recipient_token_account.key(),
        amount,
        new_supply: config.circulating_supply,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
