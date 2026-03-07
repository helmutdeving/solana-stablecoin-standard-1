# SSS-1: Minimal Stablecoin Preset

| Field        | Value                                              |
|--------------|----------------------------------------------------|
| SSS Number   | 1                                                  |
| Title        | Minimal Stablecoin Preset                          |
| Author       | Solana Stablecoin Standard Working Group           |
| Status       | Draft                                              |
| Type         | Standard                                           |
| Category     | Token                                              |
| Created      | 2026-03-02                                         |
| Requires     | Token-2022, Anchor 0.30+                           |

---

## Abstract

SSS-1 defines the minimal viable preset for issuing a stablecoin on Solana using the Token-2022 program. It specifies a canonical on-chain configuration account (`StablecoinConfig`), a deterministic set of instructions, PDA derivation rules, and event schemas that together enable interoperability between issuers, wallets, DEX aggregators, and lending protocols without requiring protocol-specific integration work.

The preset is intentionally minimal: no compliance extensions, no freeze authority, no transfer hooks. An issuer who wants regulated functionality upgrades to SSS-2. SSS-1 covers the 80% case — a freely-transferable stablecoin with a configurable supply cap, a single admin, and standard Token-2022 mint semantics.

Any program that conforms to the SSS-1 interface can be treated as a standard stablecoin by aggregators and wallets that consume this standard. Discovery is on-chain: the presence of a valid `StablecoinConfig` PDA at the canonical seed path is the conformance signal.

---

## Motivation

Solana's DeFi ecosystem has accumulated dozens of stablecoin deployments, each with bespoke mint authority setups, varying ATA conventions, and undocumented upgrade paths. Integrators must write custom adapters per issuer. Wallet UIs cannot confidently label a token as a stablecoin or display supply-cap warnings without out-of-band knowledge. Lending protocols must manually whitelist tokens they trust.

The SSS standard series addresses this by publishing a small, versioned set of on-chain interfaces. Conforming programs expose a well-known PDA that aggregators can fetch to learn: which version of SSS this token implements, who the admin is, what the supply cap is, and what upgrade path is available. A Jupiter or Kamino integration that reads SSS-1 config needs zero issuer-specific code.

SSS-1 specifically is motivated by stablecoin projects that:

- Do not require KYC gating or blacklisting (non-regulated jurisdictions, algorithmic designs)
- Want battle-tested supply cap enforcement without writing custom mint logic
- Need a clear, public upgrade path to SSS-2 when regulatory requirements change
- Want their token recognized as standard by wallets and aggregators on day one

---

## Specification

### Terminology

- **MUST**: The requirement is mandatory for SSS-1 conformance.
- **SHOULD**: Recommended but not required for conformance.
- **MAY**: Optional.
- **Admin**: The keypair or program address that holds upgrade-level authority.
- **Mint Authority**: The on-chain Token-2022 mint authority. For SSS-1 this is always the `StablecoinConfig` PDA.

---

### Account Schemas

#### `StablecoinConfig`

The canonical configuration account for an SSS-1 stablecoin. There is exactly one `StablecoinConfig` per mint.

| Field              | Type        | Bytes | Offset | Description                                                   |
|--------------------|-------------|-------|--------|---------------------------------------------------------------|
| `discriminator`    | `[u8; 8]`   | 8     | 0      | Anchor account discriminator: `sha256("account:StablecoinConfig")[..8]` |
| `version`          | `u8`        | 1     | 8      | SSS version. MUST be `1` for SSS-1.                           |
| `bump`             | `u8`        | 1     | 9      | Canonical PDA bump stored for CPI re-derivation.              |
| `mint`             | `Pubkey`    | 32    | 10     | The Token-2022 mint this config governs.                      |
| `admin`            | `Pubkey`    | 32    | 42     | Authority for admin instructions.                             |
| `supply_cap`       | `u64`       | 8     | 74     | Maximum tokens that may exist. `0` = uncapped.                |
| `total_supply`     | `u64`       | 8     | 82     | Current circulating supply tracked on-chain.                  |
| `decimals`         | `u8`        | 1     | 90     | Must match the Token-2022 mint's `decimals` field.            |
| `is_paused`        | `bool`      | 1     | 91     | Reserved for future use. MUST be `false` in SSS-1.            |
| `upgraded_to`      | `Option<Pubkey>` | 33 | 92  | If set, this config has been migrated to SSS-2. The pubkey is the new `ComplianceConfig` PDA. |
| `created_at`       | `i64`       | 8     | 125    | Unix timestamp of `initialize_sss1`.                          |
| `_reserved`        | `[u8; 64]`  | 64    | 133    | Zero-padded. Reserved for future standard fields.             |

