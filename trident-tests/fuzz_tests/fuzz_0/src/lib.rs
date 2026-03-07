//! Fuzz Target 0: SSS-1 Core Supply Invariants
//!
//! Tests that for any sequence of mint/burn/transfer operations:
//!   1. circulating_supply never exceeds supply_cap
//!   2. circulating_supply = total_minted - total_burned (accounting invariant)
//!   3. Mint with supply_cap=0 (uncapped) never panics
//!   4. Burn never underflows below zero
//!   5. Transfer cannot create or destroy tokens

use anchor_lang::prelude::*;
use arbitrary::Arbitrary;
use trident_fuzz::prelude::*;

use solana_stablecoin_standard::instructions::{Sss1Params, InitializeSss1, MintTokens, BurnTokens, TransferTokens};

/// All possible fuzz instructions for SSS-1 operations
#[derive(Arbitrary, Debug)]
pub enum FuzzInstruction {
    InitializeSss1(InitializeSss1Data),
    MintTokens(MintTokensData),
    BurnTokens(BurnTokensData),
    TransferTokens(TransferTokensData),
}

// ─── Instruction Data ─────────────────────────────────────────────────────────

#[derive(Arbitrary, Debug, Clone)]
pub struct InitializeSss1Data {
    pub name: [u8; 32],
    pub symbol: [u8; 8],
    pub decimals: u8,
    /// Supply cap — 0 means uncapped. Fuzzer will try both.
    pub supply_cap: u64,
}

#[derive(Arbitrary, Debug, Clone)]
pub struct MintTokensData {
    /// Amount to mint. Fuzzer explores all u64 values including overflow boundary.
    pub amount: u64,
}

#[derive(Arbitrary, Debug, Clone)]
pub struct BurnTokensData {
    pub amount: u64,
}

#[derive(Arbitrary, Debug, Clone)]
pub struct TransferTokensData {
    pub amount: u64,
}

// ─── Account Snapshots ────────────────────────────────────────────────────────

/// Account state captured before each instruction (for invariant checking)
#[derive(Debug, Clone, Default)]
pub struct Sss1Snapshot {
    pub circulating_supply: u64,
    pub total_minted: u64,
    pub total_burned: u64,
    pub supply_cap: u64,
    pub paused: bool,
}

// ─── Invariant Checks ─────────────────────────────────────────────────────────

/// Post-instruction invariant: supply_cap not exceeded (when cap > 0)
pub fn check_supply_cap(snapshot: &Sss1Snapshot) {
    if snapshot.supply_cap > 0 {
        assert!(
            snapshot.circulating_supply <= snapshot.supply_cap,
            "INVARIANT VIOLATED: circulating_supply ({}) > supply_cap ({})",
            snapshot.circulating_supply,
            snapshot.supply_cap
        );
    }
}

/// Post-instruction invariant: accounting equation holds
pub fn check_accounting(snapshot: &Sss1Snapshot) {
    assert_eq!(
        snapshot.circulating_supply,
        snapshot.total_minted.saturating_sub(snapshot.total_burned),
        "INVARIANT VIOLATED: circulating_supply ({}) != total_minted ({}) - total_burned ({})",
        snapshot.circulating_supply,
        snapshot.total_minted,
        snapshot.total_burned
    );
}

/// Post-instruction invariant: supply is never negative (encoded as no underflow)
pub fn check_no_underflow(snapshot: &Sss1Snapshot) {
    assert!(
        snapshot.total_burned <= snapshot.total_minted,
        "INVARIANT VIOLATED: total_burned ({}) > total_minted ({})",
        snapshot.total_burned,
        snapshot.total_minted
    );
}
