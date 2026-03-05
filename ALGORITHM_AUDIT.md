# AlphaOS 核心算法盈利能力审计报告

审计时间：2026-03-05  
审计范围：策略层、执行层、风控层、数据层 8 个核心文件

## 总结结论

当前系统更接近“可运行的演示框架”，还不具备稳定正收益所需的执行与风控闭环。  
核心问题不是单点 bug，而是三层错配：

1. 信号层用“可解释的估算价”，不是“可成交价格”。
2. 执行层是串行双腿、无原子性，且无 MEV 防护。
3. 风控与模拟的成本模型偏乐观，导致策略通过率虚高。

在当前默认参数下（`SLIPPAGE_BPS=12`, `TAKER_FEE_BPS=20`, `GAS_USD_DEFAULT=1.25`），系统对净收益存在系统性高估，实盘期望值大概率为负。

---

## 1. 策略层

### 模块：`src/skills/alphaos/plugins/dex-arbitrage.ts`

1. **当前问题**
- 信号只比较 `min(ask)` 与 `max(bid)`，未考虑深度、可成交量、分层滑点与报价时效（`scan`）。
- `evaluate` 仅要求 `grossEdgeBps > 0`，忽略手续费、双腿 gas、失败概率（`evaluate`）。
- 仓位 sizing 用 `Math.max(20, balance * maxTradePctBalance)`，会在小余额/低 edge 场景强制最小下单（`plan`）。

2. **影响评估**
- 以默认成本估算，双腿 taker+slippage 就约 52 bps（不含第二腿 gas/冲击），但信号门槛是 `>0 bps`，可能导致 **70%+** 的候选交易在实盘为负 EV。
- 在余额较小时强制 `$20` notional，会把“应当放弃”的弱信号变成实际亏损，日内回撤放大约 **10%-25%**。

3. **优化方案（代码级）**
- 在 `evaluate` 增加“可执行净边际”门槛：  
  `netEdgeBps = grossEdgeBps - feeBps(2 legs) - slippageBps(2 legs) - latencyPenaltyBps - mevPenaltyBps`。  
  仅当 `netEdgeBps >= risk.minNetEdgeBps*` 才通过。
- `plan` 改为 edge-aware sizing：  
  `notional = min(maxNotional, k * expectedNetUsd / expectedTailLoss)`；去掉硬编码 `$20` 下限，改为 `minTradeUsd` 配置并可按链动态调整。
- 引入报价 freshness 检查：若 `quote.ts` 超过 `N` ms 或 block 落后则拒绝。

4. **优先级**
- **P0**

---

### 模块：`src/skills/alphaos/plugins/smart-money-mirror.ts`

1. **当前问题**
- `estimateEdgeBps` 仅靠 `confidence + log(size)` 人工映射（65-240 bps），不是由真实成交路径反推。
- `buyPrice=1`、`sellPrice=1+edge` 为合成价格，不对应任何订单簿/路由报价。
- 信号在 `scan` 即标记 `consumed`，执行失败后无重放与衰减管理。
- `toPair(token)` 直接拼 `${TOKEN}/USDC`，缺少 token 可交易性与池子存在性校验。

2. **影响评估**
- 合成价格会系统性抬高毛利，可能使预估收益高估 **40%-80%**。
- “先 consumed 再执行”导致失败信号丢失，策略迭代样本污染，回测到实盘偏差可达 **20%-35%**。

3. **优化方案（代码级）**
- 用“跟单可执行价差”替代 `estimateEdgeBps`：  
  对目标 token 请求实时买入/卖出可执行报价，按真实深度估计冲击成本。
- 信号状态机改为：`pending -> processing -> executed/ignored/expired`；失败回滚到 `pending`（含退避重试次数）。
- 增加 wallet 画像与衰减：`wallet_30d_alpha`, `holding_half_life`, `follow_delay_ms`，并在 `evaluate` 中纳入。

4. **优先级**
- **P0**

---

## 2. 执行层

### 模块：`src/skills/alphaos/runtime/onchainos-client.ts`

