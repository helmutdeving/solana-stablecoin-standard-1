# SSS-2: Compliant Stablecoin Preset

| Field        | Value                                              |
|--------------|----------------------------------------------------|
| SSS Number   | 2                                                  |
| Title        | Compliant Stablecoin Preset                        |
| Author       | Solana Stablecoin Standard Working Group           |
| Status       | Draft                                              |
| Type         | Standard                                           |
| Category     | Token / Compliance                                 |
| Created      | 2026-03-02                                         |
| Requires     | SSS-1, Token-2022 (freeze extension), Anchor 0.30+ |

---

## Abstract

SSS-2 extends SSS-1 with a canonical on-chain compliance layer designed for regulated stablecoin issuers — the USDC/USDT analogs that operate under AML/CFT obligations, OFAC screening requirements, and emerging frameworks like MiCA. It introduces a `ComplianceConfig` account, per-address `WhitelistRecord` and `FreezeRecord` PDAs, an append-only `ComplianceEventRecord` log, and a second authority role (compliance officer) separate from the admin.

The standard is designed to be an open, vendor-agnostic alternative to proprietary compliance stacks. Any issuer deploying an SSS-2 program can be integrated by wallets, DEX aggregators, and lending protocols using the same discovery and decoding path as SSS-1 — no off-chain integration agreements required. Compliance data lives on-chain, is auditable by regulators and counterparties, and follows a defined schema that third-party risk engines can consume.

SSS-2 is always reached via the upgrade path from SSS-1. A stablecoin MUST first be initialized as SSS-1 and then upgraded via `upgrade_to_sss2`. This preserves the minimal path for non-regulated issuers and ensures the compliance layer is an explicit opt-in.

---

## Motivation

The global regulatory environment for stablecoins is converging around a common set of requirements: KYC gating for address whitelisting, the ability to freeze addresses suspected of sanctions violations, the ability to seize funds from frozen addresses to a compliance-controlled vault, and an auditable on-chain event log for regulatory reporting.

Today, each regulated Solana stablecoin issuer implements these capabilities differently:

- Some use off-chain blacklists enforced only at the application layer, providing no on-chain guarantees.
- Some use Token-2022's freeze authority but with no standard for how freeze decisions are recorded or contested.
- None publish a machine-readable whitelist that counterparty protocols can verify before accepting a token deposit.

This fragmentation imposes costs on the entire ecosystem. A lending protocol that wants to safely accept a regulated stablecoin must either trust the issuer's API (centralizing risk) or build custom per-issuer integrations. Wallets cannot display compliance status without out-of-band issuer documentation. Regulators cannot audit compliance actions without issuer cooperation.

SSS-2 solves this by publishing a complete, standard on-chain compliance interface. It is inspired by existing industry practice (USDC's blacklist architecture, USDT's freeze mechanism) but makes the schema explicit and open. The standard is designed to be compatible with MiCA's traceability requirements (effective 2024–2026) and FATF Travel Rule implementations.

---

## Specification

### Terminology

All SSS-1 terminology applies. Additional terms:

- **Compliance Officer**: A keypair or program address authorized to execute whitelist and freeze operations. May differ from the admin.
- **Whitelist**: The set of addresses authorized to hold or receive tokens on a whitelisted mint.
- **Freeze**: A per-address flag that halts all token operations for that address.
- **Seize**: The forcible transfer of a frozen address's token balance to the compliance vault.
- **Compliance Vault**: A token account controlled by the admin that receives seized funds.
- **KYC Reference**: An opaque, provider-agnostic string identifying the KYC record for an address.

---

### Account Schemas

#### `ComplianceConfig`

The top-level compliance configuration for an SSS-2 stablecoin. One per mint.

| Field                   | Type           | Bytes | Offset | Description                                                             |
|-------------------------|----------------|-------|--------|-------------------------------------------------------------------------|
| `discriminator`         | `[u8; 8]`      | 8     | 0      | Anchor discriminator: `sha256("account:ComplianceConfig")[..8]`         |
| `version`               | `u8`           | 1     | 8      | SSS version. MUST be `2`.                                               |
| `bump`                  | `u8`           | 1     | 9      | Canonical PDA bump.                                                     |
| `mint`                  | `Pubkey`       | 32    | 10     | Token-2022 mint this config governs.                                    |
| `admin`                 | `Pubkey`       | 32    | 42     | Ultimate authority. Can do everything including upgrade and admin transfer. |
| `compliance_officer`    | `Pubkey`       | 32    | 74     | Can execute whitelist/freeze/seize. Cannot upgrade or transfer admin.   |
| `supply_cap`            | `u64`          | 8     | 106    | Maximum supply. `0` = uncapped.                                         |
| `total_supply`          | `u64`          | 8     | 114    | Current circulating supply.                                             |
| `decimals`              | `u8`           | 1     | 122    | Must match mint decimals.                                               |
| `whitelist_enabled`     | `bool`         | 1     | 123    | If `true`, only whitelisted addresses may receive/mint tokens.          |
| `compliance_vault`      | `Pubkey`       | 32    | 124    | Token account that receives seized funds.                               |
| `event_count`           | `u64`          | 8     | 156    | Total number of compliance events recorded. Monotonically increasing.   |
| `sss1_config`           | `Pubkey`       | 32    | 164    | Address of the originating SSS-1 `StablecoinConfig`.                    |
| `created_at`            | `i64`          | 8     | 196    | Unix timestamp of `initialize_sss2`.                                    |
| `_reserved`             | `[u8; 64]`     | 64    | 204    | Zero-padded. Reserved for future standard fields.                       |

