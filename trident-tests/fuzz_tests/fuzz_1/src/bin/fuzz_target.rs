//! Fuzz Target 1 Entry Point — SSS-2 Compliance Invariants
//!
//! Run with: trident fuzz run fuzz_1

use honggfuzz::fuzz;
use fuzz_1::*;

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

            let mut state = Sss2State::default();

            for ix in &instructions {
                let w = |idx: u8| (idx as usize) % N_WALLETS;

                match ix {
                    FuzzInstruction::InitializeSss2(data) => {
                        state.whitelist_transfers = data.whitelist_transfers;
                        state.whitelist_mints = data.whitelist_mints;
                        state.whitelist_burns = data.whitelist_burns;
                        state.initialized = true;
                    }
                    FuzzInstruction::WhitelistAdd(data) if state.initialized => {
                        let idx = w(data.wallet_idx);
                        if !state.whitelist[idx] {
                            state.whitelist[idx] = true;
                            state.whitelist_count += 1;
                        }
                    }
                    FuzzInstruction::WhitelistRemove(data) if state.initialized => {
                        let idx = w(data.wallet_idx);
                        if state.whitelist[idx] {
                            state.whitelist[idx] = false;
                            state.whitelist_count -= 1;
                        }
                    }
                    FuzzInstruction::FreezeAccount(data) if state.initialized => {
                        let idx = w(data.wallet_idx);
                        if !state.frozen[idx] {
                            state.frozen[idx] = true;
                            state.freeze_count += 1;
                        }
                    }
                    FuzzInstruction::UnfreezeAccount(data) if state.initialized => {
                        let idx = w(data.wallet_idx);
                        if state.frozen[idx] {
                            state.frozen[idx] = false;
                            state.freeze_count -= 1;
                        }
                    }
                    FuzzInstruction::SeizeFunds(data) if state.initialized => {
                        let idx = w(data.wallet_idx);
                        // Seize only works on frozen accounts
                        if state.frozen[idx] {
                            let seize_amt = data.amount.min(state.balances[idx]);
                            state.balances[idx] -= seize_amt;
                            // Vault balance (not tracked separately here)
                        }
                    }
                    FuzzInstruction::MintTokens(data) if state.initialized => {
                        let idx = w(data.wallet_idx);
                        // When whitelist_mints=true, only whitelisted can receive
                        if state.whitelist_mints && !state.whitelist[idx] {
                            continue; // Program would reject
                        }
                        state.balances[idx] = state.balances[idx].saturating_add(data.amount);
                    }
                    FuzzInstruction::TransferTokens(data) if state.initialized => {
                        let from = w(data.from_idx);
                        let to = w(data.to_idx);
                        // Frozen accounts cannot transfer
                        if state.frozen[from] || state.frozen[to] {
                            continue; // Program would reject
                        }
                        // Whitelist enforcement
                        if state.whitelist_transfers {
                            if !state.whitelist[from] || !state.whitelist[to] {
                                continue;
                            }
                        }
                        if data.amount > state.balances[from] {
                            continue;
                        }
                        state.balances[from] -= data.amount;
                        state.balances[to] = state.balances[to].saturating_add(data.amount);
                    }
                    _ => {}
                }

                // Check invariants after each instruction
                check_freeze_count(&state);
                check_whitelist_count(&state);
                check_balances_non_negative(&state);
            }
        });
    }
}
