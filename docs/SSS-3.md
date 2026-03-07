# SSS-3: Private Stablecoin Standard

**Status**: Experimental (Proof of Concept)
**Authors**: Helmut (helmutdeving)
**Created**: 2026-03-02
**Depends on**: SSS-1 (base ledger)

---

## Abstract

SSS-3 defines a **private stablecoin preset** that combines two privacy mechanisms:

1. **Scoped Allowlists** — Only allowlisted addresses may send and/or receive tokens, enforced by on-chain PDAs.
2. **Confidential Transfers** — Token-2022's `ConfidentialTransfer` extension hides transfer amounts on-chain using ElGamal encryption, while preserving compliance via an optional auditor key.

SSS-3 is explicitly experimental. The allowlist mechanism is fully production-ready. Confidential transfer tooling (ZK proof generation) is still maturing in the Solana ecosystem as of early 2026; the on-chain scaffolding is complete.

---

## Motivation

Financial privacy on public blockchains is a first-class concern for institutional stablecoin issuers. Regulated entities operating settlement networks, dark pools, or interbank clearing may require:

- Transfer amounts invisible to the public
- Strict access control gating who may receive funds
- Auditability only with explicit key disclosure (e.g. for regulatory requests)

SSS-1 and SSS-2 are transparent. SSS-3 addresses these requirements while preserving the administrative compliance infrastructure (freeze, seize, pause) from SSS-2 via the shared `StablecoinConfig`.

---

## Specification

### 3.1 Account Layouts

#### `Sss3Config` PDA: `["sss3-config", mint]`

```
Field                         Type        Bytes   Description
─────────────────────────────────────────────────────────────
discriminator                 [u8; 8]     8       Anchor discriminator
mint                          Pubkey      32      Associated mint
allowlist_authority           Pubkey      32      Who can manage allowlist
require_allowlist_for_receive bool        1       Gate receive on allowlist
require_allowlist_for_send    bool        1       Gate send on allowlist
confidential_transfers_enabled bool       1       Whether CT extension active
auto_approve_new_accounts     bool        1       Auto-approve ATA CT config
auditor_pubkey                Option<[u8;32]> 33  Auditor ElGamal pubkey
allowlist_count               u32         4       Total allowlist entries
bump                          u8          1       PDA bump
─────────────────────────────────────────────────────────────
TOTAL                                     114
```

#### `AllowlistRecord` PDA: `["sss3-allowlist", mint, wallet]`

```
Field       Type        Bytes   Description
────────────────────────────────────────────
discriminator [u8; 8]   8       Anchor discriminator
mint          Pubkey    32      Associated mint
wallet        Pubkey    32      Allowlisted address
added_at      i64       8       Unix timestamp of addition
expires_at    i64       8       Expiry (0 = no expiry)
added_by      Pubkey    32      Who added this entry
active        bool      1       Is active flag
note          [u8; 64]  64      Operator note (UTF-8)
bump          u8        1       PDA bump
────────────────────────────────────────────
TOTAL                   186
```

**Distinguishing feature**: SSS-3 allowlist uses seed `"sss3-allowlist"` — separate from the SSS-2 KYC whitelist (`"sss-whitelist"`). They model different concerns:
- SSS-2 whitelist: KYC identity compliance (regulatory)
- SSS-3 allowlist: access control for privacy-preserving networks (operational)

---

### 3.2 Instructions

#### `initialize_sss3(params: Sss3Params) → Result<()>`

Initializes an SSS-3 stablecoin. Creates:
- `StablecoinConfig` (shared base, preset = `Sss3`)
- `Sss3Config` (privacy-specific configuration)

The Token-2022 mint is initialized with a **freeze authority** (retained by admin for emergency compliance).

**Confidential Transfer Extension**: If `confidential_transfers_enabled = true`, the client MUST call `initializeConfidentialMint()` from the SDK before this instruction. This two-step process is required because Anchor cannot pre-initialize Token-2022 extensions; the client uses `@solana/spl-token`'s `createInitializeConfidentialTransferMintInstruction` in the same transaction.