**Total size**: 268 bytes.

**PDA Derivation**:

```
seeds = [b"sss2", mint.key().as_ref()]
program_id = <issuer's program ID>
```

---

#### `WhitelistRecord`

One PDA per whitelisted address. Presence of a valid, non-expired `WhitelistRecord` is the on-chain signal that an address is KYC-approved.

| Field            | Type        | Bytes | Offset | Description                                                         |
|------------------|-------------|-------|--------|---------------------------------------------------------------------|
| `discriminator`  | `[u8; 8]`   | 8     | 0      | Anchor discriminator: `sha256("account:WhitelistRecord")[..8]`      |
| `bump`           | `u8`        | 1     | 8      | Canonical PDA bump.                                                 |
| `mint`           | `Pubkey`    | 32    | 9      | The mint this record applies to.                                    |
| `wallet`         | `Pubkey`    | 32    | 41     | The wallet address being whitelisted.                               |
| `kyc_reference`  | `[u8; 128]` | 128   | 73     | Opaque KYC identifier. UTF-8 string, zero-padded to 128 bytes. May be a UUID, hash, or provider-specific ID. |
| `added_by`       | `Pubkey`    | 32    | 201    | The compliance officer or admin that added this record.             |
| `added_at`       | `i64`       | 8     | 233    | Unix timestamp of addition.                                         |
| `expires_at`     | `i64`       | 8     | 241    | Expiry timestamp. `0` = never expires. After expiry the record is invalid but not closed. |
| `is_active`      | `bool`      | 1     | 249    | `false` after `whitelist_remove`.                                   |

**Total size**: 250 bytes.

**PDA Derivation**:

```
seeds = [b"whitelist", mint.key().as_ref(), wallet.key().as_ref()]
program_id = <issuer's program ID>
```

**Validity Condition**: A `WhitelistRecord` is valid if `is_active == true && (expires_at == 0 || expires_at > Clock::get().unix_timestamp)`.

---

#### `FreezeRecord`

One PDA per frozen address. Created by `freeze_account`, closed by `unfreeze_account` (or retained with `is_frozen = false`).

| Field            | Type      | Bytes | Offset | Description                                                          |
|------------------|-----------|-------|--------|----------------------------------------------------------------------|
| `discriminator`  | `[u8; 8]` | 8     | 0      | Anchor discriminator: `sha256("account:FreezeRecord")[..8]`          |
| `bump`           | `u8`      | 1     | 8      | Canonical PDA bump.                                                  |
| `mint`           | `Pubkey`  | 32    | 9      | The mint this record applies to.                                     |
| `wallet`         | `Pubkey`  | 32    | 41     | The frozen wallet address.                                           |
| `frozen_by`      | `Pubkey`  | 32    | 73     | The compliance officer or admin that froze the account.              |
| `frozen_at`      | `i64`     | 8     | 105    | Unix timestamp of freeze.                                            |
| `freeze_reason`  | `[u8; 64]`| 64    | 113    | Opaque reason string. Zero-padded. Useful for audit log.             |
| `is_frozen`      | `bool`    | 1     | 177    | `true` while frozen. Set to `false` by `unfreeze_account`.           |
| `unfrozen_at`    | `i64`     | 8     | 178    | Unix timestamp of unfreeze. `0` if still frozen.                     |
| `funds_seized`   | `bool`    | 1     | 186    | `true` if `seize_funds` was called on this address while frozen.     |

**Total size**: 187 bytes.

**PDA Derivation**:

```
seeds = [b"freeze", mint.key().as_ref(), wallet.key().as_ref()]
program_id = <issuer's program ID>
```

---

#### `ComplianceEventRecord`

Append-only audit log entry. One PDA per event, indexed by a monotonically increasing counter.

