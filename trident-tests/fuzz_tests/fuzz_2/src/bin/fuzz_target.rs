//! Fuzz Target 2 Entry Point — SSS-3 Allowlist + Confidential Mint Invariants
//!
//! Run with: trident fuzz run fuzz_2

use honggfuzz::fuzz;
use fuzz_2::*;
use sha2::{Sha256, Digest};

fn main() {
    loop {
        fuzz!(|data: &[u8]| {
            let mut unstructured = arbitrary::Unstructured::new(data);
            let instructions: Vec<FuzzInstruction> = match
                <Vec<FuzzInstruction>>::arbitrary_take_rest(unstructured)
            {
                Ok(ixs) => ixs,
                Err(_) => return,
            };

            let mut state = Sss3State::default();
            let mut used_nonces: std::collections::HashSet<[u8; 32]> = std::collections::HashSet::new();

            for ix in &instructions {
                let w = |idx: u8| (idx as usize) % N_WALLETS;

                match ix {
                    FuzzInstruction::InitializeSss3(data) => {
                        state.require_allowlist_for_receive = data.require_allowlist_for_receive;
                        state.require_allowlist_for_send = data.require_allowlist_for_send;
                        state.confidential_transfers_enabled = data.confidential_transfers_enabled;
                        state.initialized = true;
                    }
                    FuzzInstruction::AllowlistAdd(data) if state.initialized => {
                        let idx = w(data.wallet_idx);
                        // Compute expiry: positive offset = future, negative = past
                        let expires_at = if data.expiry_offset == 0 {
                            0 // no expiry
                        } else {
                            MOCK_NOW + data.expiry_offset
                        };
                        let was_active = state.allowlist[idx]
                            .as_ref()
                            .map(|e| e.active)
                            .unwrap_or(false);
                        state.allowlist[idx] = Some(AllowlistEntry {
                            active: true,
                            expires_at,
                        });
                        if !was_active {
                            state.allowlist_count += 1;
                        }
                    }
                    FuzzInstruction::AllowlistRemove(data) if state.initialized => {
                        let idx = w(data.wallet_idx);
                        if let Some(entry) = &mut state.allowlist[idx] {
                            if entry.active {
                                entry.active = false;
                                state.allowlist_count = state.allowlist_count.saturating_sub(1);
                            }
                        }
                    }
                    FuzzInstruction::TransferSss3(data) if state.initialized => {
                        let from = w(data.from_idx);
                        let to = w(data.to_idx);

                        // Allowlist enforcement
                        if state.require_allowlist_for_send && !state.is_allowlisted(from) {
                            continue; // Program rejects
                        }
                        if state.require_allowlist_for_receive && !state.is_allowlisted(to) {
                            continue; // Program rejects
                        }
                        if data.amount > state.balances[from] {
                            continue;
                        }
                        state.balances[from] -= data.amount;
                        state.balances[to] = state.balances[to].saturating_add(data.amount);
                    }
                    FuzzInstruction::ConfidentialMintSss3(data) if state.initialized => {
                        let recipient = w(data.recipient_idx);

                        // Recipient must be allowlisted
                        if !state.is_allowlisted(recipient) {
                            continue; // Program rejects
                        }

                        // Confidential transfers must be enabled
                        if !state.confidential_transfers_enabled {
                            continue;
                        }

                        // Compute commitment hash — must be deterministic
                        let recipient_bytes = [recipient as u8; 32]; // mock pubkey
                        let mut hasher = Sha256::new();
                        hasher.update(recipient_bytes);
                        hasher.update(data.amount.to_le_bytes());
                        hasher.update(data.nonce);
                        let hash: [u8; 32] = hasher.finalize().into();

                        // Verify determinism
                        check_commitment_hash_determinism(
                            recipient_bytes,
                            data.amount,
                            data.nonce,
                            hash,
                        );

                        // Track commitment
                        state.commitment_hashes.push(hash);

                        // Mint tokens to recipient (simplification — real CT mint is via Token-2022)
                        state.balances[recipient] = state.balances[recipient].saturating_add(data.amount);
                    }
                    _ => {}
                }

                // Check invariants after each instruction
                check_allowlist_count(&state);
                check_no_duplicate_commitments(&state);
            }
        });
    }
}
