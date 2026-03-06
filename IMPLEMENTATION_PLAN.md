# AI Agent 链上通信功能实施计划

## 0. 目标与边界

本文基于当前仓库的实际结构，为 `REQUIREMENT.md` 中提出的“AI Agent 链上通信架构”制定落地计划。目标不是重写 AlphaOS，而是在现有 `scan -> evaluate -> plan -> simulate -> execute -> record -> notify` 运行时上，新增一层可复用的链上通信与唤醒能力。

核心原则：

- 复用现有 `VaultService`、`StateStore`、`OnchainOsClient`、`AlphaEngine`、`DiscoveryEngine`。
- 新能力统一放在 `src/skills/alphaos/runtime/` 下，避免在根目录散落新逻辑。
- 优先完成黑客松可演示闭环，再补全 x402 标准化与生产级可靠性。
- 将“RPC Hook”实现为链上监听器/交易轮询器，不与现有 OpenClaw HTTP hook 混淆。

当前建议的增量能力：

1. 为每个 Agent 生成并托管一个通信/影子钱包。
2. 用 secp256k1 + ECDH 派生共享密钥，对任务载荷做加密封装。
3. 通过 0 ETH calldata 交易发送加密消息。
4. 在接收端监听通信钱包相关交易，解密并路由为 AlphaOS 内部任务。
5. 将 x402 作为“支付 + 鉴权”层，先做可插拔适配，再逐步接入真实校验。

## 1. 项目结构分析

### 1.1 当前仓库结构

当前项目是单包 TypeScript 服务，核心目录如下：

| 路径 | 当前职责 | 与本需求的关系 |
| --- | --- | --- |
| `src/index.ts` | 进程入口、CLI、启动 HTTP 服务 | 需要增加通信服务启动和密钥初始化命令 |
| `src/skills/alphaos/skill.ts` | 装配运行时依赖并返回 skill 实例 | 是新增通信子系统的最佳挂载点 |
| `src/skills/alphaos/types.ts` | 全局领域类型定义 | 需要扩展消息、Peer、x402、监听事件类型 |
| `src/skills/alphaos/engine/alpha-engine.ts` | 主执行编排、门控、降级、交易执行 | 需要暴露远程任务入口或由通信路由器调用 |
| `src/skills/alphaos/api/server.ts` | Demo/UI/API 聚合入口 | 需要增加通信状态、Peer 管理、消息发送/重放接口 |
| `src/skills/alphaos/runtime/config.ts` | 环境变量读取 | 需要增加钱包、RPC、paymaster、x402 等配置 |
| `src/skills/alphaos/runtime/state-store.ts` | SQLite 业务状态、迁移、报表 | 需要新增通信会话、消息、回执、Peer、监听游标等表 |
| `src/skills/alphaos/runtime/vault.ts` | AES-256-GCM 密钥托管 | 可直接托管通信钱包私钥和共享配置 |
| `src/skills/alphaos/runtime/onchainos-client.ts` | OnchainOS 接入与链路探测 | 需扩展为支持 0 ETH calldata 发信与交易拉取 |
| `src/skills/alphaos/runtime/notifier.ts` | OpenClaw hook 推送 | 需增加通信相关事件通知 |
| `src/skills/alphaos/runtime/discovery/*` | 发现式策略会话、审批执行、报告 | 可作为链上消息唤醒后的首批任务类型 |
| `tests/*.test.ts` | 单元/接口测试 | 需要新增通信与加密测试矩阵 |

### 1.2 当前已有可复用能力

当前仓库已经具备 5 个非常关键的基础设施，这决定了新功能应当以“增量接线”为主：

1. 状态持久化已经成型  
   `StateStore` 已负责 SQLite migration、机会、交易、hook outbox、discovery session/report 等多类状态管理。通信能力可以沿用同一数据层。

2. 安全存储已经成型  
   `VaultService` 目前用 AES-256-GCM + PBKDF2 托管密钥，可直接保存通信钱包私钥，不需要再引入第二套 secret store。