| Field            | Type        | Bytes | Offset | Description                                                          |
|------------------|-------------|-------|--------|----------------------------------------------------------------------|
| `discriminator`  | `[u8; 8]`   | 8     | 0      | Anchor discriminator: `sha256("account:ComplianceEventRecord")[..8]` |
| `bump`           | `u8`        | 1     | 8      | Canonical PDA bump.                                                  |
| `mint`           | `Pubkey`    | 32    | 9      | The mint this event applies to.                                      |
| `event_index`    | `u64`       | 8     | 41     | Monotonically increasing index. Matches `ComplianceConfig.event_count - 1` at creation. |
| `event_type`     | `u8`        | 1     | 49     | Event type discriminant. See Event Type Registry below.              |
| `subject`        | `Pubkey`    | 32    | 50     | Primary subject (wallet, admin address) of the event.                |
| `actor`          | `Pubkey`    | 32    | 82     | The compliance officer or admin that triggered the event.            |
| `timestamp`      | `i64`       | 8     | 114    | Unix timestamp.                                                      |
| `amount`         | `u64`       | 8     | 122    | Token amount involved. `0` if not applicable.                        |
| `metadata`       | `[u8; 128]` | 128   | 130    | Opaque metadata (e.g. KYC reference, reason string). Zero-padded.    |

**Total size**: 258 bytes.

**PDA Derivation**:

```
seeds = [b"event", mint.key().as_ref(), event_index.to_le_bytes().as_ref()]
program_id = <issuer's program ID>
```

**Event Type Registry**:

| Value | Name                  | Description                                          |
|-------|-----------------------|------------------------------------------------------|
| 0     | `WhitelistAdded`      | Address added to whitelist                           |
| 1     | `WhitelistRemoved`    | Address removed from whitelist                       |
| 2     | `AccountFrozen`       | Address frozen                                       |
| 3     | `AccountUnfrozen`     | Address unfrozen                                     |
| 4     | `FundsSeized`         | Funds seized from frozen address to compliance vault |
| 5     | `ComplianceOfficerChanged` | Compliance officer authority transferred         |
| 6     | `WhitelistToggled`    | `whitelist_enabled` flag changed                     |
| 7     | `Custom`              | Issuer-defined event type; metadata field used for type info |

---

### Roles and Authority Model

SSS-2 introduces a two-role authority model:

| Role                | Capabilities                                                           |
|---------------------|------------------------------------------------------------------------|
| Admin               | Everything: whitelist, freeze, seize, update cap, transfer admin, change compliance officer, upgrade |
| Compliance Officer  | Whitelist add/remove, freeze, unfreeze, seize, record compliance event |
| Compliance Officer  | Cannot: transfer admin, update supply cap, upgrade program, change own role |

The admin MAY set `compliance_officer == admin` if a single keypair should hold both roles. The compliance officer MAY be a multi-sig program address.

---

### Instruction Set

All SSS-1 instructions become invalid after `upgrade_to_sss2` marks the SSS-1 config as migrated. All SSS-2 instructions are on a separate program (the SSS-2 reference implementation). The programs MAY share the same binary via Anchor's multi-program workspace.

---

#### `initialize_sss2`

Initializes the `ComplianceConfig` PDA and sets up the Token-2022 freeze extension. Called after the SSS-2 program is deployed, before calling `upgrade_to_sss2` on the SSS-1 program.

**Accounts**:

| # | Name                  | Writable | Signer | Description                                          |
|---|-----------------------|----------|--------|------------------------------------------------------|
| 0 | `compliance_config`   | Yes      | No     | `ComplianceConfig` PDA (created here)                |
| 1 | `mint`                | Yes      | No     | Existing Token-2022 mint (already initialized by SSS-1) |
| 2 | `sss1_config`         | No       | No     | The SSS-1 `StablecoinConfig` PDA for this mint       |
| 3 | `compliance_vault`    | No       | No     | Token account for seized funds (must already exist)  |
| 4 | `admin`               | No       | Yes    | Must match `sss1_config.admin`                       |
| 5 | `compliance_officer`  | No       | No     | Initial compliance officer address                   |
| 6 | `token_program`       | No       | No     | Token-2022 program                                   |
| 7 | `system_program`      | No       | No     | System program                                       |

**Parameters**:

| Name                  | Type   | Description                                       |
|-----------------------|--------|---------------------------------------------------|
| `whitelist_enabled`   | `bool` | Whether to enable whitelist enforcement at init.  |

**Validation Rules**:

1. `admin` MUST match `sss1_config.admin`.
2. `sss1_config.upgraded_to` MUST be `None` (cannot re-initialize after migration).
3. The `ComplianceConfig` PDA MUST not already exist.
4. `compliance_vault` MUST be a token account for `mint`.

**Effects**:

1. Creates `ComplianceConfig` with all fields set.
2. Sets `event_count = 0`, `total_supply = sss1_config.total_supply`.
3. Does NOT call `upgrade_to_sss2` on the SSS-1 program — that is a separate instruction the admin calls after verifying `ComplianceConfig` is correct.

**Emitted Event**: `Sss2Initialized { mint, admin, compliance_officer, whitelist_enabled, timestamp }`.

**Error Conditions**:

