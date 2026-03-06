# AlphaOS Architecture

- `api/server.ts`: demo page, SSE stream, control and growth endpoints
- `engine/alpha-engine.ts`: orchestrator, multi-plugin scheduler, and mode gates
- `plugins/dex-arbitrage.ts`: DEX spread strategy
- `runtime/state-store.ts`: SQLite persistence, strategy profiles, token cache, backtest snapshot, replay dataset, and outbox
- `runtime/sandbox-replay.ts`: deterministic risk replay for strategy stress tests
- `runtime/vault.ts`: AES-256 secret storage
- `runtime/notifier.ts`: OpenClaw hook integration
- `runtime/onchainos-client.ts`: official OnchainOS v6-first adapter with controlled fallback, token resolution cache, and bearer/api-key/hmac auth
- `scripts/hackathon-demo.sh`: one-click hackathon demo pipeline
- `scripts/onchainos-live-smoke.sh`: v6 integration smoke (`quote -> swap -> simulate`, non-broadcast)