3. 执行引擎已经成型  
   `AlphaEngine` 已处理风控、模拟、降级、执行与记录。链上消息应触发“引擎已有能力”，而不是复制一套执行逻辑。

4. 外部唤醒/回调模式已经成型  
   目前的 OpenClaw discovery 流程本质上就是“外部发起 -> AlphaOS 执行 -> 回调结果”。新功能可复用这种事件驱动思路，只是把触发源从 HTTP/API 扩展到链上交易。

5. Demo/评审接口已经成型  
   当前已有 `/demo`、SSE、growth share、discovery report 等展示能力，适合快速接入链上通信观测面板。

### 1.3 当前缺口

围绕 `REQUIREMENT.md`，现有项目仍缺少以下能力：

| 能力缺口 | 当前状态 | 落地影响 |
| --- | --- | --- |
| 通信钱包生命周期管理 | 无 | 无法生成/轮换影子钱包 |
| secp256k1/ECDH 消息加密 | 无 | 无法完成 agent-to-agent 加密通信 |
| calldata 编解码 | 无 | 无法把任务载荷打包进链上交易 |
| 链上监听/收件箱 | 无 | 无法基于通信钱包实现 Hook 唤醒 |
| x402 支付/鉴权 | 无 | 无法实现“通信即支付，指令即鉴权” |
| Peer 信任关系与公钥发现 | 无 | 无法安全地识别消息发送方 |
| 消息去重、重放保护、nonce | 无 | 容易被重复消息或旧消息污染 |
| 适配原始链交易发送能力 | 现有 `OnchainOsClient` 更偏 quote/swap/simulate | 0 ETH calldata 发信需要额外链路 |

### 1.4 结构层面的扩展建议

建议在现有 `runtime/` 下新增一个独立子域：

`src/skills/alphaos/runtime/agent-comm/`

原因：

- 与 `runtime/discovery/` 一样，形成可维护的子系统边界。
- 避免把通信、加密、监听逻辑堆进 `onchainos-client.ts` 单文件。
- 后续若要把这套能力升级为独立 skill，也更容易抽离。

### 1.5 技术约束与新增依赖建议

当前 `package.json` 只有 `express`、`better-sqlite3`、`dotenv`、`pino`，缺少 EVM 钱包/加密基础库。建议新增：

| 依赖 | 用途 |
| --- | --- |
| `viem` 或 `ethers` | 钱包、签名、交易编码、RPC 读写 |
| `@noble/secp256k1` | secp256k1 ECDH、轻量密码学操作 |
| `@scure/base` 或同类库 | calldata/二进制安全编码 |
| `zod` 或同类校验库 | 对链上解密后的命令做 schema 校验 |

推荐优先选 `viem + @noble/secp256k1`，原因是体积较轻、原始 RPC 和编码能力更清晰，适合黑客松快速迭代。

## 2. 新增模块清单

以下模块建议全部新增在现有结构内，保持命名与仓库风格一致。

### 2.1 核心运行时模块

