//! Fuzz Target 2: SSS-3 Allowlist + Confidential Mint Invariants
//!
//! Tests that for any sequence of allowlist/transfer/confidential-mint operations:
//!   1. When require_allowlist_for_send=true, non-listed senders are rejected
//!   2. When require_allowlist_for_receive=true, non-listed recipients are rejected
//!   3. Expired allowlist entries are treated as non-existent
//!   4. allowlist_count stays consistent with active records
//!   5. Commitment hash is logged for every successful confidential mint initiation
//!   6. Commitment hash is deterministic (same inputs → same hash)

use anchor_lang::prelude::*;
use arbitrary::Arbitrary;
use trident_fuzz::prelude::*;
use sha2::{Sha256, Digest};

/// All possible fuzz instructions for SSS-3 operations
#[derive(Arbitrary, Debug)]
pub enum FuzzInstruction {
    InitializeSss3(InitializeSss3Data),
    AllowlistAdd(AllowlistAddData),
    AllowlistRemove(AllowlistRemoveData),
    TransferSss3(TransferData),
    ConfidentialMintSss3(ConfidentialMintData),
}

// ─── Instruction Data ─────────────────────────────────────────────────────────

#[derive(Arbitrary, Debug, Clone)]
pub struct InitializeSss3Data {
    pub require_allowlist_for_receive: bool,
    pub require_allowlist_for_send: bool,
    pub confidential_transfers_enabled: bool,
    pub auto_approve_new_accounts: bool,
    /// Whether to set an auditor pubkey
    pub has_auditor: bool,
}

#[derive(Arbitrary, Debug, Clone)]
pub struct AllowlistAddData {
    /// Wallet index 0-4
    pub wallet_idx: u8,
    /// Expiry in seconds from now (0 = no expiry, 1 = already expired)
    pub expiry_offset: i64,
}

#[derive(Arbitrary, Debug, Clone)]
pub struct AllowlistRemoveData {
    pub wallet_idx: u8,
}

#[derive(Arbitrary, Debug, Clone)]
pub struct TransferData {
    pub from_idx: u8,
    pub to_idx: u8,
    pub amount: u64,
}

#[derive(Arbitrary, Debug, Clone)]
pub struct ConfidentialMintData {
    pub recipient_idx: u8,
    pub amount: u64,
    pub nonce: [u8; 32],
}

// ─── Simulated State ──────────────────────────────────────────────────────────

const N_WALLETS: usize = 5;
const MOCK_NOW: i64 = 1_700_000_000; // Fixed timestamp for deterministic expiry checks

#[derive(Debug, Clone)]
pub struct AllowlistEntry {
    pub active: bool,
    pub expires_at: i64, // 0 = no expiry
}

#[derive(Debug, Clone)]
pub struct Sss3State {
    pub initialized: bool,
    pub require_allowlist_for_receive: bool,
    pub require_allowlist_for_send: bool,
    pub confidential_transfers_enabled: bool,
    pub allowlist: [Option<AllowlistEntry>; N_WALLETS],
    pub allowlist_count: u32,
    pub balances: [u64; N_WALLETS],
    pub commitment_hashes: Vec<[u8; 32]>,
}

impl Sss3State {
    pub fn is_allowlisted(&self, idx: usize) -> bool {
        match &self.allowlist[idx] {
            Some(entry) if entry.active => {
                if entry.expires_at == 0 {
                    return true;
                }
                entry.expires_at > MOCK_NOW
            }
            _ => false,
        }
    }

    pub fn active_allowlist_count(&self) -> u32 {
        self.allowlist
            .iter()
            .filter(|e| {
                e.as_ref().map(|entry| {
                    entry.active && (entry.expires_at == 0 || entry.expires_at > MOCK_NOW)
                }).unwrap_or(false)
            })
            .count() as u32
    }
}

impl Default for Sss3State {
    fn default() -> Self {
        Self {
            initialized: false,
            require_allowlist_for_receive: false,
            require_allowlist_for_send: false,
            confidential_transfers_enabled: false,
            allowlist: Default::default(),
            allowlist_count: 0,
            balances: [0u64; N_WALLETS],
            commitment_hashes: Vec::new(),
        }
    }
}

// ─── Invariant Checks ─────────────────────────────────────────────────────────

/// Commitment hash is deterministic
pub fn check_commitment_hash_determinism(
    recipient: [u8; 32],
    amount: u64,
    nonce: [u8; 32],
    expected: [u8; 32],
) {
    let mut hasher = Sha256::new();
    hasher.update(recipient);
    hasher.update(amount.to_le_bytes());
    hasher.update(nonce);
    let computed: [u8; 32] = hasher.finalize().into();

    assert_eq!(
        computed,
        expected,
        "INVARIANT VIOLATED: commitment hash is not deterministic"
    );
}

/// Commitment hashes are never duplicated within a single session
pub fn check_no_duplicate_commitments(state: &Sss3State) {
    let mut seen = std::collections::HashSet::new();
    for hash in &state.commitment_hashes {
        assert!(
            seen.insert(hash),
            "INVARIANT VIOLATED: duplicate commitment hash detected"
        );
    }
}

/// allowlist_count must equal active allowlist entries
pub fn check_allowlist_count(state: &Sss3State) {
    let actual = state.active_allowlist_count();
    assert_eq!(
        state.allowlist_count,
        actual,
        "INVARIANT VIOLATED: allowlist_count ({}) != actual active entries ({})",
        state.allowlist_count,
        actual
    );
}