| Code  | Name                       | Condition                                          |
|-------|----------------------------|----------------------------------------------------|
| 7000  | `Unauthorized`             | Admin signer does not match sss1_config admin      |
| 7001  | `AlreadyInitialized`       | ComplianceConfig PDA already exists                |
| 7002  | `InvalidSss1Config`        | sss1_config fails discriminator or mint check      |
| 7003  | `InvalidComplianceVault`   | compliance_vault is not a valid token account for this mint |
| 7004  | `Sss1AlreadyMigrated`      | sss1_config.upgraded_to is Some(_)                 |

---

#### `whitelist_add`

Adds an address to the whitelist by creating a `WhitelistRecord` PDA.

**Accounts**:

| # | Name                  | Writable | Signer | Description                                     |
|---|-----------------------|----------|--------|-------------------------------------------------|
| 0 | `compliance_config`   | No       | No     | `ComplianceConfig` PDA                          |
| 1 | `whitelist_record`    | Yes      | No     | `WhitelistRecord` PDA (created here)            |
| 2 | `wallet`              | No       | No     | Address being whitelisted                        |
| 3 | `authority`           | No       | Yes    | Admin or compliance officer                     |
| 4 | `payer`               | Yes      | Yes    | Rent payer for new PDA                          |
| 5 | `system_program`      | No       | No     | System program                                  |

**Parameters**:

| Name            | Type        | Description                                               |
|-----------------|-------------|-----------------------------------------------------------|
| `kyc_reference` | `[u8; 128]` | Opaque KYC identifier. Zero-pad if shorter than 128 bytes.|
| `expires_at`    | `i64`       | Expiry timestamp. `0` = no expiry.                        |

**Validation Rules**:

1. `authority` MUST be `compliance_config.admin` or `compliance_config.compliance_officer`.
2. A `WhitelistRecord` PDA for `(mint, wallet)` MUST NOT already exist with `is_active == true`.
3. If `expires_at > 0`, it MUST be in the future (`expires_at > Clock::unix_timestamp`).

**Effects**:

1. Creates `WhitelistRecord` with `is_active = true`.
2. Creates `ComplianceEventRecord` with `event_type = WhitelistAdded`.
3. Increments `compliance_config.event_count`.

**Error Conditions**:

| Code  | Name                       | Condition                                              |
|-------|----------------------------|--------------------------------------------------------|
| 7000  | `Unauthorized`             | Signer is not admin or compliance officer              |
| 7005  | `AlreadyWhitelisted`       | Active whitelist record already exists for this wallet |
| 7006  | `InvalidExpiry`            | expires_at is in the past                              |

---

#### `whitelist_remove`

Deactivates a whitelist record. The `WhitelistRecord` PDA is NOT closed (historical record is preserved); `is_active` is set to `false`.

**Accounts**:

| # | Name                  | Writable | Signer | Description                           |
|---|-----------------------|----------|--------|---------------------------------------|
| 0 | `compliance_config`   | Yes      | No     | `ComplianceConfig` PDA                |
| 1 | `whitelist_record`    | Yes      | No     | `WhitelistRecord` PDA to deactivate   |
| 2 | `wallet`              | No       | No     | Address being removed                 |
| 3 | `authority`           | No       | Yes    | Admin or compliance officer           |

**Parameters**: None.

**Validation Rules**:

1. `authority` MUST be admin or compliance officer.
2. `whitelist_record.wallet` MUST match `wallet`.
3. `whitelist_record.is_active` MUST be `true`.

**Effects**:

1. Sets `whitelist_record.is_active = false`.
2. Creates `ComplianceEventRecord` with `event_type = WhitelistRemoved`.
3. Increments `compliance_config.event_count`.

**Error Conditions**:

| Code  | Name                    | Condition                                   |
|-------|-------------------------|---------------------------------------------|
| 7000  | `Unauthorized`          | Signer is not admin or compliance officer   |
| 7007  | `NotWhitelisted`        | Record is already inactive                  |
| 7008  | `WalletMismatch`        | Record wallet does not match provided wallet|

---

#### `freeze_account`

Freezes a wallet address. After this instruction, any `mint_tokens`, `burn_tokens`, or `transfer_tokens` instruction that involves the frozen address MUST fail.

SSS-2 enforces the freeze at the program level by checking for the presence and status of a `FreezeRecord` PDA on every token operation. Additionally, the program SHOULD exercise the Token-2022 freeze authority to freeze the token account at the SPL layer.

**Accounts**:

| # | Name                  | Writable | Signer | Description                               |
|---|-----------------------|----------|--------|-------------------------------------------|
| 0 | `compliance_config`   | Yes      | No     | `ComplianceConfig` PDA                    |
| 1 | `freeze_record`       | Yes      | No     | `FreezeRecord` PDA (created or updated)   |
| 2 | `target_ata`          | Yes      | No     | Token account of the wallet to freeze     |
| 3 | `wallet`              | No       | No     | Wallet being frozen                       |
| 4 | `mint`                | No       | No     | Token-2022 mint                           |
| 5 | `authority`           | No       | Yes    | Admin or compliance officer               |
| 6 | `token_program`       | No       | No     | Token-2022 program                        |
| 7 | `payer`               | Yes      | Yes    | Rent payer if creating new FreezeRecord   |
| 8 | `system_program`      | No       | No     | System program                            |

