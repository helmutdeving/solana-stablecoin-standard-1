# Devnet Deployment Proof

## Network: Solana Devnet

### Deployed Programs

| Program | Address | Tx Signature | Slot | Status |
|---------|---------|--------------|------|--------|
| SSS Transfer Hook | `DbEuNBSDNQp1ijdX7qhnLX7qVfqVMDcjBWiGeUqhaY5w` | `42qdUzVCujTwL2so2ddDeS2egHVJWEsP9RBiNYMM6S5JDwE4tws5Tg53jfQxGrH59GAMyJHL2KauevyaXyfBXhQU` | 446587054 | LIVE |
| SSS Core (SSS-1/SSS-2) | `8kY3yQGTdrvPRG3SQfjwyf3SuuUW9Wt1W8zFwURTpa59` | pending (needs SOL top-up) | — | Pending |

### Verify On-Chain

```bash
# Verify Transfer Hook program
solana program show DbEuNBSDNQp1ijdX7qhnLX7qVfqVMDcjBWiGeUqhaY5w --url devnet

# View deployment transaction
# https://explorer.solana.com/tx/42qdUzVCujTwL2so2ddDeS2egHVJWEsP9RBiNYMM6S5JDwE4tws5Tg53jfQxGrH59GAMyJHL2KauevyaXyfBXhQU?cluster=devnet

# View program on Solana Explorer
# https://explorer.solana.com/address/DbEuNBSDNQp1ijdX7qhnLX7qVfqVMDcjBWiGeUqhaY5w?cluster=devnet
```

### Program Details

**SSS Transfer Hook** (`DbEuNBSDNQp1ijdX7qhnLX7qVfqVMDcjBWiGeUqhaY5w`)
- Owner: `BPFLoaderUpgradeab1e11111111111111111111111` (BPF Upgradeable Loader)
- Authority: `Hg6b9gaZ9eTQPQpFuHrXmka1zUfvLb6z9QQ2fMEkcpjx`
- Deployed at slot: 446587054
- Size: 242,240 bytes
- Implements: Token-2022 Transfer Hook interface for SSS-2 compliance enforcement

### Deployment Date

2026-03-06