```typescript
// SDK helper: packages/sdk/src/sss3.ts
async function initializeSss3Mint(
  connection: Connection,
  payer: Keypair,
  auditorElgamalPubkey?: ElGamalPubkey,
): Promise<{ mint: Keypair; txSig: string }> {
  const mint = Keypair.generate();
  const extensions = [ExtensionType.ConfidentialTransferMint];
  const mintLen = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const tx = new Transaction().add(
    SystemProgram.createAccount({ ... lamports, space: mintLen ... }),
    createInitializeConfidentialTransferMintInstruction(
      mint.publicKey,
      null,               // authority (null = immutable after init)
      true,               // auto_approve_new_accounts
      auditorElgamalPubkey ?? null,
      TOKEN_2022_PROGRAM_ID,
    ),
    // initializeSss3 instruction follows
  );
  // ...
}
```

#### `allowlist_add(expiry: i64, note: [u8; 64]) → Result<()>`

Adds a wallet to the SSS-3 allowlist. Only callable by `allowlist_authority`.

Emits `AllowlistUpdated { action: 1 }`.

#### `allowlist_remove() → Result<()>`

Deactivates an allowlist record (`active = false`). Does not close the account to preserve audit trail.

Emits `AllowlistUpdated { action: 0 }`.

#### `transfer_sss3(amount: u64) → Result<()>`

Standard (non-confidential) transfer with allowlist enforcement.

Enforcement matrix:
```
require_allowlist_for_send=false  → sender not checked
require_allowlist_for_send=true   → sender must have active, non-expired AllowlistRecord
require_allowlist_for_receive=false → recipient not checked
require_allowlist_for_receive=true  → recipient must have active, non-expired AllowlistRecord
```

#### `confidential_mint_sss3(commitment_hash: [u8; 32]) → Result<()>`

Records a confidential mint initiation on-chain:
1. Validates `mint_authority` signature
2. Validates `recipient_allowlist` record is active and non-expired
3. Emits `ConfidentialMintInitiated { commitment_hash }` for auditor indexing

The actual token minting (with ElGamal ciphertext) occurs via the Token-2022 `confidentialTransferMint` instruction, called separately by the client after this validation step.

```
commitment_hash: SHA-256(recipient_pubkey || amount_plaintext || nonce)
```

The auditor can decrypt the actual amount using their ElGamal private key from the on-chain ciphertext.

---

### 3.3 Errors

| Code | Name | Description |
|------|------|-------------|
| 6014 | `NotSss3` | SSS-3 instruction called on non-SSS-3 config |
| 6015 | `RecipientNotAllowlisted` | Recipient not on SSS-3 allowlist |
| 6016 | `SenderNotAllowlisted` | Sender not on SSS-3 allowlist |
| 6017 | `AllowlistExpired` | Allowlist entry has past its expiry |
| 6018 | `NotAllowlisted` | Address is not on the allowlist |
| 6019 | `ConfidentialTransfersDisabled` | CT not enabled for this mint |

---

### 3.4 Events

```rust
// Emitted on allowlist_add / allowlist_remove
AllowlistUpdated {
  mint: Pubkey,
  wallet: Pubkey,
  action: u8,      // 0=removed, 1=added
  actor: Pubkey,
  timestamp: i64,
}

// Emitted on confidential_mint_sss3
ConfidentialMintInitiated {
  mint: Pubkey,
  recipient_allowlist_record: Pubkey,
  commitment_hash: [u8; 32],  // for auditor decryption
  initiator: Pubkey,
  timestamp: i64,
}
```

---

## 4. Confidential Transfer Architecture

### 4.1 ElGamal Encryption

Solana's Token-2022 `ConfidentialTransfer` extension uses **twisted ElGamal** encryption:

```
ciphertext = (r·G, amount·G + r·pubkey)

Where:
  G       = curve25519 generator
  r       = random nonce (per-transfer)
  pubkey  = recipient's ElGamal public key
  amount  = plaintext token amount
```

Decryption requires the recipient's ElGamal private key (derived from their Solana keypair via BIP-32 or a domain-separated hash).

### 4.2 Audit Flow