**Parameters**:

| Name             | Type        | Description                               |
|------------------|-------------|-------------------------------------------|
| `freeze_reason`  | `[u8; 64]`  | Opaque reason string. Zero-padded.        |

**Validation Rules**:

1. `authority` MUST be admin or compliance officer.
2. `target_ata.owner` MUST be `wallet`.
3. `target_ata.mint` MUST be `compliance_config.mint`.
4. No existing `FreezeRecord` with `is_frozen == true` for `(mint, wallet)`.

**Effects**:

1. Creates or updates `FreezeRecord` with `is_frozen = true`, `frozen_at = now`, `frozen_by = authority`.
2. CPIs to Token-2022 `freeze_account` using the `ComplianceConfig` PDA as freeze authority.
3. Creates `ComplianceEventRecord` with `event_type = AccountFrozen`.
4. Increments `compliance_config.event_count`.

**Error Conditions**:

| Code  | Name                    | Condition                                        |
|-------|-------------------------|--------------------------------------------------|
| 7000  | `Unauthorized`          | Signer is not admin or compliance officer        |
| 7009  | `AlreadyFrozen`         | FreezeRecord already exists with is_frozen=true  |
| 7010  | `InvalidTokenAccount`   | ATA owner or mint mismatch                       |

---

#### `unfreeze_account`

Reverses a freeze. After this instruction, the previously frozen address can transact again (subject to whitelist enforcement if enabled).

**Accounts**:

| # | Name                  | Writable | Signer | Description                                       |
|---|-----------------------|----------|--------|---------------------------------------------------|
| 0 | `compliance_config`   | Yes      | No     | `ComplianceConfig` PDA                            |
| 1 | `freeze_record`       | Yes      | No     | `FreezeRecord` PDA                                |
| 2 | `target_ata`          | Yes      | No     | Token account to unfreeze at SPL level            |
| 3 | `wallet`              | No       | No     | Wallet being unfrozen                             |
| 4 | `mint`                | No       | No     | Token-2022 mint                                   |
| 5 | `authority`           | No       | Yes    | Admin or compliance officer                       |
| 6 | `token_program`       | No       | No     | Token-2022 program                                |

**Parameters**: None.

**Validation Rules**:

1. `authority` MUST be admin or compliance officer.
2. `freeze_record.wallet` MUST match `wallet`.
3. `freeze_record.is_frozen` MUST be `true`.
4. `freeze_record.funds_seized` MUST be `false` (cannot unfreeze an address whose funds were seized without re-initializing).

**Effects**:

1. Sets `freeze_record.is_frozen = false`, `freeze_record.unfrozen_at = now`.
2. CPIs to Token-2022 `thaw_account`.
3. Creates `ComplianceEventRecord` with `event_type = AccountUnfrozen`.
4. Increments `compliance_config.event_count`.

**Error Conditions**:

| Code  | Name                 | Condition                                          |
|-------|----------------------|----------------------------------------------------|
| 7000  | `Unauthorized`       | Signer is not admin or compliance officer          |
| 7011  | `NotFrozen`          | freeze_record.is_frozen is false                   |
| 7008  | `WalletMismatch`     | FreezeRecord wallet does not match provided wallet |
| 7012  | `FundsAlreadySeized` | Cannot unfreeze after seizure without re-init      |

---

#### `seize_funds`

Forcibly transfers all tokens from a frozen address to the compliance vault. Can only be called on addresses that are currently frozen.

**Accounts**:

| # | Name                  | Writable | Signer | Description                                           |
|---|-----------------------|----------|--------|-------------------------------------------------------|
| 0 | `compliance_config`   | Yes      | No     | `ComplianceConfig` PDA                                |
| 1 | `freeze_record`       | Yes      | No     | `FreezeRecord` PDA (must have is_frozen=true)         |
| 2 | `source_ata`          | Yes      | No     | Token account of frozen wallet                        |
| 3 | `compliance_vault`    | Yes      | No     | Destination token account (compliance_config.compliance_vault) |
| 4 | `wallet`              | No       | No     | Frozen wallet address                                 |
| 5 | `mint`                | No       | No     | Token-2022 mint                                       |
| 6 | `authority`           | No       | Yes    | Admin or compliance officer                           |
| 7 | `token_program`       | No       | No     | Token-2022 program                                    |

**Parameters**: None.

**Validation Rules**:

1. `authority` MUST be admin or compliance officer.
2. `freeze_record.is_frozen` MUST be `true`.
3. `freeze_record.funds_seized` MUST be `false`.
4. `source_ata.owner` MUST be `wallet`.
5. `compliance_vault` MUST match `compliance_config.compliance_vault`.
6. `source_ata` balance MUST be > 0.

**Effects**:

1. CPIs to Token-2022 `transfer_checked` using `ComplianceConfig` PDA as authority, moving the full balance from `source_ata` to `compliance_vault`.
2. Decrements `compliance_config.total_supply` by the seized amount (the supply is not burned; it remains in the compliance vault).
3. Sets `freeze_record.funds_seized = true`.
4. Creates `ComplianceEventRecord` with `event_type = FundsSeized`, `amount = seized_amount`.
5. Increments `compliance_config.event_count`.

**Error Conditions**:

| Code  | Name                    | Condition                                        |
|-------|-------------------------|--------------------------------------------------|
| 7000  | `Unauthorized`          | Signer is not admin or compliance officer        |
| 7011  | `NotFrozen`             | Source wallet is not frozen                      |
| 7012  | `FundsAlreadySeized`    | Funds already seized                             |
| 7013  | `ZeroBalance`           | Source ATA has zero balance                      |
| 7014  | `VaultMismatch`         | compliance_vault does not match config           |

---

#### `record_compliance_event`

Allows the compliance officer or admin to record a custom compliance event (event_type = 7, `Custom`). Used for documenting OFAC decisions, regulatory orders, and other off-chain actions that should be anchored on-chain.

**Accounts**:

| # | Name                    | Writable | Signer | Description                                     |
|---|-------------------------|----------|--------|-------------------------------------------------|
| 0 | `compliance_config`     | Yes      | No     | `ComplianceConfig` PDA                          |
| 1 | `event_record`          | Yes      | No     | `ComplianceEventRecord` PDA (created here)      |
| 2 | `subject`               | No       | No     | Subject address of the event                    |
| 3 | `authority`             | No       | Yes    | Admin or compliance officer                     |
| 4 | `payer`                 | Yes      | Yes    | Rent payer                                      |
| 5 | `system_program`        | No       | No     | System program                                  |

**Parameters**:

| Name       | Type        | Description                                                         |
|------------|-------------|---------------------------------------------------------------------|
| `metadata` | `[u8; 128]` | Custom metadata. By convention, first 32 bytes identify the event sub-type. |

**Validation Rules**:

1. `authority` MUST be admin or compliance officer.

**Effects**:

1. Creates `ComplianceEventRecord` with `event_type = 7 (Custom)`, `subject = subject.key()`, `metadata = metadata`.
2. Increments `compliance_config.event_count`.

**Error Conditions**:

| Code  | Name            | Condition                                      |
|-------|-----------------|------------------------------------------------|
| 7000  | `Unauthorized`  | Signer is not admin or compliance officer      |

---

#### `update_compliance_officer`

Transfers the compliance officer role. Only the admin can do this.

**Accounts**:

| # | Name                 | Writable | Signer | Description                |
|---|----------------------|----------|--------|----------------------------|
| 0 | `compliance_config`  | Yes      | No     | `ComplianceConfig` PDA     |
| 1 | `admin`              | No       | Yes    | Current admin              |

**Parameters**:

| Name                     | Type     | Description                       |
|--------------------------|----------|-----------------------------------|
| `new_compliance_officer` | `Pubkey` | Incoming compliance officer.      |

**Validation Rules**:

1. `admin` MUST match `compliance_config.admin`.
2. `new_compliance_officer` MUST NOT equal `compliance_config.compliance_officer`.

**Effects**:

1. Sets `compliance_config.compliance_officer = new_compliance_officer`.
2. Creates `ComplianceEventRecord` with `event_type = ComplianceOfficerChanged`.
3. Increments `compliance_config.event_count`.

**Error Conditions**:

| Code  | Name                    | Condition                                        |
|-------|-------------------------|--------------------------------------------------|
| 7000  | `Unauthorized`          | Signer is not admin                              |
| 7015  | `SameComplianceOfficer` | New officer equals current officer               |

---

### Whitelist Enforcement Semantics

When `compliance_config.whitelist_enabled == true`:

- `mint_tokens`: The recipient's ATA owner MUST have a valid `WhitelistRecord`.
- `transfer_tokens`: The destination address MUST have a valid `WhitelistRecord`.
- `burn_tokens`: No whitelist check (anyone can burn their own tokens, even if de-whitelisted).

A `WhitelistRecord` is valid if: `is_active == true AND (expires_at == 0 OR expires_at > Clock::unix_timestamp)`.

When `whitelist_enabled == false`, the whitelist check is bypassed entirely. Issuers MAY disable whitelisting for test deployments or grace periods.

---

### Freeze Semantics

A frozen address CANNOT:
- Be the `recipient_ata` owner in `mint_tokens`
- Be the `sender` in `transfer_tokens`
- Be the `dest_ata` owner in `transfer_tokens`
- Call `burn_tokens` (the `holder` signer check also fails at the Token-2022 level since the ATA is frozen)

Freeze is enforced at two layers:
1. **Program layer**: SSS-2 checks for `FreezeRecord.is_frozen == true` in every relevant instruction.
2. **SPL layer**: Token-2022 `freeze_account` is called during `freeze_account`, which prevents any SPL-level transfer from the frozen ATA regardless of SSS-2 checks.