**Total size**: 197 bytes.

The Anchor account discriminator is computed as the first 8 bytes of `sha256("account:StablecoinConfig")`. Implementations MUST use the Anchor IDL discriminator mechanism so that downstream tooling can decode the account generically.

---

### PDA Derivation

The `StablecoinConfig` PDA MUST be derived as follows:

```
seeds = [b"sss1", mint.key().as_ref()]
program_id = <issuer's program ID>
```

The canonical bump is the value returned by `find_program_address` (the highest valid bump). This value MUST be stored in `StablecoinConfig.bump` at initialization time and used in all subsequent CPIs that sign with the PDA.

**Rationale**: Including `mint` in the seed (rather than a human-readable name) ensures there is at most one `StablecoinConfig` per mint per program. Including the literal `b"sss1"` as a namespace prefix avoids collisions with SSS-2 and any program-internal PDAs.

Aggregators that wish to discover whether a given mint conforms to SSS-1 MUST attempt to fetch the PDA at:

```
PDA = find_program_address(["sss1", mint], program_id)
```

If the account exists, has the correct discriminator, and has `version == 1`, the mint is an SSS-1 conformant stablecoin.

---

### Token-2022 Configuration

SSS-1 uses Token-2022 with the following constraints:

| Property              | Required Value                               |
|-----------------------|----------------------------------------------|
| Mint authority        | `StablecoinConfig` PDA                       |
| Freeze authority      | `None`                                       |
| Extensions            | None (no transfer fee, no interest-bearing, no permanent delegate) |
| Decimals              | Any value 0–9, fixed at initialization       |

The absence of a freeze authority is a deliberate SSS-1 constraint. An issuer who needs freeze capability MUST upgrade to SSS-2. Wallets and aggregators MAY use the `freeze_authority == None` invariant to display SSS-1 tokens as non-freezable.

---

### Instruction Set

All instructions are on the issuer's program. The SSS-1 standard defines the interface; reference implementations use Anchor's IDL to expose these.

---

#### `initialize_sss1`

Initializes the `StablecoinConfig` PDA and configures the Token-2022 mint.

**Accounts**:

| # | Name               | Writable | Signer | Description                                          |
|---|--------------------|----------|--------|------------------------------------------------------|
| 0 | `config`           | Yes      | No     | `StablecoinConfig` PDA (created here)                |
| 1 | `mint`             | Yes      | Yes    | New Token-2022 mint keypair                          |
| 2 | `admin`            | No       | Yes    | Admin authority                                      |
| 3 | `payer`            | Yes      | Yes    | Rent payer                                           |
| 4 | `token_program`    | No       | No     | Token-2022 program (`TokenzQdBNbLqP5VEhdkAS6EPZT59ttnzitmVqda1ub`) |
| 5 | `system_program`   | No       | No     | System program                                       |
| 6 | `rent`             | No       | No     | Rent sysvar                                          |

**Parameters**:

| Name          | Type  | Description                                              |
|---------------|-------|----------------------------------------------------------|
| `decimals`    | `u8`  | Token decimals. MUST be in range [0, 9].                 |
| `supply_cap`  | `u64` | Maximum supply. `0` = uncapped.                          |

**Validation Rules**:

1. `mint` MUST be a fresh keypair (zero lamports, not yet initialized).
2. `decimals` MUST be in [0, 9].
3. The derived PDA for `(b"sss1", mint.key())` MUST not already exist.
4. `admin` MUST be a signer.

**Effects**:

1. Creates the Token-2022 mint with `mint_authority = config_pda`, `freeze_authority = None`, `decimals = params.decimals`.
2. Initializes `StablecoinConfig` with all fields set per the schema.
3. Sets `total_supply = 0`, `is_paused = false`, `upgraded_to = None`.

**Emitted Event**: `Sss1Initialized { mint, admin, supply_cap, decimals, timestamp }`.

**Error Conditions**:

| Code  | Name                        | Condition                                  |
|-------|-----------------------------|--------------------------------------------|
| 6000  | `InvalidDecimals`           | `decimals > 9`                             |
| 6001  | `AlreadyInitialized`        | `StablecoinConfig` PDA already exists      |
| 6002  | `MintAlreadyInitialized`    | Mint account has non-zero lamports at init |