| 建议文件 | 职责 | MVP 必需 |
| --- | --- | --- |
| `src/skills/alphaos/runtime/agent-comm/types.ts` | 定义消息信封、Peer、会话、x402、回执、命令 payload 类型 | 是 |
| `src/skills/alphaos/runtime/agent-comm/shadow-wallet.ts` | 生成通信钱包、导出地址、公钥、轮换与恢复 | 是 |
| `src/skills/alphaos/runtime/agent-comm/ecdh-crypto.ts` | secp256k1 ECDH、密钥派生、AES-256-GCM 加解密 | 是 |
| `src/skills/alphaos/runtime/agent-comm/calldata-codec.ts` | 消息 envelope 编码/解码、版本头、压缩与长度限制 | 是 |
| `src/skills/alphaos/runtime/agent-comm/peer-registry.ts` | 保存对端 Agent 标识、公钥、钱包地址、信任状态 | 是 |
| `src/skills/alphaos/runtime/agent-comm/message-store.ts` | 作为 `StateStore` 的薄封装，处理消息入箱/出箱/状态流转 | 是 |
| `src/skills/alphaos/runtime/agent-comm/tx-sender.ts` | 构造 0 ETH calldata 发信交易，支持 paymaster/普通发送 | 是 |
| `src/skills/alphaos/runtime/agent-comm/tx-listener.ts` | 监听通信钱包相关交易，支持轮询或 WebSocket 模式 | 是 |
| `src/skills/alphaos/runtime/agent-comm/inbox-processor.ts` | 解析交易、去重、防重放、ECDH 解密、落库 | 是 |
| `src/skills/alphaos/runtime/agent-comm/task-router.ts` | 将解密后的命令路由到 `DiscoveryEngine`、`AlphaEngine`、`OnchainOsClient` | 是 |
| `src/skills/alphaos/runtime/agent-comm/x402-adapter.ts` | x402 请求/回执抽象、签名验证、支付元数据适配 | 否，Phase 2 必需 |
| `src/skills/alphaos/runtime/agent-comm/agent-comm-service.ts` | 装配发信、监听、入箱处理与状态查询 | 是 |

### 2.2 API 与展示辅助模块

| 建议文件 | 职责 | MVP 必需 |
| --- | --- | --- |
| `src/skills/alphaos/api/agent-comm-presenters.ts` | 将内部消息/Peer/会话数据格式化给 API 和 demo 页面 | 否 |
| `src/skills/alphaos/api/agent-comm-demo.ts` | 输出 demo 页所需的链上通信摘要数据 | 否 |

如果不想增加 API 文件数，也可以先把路由直接写入现有 `api/server.ts`，但建议把格式化逻辑拆出去，避免 `server.ts` 继续膨胀。

### 2.3 测试文件

| 建议文件 | 覆盖点 |
| --- | --- |
| `tests/agent-comm-crypto.test.ts` | ECDH、密钥派生、AES 加解密正确性 |
| `tests/agent-comm-codec.test.ts` | calldata envelope 编解码、版本兼容、长度边界 |
| `tests/agent-comm-store.test.ts` | Peer、消息、回执、listener cursor 落库 |
| `tests/agent-comm-listener.test.ts` | 交易监听、去重、防重放、确认状态切换 |
| `tests/agent-comm-router.test.ts` | 解密后任务路由到 discovery / engine / probe |
| `tests/agent-comm-api.test.ts` | Peer 注册、消息发送、状态查看、鉴权 |
| `tests/agent-comm-x402.test.ts` | x402 元数据校验与失败分支 |

### 2.4 文档与脚本

| 建议文件 | 职责 |
| --- | --- |
| `docs/AGENT_COMM_ARCHITECTURE.md` | 正式架构说明、交易流、密钥流、信任模型 |
| `docs/HACKATHON_AGENT_COMM_DEMO.md` | 黑客松演示步骤与口播脚本 |
| `scripts/agent-comm-demo.sh` | 一键演示 A/B Agent 发信、收信、唤醒 |

## 3. 现有模块修改点

以下是需要修改的现有文件及建议改动。

### 3.1 入口与装配层

| 文件 | 需要修改的内容 | 目的 |
| --- | --- | --- |
| `src/index.ts` | 新增 `comm:init-wallet`、`comm:send-test`、`comm:show-peer` 等 CLI；启动 `AgentCommService`；在 shutdown 中关闭 listener | 让通信能力具备可运维入口 |
| `src/skills/alphaos/skill.ts` | 装配 `AgentCommService`、`PeerRegistry`、`TaskRouter` 并暴露到 API 层 | 让通信成为 skill runtime 的一部分 |

### 3.2 类型与配置层