1. **当前问题**
- 双腿执行是严格串行（先 buy 再 sell），无原子性；sell 失败后才 hedge，存在裸露仓位窗口（`executeDualLeg`）。
- 单腿执行链路包含 quote/swap/simulate/broadcast/history，多次串行 RPC；延迟高且不稳定（`executeLeg`）。
- `slippage` 写死 `"0.5"`，未按池深、波动、gas 竞争动态调整（`buildSwapV6` 调用处）。
- 无私有交易通道/捆绑提交，缺少 MEV 抢跑与夹子保护。
- `getQuotes` 按 dex 串行抓取，行情构建延迟叠加（`for ... await`）。

2. **影响评估**
- 在常见链上环境，双腿总延迟每增加 1 秒，套利 edge 可能衰减 10-30 bps；当前串行路径可能带来 2-5 秒额外延迟，足以吞噬大部分 60-120 bps 信号。
- 无原子性时，单次 sell 失败可能把“低风险套利”变成方向性持仓，尾部亏损放大 **2x-5x**。

3. **优化方案（代码级）**
- P0：引入原子双腿执行（合约 multicall / flash-loan / 聚合器 bundle），保证 all-or-nothing。
- P0：把 `getQuotes` 改为并发请求并打时间戳，超时与 stale 直接丢弃。
- P1：`slippage` 动态化：`base + depthImpact + volatility + urgency`。
- P0：接入私有中继（private RPC / relay）并支持 bundle，减少 MEV 暴露。
- P1：将 `history` 查询异步化，不阻塞下一个机会处理。

4. **优先级**
- **P0**

---

### 模块：`src/skills/alphaos/engine/alpha-engine.ts`

1. **当前问题**
- `tick` 级串行：插件串行、机会串行、执行串行；长尾机会会阻塞后续机会。
- `running` 互斥会在慢 tick 时跳过新 tick，实际扫描频率下降（名义 5s，实测可能 10s+）。
- `quoteGas` 只取买腿估算写入机会，成本记录口径不完整。
- 缺少机会 TTL 与优先队列，旧信号可能在过期后仍执行。

2. **影响评估**
- 机会排队导致“先发现后成交”时间拉长，易把可赚机会变成亏损机会；对高频套利，吞吐瓶颈可能损失 **30%-60%** 可实现收益。

3. **优化方案（代码级）**
- 将 `processOpportunity` 放入优先队列（按 `expectedNetUsd/latencyRisk` 排序）+ worker 并发上限。
- 每个机会加 `expiresAt`/`maxLatencyMs`，超时直接拒绝。
- 扫描与执行解耦：`scan loop` 只入队，`executor loop` 消费队列并限流。

4. **优先级**
- **P1**

---

## 3. 风控层

### 模块：`src/skills/alphaos/runtime/risk-engine.ts`

1. **当前问题**
- 阈值固定（延迟、滑点、reject rate），没有按波动率、流动性、时段动态调整。
- live gate 仅看 24h 模拟净值/胜率，未设置最小样本量与置信区间。
- circuit breaker 未覆盖“未对冲库存风险”“跨策略相关暴露”等系统性风险。

2. **影响评估**
- 固定阈值在行情切换时会“过松或过严”，触发错配；可能造成 **15%-30%** 的风险预算误用。
- 缺少样本量约束会导致偶然盈利触发 live，早期实盘失真风险高。

3. **优化方案（代码级）**
- 增加动态阈值：`maxLatencyMs = f(volatility, gasPercentile, poolDepth)`。
- live gate 增加最小样本（如 `n>=100`）与置信边界（Wilson/Bootstrap）。
- 引入持仓与相关性风控：按 token/链/策略聚合限额 + inventory 超时清仓。

4. **优先级**
- **P1**

---

### 模块：`src/skills/alphaos/runtime/simulator.ts`

1. **当前问题**
- 费用模型只算一次 gas，且滑点只算一次，双腿交易被低估（`estimate`）。
- 滑点固定常数，不随 notional 与深度变化。
- 未纳入执行失败概率、重试成本、延迟衰减。

2. **影响评估**
- 在双腿场景下，费用可能被低估 **30%-60%**，直接抬高通过率与回测收益。
- 风控门槛基于偏乐观仿真，会放行大量边际交易。

