# AlphaOS Agent-Comm 设计文档（v0.1）

版本日期：2026-03-06  
定位：基于最新 `REQUIREMENT.md` 与当前代码事实，收敛出一个可实施的 `Agent-Comm v0.1` 设计。

---

## 1. 设计目标

本设计只服务于一个最小闭环：

1. Agent A 向 Agent B 的通信地址发送一笔 `0 ETH calldata` 交易
2. Agent B 以 `poll` 模式监听单链、单地址交易
3. Agent B 完成 envelope 解码、trusted peer 校验、解密、去重、落库
4. Agent B 对白名单命令执行本地路由，并给出统一结构化结果
5. 系统可查看最近消息、cursor、最近错误与本机通信身份

这里的“统一结果”指本地运行时得到统一 `RouteResult`，并据此更新消息状态与日志；`v0.1` **不要求把执行结果回传给发送方**。

---

## 2. v0.1 边界

### 2.1 本版必须覆盖

- 单链：只围绕一个 `COMM_CHAIN_ID` 工作
- 单地址：只监听当前通信钱包地址
- 单监听模式：只支持 `poll`
- 最小白名单命令：
  - `ping`
  - `start_discovery`
  - `get_discovery_report`
  - `approve_candidate`
- 最小可观测：
  - 本机通信地址 / 公钥
  - listener cursor
  - 最近消息
  - 最近错误
  - trusted peers

### 2.2 本版明确不纳入

- `ws` 监听
- 多链并行监听
- paymaster 发送链路
- x402 真实支付 / 验签闭环
- envelope 签名真实性校验闭环
- 远程命令全量支持（`probe_onchainos`、`request_mode_change`）
- receipt / session / x402 receipt 等扩展账本
- 专门的 `agent-comm-service.ts`、`presenters`、demo 页面体系
- 向发送方回传执行结果的回执链路

结论：`v0.1` 的重点不是“补全协议愿景”，而是把现有模块接成一个真实可跑的最小闭环。

---

## 3. 架构与模块边界

### 3.1 总体结构

```text
Sender Agent
  ├─ PeerRegistry
  ├─ ShadowWallet
  ├─ ECDH + AES-GCM
  ├─ CalldataCodec
  └─ TxSender
          │
          ▼
   0 ETH calldata transaction
          │
          ▼
Receiver Agent
  ├─ AgentCommRuntime   <-- v0.1 仅新增的装配入口
  │   ├─ config / wallet bootstrap
  │   ├─ TxListener (poll only)
  │   ├─ InboxProcessor
  │   ├─ TaskRouter
  │   └─ runtime status snapshot
  └─ StateStore
      ├─ agent_peers
      ├─ agent_messages
      └─ listener_cursors
```

### 3.2 保留并继续使用的现有模块

- `types.ts`
- `config.ts`
- `shadow-wallet.ts`
- `ecdh-crypto.ts`
- `calldata-codec.ts`
- `peer-registry.ts`
- `tx-sender.ts`
- `tx-listener.ts`
- `inbox-processor.ts`
- `task-router.ts`
- `state-store.ts`

### 3.3 仅保留接口/类型，不进入 v0.1 主链路

- `x402-adapter.ts`
- envelope 中的 `signature` / `x402` 字段的结构性存在
- `types.ts` 中超出白名单的命令类型与扩展状态

### 3.4 v0.1 唯一需要新增的装配层

应新增一个内部运行入口，例如：

- `src/skills/alphaos/runtime/agent-comm/runtime.ts`
- 或 `src/skills/alphaos/runtime/agent-comm/bootstrap.ts`

该入口是装配层，不是新的业务中心；它只负责把已有模块接起来，不引入新的存储模型和协议层。

---

## 4. 运行入口设计

当前最大缺口不是底层实现，而是没有实际运行入口。

### 4.1 运行入口依赖

运行入口至少依赖以下现有对象：

