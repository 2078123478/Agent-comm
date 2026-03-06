# AlphaOS Agent-Comm Requirement（重写版）

版本日期：2026-03-06  
定位：基于当前仓库“已实现事实”重定义下一阶段 requirement。

## 1. 背景与目标

当前通信功能的核心问题不是“再设计一套完整协议”，而是让 AlphaOS 具备可验证的最小链上通信闭环：

- Agent A 能发送加密命令到 Agent B 的通信地址（0 ETH calldata）。
- Agent B 能监听、解密、校验信任关系、去重并落库。
- 对可执行命令，能路由到现有 Discovery 能力并返回统一结果。

本版 requirement 服务于“两层目标”：

- 第一层（当前必须达成）：黑客松可演示闭环 + 本地可复现。
- 第二层（可继续演进）：最小可复用基础，而不是一次性产品化全能力。

## 2. 当前事实盘点

以下均基于 `src/skills/alphaos/runtime/*`、`tests/agent-comm.test.ts`、`tests/state-store.test.ts` 当前代码。

### 2.1 已实现能力

- 协议与类型：`types.ts` 已提供命令、Envelope、Peer、Message、Cursor、x402 相关 Zod schema。
- 配置项：`config.ts` 已加入 `COMM_*` 与 `X402_MODE` 字段读取与校验。
- 持久化：`state-store.ts` 已落地 `agent_peers`、`agent_messages`、`listener_cursors` 三表与 CRUD。
- 防重放基础：`agent_messages` 已有 `UNIQUE(peer_id, direction, nonce)`，并有迁移兼容逻辑。
- 密钥与加密：`shadow-wallet.ts`、`ecdh-crypto.ts`、`calldata-codec.ts` 已可用于钱包、公钥、ECDH、AES-GCM、Envelope 编解码。
- 发送链路：`tx-sender.ts` 已支持普通 0 ETH calldata 发送并可落 outbound 消息状态。
- 监听链路：`tx-listener.ts` 已支持 poll 模式按区块扫描并持久化 cursor。
- 入箱处理：`inbox-processor.ts` 已实现收件地址校验、trusted peer 校验、发件钱包/公钥校验、解密、去重落库。
- 任务路由：`task-router.ts` 已支持 `ping`、`start_discovery`、`get_discovery_report`、`approve_candidate`。
- 测试事实：`tests/agent-comm.test.ts` 与 `tests/state-store.test.ts` 可通过，覆盖 codec/监听过滤/存储迁移与去重。

### 2.2 部分实现或能力不完整

- `types.ts` 声明了 `probe_onchainos`、`request_mode_change`，但 `task-router.ts` 当前不支持。
- 配置允许 `COMM_LISTENER_MODE=ws`，但 `tx-listener.ts` 仅支持 `poll`。
- `x402-adapter.ts` 仅做结构性字段检查，未做真实签名真实性验证，也未接入执行主流程。
- Envelope 含 `signature` 字段，但发送/接收主链路未完成签名生成与验签闭环。
- 消息状态枚举较完整（`confirmed/received/executed/rejected` 等），但当前链路主要使用 `pending/sent/failed/decrypted`。
- `COMM_PAYMASTER_URL` 已配置化，但发送模块未使用 paymaster 路径。

### 2.3 仅在设计/计划文档存在、未真正落地

- `agent-comm-service.ts`、`agent-comm-presenters.ts`、`agent-comm-demo.ts`、通信 API 路由、通信 CLI 命令均未落地。
- 主进程/Skill 装配层未接入 agent-comm 运行链路（当前模块主要是“库代码”状态）。
- `message-store.ts` 未落地。
- `x402_receipts`、`agent_sessions`、`agent_message_receipts` 在 `state-store` 中已明确移除，不是当前实现目标。

### 2.4 文档与现实不一致（需要在 requirement 中纠偏）

- `DESIGN.md` 将 `tx-sender/tx-listener/inbox-processor/task-router/x402-adapter` 标为待实现，但代码已存在。
- `TASK.md` 标记 Phase 3 已完成，但“x402 真正可执行闭环”与“路由命令覆盖”仍不完整。
- `IMPLEMENTATION_PLAN.md` 大量“待新增模块/API/CLI”尚未接线落地，且部分前置假设已过时（如依赖已加入）。

## 3. 复杂度与负担分析

### 3.1 当前偏重的复杂度

- 协议面偏重：类型层提前引入 receipt/session/x402 多类模型，但当前主链路未消费。
- 配置面偏重：`COMM_LISTENER_MODE=ws`、`COMM_PAYMASTER_URL`、`X402_MODE=observe/enforce` 已暴露，但运行链路未闭环。
- 状态机偏重：消息状态定义超出当前执行路径，带来“看起来完整、实际未用”的维护成本。
- 文档面偏重：设计/实施计划范围大于实际接线范围，影响用户判断“什么已经可用”。

### 3.2 复杂度来源是否服务当前目标

