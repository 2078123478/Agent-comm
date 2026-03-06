# OpenClaw x AlphaOS Discovery 集成手册

本文给 OpenClaw 侧的编排实现，目标是完成闭环：
`启动发现会话 -> 拉取报告 -> 人审候选 -> 单次审批执行 -> 接收结果回调`

## 1. 会话编排流程
1. OpenClaw 调 `POST /api/v1/discovery/sessions/start`
2. AlphaOS 进入采样与策略分析，持续写 `samples/candidates`
3. OpenClaw 周期轮询：
`GET /api/v1/discovery/sessions/:id`、`/candidates`、`/report`
4. OpenClaw 决策后调 `POST /approve`（默认 `paper`）
5. AlphaOS 复用主执行管线（风控+模拟+执行），返回结构化结果
6. AlphaOS 通过 hook 事件上报关键里程碑

## 2. 鉴权
- Discovery API 在 `/api/v1/**` 下，默认需要 Bearer Token
- Header: `Authorization: Bearer <API_SECRET>`

## 3. 核心接口

### 3.1 启动会话
`POST /api/v1/discovery/sessions/start`

请求体：
```json
{
  "strategyId": "spread-threshold",
  "pairs": ["ETH/USDC", "BTC/USDC"],
  "durationMinutes": 30,
  "sampleIntervalSec": 5,
  "topN": 20
}
```

`strategyId` 可选：
- `spread-threshold`
- `mean-reversion`
- `volatility-breakout`

### 3.2 查询与报告
- `GET /api/v1/discovery/sessions/active`
- `GET /api/v1/discovery/sessions/:sessionId`
- `GET /api/v1/discovery/sessions/:sessionId/candidates?limit=50`
- `GET /api/v1/discovery/sessions/:sessionId/report`

报告包含：
- `summary`（样本数、候选数、topPair、topScore）
- `topCandidates`
- `charts`（按 pair 聚合的时序点，OpenClaw/UI 直接渲染）

### 3.3 提前终止
`POST /api/v1/discovery/sessions/:sessionId/stop`

### 3.4 审批执行
`POST /api/v1/discovery/sessions/:sessionId/approve`

请求体：
```json
{
  "candidateId": "<candidate-id>",
  "mode": "paper"
}
```

响应重点字段：
- `approved`
- `effectiveMode`（权限受限或 gate 不通过会降级到 `paper`）
- `simulation`
- `tradeResult`
- `tradeId`
- `degradedToPaper`

## 4. Hook 事件（AlphaOS -> OpenClaw）

事件名：
- `discovery_started`
- `discovery_progress`
- `discovery_report_ready`
- `discovery_candidate_approved`
- `discovery_candidate_executed`
- `discovery_candidate_failed`

建议 OpenClaw 侧按 `sessionId + candidateId` 做幂等去重。

## 5. OpenClaw 实战建议
- 调度层只允许一个 active session（冲突会返回 409）
- 会话结束后再审批，避免在数据未收敛时提前执行
- 先 `paper` 验证候选质量，再切 `live`
- 按策略维度沉淀命中率：
  `spread-threshold` 更稳健，`mean-reversion/volatility-breakout` 更偏事件驱动

## 6. 一键演示脚本

仓库已提供：
`scripts/discovery-demo.sh`

示例：
```bash
ALPHAOS_API_SECRET=your-token \
ALPHAOS_DISCOVERY_STRATEGY=mean-reversion \
ALPHAOS_DISCOVERY_PAIRS=ETH/USDC,BTC/USDC \
ALPHAOS_DISCOVERY_AUTO_APPROVE=true \
bash scripts/discovery-demo.sh
```

输出文件位于 `demo-output/discovery-demo-*.json`。
