use anchor_lang::prelude::*;

#[event]
pub struct StablecoinInitialized {
    pub mint: Pubkey,
    pub preset: u8, // 1 = SSS-1, 2 = SSS-2
    pub admin: Pubkey,
    pub supply_cap: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensMinted {
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub new_supply: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensBurned {
    pub mint: Pubkey,
    pub holder: Pubkey,
    pub amount: u64,
    pub new_supply: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensTransferred {
    pub mint: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct WhitelistUpdated {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub action: u8, // 0 = removed, 1 = added
    pub actor: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AccountFreezeUpdated {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub frozen: bool,
    pub actor: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct FundsSeized {
    pub mint: Pubkey,
    pub from: Pubkey,
    pub vault: Pubkey,
    pub amount: u64,
    pub actor: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SupplyCapUpdated {
    pub mint: Pubkey,
    pub old_cap: u64,
    pub new_cap: u64,
    pub admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AdminTransferred {
    pub mint: Pubkey,
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PresetUpgraded {
    pub mint: Pubkey,
    pub from_preset: u8,
    pub to_preset: u8,
    pub admin: Pubkey,
    pub timestamp: i64,
}
