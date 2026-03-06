# AlphaOS Agent-Comm 任务拆解（v0.1）

基于最新 `REQUIREMENT.md` 与 `DESIGN.md`。  
目标：交付 **单链 + poll + 白名单命令 + 最小可观测** 的真实运行闭环。

状态标记：
- `[ ] 待实施`
- `[~] 部分已完成，需补齐/收敛`
- `[x] 已完成`

---

## 任务依赖总览（已按实施优先级重排）

```text
T1 runtime/bootstrap 闭环装配
  ↓
T2 最小观测与运维入口
  ↓
T3 配置与文档收敛
  ↓
T4 状态/命令边界收敛
  ↓
T5 验证与演示闭环
```

说明：
- 现有 `tx-sender / tx-listener / inbox-processor / task-router / state-store` 已具备基础能力。
- 当前主缺口是“装配入口 + 启动前置校验 + 状态可观测 + 失败边界落地”。
- 本任务单不再沿用旧 Phase 思维，不再把 `ws/x402/paymaster` 当作 v0.1 交付项。

---

## T1：runtime/bootstrap 闭环装配（实施起点）

### [x] T1.1 新增 Agent-Comm 运行时入口（必须）
- 目标文件：`src/skills/alphaos/runtime/agent-comm/runtime.ts`（或 `bootstrap.ts`）
- 任务描述：新增装配层，把已有模块接成运行闭环，而非新增协议/表结构。
- 最小接口：
  - `startAgentCommRuntime(...)`
  - 返回 `stop()` 与 `getSnapshot()`
- 验收标准：主程序可以一行调用启动/停止通信运行时。

### [x] T1.2 启动前置校验（必须）
- 目标文件：运行时入口 + `config.ts`（必要时）
- 校验要求（`COMM_ENABLED=true` 时）：
  - `COMM_LISTENER_MODE` 仅允许 `poll`（`ws` 直接报错）
  - `COMM_RPC_URL` 必填
  - `VAULT_MASTER_PASSWORD` 必填
  - vault 中必须存在 `COMM_WALLET_ALIAS` 私钥，并可恢复为有效钱包
  - RPC 链 ID 必须等于 `COMM_CHAIN_ID`
- 验收标准：所有前置缺失都在启动期显式失败，不进入监听循环后再隐式报错。

### [x] T1.3 inbound 主链路与状态流转落地（必须）
- 目标文件：运行时入口（复用 `tx-listener`、`inbox-processor`、`task-router`）
- 流程要求：
  1. listener 轮询交易
  2. inbox 校验 + 解密 + 去重 + 落库（`decrypted`）
  3. runtime 按消息状态判定是否执行
  4. router 成功 -> `executed`；失败 -> `rejected`
- 验收标准：`decrypted -> executed/rejected` 路径可真实触发。

### [x] T1.4 失败边界落地（必须）
- 目标文件：运行时入口
- 规则要求：
  - 落库前失败（recipient/trusted peer/pubkey/envelope/decrypt 等）：
    - 只记录日志 + runtime 最近错误
    - 不写 synthetic message
  - 落库后失败（非白名单/参数非法/执行失败）：
    - 更新既有消息 `error`
    - 状态置为 `rejected`
- 验收标准：失败位置与持久化行为严格符合 `DESIGN.md` 6.5。

### [x] T1.5 outbound 状态最小承诺核对（必须）
- 目标文件：`tx-sender.ts` + 发送调用点
- 规则要求：outbound 仅承诺 `sent/failed`；与当前落库行为保持一致。
- 验收标准：不会引入 `confirmed/received` 等 v0.1 未承诺状态依赖。

### [x] T1.6 接入主程序生命周期（必须）
- 目标文件：`src/index.ts`
- 任务描述：
  - `createAlphaOsSkill()` 后自动启动 comm runtime（当 `COMM_ENABLED=true`）
  - `SIGINT/SIGTERM` 时统一 stop（engine/discovery/server/comm）
- 验收标准：主程序启动即可进入监听闭环，退出时可优雅释放。

---

## T2：最小观测与运维入口

### [x] T2.1 runtime snapshot 查询（必须）
- 目标：暴露最小快照（内部方法或 API）
- 至少包含：
  - `enabled`
  - `chainId`
  - `listenerMode`
  - `walletAlias`
  - `localAddress`
  - `localPubkey`
  - `lastCursor`
  - `lastRuntimeError`
- 验收标准：不新增数据库表，仅复用运行时内存状态 + `listener_cursors`。

### [x] T2.2 最小状态查询（必须）
- 目标：可查询最近消息、trusted peers、cursor
- 建议复用现有 API 层新增最小端点（避免新建重型 service/presenter）
- 验收标准：可快速定位问题卡在发送、监听、解密还是路由阶段。

