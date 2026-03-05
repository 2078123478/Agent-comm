---
name: alphaos
description: Build, run, or extend AlphaOS, a plugin-based OnchainOS arbitrage skill with scan/evaluate/simulate/execute/record/notify workflow, SQLite state tracking, AES-256 vault, and OpenClaw hook delivery. Use when implementing strategy plugins, risk gating, execution mode transitions, or growth-facing profit telemetry.
---

# AlphaOS Skill

Implement AlphaOS by keeping all domain logic under `src/skills/alphaos/` and treating each strategy as a plugin.

## Workflow

1. Load config from env.
2. Build runtime services: state store, market watcher, simulator, risk engine, notifier, OnchainOS v6 client.
3. Register strategy plugin(s) and upsert strategy config.
4. Start engine tick loop (`scan -> evaluate -> plan -> simulate -> execute -> record -> notify`).
5. Expose API endpoints for mode control, metrics, opportunities, and trades.

## Plugin contract

Use `StrategyPlugin` in `src/skills/alphaos/types.ts`:

- `scan()` creates opportunities from quotes.
- `evaluate()` rejects/accepts opportunities.
- `plan()` outputs an execution plan with bounded notional.

## State and security

- Business state in `data/alpha.db`.
- Vault state in `data/vault.db`.
- Token resolution cache in `token_cache` table.
- Vault encryption: AES-256-GCM + PBKDF2-HMAC-SHA256.

## Official v6 mode

- Prefer official v6 endpoints for live execution:
  `quote -> swap -> (simulate) -> broadcast -> history`.
- Use controlled fallback only on `404/405` when compat fallback is enabled.
- If simulate/broadcast is permission-limited, degrade opportunity to `paper` and emit risk alerts.
- Validate credentials and whitelist availability with `POST /api/v1/integration/onchainos/probe` (non-broadcast smoke).

## Notifications

- Send OpenClaw wake hooks using `/hooks/wake`.
- Event text format:
  `[alphaos][{mode}][{level}] {event} pair={pair} net={netUsd} tx={txHash|na}`

## Strategy tuning and growth demo

- Manage A/B tuning profiles per strategy through `/api/v1/strategies/profile`.
- Export recent strategy performance via `/api/v1/backtest/snapshot`.
- Run deterministic risk replay via `/api/v1/replay/sandbox`.
- Use `/demo` + `/api/v1/stream/metrics` for real-time hackathon presentation.
- Use `scripts/hackathon-demo.sh` for one-click showcase artifact generation.
- Use `scripts/onchainos-live-smoke.sh` before finals to validate official v6 connectivity.

## Extension points

- Add new plugins in `src/skills/alphaos/plugins`.
- Add richer OnchainOS API adapters in `runtime/onchainos-client.ts`.
- Add custom hook mappers in OpenClaw side if richer delivery is needed.
- Ingest external alpha signals via `POST /api/v1/signals/whale` and let `smart-money-mirror` consume them.