---

#### `mint_tokens`

Mints new tokens to a recipient's associated token account.

**Accounts**:

| # | Name               | Writable | Signer | Description                                          |
|---|--------------------|----------|--------|------------------------------------------------------|
| 0 | `config`           | Yes      | No     | `StablecoinConfig` PDA                               |
| 1 | `mint`             | Yes      | No     | Token-2022 mint                                      |
| 2 | `recipient_ata`    | Yes      | No     | Recipient's ATA (must exist prior or init in same tx)|
| 3 | `admin`            | No       | Yes    | Current admin                                        |
| 4 | `token_program`    | No       | No     | Token-2022 program                                   |

**Parameters**:

| Name     | Type  | Description              |
|----------|-------|--------------------------|
| `amount` | `u64` | Raw token units to mint. |

**Validation Rules**:

1. `admin` signer MUST match `config.admin`.
2. `mint` MUST match `config.mint`.
3. `config.upgraded_to` MUST be `None` (cannot mint on a migrated config).
4. If `config.supply_cap > 0`: `config.total_supply + amount <= config.supply_cap`.
5. `amount > 0`.

**Effects**:

1. CPIs to Token-2022 `mint_to` using the `StablecoinConfig` PDA as mint authority.
2. Increments `config.total_supply` by `amount`.

**Emitted Event**: `TokensMinted { mint, recipient, amount, new_total_supply }`.

**Error Conditions**:

| Code  | Name                   | Condition                                           |
|-------|------------------------|-----------------------------------------------------|
| 6003  | `Unauthorized`         | Signer does not match `config.admin`                |
| 6004  | `SupplyCapExceeded`    | Mint would exceed `supply_cap`                      |
| 6005  | `ZeroAmount`           | `amount == 0`                                       |
| 6006  | `ConfigMigrated`       | `config.upgraded_to` is `Some(_)`                   |
| 6007  | `MintMismatch`         | Provided mint does not match `config.mint`          |

---

#### `burn_tokens`

Burns tokens from a holder's token account. The holder MUST sign.

**Accounts**:

| # | Name            | Writable | Signer | Description                         |
|---|-----------------|----------|--------|-------------------------------------|
| 0 | `config`        | Yes      | No     | `StablecoinConfig` PDA              |
| 1 | `mint`          | Yes      | No     | Token-2022 mint                     |
| 2 | `source_ata`    | Yes      | No     | Holder's token account              |
| 3 | `holder`        | No       | Yes    | Token account owner                 |
| 4 | `token_program` | No       | No     | Token-2022 program                  |

**Parameters**:

| Name     | Type  | Description              |
|----------|-------|--------------------------|
| `amount` | `u64` | Raw token units to burn. |

**Validation Rules**:

1. `holder` MUST be the owner of `source_ata`.
2. `source_ata` balance MUST be >= `amount`.
3. `amount > 0`.
4. `config.upgraded_to` MUST be `None`.

**Effects**:

1. CPIs to Token-2022 `burn` using `holder` as authority.
2. Decrements `config.total_supply` by `amount`.

**Emitted Event**: `TokensBurned { mint, holder, amount, new_total_supply }`.

**Error Conditions**:

| Code  | Name                      | Condition                                      |
|-------|---------------------------|------------------------------------------------|
| 6005  | `ZeroAmount`              | `amount == 0`                                  |
| 6006  | `ConfigMigrated`          | Config has been upgraded                        |
| 6008  | `InsufficientBalance`     | Source ATA balance < `amount`                  |
| 6009  | `InvalidTokenAccountOwner`| `holder` does not own `source_ata`             |

---

#### `transfer_tokens`

Transfers tokens between two accounts. This is a pass-through to Token-2022's `transfer_checked` and exists primarily to allow event emission and future hook insertion points.

**Accounts**:

| # | Name            | Writable | Signer | Description                         |
|---|-----------------|----------|--------|-------------------------------------|
| 0 | `config`        | No       | No     | `StablecoinConfig` PDA (read-only)  |
| 1 | `mint`          | No       | No     | Token-2022 mint                     |
| 2 | `source_ata`    | Yes      | No     | Sender's token account              |
| 3 | `dest_ata`      | Yes      | No     | Recipient's token account           |
| 4 | `sender`        | No       | Yes    | Source account owner                |
| 5 | `token_program` | No       | No     | Token-2022 program                  |

