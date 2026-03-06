# AlphaOS (Skill-Oriented Architecture)

AlphaOS is implemented as a reusable skill runtime, not a loose set of services.

## Layout
- `skills/alphaos/SKILL.md`: reusable skill contract and workflow
- `src/skills/alphaos/`: runtime implementation for this skill
  - `engine/`: multi-strategy orchestration and mode gates
  - `plugins/`: strategy plugins (`dex-arbitrage`)
  - `runtime/`: DB, vault, market adapter, notifier, risk, simulator, agent-comm
  - `api/`: demo/control endpoints

## Core flow
`scan -> evaluate -> plan -> simulate -> execute -> record -> notify`

## Algorithm Notes
- `docs/ALGORITHM.md`: 中文算法说明（盈利原理、风险点、公式、门控与熔断）
- `docs/JUDGE_ONE_PAGER.md`: 一页说明（面向评审）
- `docs/OPENCLAW_DISCOVERY_PLAYBOOK.md`: OpenClaw 双向编排接入手册（start/report/approve/hook）

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

## Discovery Demo
```bash
# keep service running in another terminal: npm run dev
npm run demo:discovery
```
This writes a discovery artifact under `demo-output/discovery-demo-*.json`.

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
- `GET /api/v1/growth/moments?limit=5`
- `GET /api/v1/backtest/snapshot?hours=24&format=json|csv`
- `POST /api/v1/replay/sandbox` with `{ "seed":"demo-1","hours":24,"mode":"paper","strategyId":"dex-arbitrage" }`
- `GET /api/v1/agent-comm/status`
- `GET /api/v1/agent-comm/messages?limit=50&peerId=&direction=inbound|outbound&status=...`
- `GET /api/v1/agent-comm/peers?limit=100&status=pending|trusted|blocked|revoked`
- `POST /api/v1/agent-comm/peers/trusted`
  with `{ "peerId":"peer-a","walletAddress":"0x...","pubkey":"0x...","name":"Peer A","capabilities":["ping"] }`
- `POST /api/v1/discovery/sessions/start`
  with `{ "strategyId":"spread-threshold|mean-reversion|volatility-breakout","pairs":["ETH/USDC"],"durationMinutes":30,"sampleIntervalSec":5,"topN":20 }`
- `GET /api/v1/discovery/sessions/active`
- `GET /api/v1/discovery/sessions/:sessionId`
- `GET /api/v1/discovery/sessions/:sessionId/candidates?limit=50`
- `GET /api/v1/discovery/sessions/:sessionId/report`
- `POST /api/v1/discovery/sessions/:sessionId/stop`
- `POST /api/v1/discovery/sessions/:sessionId/approve`
  with `{ "candidateId":"...","mode":"paper|live" }`

## Vault
```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- vault:set trader-key 0xabc
VAULT_MASTER_PASSWORD=pass123 npm run dev -- vault:get trader-key
```

## Agent-Comm v0.1
最小复用入口文档见 `docs/AGENT_COMM_MIN_REUSE.md`。

1. Configure `.env`:
```bash
COMM_ENABLED=true
COMM_RPC_URL=https://your-rpc
COMM_CHAIN_ID=196
COMM_LISTENER_MODE=poll
COMM_WALLET_ALIAS=agent-comm
```
2. Initialize or restore the comm wallet directly:
```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:wallet:init
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:wallet:init --private-key 0x<private_key>
```
3. Inspect local identity:
```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:identity
```
4. Register a trusted peer:
```bash
npm run dev -- agent-comm:peer:trust peer-b 0x<peer_wallet_address> 0x<peer_pubkey>
```
5. Send a command without wiring low-level modules:
```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:send ping peer-b --echo hello
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:send start_discovery peer-b --strategy-id spread-threshold
```
6. Start service with vault password when you want runtime receive/execute path:
```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev
```
7. Query runtime status via `/api/v1/agent-comm/*` endpoints.

## Notes
- Business DB: `data/alpha.db`
- Vault DB: `data/vault.db`
- OpenClaw hook endpoint: `/hooks/wake`
- Enabled strategies controlled by `ENABLED_STRATEGIES` (default `dex-arbitrage`)
- Onchain auth modes: `bearer`, `api-key`, `hmac` (configured by `ONCHAINOS_AUTH_MODE`)
- Official mode uses OnchainOS v6 chain flow:
  `quote -> swap -> (simulate) -> broadcast -> history`
- White-list restricted simulate/broadcast automatically degrade to `paper` and emit risk alerts.
- Discovery defaults can be tuned in `.env`:
  `DISCOVERY_DEFAULT_DURATION_MINUTES`, `DISCOVERY_DEFAULT_SAMPLE_INTERVAL_SEC`,
  `DISCOVERY_DEFAULT_TOPN`, `DISCOVERY_LOOKBACK_SAMPLES`, `DISCOVERY_Z_ENTER`,
  `DISCOVERY_VOL_RATIO_MIN`, `DISCOVERY_MIN_SPREAD_BPS`, `DISCOVERY_NOTIONAL_USD`.
