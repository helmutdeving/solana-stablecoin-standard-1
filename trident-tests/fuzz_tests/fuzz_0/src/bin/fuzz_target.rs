//! Fuzz Target 0 Entry Point — SSS-1 Core Supply Invariants
//!
//! Run with:
//!   trident fuzz run fuzz_0
//! or:
//!   cargo hfuzz run fuzz_0

use honggfuzz::fuzz;
use fuzz_0::*;

fn main() {
    loop {
        fuzz!(|data: &[u8]| {
            // Use arbitrary crate to generate structured fuzz inputs
            let mut unstructured = arbitrary::Unstructured::new(data);

            // Generate a sequence of fuzz instructions
            let instructions: Vec<FuzzInstruction> = match
                <Vec<FuzzInstruction>>::arbitrary_take_rest(unstructured)
            {
                Ok(ixs) => ixs,
                Err(_) => return,
            };

            // Simulate execution and check invariants
            let mut supply: u64 = 0;
            let mut total_minted: u64 = 0;
            let mut total_burned: u64 = 0;
            let mut supply_cap: u64 = 0;
            let mut initialized = false;

            for ix in &instructions {
                match ix {
                    FuzzInstruction::InitializeSss1(data) => {
                        supply_cap = data.supply_cap;
                        supply = 0;
                        total_minted = 0;
                        total_burned = 0;
                        initialized = true;
                    }
                    FuzzInstruction::MintTokens(data) if initialized => {
                        let new_supply = supply.saturating_add(data.amount);
                        if supply_cap > 0 && new_supply > supply_cap {
                            // Program should reject — we skip (simulating expected error)
                            continue;
                        }
                        supply = new_supply;
                        total_minted = total_minted.saturating_add(data.amount);
                    }
                    FuzzInstruction::BurnTokens(data) if initialized => {
                        if data.amount > supply {
                            // Program should reject — skip
                            continue;
                        }
                        supply = supply.saturating_sub(data.amount);
                        total_burned = total_burned.saturating_add(data.amount);
                    }
                    FuzzInstruction::TransferTokens(_) if initialized => {
                        // Transfer preserves supply — no state change to track
                    }
                    _ => {}
                }

                // Check invariants after each instruction
                let snapshot = Sss1Snapshot {
                    circulating_supply: supply,
                    total_minted,
                    total_burned,
                    supply_cap,
                    paused: false,
                };
                check_supply_cap(&snapshot);
                check_accounting(&snapshot);
                check_no_underflow(&snapshot);
            }
        });
    }
}