- `AlphaOsConfig`
- `StateStore`
- `DiscoveryEngine`
- `OnchainOsClient`
- `Logger`

另外，通信钱包恢复依赖：

- `COMM_WALLET_ALIAS`
- `VAULT_MASTER_PASSWORD`
- `VaultService`

`VAULT_MASTER_PASSWORD` 不是新的 `COMM_*` 配置项，但它是 `COMM_ENABLED=true` 时的**运行前置条件**。

### 4.2 运行入口职责

运行入口至少负责：

1. 读取并校验通信配置
2. 从 vault 恢复通信钱包
3. 解析出本机通信地址与公钥
4. 启动 `TxListener`
5. 将监听到的交易交给 `InboxProcessor`
6. 对成功解密的消息执行 `TaskRouter`
7. 根据结果更新消息状态
8. 暴露最小运行状态快照
9. 提供显式 `stop()` 以便主程序优雅退出

### 4.3 建议的最小运行时接口

运行入口应返回一个轻量 handle，至少包含：

- `stop(): void`
- `getSnapshot(): AgentCommRuntimeSnapshot`

其中 `AgentCommRuntimeSnapshot` 只需覆盖：

- `enabled`
- `chainId`
- `listenerMode`
- `walletAlias`
- `localAddress`
- `localPubkey`
- `lastCursor`
- `lastRuntimeError`

不要求引入新的数据库表来保存 runtime snapshot。

### 4.4 与主程序的接线位置

当前 `src/index.ts` 已负责：

- `loadConfig()`
- `createAlphaOsSkill()`
- 启动 `engine`
- 启动 `discovery`
- 启动 API server

`v0.1` 应在此基础上增加：

1. `createAlphaOsSkill()` 后启动 agent-comm runtime
2. 在 `SIGINT` / `SIGTERM` 时与 engine / discovery 一起停止

不要求为了 agent-comm 再引入新的主进程框架。

---

## 5. 配置设计

### 5.1 v0.1 实际使用配置

| 配置项 | 必需 | 默认值 | v0.1 作用 |
|---|---:|---|---|
| `COMM_ENABLED` | 否 | `false` | 是否启用通信运行时 |
| `COMM_CHAIN_ID` | 否 | `196` | 唯一目标链 |
| `COMM_RPC_URL` | 是* | - | 发信与 poll 监听共用 RPC |
| `COMM_LISTENER_MODE` | 否 | `disabled` | 仅允许 `disabled` / `poll` |
| `COMM_POLL_INTERVAL_MS` | 否 | `5000` | 轮询间隔 |
| `COMM_WALLET_ALIAS` | 否 | `agent-comm` | 通信钱包别名 |

\* 当 `COMM_ENABLED=true` 时必填

### 5.2 运行前置条件

当 `COMM_ENABLED=true` 时，除上表外还必须满足：

1. `VAULT_MASTER_PASSWORD` 已提供
2. vault 中存在 `COMM_WALLET_ALIAS` 对应私钥
3. 私钥可恢复为合法 secp256k1 钱包
4. `COMM_RPC_URL` 返回的链 ID 与 `COMM_CHAIN_ID` 一致

缺任一项，都应在启动阶段直接报错并中止启动。

### 5.3 允许运行的模式

`v0.1` 只定义以下两种运行模式：

- `COMM_ENABLED=false`
  - 整个通信链路关闭
- `COMM_ENABLED=true` 且 `COMM_LISTENER_MODE=poll`
  - 启动完整监听闭环

`COMM_ENABLED=true` 且 `COMM_LISTENER_MODE=disabled` 只可作为显式调试/维护状态存在，**不计入 v0.1 闭环验收**。

### 5.4 明确不承诺的配置项

以下字段即使暂时还在代码中，也不构成 `v0.1` 设计承诺：

- `COMM_LISTENER_MODE=ws`
- `COMM_PAYMASTER_URL`
- `X402_MODE=observe|enforce`

设计、任务与验收均不围绕这些字段展开。