| 文件 | 需要修改的内容 | 目的 |
| --- | --- | --- |
| `src/skills/alphaos/types.ts` | 新增 `AgentPeer`、`AgentMessage`、`EncryptedEnvelope`、`AgentCommand`、`X402Proof`、`ListenerCursor`、`CommStatus` 等类型 | 避免通信类型散落在各文件 |
| `src/skills/alphaos/runtime/config.ts` | 新增通信相关 env：`COMM_ENABLED`、`COMM_CHAIN_ID`、`COMM_RPC_URL`、`COMM_LISTENER_MODE`、`COMM_POLL_INTERVAL_MS`、`COMM_WALLET_ALIAS`、`COMM_PAYMASTER_URL`、`X402_MODE` 等 | 统一配置来源 |

### 3.3 存储与安全层

| 文件 | 需要修改的内容 | 目的 |
| --- | --- | --- |
| `src/skills/alphaos/runtime/state-store.ts` | 增加表：`agent_peers`、`agent_messages`、`agent_message_receipts`、`agent_sessions`、`listener_cursors`、`x402_receipts`；增加 CRUD/query/index/migration | 建立通信账本与审计轨迹 |
| `src/skills/alphaos/runtime/vault.ts` | 支持按 alias 托管通信钱包私钥；可补 `hasSecret()`、`rotateSecret()` 辅助方法 | 复用现有密钥存储能力 |

建议新增的数据表字段：

- `agent_peers`: `peer_id`, `name`, `wallet_address`, `pubkey`, `status`, `capabilities_json`, `created_at`, `updated_at`
- `agent_messages`: `id`, `direction`, `peer_id`, `tx_hash`, `nonce`, `command_type`, `ciphertext`, `status`, `sent_at`, `received_at`, `executed_at`, `error`
- `agent_message_receipts`: `message_id`, `receipt_type`, `payload_json`, `created_at`
- `agent_sessions`: `id`, `peer_id`, `shared_key_hint`, `last_nonce`, `last_tx_hash`, `updated_at`
- `listener_cursors`: `address`, `chain_id`, `cursor`, `updated_at`
- `x402_receipts`: `id`, `message_id`, `payer`, `amount`, `asset`, `proof_json`, `verified`, `created_at`

### 3.4 链交互与任务执行层

| 文件 | 需要修改的内容 | 目的 |
| --- | --- | --- |
| `src/skills/alphaos/runtime/onchainos-client.ts` | 增加“原始交易发送/查询”能力，或封装一个底层 EVM 客户端；支持 paymaster/private submit；支持按钱包查询近期交易 | 让通信交易可真正上链 |
| `src/skills/alphaos/engine/alpha-engine.ts` | 增加可安全暴露给任务路由器的受控方法，如 `requestMode`、`executeApprovedCandidate` 的更清晰包装 | 让远程任务只调用受控动作 |
| `src/skills/alphaos/runtime/discovery/discovery-engine.ts` | 为链上消息触发场景补一个更稳定的 API，例如 `startSessionFromRemoteCommand()` | 让 discovery 成为首批可远程调用功能 |
| `src/skills/alphaos/runtime/notifier.ts` | 增加 `comm_message_received`、`comm_message_sent`、`comm_task_executed`、`x402_verified`、`x402_rejected` 等事件 | 在 Demo 和排障时可观测 |

### 3.5 API 与 Demo 层

| 文件 | 需要修改的内容 | 目的 |
| --- | --- | --- |
| `src/skills/alphaos/api/server.ts` | 新增通信接口、Peer 管理接口、消息列表、手工重放/重试接口、demo 状态接口；更新 `/demo` 页面显示“通信钱包、最近消息、支付验证、唤醒状态” | 支持黑客松展示和调试 |
| `README.md` | 增加链上通信功能说明、依赖、启动步骤、演示方法 | 降低接手成本 |
| `docs/JUDGE_ONE_PAGER.md` | 增加“为什么链上通信而不是普通 HTTP webhook”的叙事补充 | 服务答辩 |

建议新增 API：

- `GET /api/v1/agent-comm/status`
- `GET /api/v1/agent-comm/wallet`
- `GET /api/v1/agent-comm/peers`
- `POST /api/v1/agent-comm/peers`
- `POST /api/v1/agent-comm/messages/send`
- `GET /api/v1/agent-comm/messages?limit=50`
- `POST /api/v1/agent-comm/messages/:messageId/replay`
- `POST /api/v1/agent-comm/test/ping`

