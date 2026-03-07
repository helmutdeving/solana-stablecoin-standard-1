# SSS Architecture Reference

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           SSS Ecosystem                                       │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│   │  Admin TUI   │    │ React Admin  │    │   CLI Tool   │                  │
│   │  (packages/  │    │  Dashboard   │    │  (packages/  │                  │
│   │    tui/)     │    │ (frontend/)  │    │    cli/)     │                  │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                  │
│          │                  │                   │                            │
│          └──────────────────┼───────────────────┘                            │
│                             │                                                │
│                    ┌────────▼─────────┐                                      │
│                    │  TypeScript SDK  │                                      │
│                    │  (packages/sdk/) │                                      │
│                    └────────┬─────────┘                                      │
│                             │                                                │
│          ┌──────────────────┼───────────────────────┐                        │
│          │                  │                       │                        │
│   ┌──────▼───────┐  ┌───────▼──────┐  ┌────────────▼───────────┐           │
│   │ Mint/Burn    │  │  Compliance  │  │   Event Listener       │           │
│   │ REST API     │  │  Module      │  │   + Webhook Service    │           │
│   │ :3001        │  │  :3003       │  │   :3002                │           │
│   └──────┬───────┘  └───────┬──────┘  └────────────┬───────────┘           │
│          │                  │                       │                        │
│          └──────────────────┼───────────────────────┘                        │
│                             │  RPC calls                                     │
│                    ┌────────▼──────────────┐                                 │
│                    │   Solana RPC Node     │                                 │
│                    │  (devnet/mainnet)     │                                 │
│                    └────────┬──────────────┘                                 │
│                             │                                                │
│          ┌──────────────────┼────────────────────────┐                       │
│          │                  │                        │                       │
│   ┌──────▼───────┐  ┌───────▼────────┐  ┌───────────▼────────┐             │
│   │ sss-program  │  │  sss-transfer  │  │  Token-2022 Mint   │             │
│   │ (SSS-1/2/3)  │  │  -hook program │  │  (on-chain state)  │             │
│   │ Anchor/Rust  │  │  Anchor/Rust   │  │                    │             │
│   └──────────────┘  └────────────────┘  └────────────────────┘             │
│                                                                              │
│          ┌───────────────────────────────────────────────┐                   │
│          │              Oracle Service :3004              │                   │
│          │  Pyth → Switchboard → CoinGecko (failover)    │                   │
│          └───────────────────────────────────────────────┘                   │
│                                                                              │
│          ┌───────────────────────────────────────────────┐                   │
│          │        Observability Stack                     │                   │
│          │  Prometheus :9090  →  Grafana :3005            │                   │
│          │  Scrapes /metrics from all 4 services          │                   │
│          └───────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

## On-Chain Programs

### `solana-stablecoin-standard` (main program)

The core Anchor program implementing all three SSS presets.

```
programs/solana-stablecoin-standard/src/
├── lib.rs                    # Program entry point, declare_id!
├── state.rs                  # Account structs (StablecoinConfig, ComplianceConfig, …)
├── errors.rs                 # Custom error codes
├── events.rs                 # On-chain events (Mint, Burn, Transfer, Freeze, Audit)
└── instructions/
    ├── initialize_sss1.rs    # SSS-1: init minimal stablecoin
    ├── initialize_sss2.rs    # SSS-2: init compliant stablecoin
    ├── initialize_sss3.rs    # SSS-3: init confidential stablecoin
    ├── mint.rs               # Mint tokens (with supply cap check)
    ├── burn.rs               # Burn tokens
    ├── transfer.rs           # Transfer (SSS-2: whitelist + freeze check)
    ├── freeze_account.rs     # SSS-2: freeze a wallet
    ├── unfreeze_account.rs   # SSS-2: unfreeze a wallet
    ├── whitelist_account.rs  # SSS-2: add to KYC whitelist
    ├── remove_whitelist.rs   # SSS-2: remove from KYC whitelist
    └── seize.rs              # SSS-2: regulatory seizure
```

**Account Layout:**

| Account | PDA Seeds | Size | Description |
|---------|-----------|------|-------------|
| `StablecoinConfig` | `["sss-config", mint]` | 120 bytes | Core config for all presets |
| `ComplianceConfig` | `["sss-compliance", mint]` | 96 bytes | SSS-2 compliance settings |
| `WhitelistRecord` | `["sss-whitelist", mint, wallet]` | 48 bytes | KYC whitelist entry |
| `FreezeRecord` | `["sss-freeze", mint, wallet]` | 48 bytes | Account freeze record |
| `ComplianceEventRecord` | `["sss-event", mint, event_id]` | 128 bytes | Append-only audit log |
| `Sss3Config` | `["sss3-config", mint]` | 96 bytes | SSS-3 confidential settings |
| `Sss3AllowlistRecord` | `["sss3-allowlist", mint, wallet]` | 56 bytes | SSS-3 allowlist entry |