---

## 6. 数据模型与状态模型

### 6.1 仅保留三张通信表

#### `agent_peers`

用途：保存 peer 身份与信任状态。

关键点：

- `status=trusted` 才允许进入执行链
- `wallet_address` 与 `pubkey` 是身份校验依据
- `capabilities_json` 在 `v0.1` 仅作声明性元数据，不作为执行授权依据

#### `agent_messages`

用途：保存收发消息账本。

关键点：

- 唯一约束：`UNIQUE(peer_id, direction, nonce)`
- `error` 只记录当前消息的结构化失败原因
- 不新增 execution receipt / response receipt 表

#### `listener_cursors`

用途：保存 `(address, chain_id)` 维度的监听进度。

关键点：

- 一进程只围绕一个本机地址与一个链 ID 工作
- cursor 以区块号字符串保存
- cursor 是 listener 恢复点，不是业务确认回执

### 6.2 v0.1 真实状态子集

虽然类型层定义了更多状态，但 `v0.1` 只要求以下真实状态：

- `sent`
- `failed`
- `decrypted`
- `executed`
- `rejected`

说明：

- `pending` 可作为预留或预创建消息时的内部状态，但不是 `v0.1` happy path 的必需状态
- `confirmed`、`received` 不纳入当前实现与验收

### 6.3 状态流转

#### outbound

发送链路只要求支持：

- `sent`
- `failed`

如果未来发送入口想先预创建消息，可临时使用 `pending`，但 `v0.1` 不要求专门围绕它扩展逻辑。

#### inbound

接收链路要求支持：

- `decrypted -> executed`
- `decrypted -> rejected`

其中：

- 白名单命令成功执行后置为 `executed`
- 非白名单命令、参数非法、执行失败时置为 `rejected`

### 6.4 去重与执行语义

`v0.1` 的语义必须明确为：

- 存储层：对同一 `(peer_id, direction, nonce)` 保证去重
- 运行层：对已是 `executed` 或 `rejected` 的 inbound 消息，重复扫描时不得再次执行
- 崩溃语义：不承诺跨进程 crash window 的“严格 exactly-once 执行”

换言之，`v0.1` 提供的是：

- at-most-once 持久化
- best-effort 的单进程幂等执行

而不是完整的分布式 exactly-once 语义。

### 6.5 失败落点规则

需要区分两类失败：

#### 落库前失败

例如：

- recipient 不匹配
- trusted peer 不存在
- sender wallet / pubkey 不匹配
- envelope 解码失败
- 解密失败

这些失败可能无法形成可信 `agent_messages` 记录，因此 `v0.1` 要求：

- 通过 logger 记录
- 在 runtime snapshot 中暴露最近运行错误
- 不为此新增错误表或 synthetic message

#### 落库后失败

例如：

- 非白名单命令
- 路由参数不合法
- discovery 执行失败

这些失败应更新已有 `agent_messages.error`，并将状态置为 `rejected`。

---

## 7. 核心流程

### 7.1 发送流程

```text
1. 读取 trusted peer
2. 用本地 ShadowWallet 与 peer 公钥派生共享密钥
3. 生成 EncryptedEnvelope
4. 编码为 calldata
5. TxSender 发送 0 ETH 交易
6. 将 outbound 消息写入 agent_messages（sent / failed）
```

约束：

- 发送路径必须校验 envelope.recipient 与目标地址一致
- 发送路径必须校验 envelope.senderPubkey 与本地钱包公钥一致
- 若发送入口需要最小可观测，必须传入 `store + outboundMessage context`

### 7.2 接收流程