### 3.6 测试层

现有测试结构已经按模块分文件，新增通信测试时建议延续同样风格：

- 单元测试覆盖密码学与 codec。
- 存储测试覆盖 SQLite migration 和查询。
- API 测试覆盖鉴权、输入校验、状态机流转。
- 端到端测试用 mock RPC/假交易 feed 验证“发信 -> 监听 -> 解密 -> 执行 -> 回执”。

## 4. 分阶段实施计划

以下分期兼顾黑客松时间与工程可控性，默认按 4 个阶段推进。

### Phase 0: 方案定稿与底座准备（0.5-1 天）

目标：

- 定义消息协议、命令集、Peer 模型和信任边界。
- 决定底层链工具库（推荐 `viem`）。
- 明确 MVP 不做什么，避免过早扩展。

任务：

1. 确认 envelope 格式  
   建议字段：`version`, `senderPeerId`, `senderPubkey`, `recipient`, `nonce`, `timestamp`, `command`, `x402`, `ciphertext`, `signature`.

2. 明确远程任务白名单  
   MVP 只允许：
   - `ping`
   - `probe_onchainos`
   - `start_discovery`
   - `get_discovery_report`
   - `approve_candidate`
   - `request_mode_change`

3. 定义消息大小约束  
   避免 calldata 过长，MVP 可限制在 `2KB-4KB` 以内。

4. 设计数据库迁移  
   先只建通信核心表，不一次性把所有分析表补满。

交付物：

- 协议草案
- 新增依赖
- 状态表设计

验收标准：

- 项目可编译
- 类型定义与表结构冻结
- 团队对 Demo 流程达成一致

### Phase 1: 安全通信 MVP（1-2 天）

目标：

- 让 Agent A 能向 Agent B 的通信钱包发送加密任务。
- Agent B 能监听、解密、验签并记录消息。

实现重点：

1. 通信钱包初始化  
   - 通过 CLI 生成 secp256k1 私钥并存入 vault
   - 导出地址、公钥和 wallet alias

2. ECDH + AES 加密  
   - 使用 A 私钥与 B 公钥派生共享密钥
   - 对命令 payload 做对称加密
   - 对 envelope 做签名或完整性校验

3. calldata 发信  
   - 构造 0 ETH 交易
   - 把 envelope 编码进 `data`
   - 记录本地出箱状态

4. 链上监听  
   - 轮询模式优先，WebSocket 作为增强项
   - 只监听通信钱包相关入站交易
   - 保存 listener cursor，保证重启可恢复

5. 入箱处理  
   - 解析 envelope
   - 验证时间戳和 nonce
   - 去重、防重放
   - 成功解密后落库

交付物：

- `agent-comm` 运行时主体
- Peer 注册与测试发信 API
- 消息历史查询 API

验收标准：

- 两个本地 Agent 进程可完成 `send -> chain tx -> receive -> decrypt -> store`
- 重启服务后监听不丢游标
- 同一消息重复上链不会被重复执行

### Phase 2: Hook 唤醒与任务执行 MVP（1-2 天）

目标：

- 解密后的消息能够真实触发 AlphaOS 行为。
- 形成“通信即唤醒”的可演示闭环。

实现重点：

1. 任务路由器  
   将命令映射到现有能力：
   - `probe_onchainos` -> `OnchainOsClient.probeConnection`
   - `start_discovery` -> `DiscoveryEngine.startSession`
   - `approve_candidate` -> `DiscoveryEngine.approveCandidate`
   - `request_mode_change` -> `AlphaEngine.requestMode`

2. 安全白名单  
   - 只允许白名单命令
   - 对参数做 schema 校验
   - 高风险命令必须带 `x402` 或本地 allowlist