3. **优化方案（代码级）**
- 费用改为：`fee = gasBuy + gasSell + tradeFeeBuy + tradeFeeSell + slippageBuy + slippageSell + mevCost`。
- 滑点函数化：`slippageBps = a + b*(notional/liquidity)^c`。
- 仿真输出新增 `pFail`, `expectedShortfall`, `latencyAdjustedNetUsd`，并用于 gate。

4. **优先级**
- **P0**

---

## 4. 数据层

### 模块：`src/skills/alphaos/runtime/state-store.ts`

1. **当前问题**
- `market_snapshots` 仅存 `bid/ask/ts`，缺少 `block_number`, `source_latency_ms`, `route_hash`，无法做质量回放。
- `insertTrade` 直接将 `settled_at = created_at`，结算与提交未区分，实盘口径偏乐观。
- `getSimulationStats` 用 `pass` 当“赢”，而不是按真实可执行正收益定义，易高估 win rate。
- `claimPendingWhaleSignals` 先查后逐条更新，在多实例场景可能重复消费。

2. **影响评估**
- 数据缺字段导致问题无法追因，策略调优效率下降；在实盘迭代中可造成 **1-2 个迭代周期** 的调参滞后。
- 胜率口径偏差会误导 live gate，带来错误放量。

3. **优化方案（代码级）**
- 扩展 schema：行情表增加 `block_number`, `quote_latency_ms`, `quote_id`；交易表区分 `submitted_at/confirmed_at/settled_at`。
- `getSimulationStats` 改成按 `netUsd>0` + `latencyAdjustedNetUsd>0` 统计。
- 信号 claim 改为单 SQL 原子更新（`UPDATE ... WHERE status='pending' ... RETURNING` 风格；SQLite 可用事务+临时表实现）。

4. **优先级**
- **P1**

---

### 模块：`src/skills/alphaos/runtime/market-watch.ts`

1. **当前问题**
- 仅轮询拉取并落库，没有新鲜度校验、异常值过滤、跨源一致性校验。
- 无 WebSocket/mempool 级数据，无法支持低延迟套利。
- 无失败重试与降级策略，短时 API 波动会直接丢行情。

2. **影响评估**
- 数据延迟与缺失会显著减少可执行机会，套利场景下可能损失 **50%+** 的可捕获 alpha。

3. **优化方案（代码级）**
- 增加 quote freshness gate（例如 `now - ts <= 800ms`）。
- 引入流式行情（WS + heartbeat + gap fill），轮询作为降级备份。
- 增加异常检测：跨 dex 中位数偏离阈值、时间戳回退、重复 quote 去重。

4. **优先级**
- **P0**

---

## 整体评估

### 当前系统离“真正盈利”还差多远？

结论：距离可持续盈利还有明显差距，当前仍处于 Demo-Plus 阶段。  
若直接实盘，期望收益分布大概率“均值接近 0 或为负，尾部回撤偏大”。

### 最关键的 3 个改动（按收益/风险比排序）

1. **P0：原子化双腿执行 + MEV 防护**（执行层重构核心）
2. **P0：重写可执行净边际模型**（策略评估与模拟统一到真实成本口径）
3. **P0：行情升级到低延迟+质量校验**（数据层从轮询演示升级到交易级数据）

### 是否有架构级问题需要重构？

有，且建议做一次“小范围架构重构”：

1. 把“信号生成”和“可执行定价”解耦：信号只负责方向，可执行模块负责成交路径与成本。
2. 把“扫描”和“执行”解耦成队列化流水线：支持机会 TTL、优先级、并发限流。
3. 把“模拟口径”和“实盘口径”统一：同一成本模型、同一字段、同一质量指标。

---

## 建议实施顺序

1. 第 1 周：落地 P0-1（原子执行 + private relay 接入）  
2. 第 2 周：落地 P0-2（净边际模型与 simulator 重写）  
3. 第 3 周：落地 P0-3（market-watch 低延迟与数据质量治理）  

完成以上 3 项后，再进入 P1（动态风控、状态库扩展、引擎并发调度）。