```text
1. TxListener 轮询目标链并读取最新区块
2. 根据 listener_cursors 计算下一个扫描区块
3. 逐块扫描写给本机地址的交易
4. 每条候选交易交给 InboxProcessor：
   - 收件地址校验
   - trusted peer 校验
   - sender wallet / pubkey 校验
   - envelope 解码
   - ECDH 解密
   - nonce 去重
   - inbound 消息落库（decrypted）
5. Runtime 根据 message.status 判断是否继续执行：
   - 已是 executed/rejected：直接跳过
   - 仍是 decrypted：进入 TaskRouter
6. 根据 RouteResult 更新为 executed 或 rejected
7. 每个区块处理完成后更新 listener cursor
```

### 7.3 Cursor 语义

cursor 更新粒度是“区块完成后”而不是“消息完成后”。

这意味着：

- 若进程在区块处理中崩溃，可能重扫该区块
- 重扫时依赖 `(peer_id, direction, nonce)` 去重与消息状态判断避免重复执行

这与当前 `tx-listener.ts` 的实现一致，属于 `v0.1` 可接受语义。

### 7.4 白名单路由策略

当前执行白名单固定为：

- `ping`
- `start_discovery`
- `get_discovery_report`
- `approve_candidate`

对以下命令：

- `probe_onchainos`
- `request_mode_change`

处理策略应为：

1. 允许通过 schema 解析
2. 不进入 v0.1 执行承诺
3. 在路由阶段返回结构化拒绝
4. 将消息状态更新为 `rejected`

不允许静默忽略。

---

## 8. 安全边界

### 8.1 必须保留的安全检查

#### trusted peer 边界

只有 `agent_peers.status = trusted` 的 peer 可以进入解密与执行链。

#### 发件身份一致性

至少校验三项一致关系：

- 链上交易 `from`
- peer 注册 `wallet_address`
- envelope `senderPubkey`

#### 加密方案

继续使用：

- secp256k1 ECDH
- AES-256-GCM

不为了简化而降级为伪加密或明文。

#### 防重放

依赖：

- `(peer_id, direction, nonce)` 唯一约束
- 重扫时的消息状态判断

### 8.2 当前不做出的安全承诺

- 不验证 envelope `signature` 的真实性
- 不验证 x402 proof 的真实性
- 不提供链上支付经济安全保证
- 不提供多链 / 多监听器协同的一致性保证

需要强调：`signature` 与 `x402` 在 `v0.1` 中最多是结构字段，不是放行条件。

---

## 9. 最小可观测与运维设计

### 9.1 最小状态查询能力

`v0.1` 至少要能查询：

- 本机通信地址
- 本机通信公钥
- 当前链 ID
- listener mode
- 当前 cursor
- 最近 N 条消息
- 最近 N 条消息错误
- 最近一次 runtime error
- trusted peers 列表

### 9.2 暴露方式

以下任一方式都可接受：

- 最小内部方法
- 最小 CLI
- 最小 API

但要求是：实现应复用 `StateStore` 现有查询能力与 runtime snapshot，不新增重型展示层。

### 9.3 最小运维动作

`v0.1` 至少应支持三个动作：

1. 查看本机通信身份
2. 注册 / 更新 trusted peer
3. 查看最近消息与 cursor

这三个动作足以支撑本地复现和黑客松演示。

---

## 10. 实施验收约束

当以下条件全部满足时，可认为 `Agent-Comm v0.1` 设计被正确实现：

1. `COMM_ENABLED=true` 且 `COMM_LISTENER_MODE=poll` 时，可完成单链收发闭环
2. 启动时会显式校验 RPC、链 ID、vault 密码和通信钱包
3. 只使用 `agent_peers`、`agent_messages`、`listener_cursors` 三张通信表
4. inbound 消息在成功解密后进入 `decrypted -> executed/rejected` 状态流转
5. 非白名单命令会被结构化拒绝，而不是静默忽略
6. 最近消息、cursor、本机身份和最近错误可被查询
7. `ws`、x402、paymaster、多链、回执系统不出现在 `v0.1` 验收项中

这份设计的核心不是增加能力，而是把当前 requirement 与现有代码收敛成一个后续可以稳定拆任务、稳定接线、稳定验收的最小版本。