**Parameters**:

| Name     | Type  | Description                  |
|----------|-------|------------------------------|
| `amount` | `u64` | Raw token units to transfer. |

**Validation Rules**:

1. `sender` MUST be the owner of `source_ata`.
2. `source_ata.mint` MUST equal `config.mint`.
3. `dest_ata.mint` MUST equal `config.mint`.
4. `amount > 0`.
5. `config.upgraded_to` MUST be `None`.

**Effects**:

1. CPIs to Token-2022 `transfer_checked`.

**Emitted Event**: `TokensTransferred { mint, sender, recipient, amount }`.

**Error Conditions**:

| Code  | Name                      | Condition                               |
|-------|---------------------------|-----------------------------------------|
| 6005  | `ZeroAmount`              | `amount == 0`                           |
| 6006  | `ConfigMigrated`          | Config has been upgraded                |
| 6007  | `MintMismatch`            | Source or dest ATA mint != config.mint  |
| 6009  | `InvalidTokenAccountOwner`| Sender does not own source ATA          |
| 6010  | `InvalidDestinationAccount`| Destination ATA does not exist         |

---

#### `update_supply_cap`

Updates the `supply_cap` field. The new cap MUST be either `0` (uncapped) or >= `current total_supply`.

**Accounts**:

| # | Name     | Writable | Signer | Description              |
|---|----------|----------|--------|--------------------------|
| 0 | `config` | Yes      | No     | `StablecoinConfig` PDA   |
| 1 | `admin`  | No       | Yes    | Current admin            |

**Parameters**:

| Name          | Type  | Description                          |
|---------------|-------|--------------------------------------|
| `new_cap`     | `u64` | New supply cap. `0` = uncapped.      |

**Validation Rules**:

1. `admin` signer MUST match `config.admin`.
2. `new_cap == 0 || new_cap >= config.total_supply`.
3. `config.upgraded_to` MUST be `None`.

**Effects**:

1. Sets `config.supply_cap = new_cap`.

**Emitted Event**: `SupplyCapUpdated { mint, old_cap, new_cap, admin }`.

**Error Conditions**:

| Code  | Name                   | Condition                                              |
|-------|------------------------|--------------------------------------------------------|
| 6003  | `Unauthorized`         | Signer does not match `config.admin`                   |
| 6006  | `ConfigMigrated`       | Config has been upgraded                               |
| 6011  | `CapBelowCurrentSupply`| `new_cap > 0 && new_cap < config.total_supply`         |

---

#### `transfer_admin`

Transfers admin authority to a new address. Two-step: the new admin does not need to sign this transaction, but the caller SHOULD implement a two-step acceptance pattern at the application layer.

**Accounts**:

| # | Name        | Writable | Signer | Description              |
|---|-------------|----------|--------|--------------------------|
| 0 | `config`    | Yes      | No     | `StablecoinConfig` PDA   |
| 1 | `admin`     | No       | Yes    | Current admin            |

**Parameters**:

| Name        | Type     | Description               |
|-------------|----------|---------------------------|
| `new_admin` | `Pubkey` | Incoming admin address.   |

**Validation Rules**:

1. `admin` signer MUST match `config.admin`.
2. `new_admin` MUST NOT equal `config.admin` (no-op protection).
3. `config.upgraded_to` MUST be `None`.

**Effects**:

1. Sets `config.admin = new_admin`.

**Emitted Event**: `AdminTransferred { mint, old_admin, new_admin }`.

**Error Conditions**:

| Code  | Name              | Condition                                 |
|-------|-------------------|-------------------------------------------|
| 6003  | `Unauthorized`    | Signer does not match `config.admin`      |
| 6006  | `ConfigMigrated`  | Config has been upgraded                  |
| 6012  | `SameAdmin`       | `new_admin == config.admin`               |

---

#### `upgrade_to_sss2`

Marks this SSS-1 config as migrated to SSS-2 and stores the address of the new `ComplianceConfig` PDA. After this instruction executes, all mint/burn/transfer/update instructions on the SSS-1 program MUST fail with `ConfigMigrated`.

**Accounts**:

| # | Name               | Writable | Signer | Description                                     |
|---|--------------------|----------|--------|-------------------------------------------------|
| 0 | `config`           | Yes      | No     | `StablecoinConfig` PDA                          |
| 1 | `compliance_config`| No       | No     | The new SSS-2 `ComplianceConfig` PDA (must exist)|
| 2 | `admin`            | No       | Yes    | Current admin                                   |

**Parameters**: None.

**Validation Rules**:

1. `admin` signer MUST match `config.admin`.
2. `config.upgraded_to` MUST be `None` (cannot upgrade twice).
3. `compliance_config` MUST be a valid SSS-2 `ComplianceConfig` PDA for the same mint (discriminator check).
4. `compliance_config.mint` MUST equal `config.mint`.

**Effects**:

1. Sets `config.upgraded_to = Some(compliance_config.key())`.
2. Does NOT close the `StablecoinConfig` account (historical reads must remain valid).

**Emitted Event**: `UpgradedToSss2 { mint, compliance_config, admin, timestamp }`.

**Error Conditions**:

| Code  | Name                      | Condition                                           |
|-------|---------------------------|-----------------------------------------------------|
| 6003  | `Unauthorized`            | Signer does not match `config.admin`                |
| 6006  | `ConfigMigrated`          | Already upgraded                                    |
| 6013  | `InvalidComplianceConfig` | Compliance config discriminator or mint mismatch    |

---

### Supply Cap Semantics

- `supply_cap == 0` means **uncapped**. No upper bound is enforced at mint time.
- `supply_cap > 0` means **hard cap**. The invariant `total_supply <= supply_cap` is enforced atomically within `mint_tokens`. The check MUST be `config.total_supply + amount > config.supply_cap` (with overflow check on the addition — use saturating or checked arithmetic).
- `total_supply` is tracked in `StablecoinConfig`, NOT derived from the Token-2022 mint supply. The two MUST be kept in sync. A conforming implementation ensures this by updating `total_supply` inside the same instruction that calls `mint_to` or `burn`.
- Lowering `supply_cap` below `total_supply` via `update_supply_cap` is forbidden. This prevents an admin from creating an impossible state where existing tokens exceed the cap.

---

### Events

SSS-1 programs MUST emit Anchor events (using the `emit!` macro) for all state changes. Downstream indexers and aggregators MUST be able to reconstruct supply history from the event log alone.

```rust
#[event]
pub struct Sss1Initialized {
    pub mint: Pubkey,
    pub admin: Pubkey,
    pub supply_cap: u64,
    pub decimals: u8,
    pub timestamp: i64,
}

#[event]
pub struct TokensMinted {
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub new_total_supply: u64,
}

#[event]
pub struct TokensBurned {
    pub mint: Pubkey,
    pub holder: Pubkey,
    pub amount: u64,
    pub new_total_supply: u64,
}

#[event]
pub struct TokensTransferred {
    pub mint: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SupplyCapUpdated {
    pub mint: Pubkey,
    pub old_cap: u64,
    pub new_cap: u64,
    pub admin: Pubkey,
}

#[event]
pub struct AdminTransferred {
    pub mint: Pubkey,
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct UpgradedToSss2 {
    pub mint: Pubkey,
    pub compliance_config: Pubkey,
    pub admin: Pubkey,
    pub timestamp: i64,
}
```

---

### Error Code Registry

| Code  | Name                        | Description                                              |
|-------|-----------------------------|----------------------------------------------------------|
| 6000  | `InvalidDecimals`           | Decimals out of range [0, 9]                             |
| 6001  | `AlreadyInitialized`        | Config PDA already exists                                |
| 6002  | `MintAlreadyInitialized`    | Mint account already initialized                         |
| 6003  | `Unauthorized`              | Signer is not the admin                                  |
| 6004  | `SupplyCapExceeded`         | Mint would exceed supply cap                             |
| 6005  | `ZeroAmount`                | Amount parameter is zero                                 |
| 6006  | `ConfigMigrated`            | Config has been upgraded to SSS-2                        |
| 6007  | `MintMismatch`              | Provided mint does not match config                      |
| 6008  | `InsufficientBalance`       | Token account balance insufficient                       |
| 6009  | `InvalidTokenAccountOwner`  | Signer does not own the token account                    |
| 6010  | `InvalidDestinationAccount` | Destination token account does not exist                 |
| 6011  | `CapBelowCurrentSupply`     | New cap is below current supply                          |
| 6012  | `SameAdmin`                 | New admin equals current admin                           |
| 6013  | `InvalidComplianceConfig`   | Compliance config fails validation checks                |