Both layers MUST be maintained in sync by a conforming implementation.

---

### Seize Semantics

Seizure is a destructive, one-way operation:

1. The source ATA's entire balance is moved to `compliance_vault`. This is a token transfer, not a burn — total supply does not change.
2. `freeze_record.funds_seized = true` is set. This prevents double-seizure.
3. The address remains frozen after seizure. `unfreeze_account` will fail if `funds_seized == true`.
4. If the issuer wishes to release a previously-seized address, they MUST manually close the `FreezeRecord` PDA (via a custom admin instruction not part of the standard) and create a new one.

The compliance vault MAY be burned or redeemed by the admin at their discretion. This standard does not dictate what happens to seized funds after seizure.

---

### Audit Log Semantics

All compliance state changes MUST create a `ComplianceEventRecord`. The `event_index` field is monotonically increasing and equal to `compliance_config.event_count - 1` at the time of creation. This allows off-chain indexers to:

1. Fetch all events for a mint by iterating `event_index` from 0 to `event_count - 1`.
2. Verify completeness by checking that `event_count` matches the highest-index record plus one.
3. Reconstruct the full compliance history in order.

The `ComplianceEventRecord` account is rent-exempt and is never closed by the standard protocol. Issuers MAY close old event records to reclaim rent after a sufficient retention period, but this is not recommended for regulatory compliance.

---

### Upgrade Path from SSS-1 to SSS-2

The upgrade process is:

1. Deploy the SSS-2 program (or confirm the same program supports both via `cfg` features).
2. Create the compliance vault token account.
3. Call `initialize_sss2` on the SSS-2 program, providing the SSS-1 `StablecoinConfig` PDA.
4. Verify `ComplianceConfig` fields on-chain.
5. Call `upgrade_to_sss2` on the SSS-1 program. This sets `sss1_config.upgraded_to = Some(compliance_config.pubkey)` and disables all SSS-1 mutations.
6. Optionally call `whitelist_add` for existing holders if transitioning from non-whitelisted to whitelisted mode.

After step 5, the SSS-1 config is permanently frozen. All new token operations go through the SSS-2 program.

---

### Token-2022 Freeze Extension

SSS-2 MUST set the Token-2022 freeze authority during `initialize_sss2`. The freeze authority is the `ComplianceConfig` PDA. This allows the SSS-2 program to call `freeze_account` and `thaw_account` via CPI.

The SSS-1 program initializes the mint with `freeze_authority = None`. During `initialize_sss2`, the SSS-2 program MUST use the SSS-1 `StablecoinConfig` PDA to call Token-2022's `set_authority` to change the freeze authority to the `ComplianceConfig` PDA. This is why `sss1_config` and the SSS-1 program must both be provided as accounts in `initialize_sss2`.

---

### Error Code Registry (SSS-2 Additions)

| Code  | Name                       | Description                                              |
|-------|----------------------------|----------------------------------------------------------|
| 7000  | `Unauthorized`             | Signer lacks required role                               |
| 7001  | `AlreadyInitialized`       | ComplianceConfig PDA already exists                      |
| 7002  | `InvalidSss1Config`        | SSS-1 config fails validation                            |
| 7003  | `InvalidComplianceVault`   | Vault is not a valid token account for this mint         |
| 7004  | `Sss1AlreadyMigrated`      | SSS-1 config already migrated                            |
| 7005  | `AlreadyWhitelisted`       | Active whitelist record already exists                   |
| 7006  | `InvalidExpiry`            | Expiry timestamp is in the past                          |
| 7007  | `NotWhitelisted`           | Address is not whitelisted (or record inactive)          |
| 7008  | `WalletMismatch`           | Record wallet does not match provided wallet             |
| 7009  | `AlreadyFrozen`            | Address is already frozen                                |
| 7010  | `InvalidTokenAccount`      | Token account owner or mint mismatch                     |
| 7011  | `NotFrozen`                | Address is not frozen                                    |
| 7012  | `FundsAlreadySeized`       | Seizure already performed                                |
| 7013  | `ZeroBalance`              | Source ATA has zero balance                              |
| 7014  | `VaultMismatch`            | Vault does not match compliance_config.compliance_vault  |
| 7015  | `SameComplianceOfficer`    | New officer equals current officer                       |
| 7016  | `WhitelistNotEnabled`      | Whitelist check attempted but not enabled                |
| 7017  | `WhitelistExpired`         | Whitelist record exists but has expired                  |

---

## Compliance Considerations

### OFAC Screening Integration

SSS-2 is designed to accommodate OFAC (Office of Foreign Assets Control) screening without mandating a specific provider. The recommended integration pattern is:

