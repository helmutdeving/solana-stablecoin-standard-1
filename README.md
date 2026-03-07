# Solana Stablecoin Standard (SSS)

A modular, on-chain stablecoin framework for Solana supporting two compliance tiers:

| Preset | Use case | Compliance features |
|--------|----------|---------------------|
| **SSS-1** | DeFi-native stablecoins, algorithmic tokens | None — minimal overhead |
| **SSS-2** | Regulated fiat-backed stablecoins | KYC whitelist, freeze/seize, audit log |

Built with [Anchor](https://www.anchor-lang.com/) + [Token-2022](https://spl.solana.com/token-2022).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     L3 — Governance                          │
│  Admin multi-sig · preset upgrade · authority transfer       │
├─────────────────────────────────────────────────────────────┤
│                  L2 — Compliance Hooks (SSS-2)               │
│  KYC whitelist registry · freeze registry · audit event log  │
├─────────────────────────────────────────────────────────────┤
│                    L1 — Core Ledger                           │
│  Token-2022 mint · supply cap · mint/burn/transfer           │
└─────────────────────────────────────────────────────────────┘
```

### Program Accounts

| Account | PDA Seeds | Description |
|---------|-----------|-------------|
| `StablecoinConfig` | `["sss-config", mint]` | Core config for both presets |
| `ComplianceConfig` | `["sss-compliance", mint]` | SSS-2 compliance settings |
| `WhitelistRecord` | `["sss-whitelist", mint, wallet]` | KYC whitelist entry |
| `FreezeRecord` | `["sss-freeze", mint, wallet]` | Account freeze record |
| `ComplianceEventRecord` | `["sss-event", mint, event_id]` | Append-only audit log |

---

## Prerequisites

- Rust 1.75+
- Solana CLI 1.18+
- Anchor CLI 0.30+
- Node.js 20+
- Docker (for backend services)

## Quick Start

```bash
# Install dependencies
npm install

# Build program
anchor build

# Run tests (requires local validator)
anchor test

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

## SSS-1 Quick Start

```typescript
import { SSSClient, PROGRAM_ID } from "@solana-stablecoin-standard/sdk";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import BN from "bn.js";
import IDL from "./target/idl/solana_stablecoin_standard.json";

const client = new SSSClient(provider, IDL);
const mintKp = Keypair.generate();

// Launch a minimal stablecoin (no compliance overhead)
const sig = await client.initializeSss1(mintKp, {
  name: "Dev USD",
  symbol: "dUSD",
  decimals: 6,
  supplyCap: new BN(0), // uncapped
});

// Mint 1000 dUSD to yourself
await client.mint(
  mintKp.publicKey,
  provider.wallet.publicKey,
  new BN(1_000_000_000) // 1000 * 10^6
);
```

## SSS-2 Quick Start (Regulated)

```typescript
// Launch a compliant stablecoin
const sig = await client.initializeSss2(mintKp, {
  name: "Regulated USD",
  symbol: "rUSD",
  decimals: 6,
  supplyCap: new BN(100_000_000_000_000), // 100M cap
  compliance: {
    complianceOfficer: officerWallet.publicKey,
    whitelistTransfers: true, // all transfers require KYC
    whitelistMints: true,
    whitelistBurns: false,
  },
});

// Whitelist a user after KYC
await client.whitelistAdd(mintKp.publicKey, userWallet, {
  kycRef: "kyc-provider:user123:approved", // opaque KYC reference
  expiresAt: new BN(Math.floor(Date.now() / 1000) + 365 * 86400), // 1 year
});

// Freeze a suspicious account
await client.freeze(mintKp.publicKey, suspectWallet, "Fraud investigation #2024-01");

// Seize funds from frozen account to compliance vault
await client.seize(mintKp.publicKey, suspectWallet, new BN(50_000_000));
```

---

## CLI

```bash
npm install -g @solana-stablecoin-standard/cli

# Show stablecoin info
sss info --mint <mint-address>

# Initialize SSS-1
sss init-sss1 --name "My USD" --symbol "MUSD" --decimals 6

# Initialize SSS-2
sss init-sss2 --name "Reg USD" --symbol "RUSD" \
  --officer <compliance-officer-pubkey> \
  --whitelist-transfers --whitelist-mints

# Mint tokens
sss mint --mint <mint> --recipient <wallet> --amount 1000

# Compliance operations (SSS-2)
sss whitelist add --mint <mint> --wallet <wallet> --kyc-ref "ref:123"
sss freeze --mint <mint> --wallet <wallet> --reason "Compliance hold"
sss unfreeze --mint <mint> --wallet <wallet>
sss seize --mint <mint> --wallet <wallet> --amount 500
```

---

## Backend Services

The backend services provide REST APIs for mint/burn operations and real-time event streaming.

```bash
# Start all services
cp .env.example .env  # configure your settings
docker-compose up -d

# Services:
# Port 3001 — Mint/Burn REST API
# Port 3002 — Event listener (WebSocket + webhook)
# Port 3003 — Compliance module (SSS-2)
```

### Mint/Burn API

```
POST /v1/mint   { "mint": "...", "recipient": "...", "amount": "1000.00" }
POST /v1/burn   { "mint": "...", "holder": "...", "amount": "500.00" }
GET  /v1/supply { "mint": "..." }
GET  /health
```

### Event Listener

Subscribe to program events via WebSocket:
```
ws://localhost:3002/events?mint=<mint-address>
```

Events: `TokensMinted`, `TokensBurned`, `TokensTransferred`, `AccountFreezeUpdated`, `WhitelistUpdated`, `FundsSeized`

---

## Testing

```bash
# Unit tests (SDK)
cd packages/sdk && npm test

# Integration tests (requires devnet or localnet)
cd tests && npm test

# Fuzz tests
cd tests && npm run test:fuzz
```

---

## Devnet Deployment

Program ID: `<PROGRAM_ID>` (deployed after CI build)

```bash
# Verify deployment
solana program show <PROGRAM_ID> --url devnet
```

---

## Standards Reference

### SSS-1 Specification

Minimal preset. Suitable for DeFi protocols, algorithmic stablecoins, and test tokens.

- **No compliance overhead**: transfers are unrestricted
- **Supply cap**: optional hard cap enforced at program level
- **Mint authority**: single key (can be a multi-sig or program authority)
- **Token standard**: Token-2022 (no extensions enabled by default)
- **Upgrade path**: one-way migration to SSS-2

### SSS-2 Specification

Compliant preset. Suitable for regulated fiat-backed stablecoins.

All SSS-1 features plus:

- **KYC whitelist**: per-address allowlist with expiry and KYC reference
- **Account freeze**: compliance officer can halt all operations for an address
- **Fund seizure**: seized funds transferred to compliance vault
- **Audit log**: append-only on-chain compliance event log
- **Token-2022 freeze extension**: native token freeze via SPL
- **Compliance officer**: separate key with compliance-only capabilities

---

## License

MIT