### `sss-transfer-hook` (Transfer Hook program)

Token-2022 compatible transfer hook for compliance enforcement at the token layer.

```
programs/sss-transfer-hook/src/
├── lib.rs              # Transfer hook entry point
└── instructions/
    ├── execute.rs      # Called by Token-2022 on every transfer
    └── initialize.rs  # Initialize the extra account meta list
```

**Key behaviour**: On each token transfer, the hook:
1. Reads `ComplianceConfig` PDA for the mint
2. If SSS-2, checks `FreezeRecord` for sender and receiver
3. If SSS-2, checks `WhitelistRecord` for both parties
4. Rejects transfer with `TransferHookViolation` if any check fails

## TypeScript SDK (`packages/sdk`)

```
packages/sdk/src/
├── index.ts          # Public API surface
├── client.ts         # SSSClient — main class
├── sss3.ts           # SSS3Client — confidential stablecoin methods
├── pdas.ts           # PDA derivation helpers
├── types.ts          # TypeScript types (Preset enum, config structs, events)
└── utils.ts          # BN helpers, lamport conversions, validation
```

**Preset hierarchy:**

```
Preset.SSS1  ─ Minimal stablecoin
  └── Preset.SSS2  ─ + KYC whitelist, freeze, seize, audit log
       └── Preset.SSS3  ─ + Confidential mint (commitment hash, ElGamal auditor key)
```

## Backend Services

All services are independent Express servers, each with:
- `GET /health` — liveness check
- `GET /metrics` — Prometheus metrics (prom-client)
- Standard JSON API

| Service | Port | Responsibility |
|---------|------|----------------|
| `mint-burn` | 3001 | POST /v1/mint, /v1/burn, /v1/transfer, GET /v1/supply |
| `event-listener` | 3002 | WebSocket event stream, webhook delivery, borsh decoding |
| `compliance` | 3003 | POST /v1/whitelist, /v1/freeze, GET /v1/accounts |
| `oracle` | 3004 | GET /v1/price/:symbol, computeMintAmount/Redeem (Pyth→Switchboard→CoinGecko) |

## Observability

Prometheus scrapes all 4 services every 10-15s. Key metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `sss_total_supply` | Gauge | Current total circulating supply |
| `sss_supply_utilization_percent` | Gauge | Supply / cap ratio |
| `sss_mint_total` | Counter | Total mint operations |
| `sss_burn_total` | Counter | Total burn operations |
| `sss_whitelist_count` | Gauge | Number of KYC-whitelisted accounts |
| `sss_frozen_count` | Gauge | Number of frozen accounts |
| `sss_oracle_price` | Gauge | Price per symbol+source |
| `http_request_duration_seconds` | Histogram | API latency per endpoint |

Grafana (port 3005) auto-provisions the SSS Overview dashboard via file provisioning.

## Testing Strategy

```
tests/
├── sss1.spec.ts          # 28 SSS-1 tests (init, mint, burn, supply cap, events)
├── sss2.spec.ts          # 33 SSS-2 tests (whitelist, freeze, seize, transfer hook, audit log)
├── sss3.spec.ts          # 30 SSS-3 tests (allowlist, commitment hash, confidential ops)
├── transfer-hook.spec.ts # 24 Transfer Hook tests (cross-program enforcement, error cases)
└── helpers.ts            # Shared keypair setup, airdrop utilities, PDA helpers

trident-tests/
├── fuzz_0/               # SSS-1 fuzz: supply invariants (cap/accounting/underflow)
├── fuzz_1/               # SSS-2 fuzz: compliance invariants (freeze/whitelist state)
└── fuzz_2/               # SSS-3 fuzz: allowlist invariants (deduplication, commitment hash)
```

**Total: 115 test cases + 3 fuzz targets (Trident)**

## Security Properties

| Property | Implementation | Standard Reference |
|----------|----------------|-------------------|
| Supply cap enforcement | `StablecoinConfig.supply_cap`, checked on every mint | SSS-1 |
| Integer overflow protection | `checked_add`, `checked_sub` throughout | SSS-1 |
| Authority access control | `has_one = authority` on all admin instructions | SSS-1 |
| Transfer compliance | Transfer Hook cross-program read at token layer | SSS-2 |
| Whitelist gating | `WhitelistRecord` PDA existence check | SSS-2 |
| Freeze enforcement | `FreezeRecord` PDA existence check (sender + receiver) | SSS-2 |
| Append-only audit log | `ComplianceEventRecord` PDA, event_id monotonic | SSS-2 |
| Confidential commitment | Commitment hash = SHA256(amount ‖ nonce ‖ auditor_key) | SSS-3 |
| Fuzz-tested invariants | Trident fuzz testing for all 3 preset state machines | All |