1. The issuer operates an off-chain screening service that watches for new wallet addresses interacting with the token.
2. When a new address is detected, the screening service checks the address against the OFAC SDN list and other sanctions databases.
3. If the address is sanctioned, the compliance officer calls `freeze_account` with `freeze_reason` set to an OFAC-standard reason code (e.g., `"OFAC_SDN_MATCH:<list_entry_id>"`).
4. The `ComplianceEventRecord` created by `freeze_account` provides the on-chain audit trail for the screening decision.

Issuers MAY also use `whitelist_add` pre-emptively for all addresses that pass screening, combined with `whitelist_enabled = true`, to create an allow-list model rather than a deny-list model.

### MiCA Compatibility

SSS-2's design is informed by the European Union's Markets in Crypto-Assets Regulation (MiCA) requirements for e-money token issuers:

- **Traceability**: The `ComplianceEventRecord` log satisfies MiCA's requirement for transaction monitoring records.
- **Redemption**: MiCA requires issuers to redeem tokens at par on request. The `burn_tokens` instruction in SSS-2 (inherited from SSS-1) enables on-chain redemption.
- **Reserves**: MiCA requires reserve asset backing. This standard does not govern reserve management; issuers MUST comply separately.
- **Freeze authority**: MiCA's provisions for halting transfers under regulatory orders are satisfied by `freeze_account` / `seize_funds`.
- **KYC reference**: MiCA requires issuers to maintain KYC records for token holders. The `kyc_reference` field in `WhitelistRecord` stores the opaque reference to the off-chain KYC record, satisfying the on-chain linkage requirement without storing PII on-chain.

### FATF Travel Rule

For transactions above the Travel Rule threshold (USD 1,000 equivalent), FATF requires originating and beneficiary VASPs to exchange sender/recipient information. SSS-2 does not implement Travel Rule messaging on-chain (this is typically handled off-chain by VASP compliance systems like Notabene or Shyft). However, the `transfer_tokens` event emitted by SSS-2 provides the on-chain transaction record that VASP systems can anchor their Travel Rule messages to.

---

## Security Considerations

### Compliance Officer Key Management

The compliance officer key has significant power: it can freeze any address and seize funds. A compromised compliance officer key could be used to freeze innocent users or redirect funds to an attacker-controlled compliance vault (if the vault is also controlled by the attacker). Issuers MUST:

- Use a hardware security module (HSM) or multi-sig (Squads Protocol recommended) for the compliance officer role in production.
- Separate the compliance officer key from the admin key across physical locations.
- Implement alerting for any `freeze_account` or `seize_funds` transaction that is not initiated by the compliance system.

### Multi-Sig Recommendations

For production SSS-2 deployments:

| Role                | Recommended Custody                     | Threshold  |
|---------------------|-----------------------------------------|------------|
| Admin               | Squads multi-sig                        | 3-of-5     |
| Compliance Officer  | HSM or Squads multi-sig                 | 2-of-3     |
| Compliance Vault    | Squads multi-sig token account          | 3-of-5     |

### Seize Finality

`seize_funds` is irreversible. Once funds are seized, the only way to return them is for the admin to manually transfer from the compliance vault. Implementations SHOULD require a time-lock or multi-sig approval for `seize_funds` to prevent accidental or malicious seizures. This standard does not enforce a time-lock but recommends it strongly.

### Whitelist Expiry Race

If `expires_at` is very close to the current block time, a transaction may be submitted before expiry but processed after. The program uses `Clock::get().unix_timestamp` which is the validator's reported time. In practice, this creates at most a few-second window. Issuers SHOULD set `expires_at` with sufficient margin (e.g., 24 hours before the KYC record's actual expiry) to avoid edge cases.

### Event Log Integrity

The `ComplianceEventRecord` accounts are append-only by standard protocol, but they are not cryptographically chained (no hash pointer to previous event). An attacker with admin access could theoretically close old event accounts (Anchor allows account closure by the authority that created them if a `close` constraint is set). Implementations MUST NOT include a `close` constraint on `ComplianceEventRecord`. If rent reclamation is needed, this MUST require a separate governance vote and public announcement.

---

## Reference Implementation

The reference implementation is an Anchor 0.30+ program located at:

```
programs/sss2/
├── src/
│   ├── lib.rs
│   ├── instructions/
│   │   ├── initialize.rs
│   │   ├── whitelist_add.rs
│   │   ├── whitelist_remove.rs
│   │   ├── freeze_account.rs
│   │   ├── unfreeze_account.rs
│   │   ├── seize_funds.rs
│   │   ├── record_compliance_event.rs
│   │   └── update_compliance_officer.rs
│   ├── state/
│   │   ├── compliance_config.rs
│   │   ├── whitelist_record.rs
│   │   ├── freeze_record.rs
│   │   └── compliance_event_record.rs
│   ├── events.rs
│   └── errors.rs
└── Cargo.toml
```

---

## Changelog

| Version | Date       | Description                                      |
|---------|------------|--------------------------------------------------|
| 0.1.0   | 2026-03-02 | Initial draft                                    |
