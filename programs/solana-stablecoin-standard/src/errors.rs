use anchor_lang::prelude::*;

#[error_code]
pub enum SssError {
    // ─── General ─────────────────────────────────────────────────────────────
    #[msg("Unauthorized: caller does not have the required authority")]
    Unauthorized,

    #[msg("Program is globally paused")]
    Paused,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Invalid amount: must be greater than zero")]
    InvalidAmount,

    // ─── Supply ───────────────────────────────────────────────────────────────
    #[msg("Supply cap would be exceeded by this mint")]
    SupplyCapExceeded,

    #[msg("Insufficient balance to burn")]
    InsufficientBalance,

    // ─── SSS-2 Compliance ─────────────────────────────────────────────────────
    #[msg("SSS-2 feature not available on SSS-1 preset")]
    NotSss2,

    #[msg("Recipient is not on the KYC whitelist")]
    RecipientNotWhitelisted,

    #[msg("Sender is not on the KYC whitelist")]
    SenderNotWhitelisted,

    #[msg("Account is frozen — all operations suspended")]
    AccountFrozen,

    #[msg("Account is not frozen")]
    AccountNotFrozen,

    #[msg("Whitelist entry has expired")]
    WhitelistExpired,

    #[msg("Whitelist entry already exists for this address")]
    AlreadyWhitelisted,

    #[msg("Address is not on the whitelist")]
    NotWhitelisted,

    // ─── Admin ────────────────────────────────────────────────────────────────
    #[msg("New supply cap cannot be lower than current circulating supply")]
    SupplyCapBelowCirculating,

    #[msg("No pending admin transfer")]
    NoPendingAdmin,

    #[msg("Cannot downgrade from SSS-2 to SSS-1")]
    CannotDowngrade,

    // ─── String length ────────────────────────────────────────────────────────
    #[msg("Reason string too long (max 128 bytes)")]
    ReasonTooLong,
}