### [x] T2.3 最小 peer 运维动作（应做）
- 目标：提供 trusted peer 注册/更新入口（API/CLI 任一）
- 字段最小集：`peerId`、`walletAddress`、`pubkey`、`status=trusted`
- 验收标准：两端可完成一次可信 peer 建立并进入通信闭环。

---

## T3：配置与文档收敛

### [x] T3.1 收敛 `.env.example`
- 任务描述：补齐 v0.1 实际使用的 `COMM_*`，并标注非承诺项。
- 必须包含：
  - `COMM_ENABLED`
  - `COMM_CHAIN_ID`
  - `COMM_RPC_URL`
  - `COMM_LISTENER_MODE`
  - `COMM_POLL_INTERVAL_MS`
  - `COMM_WALLET_ALIAS`
- 必须明确：
  - `COMM_LISTENER_MODE` 仅支持 `disabled|poll`
  - `COMM_ENABLED=true` 时需 `VAULT_MASTER_PASSWORD`
  - `COMM_PAYMASTER_URL`、`X402_MODE` 非 v0.1 验收项

### [x] T3.2 收敛 `loadConfig()` 错误信息
- 目标文件：`src/skills/alphaos/runtime/config.ts`
- 任务描述：把明显非法组合提前报错（尤其 `COMM_LISTENER_MODE=ws`）。
- 验收标准：错误信息可直接指导修复。

### [x] T3.3 收敛 README/文档对外承诺
- 目标文件：`README.md`（必要时补 docs）
- 任务描述：补通信启动、钱包前置、最小观测入口说明；去除误导性能力承诺。
- 验收标准：文档与实际可运行能力一致。

---

## T4：状态与命令边界收敛

### [x] T4.1 白名单命令承诺收敛（必须）
- 目标文件：`task-router.ts`、相关文档/测试
- v0.1 承诺命令：
  - `ping`
  - `start_discovery`
  - `get_discovery_report`
  - `approve_candidate`
- 对 `probe_onchainos`、`request_mode_change`：
  - 允许解析
  - 路由阶段结构化拒绝
  - 状态写 `rejected`

### [~] T4.2 状态子集收敛（必须）
- 目标文件：`types.ts`、运行逻辑、测试
- v0.1 真实可达状态：
  - outbound: `sent|failed`
  - inbound: `decrypted|executed|rejected`
- 验收标准：文档、代码、测试三者一致，不误导为全状态机已落地。
- 当前进展：运行时流转已按该子集执行；`types.ts` 仍保留扩展状态常量，待进一步收敛说明。

### [ ] T4.3 x402 保留但降级（应做）
- 目标文件：`x402-adapter.ts`、文档
- 任务描述：明确其为预留接口，不进入 v0.1 主链路/验收。
- 验收标准：不再造成“已支持真实支付闭环”的误解。

---

## T5：验证与演示闭环

### [x] T5.1 增加 runtime 装配与失败边界测试（必须）
- 测试覆盖：
  - `COMM_ENABLED=true` 缺 `COMM_RPC_URL`
  - `COMM_LISTENER_MODE=ws`
  - 缺 `VAULT_MASTER_PASSWORD`
  - 缺通信钱包 alias
  - RPC 链 ID 不匹配
- 验收标准：全部为启动期显式错误。

### [x] T5.2 增加 inbound/outbound 状态流转测试（必须）
- 测试覆盖：
  - outbound `sent/failed`
  - inbound `decrypted -> executed/rejected`
  - 已 `executed/rejected` 的消息重扫不重复执行
  - 落库前失败不写 message；落库后失败写 `rejected + error`
- 验收标准：核心状态与失败边界可自动化验证。

### [ ] T5.3 最小闭环演示说明（应做）
- 形式：`docs/AGENT_COMM_DEMO.md` 或脚本
- 内容：
  1. 初始化通信钱包
  2. 注册 trusted peer
  3. 启动 listener
  4. 发送命令
  5. 查看 snapshot/messages/cursor
- 验收标准：他人按步骤可复现闭环。

---

## 当前实施顺序（本轮执行）

1. `T1.1 ~ T1.6` runtime/bootstrap 与主程序接线  
2. `T2.1 ~ T2.2` 最小观测入口  
3. 每完成一小步执行 `npm run build` / 相关测试  
4. 再推进 `T3+T5` 收尾

---

## v0.1 完成定义（验收门槛）

以下条件全部满足才算完成：

1. 主程序可在 `COMM_ENABLED=true + poll` 下自动启动通信闭环  
2. 启动期强校验覆盖 RPC、链 ID、`VAULT_MASTER_PASSWORD`、通信钱包 alias  
3. 仅使用 `agent_peers`、`agent_messages`、`listener_cursors` 三表  
4. inbound 实现 `decrypted -> executed/rejected`，outbound 实现 `sent/failed`  
5. 非白名单命令为结构化拒绝（非静默忽略）  
6. 可查询 runtime snapshot、最近消息、cursor、trusted peers  
7. `ws/x402/paymaster/多链/回执系统` 不纳入 v0.1 验收