3. 回执与通知  
   - 执行成功/失败都写入 message receipt
   - 通过 `OpenClawNotifier` 发出通信事件
   - Demo 页展示最近一次唤醒结果

交付物：

- `task-router.ts`
- 执行回执与消息状态机
- Demo 页面通信状态卡片

验收标准：

- 链上消息可远程启动 discovery session
- 链上消息可远程触发 probe 或模式切换
- 执行结果可被发送端查询

### Phase 3: x402 支付与鉴权层（1-2 天）

目标：

- 把“任务请求”升级为“带支付/权限证明的任务请求”。
- 给黑客松叙事补齐“通信即支付，指令即鉴权”。

实现重点：

1. 抽象 x402 适配层  
   不在主流程写死具体供应商，统一用 `x402-adapter.ts` 封装：
   - proof 提取
   - 金额/资产校验
   - 发送方与支付方关联
   - 验签/有效期验证

2. 命令权限分层  
   - 免费：`ping`, `probe_onchainos`
   - 低付费：`start_discovery`
   - 高付费：`approve_candidate`, `request_mode_change`

3. 失败分支  
   - 缺失 proof
   - proof 过期
   - 金额不足
   - payer 与 sender 不一致
   - proof 通过但执行失败

4. 回执链路  
   - 将支付验证结果写入 `x402_receipts`
   - 将验证状态回传给发送方

交付物：

- x402 校验与回执模块
- 命令级鉴权策略
- Demo 中的支付验证面板

验收标准：

- 未携带 proof 的付费命令会被拒绝
- proof 合法时命令可继续执行
- 支付验证状态可查询、可展示

### Phase 4: 黑客松演示增强与生产级加固（1 天）

目标：

- 强化可讲述性、稳定性和排障能力。

实现重点：

1. Demo 脚本  
   `A 发起消息 -> B 收到链上交易 -> B 解密 -> B 启动 discovery/probe -> B 返回结果`

2. 监控与观测  
   - `/api/v1/agent-comm/status`
   - listener lag
   - 最近失败原因
   - 最近成功支付与任务

3. 安全加固  
   - nonce 窗口
   - timestamp drift 限制
   - peer allowlist
   - 限频/限速
   - 大 payload 拒绝

4. 失败降级  
   - 监听失败时切换轮询
   - x402 服务不可用时只允许免费命令
   - paymaster 不可用时降级普通 RPC 发信

交付物：

- 一键 demo 脚本
- 评审展示版 `/demo`
- 端到端 smoke test

验收标准：

- Demo 环节不依赖手工改库
- 常见异常可在 UI 或日志中快速定位
- 服务重启后能自动恢复监听

## 5. 推荐实施顺序

如果资源有限，建议按下面优先级落地：

1. `shadow-wallet` + `ecdh-crypto` + `calldata-codec`
2. `state-store` 扩表 + `peer-registry`
3. `tx-sender` + `tx-listener`
4. `inbox-processor` + `task-router`
5. `server.ts` 新接口 + `/demo` 展示
6. `x402-adapter`
7. `scripts/agent-comm-demo.sh` + 完整 smoke test

理由：

- 前四步先把最小闭环做出来。
- API/UI 是展示层，放在链路可用之后接入更稳。
- x402 是叙事放大器，不应阻塞基础通信闭环。

## 6. 风险与规避建议

### 6.1 主要风险

| 风险 | 描述 | 规避策略 |
| --- | --- | --- |
| 原始交易发送链路与现有 OnchainOS client 不匹配 | 当前 client 偏聚合交易，不是通用钱包发送器 | 将原始 EVM 发信抽到 `tx-sender.ts`，必要时独立于 `OnchainOsClient` |
| x402 规范实现复杂度高 | 标准细节、proof 格式、验签方式可能超出黑客松周期 | Phase 2 先做 adapter/mock proof，Phase 3 再接真实 provider |
| calldata 体积过大 | 复杂任务参数可能超出合理上链范围 | 只上传最小 command envelope，大对象改为链下 URI 或摘要 |
| 消息重放与伪造 | 若 nonce/签名/时间戳验证不严，容易被重放 | 设计严格的 nonce + timestamp + signature 校验链 |
| 链上监听不稳定 | WebSocket 或 RPC 可能漏事件 | 默认轮询 + cursor 持久化 + 补拉区块范围 |
| Demo 环境权限不足 | paymaster、白名单、RPC 权限不完整 | 提前准备 mock 模式与本地双实例演示预案 |