- 对“黑客松最小闭环”真正有价值的复杂度：ECDH + AES-GCM、trusted peer 校验、nonce 去重、cursor 断点续拉。这些应保留。
- 对当前阶段价值有限的复杂度：x402 enforce、ws 监听、paymaster 专用发送路径、全量命令覆盖、回执体系。应延后。

### 3.3 当前实现中合理但不应硬砍的模块

- `inbox-processor.ts` 的多重身份校验（地址、公钥、trusted 状态）是关键安全边界。
- `state-store.ts` 的去重约束与 legacy 迁移清理逻辑是稳定性底座。
- `tx-listener.ts` 的 cursor 机制是可恢复运行的必要条件。

## 4. 复用与配置门槛分析

对其他用户最难的不是“会不会写代码”，而是“如何正确跑起来”：

- 配置可见性不足：`.env.example` 未暴露 `COMM_*` 与 `X402_MODE`，上手路径不清晰。
- 配置语义不一致：允许 `ws` 模式但无实现；`COMM_ENABLED=true` 时没有强约束 `COMM_RPC_URL`。
- 钱包前置复杂：缺少通信钱包初始化、加载、Peer 注册的一体化启动流程（当前仅有通用 vault set/get）。
- 链上前置复杂：需自备可用 RPC、链 ID 对齐、通信钱包 gas 资金或替代机制，且 paymaster 配置目前无效。
- 接线缺口：模块未接入 `index.ts/skill.ts/api` 的实际运行路径，普通用户即使配置完成也难以触发全流程。

需要收敛的方向：

- 减少“已暴露但不可用”的配置项。
- 把必填前置条件变为启动时显式校验错误，而非运行期隐式失败。
- 提供默认可跑模式（单链 + poll + 无 x402）。

## 5. 新的 Requirement 建议（Must / Should / Won’t）

### Must（当前阶段必须）

- 必须交付“单链、poll 模式”的端到端闭环：`send -> listen -> decrypt -> dedupe -> store -> route(白名单)`。
- 必须保留并使用 `agent_peers`、`agent_messages`、`listener_cursors` 三表，不扩回 receipt/session/x402 表。
- 必须保留 trusted peer + 钱包地址 + 公钥三重校验，以及 `(peer_id, direction, nonce)` 去重约束。
- 必须将通信链路接入实际运行入口（至少包含启动监听与基本状态可观测），避免停留在库级代码。
- 必须定义并严格限制当前白名单命令（以 `ping/start_discovery/get_discovery_report/approve_candidate` 为主）。

### Should（建议保留，但可简化）

- 应将消息状态收敛为当前真实可达子集，其他状态标记为预留，不纳入当前验收。
- 应把 `COMM_ENABLED=true` 的必备项做强校验（如 `COMM_RPC_URL`、通信钱包密钥可读）。
- 应明确 `COMM_LISTENER_MODE` 当前仅支持 `disabled|poll`，`ws` 在 requirement 中降为未来扩展。
- 应保留 `x402` 类型与适配接口，但 requirement 不要求真实支付验签闭环。
- 应补最小运维入口：初始化通信钱包、注册 trusted peer、查看最近消息/cursor。

### Won’t（for now，当前不纳入 requirement）

- 不纳入真实 x402 验签与支付执行闭环（含收费策略、回执落库）。
- 不纳入 ws 监听、多链并行监听、自动故障切换。
- 不纳入 paymaster 专用发送链路与相关配置承诺。
- 不纳入全量远程命令（`probe_onchainos`、`request_mode_change`）的生产级执行。
- 不纳入复杂回执系统（message receipt/session/x402 receipt）与对应数据模型。

## 6. 推荐的 KISS 版本边界

KISS 版本建议定义为：`Agent-Comm v0.1（Hackathon Reusable Core）`

包含：

- 单链通信（`COMM_CHAIN_ID`）+ 单地址监听 + poll 模式。
- 0 ETH calldata 发信。
- ECDH + AES-GCM 加密与解密。
- trusted peer 校验、nonce 去重、cursor 断点续拉。
- 最小命令路由（白名单内命令）。
- 最小可观测状态（最近消息、监听 cursor、错误原因）。

不包含：

- x402 强校验与付费分层。
- ws/多链/paymaster。
- 大规模 API/展示层扩展与复杂回执模型。

为什么更适合当前阶段：

- 与现有代码重合度最高，补的是“接线与收敛”，不是再造系统。
- 配置面更小，能显著降低新用户复现门槛。
- 仍保留后续扩展接口，不阻断产品化演进。

## 7. 风险与取舍

如果简化：

- 损失：x402 叙事完整性、未来命令扩展的即插即用感、部分“看起来很完整”的状态机。
- 收益：可用性提升、配置失败率下降、真实闭环更快达成、维护边界更清晰。

如果不简化：

- 收益：文档层面保持“大而全”愿景。
- 成本：持续承担“配置项已开放但不可用”“模块已写但未接线”的认知成本，复用难度与排障成本高。

结论：

- 当前 requirement 应优先收敛为“黑客松最小闭环 + 最小可复用核心”，并把 x402/ws/paymaster 等能力降级为明确的后续阶段目标。
