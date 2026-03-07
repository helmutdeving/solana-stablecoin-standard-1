# SSS Admin Frontend

React + Vite admin dashboard for the Solana Stablecoin Standard.

## Features

- **Dashboard** — supply metrics, 24h chart, recent events
- **Operations** — mint, burn, and transfer with form validation
- **Compliance** — freeze/unfreeze accounts, whitelist management, account lookup
- **Events** — real-time event stream via WebSocket (from `event-listener` service)
- **Oracle** — live price feeds (Pyth → Switchboard → CoinGecko fallback)
- **Settings** — configurable service endpoints, auth token, RPC URL

## Stack

- React 18 + TypeScript
- Vite 6
- Tailwind CSS 3
- React Router 6
- Recharts (supply/oracle charts)
- Lucide React (icons)

## Quick Start

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

The dev server proxies `/v1/*` → `localhost:3001` (API) and `/events` → `ws://localhost:3002` (event-listener).

## Service Dependencies

| Service | Default URL | Purpose |
|---------|-------------|---------|
| API | `http://localhost:3001` | Mint/burn/transfer/supply |
| Event Listener | `ws://localhost:3002` | Real-time WebSocket events |
| Compliance | `http://localhost:3003` | Freeze/whitelist/events |
| Oracle | `http://localhost:3004` | Price feeds |

Configure endpoints in the **Settings** page — persisted in localStorage.

## Build

```bash
npm run build
# Output: dist/
```

## Docker

The frontend is included in the `docker-compose.yml` at the project root:

```bash
docker compose up frontend
# → http://localhost:3000
```
