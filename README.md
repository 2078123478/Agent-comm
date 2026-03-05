# AlphaOS (Skill-Oriented Architecture)

AlphaOS is implemented as a reusable skill runtime, not a loose set of services.

## Layout
- `skills/alphaos/SKILL.md`: reusable skill contract and workflow
- `src/skills/alphaos/`: runtime implementation for this skill
  - `engine/`: multi-strategy orchestration and mode gates
  - `plugins/`: strategy plugins (`dex-arbitrage`, `smart-money-mirror`)
  - `runtime/`: DB, vault, market adapter, notifier, risk, simulator
  - `api/`: demo/control endpoints

## Core flow
`scan -> evaluate -> plan -> simulate -> execute -> record -> notify`

## Quick Start
```bash
cp .env.example .env
npm install
npm run dev
```

## One-Click Demo
```bash
# keep service running in another terminal: npm run dev
npm run demo:run
```
This writes demo artifacts under `demo-output/` (JSON + CSV).

## Live Integration Smoke
```bash
# requires ONCHAINOS_API_BASE/API credentials in .env
npm run demo:smoke:live
```
This validates `quote -> swap -> (simulate)` without broadcasting and writes integration artifacts under `demo-output/`.

## API
- `GET /health`
- `GET /demo` (live demo page)
- `GET /api/v1/manifest`
- `GET /api/v1/stream/metrics` (SSE)
- `GET /api/v1/integration/onchainos/status`
- `POST /api/v1/integration/onchainos/probe` with `{ "pair":"ETH/USDC","chainIndex":"196","notionalUsd":25 }`
- `GET /api/v1/integration/onchainos/token-cache?symbol=ETH&chainIndex=196`
- `POST /api/v1/engine/mode` with `{ "mode": "paper" | "live" }`
- `GET /api/v1/metrics/today`
- `GET /api/v1/strategies/status`
- `GET /api/v1/strategies/profiles`
- `POST /api/v1/strategies/profile` with `{ "strategyId":"dex-arbitrage","variant":"B","params":{"notionalMultiplier":1.2} }`
- `GET /api/v1/opportunities?limit=50`
- `GET /api/v1/trades?limit=50`
- `GET /api/v1/growth/share/latest`
- `GET /api/v1/backtest/snapshot?hours=24&format=json|csv`
- `POST /api/v1/replay/sandbox` with `{ "seed":"demo-1","hours":24,"mode":"paper","strategyId":"dex-arbitrage" }`
- `POST /api/v1/signals/whale` with `{ "wallet": "...", "token": "ETH", "side": "buy", "sizeUsd": 120000, "confidence": 0.9 }`
- `GET /api/v1/signals/whale?status=pending|consumed|ignored|all`

## Vault
```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- vault:set trader-key 0xabc
VAULT_MASTER_PASSWORD=pass123 npm run dev -- vault:get trader-key
```

## Notes
- Business DB: `data/alpha.db`
- Vault DB: `data/vault.db`
- OpenClaw hook endpoint: `/hooks/wake`
- Enabled strategies controlled by `ENABLED_STRATEGIES` (default includes `smart-money-mirror`)
- Onchain auth modes: `bearer`, `api-key`, `hmac` (configured by `ONCHAINOS_AUTH_MODE`)
- Official mode uses OnchainOS v6 chain flow:
  `quote -> swap -> (simulate) -> broadcast -> history`
- White-list restricted simulate/broadcast automatically degrade to `paper` and emit risk alerts.