---

## Security Considerations

### Admin Key Management

The `admin` keypair has full control over minting, supply cap, and admin transfer. A compromised admin key allows unlimited token minting (subject only to `supply_cap`) and transfer of admin to an attacker. Issuers MUST:

- Use a hardware wallet or multi-sig (e.g., Squads Protocol) as the admin for any production deployment.
- Never store the admin private key on an internet-connected machine.
- Consider setting a supply cap to limit blast radius of a key compromise.

### Supply Cap as a Safety Bound

Even with an uncapped (`supply_cap == 0`) configuration, issuers SHOULD set a supply cap equal to their planned maximum issuance plus a safety buffer. A supply cap of `0` is a footgun: a compromised admin can mint arbitrary amounts.

### PDA Bump Canonicality

The stored bump in `config.bump` MUST be the canonical bump (result of `find_program_address`). Implementations that use non-canonical bumps create accounts that are difficult to re-derive and may allow duplicate initialization under certain conditions. The reference implementation validates this in `initialize_sss1`.

### `total_supply` Invariant

The `total_supply` field in `StablecoinConfig` is the authoritative supply counter for cap enforcement. It MUST be updated in the same transaction as the Token-2022 `mint_to` or `burn` CPI. Any implementation that updates them in separate transactions introduces a TOCTOU vulnerability where a concurrent mint could bypass the cap.

### Re-Entrancy

Solana's single-threaded execution model prevents traditional re-entrancy. However, programs that use CPIs to untrusted programs (e.g., custom transfer hooks) MUST be careful about state consistency. SSS-1 does not use transfer hooks, so this risk is minimal in conforming implementations.

### Upgrade Irrevocability

`upgrade_to_sss2` is a one-way operation. Once a config is marked as migrated, all SSS-1 mutations are disabled. Issuers MUST ensure the SSS-2 `ComplianceConfig` is fully initialized and correct before calling this instruction, as there is no rollback mechanism.

---

## Compatibility

### Jupiter Aggregator

Jupiter reads token metadata and on-chain accounts to route swaps. An SSS-1 token with a valid `StablecoinConfig` PDA will be discoverable by Jupiter-compatible indexers that implement the SSS discovery protocol. No special Jupiter-side integration is required beyond standard Token-2022 support.

### Kamino Finance

Kamino uses on-chain price feeds and token metadata for lending markets. SSS-1 stablecoins MAY be listed on Kamino lending markets. The `StablecoinConfig` PDA provides Kamino risk modules with supply cap and upgrade status without requiring off-chain data.

### Marinade Finance

Marinade's liquid staking pools interact with tokens via standard Token-2022 interfaces. SSS-1 tokens are compatible with Marinade's token handling since SSS-1 uses no non-standard Token-2022 extensions.

### Orca / Whirlpools

Orca's concentrated liquidity pools use Token-2022 with the `transfer_checked` instruction. SSS-1's `transfer_tokens` instruction wraps `transfer_checked` and is compatible with Orca pool interactions.

### Phantom / Backpack / Solflare Wallets

Wallets that implement SSS discovery can display the `StablecoinConfig` fields inline: supply cap, current supply, admin, and migration status. The wallet MAY display an "SSS-1 Stablecoin" badge and warn users if `upgraded_to` is set (indicating the SSS-1 program is frozen and the user should interact with the SSS-2 program).

---

## Reference Implementation

The reference implementation is an Anchor 0.30+ program located at:

```
programs/sss1/
├── src/
│   ├── lib.rs              # Program entrypoint, instruction dispatch
│   ├── instructions/
│   │   ├── initialize.rs
│   │   ├── mint_tokens.rs
│   │   ├── burn_tokens.rs
│   │   ├── transfer_tokens.rs
│   │   ├── update_supply_cap.rs
│   │   ├── transfer_admin.rs
│   │   └── upgrade_to_sss2.rs
│   ├── state/
│   │   └── stablecoin_config.rs
│   ├── events.rs
│   └── errors.rs
└── Cargo.toml
```

The program ID for the devnet reference deployment is published in `Anchor.toml` at the repository root.

---

## Changelog

| Version | Date       | Description                                     |
|---------|------------|-------------------------------------------------|
| 0.1.0   | 2026-03-02 | Initial draft                                   |