When an `auditor_pubkey` is set in `Sss3Config`:
- Every confidential transfer includes an **auditor ciphertext** (amount encrypted to auditor's pubkey)
- The auditor can decrypt **any transfer** without holding recipient keys
- This satisfies regulatory requirements (FATF, FinCEN) for issuer-level visibility

```
Transfer ciphertext bundle:
  - recipient_ciphertext: (r₁·G, amount·G + r₁·recipient_pk)
  - auditor_ciphertext:   (r₂·G, amount·G + r₂·auditor_pk)
  - ZK range proof:       amount ∈ [0, 2^64)
```

### 4.3 Client-side ZK Proof Generation

```typescript
import { generateConfidentialTransferProof } from '@sss/sdk/sss3';

const { ciphertext, proof } = await generateConfidentialTransferProof({
  amount: BigInt(1_000_000),    // 1 USDC
  recipientElgamalPubkey,
  auditorElgamalPubkey,         // optional
  sourceAvailableBalance,       // current encrypted balance
  sourceDecryptionKey,          // sender's ElGamal private key
});

// Submit transaction with proof
await program.methods
  .confidentialTransfer(ciphertext, proof)
  .accounts({ ... })
  .rpc();
```

---

## 5. Security Considerations

### 5.1 Allowlist Authority Compromise
If `allowlist_authority` is compromised, an attacker can add arbitrary addresses. Mitigation: use a multisig (e.g. Squads Protocol) as the allowlist authority for high-value deployments.

### 5.2 Freeze Authority Preserved
Unlike pure privacy coins, SSS-3 retains freeze authority (via the base `StablecoinConfig`). This allows the admin to freeze and seize tokens in regulatory enforcement scenarios, even when amounts are confidential. The auditor key enables amount discovery for compliance.

### 5.3 Allowlist Expiry
Entries with `expires_at = 0` never expire. For KYC-adjacent use cases, set explicit expiry dates matching your compliance program's re-verification period.

### 5.4 Replay Protection
The `commitment_hash` in `confidential_mint_sss3` is validated off-chain but logged on-chain. Integrators SHOULD use a nonce to prevent commitment hash reuse across instructions.

---

## 6. Oracle Integration

SSS-3 stablecoins backed by non-USD collateral (e.g. EUR, GBP, XAU) integrate with the SSS Oracle service (`services/oracle/`) for:

- **computeMintAmount**: Calculate tokens to mint given fiat collateral deposit
- **computeRedeemAmount**: Calculate fiat return for a token redemption
- Price sources: Pyth (primary) → Switchboard → CoinGecko (fallback)

See `services/oracle/index.ts` for implementation.

---

## 7. Comparison with SSS-1 and SSS-2

| Feature | SSS-1 | SSS-2 | SSS-3 |
|---------|-------|-------|-------|
| Transparent amounts | ✅ | ✅ | Optional (CT extension) |
| KYC whitelist | ❌ | ✅ | ❌ |
| Access allowlist | ❌ | ❌ | ✅ |
| Freeze / seize | ❌ | ✅ | Via admin (freeze authority) |
| Audit trail | ❌ | ✅ (on-chain events) | ✅ (commitment + auditor key) |
| Compliance events | ❌ | ✅ | ❌ |
| Oracle integration | Optional | Optional | ✅ |
| Confidential transfers | ❌ | ❌ | ✅ (experimental) |
| Status | Production | Production | Experimental / PoC |

---

## 8. Future Work

- **SSS-3.1**: Transfer hook enforcement for allowlist (eliminates soft-gate, makes it cryptographically enforced at the token level)
- **SSS-3.2**: Multisig allowlist authority integration (Squads)
- **SSS-3.3**: Private minting via ZK-SNARK (hide both amount and recipient from auditor-free deployments)
- **Devnet program**: Deploy once Anchor + Token-2022 CT tooling matures (target: Q2 2026)

---

*This document follows the SIMD (Solana Improvement and Modification Document) specification format. See [SSS-1.md](SSS-1.md) and [SSS-2.md](SSS-2.md) for base and compliant preset specifications.*