### 6.2 MVP 非目标

以下内容不建议在第一版投入过多时间：

- 多链并行监听
- 群聊/广播型 Agent 通信
- 超复杂工作流编排 DSL
- 完整 DID/去中心化身份系统
- 生产级密钥轮换后台

## 7. Pitch Deck 大纲

建议控制在 10 页左右，突出“为什么这不是普通 webhook，而是链上原生 AI 协作协议”。

### Slide 1: 标题页

- 标题：`AlphaOS Agent Comm Layer`
- 副标题：`通信即支付，指令即鉴权`
- 一句话：基于 OnchainOS/X Layer 的 AI Agent 链上唤醒与协作层

### Slide 2: 问题定义

- 今天的 AI Agent 大多靠中心化 webhook/数据库/队列互相调用
- 无统一支付、无统一鉴权、无统一审计
- 对链上原生 Agent 来说，这不是可信通信

### Slide 3: 核心洞察

- 公链不是只用来结算资产，也可以用来结算“任务意图”
- 一笔 0 ETH calldata 交易既是消息载体，也是时间戳与审计证据
- 加上 x402 后，任务调用天然具备支付与权限语义

### Slide 4: 解决方案

- 双钱包架构：主钱包管资产，通信钱包管消息
- secp256k1 ECDH 加密：只有收件 Agent 能解密任务
- RPC Hook/Listener：监听通信钱包并自动唤醒 AI

### Slide 5: 系统架构图

- Agent A
- Peer Registry
- x402 proof
- 0 ETH calldata tx
- X Layer / OnchainOS / Paymaster
- Agent B listener
- AlphaOS task router
- Discovery / Engine / Probe / Execute

### Slide 6: Demo 流程

- A 向 B 发送加密 discovery 指令
- B 监听到交易并解密
- B 自动启动 discovery 或执行审批
- B 回传执行回执
- 全程有链上证据、支付证明、执行日志

### Slide 7: 为什么比普通 webhook 强

- 可审计：消息天然上链留痕
- 可支付：任务调用和微支付是同一笔意图
- 可鉴权：发送者身份与签名绑定
- 可组合：任何 Agent 都能按统一 envelope 接入

### Slide 8: 安全与边界

- 主钱包和通信钱包隔离
- 指令默认加密
- nonce/timestamp 防重放
- 公链延迟对复杂 AI 任务是可接受的
- 当前先用中心化 RPC，未来可切去中心化 RPC

### Slide 9: 黑客松价值

- 对评委：展示“AI Agent 原生链上协作”而非单点套利
- 对 OnchainOS：证明其不仅是执行底座，也能成为 Agent 通信底座
- 对生态：把支付、调用、审计、自动执行连成闭环

### Slide 10: Roadmap

- MVP：加密消息 + 监听唤醒 + discovery 任务
- Next：x402 标准化、支付等级权限
- Later：多 Agent 网络、去中心化 RPC、跨链通信

## 8. 建议的首个可演示场景

为了确保黑客松演示稳定，建议优先做下面这个单场景闭环：

1. Agent A 注册 Agent B 为 Peer。
2. Agent A 发送 `start_discovery` 加密消息到 Agent B 通信钱包。
3. Agent B 监听到交易并解密。
4. Agent B 调用现有 `DiscoveryEngine.startSession()`。
5. Agent B 在 UI 上显示“链上消息已唤醒 discovery”。
6. Agent B 生成 report，并通过 API/回执返回给 Agent A。

这个场景复用现有代码最多，讲故事最顺，也最容易在黑客松时间内做成稳定 demo。
