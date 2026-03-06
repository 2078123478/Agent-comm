# AlphaOS 一页说明

## 1) 我们在解决什么长期问题

DeFi 里最稀缺的不是“策略想法”，而是**可信执行**：

- 很多系统能发现机会，但无法稳定成交。
- 很多系统能回测漂亮，但难以证明线上执行路径真实可用。
- 很多系统能做单点优化，但缺少可复用的“策略操作系统”。

AlphaOS 的目标不是做一个短期套利脚本，而是把这条链路标准化：

```text
发现机会 -> 风险评估 -> 模拟验证 -> 执行 -> 记录 -> 传播
```

## 2) 为什么基于 OnchainOS 构建

AlphaOS 选择基于 OnchainOS，是因为执行链路与工程效率的客观要求：

1. OnchainOS 提供官方 v6 执行流（`quote -> swap -> simulate -> broadcast -> history`），
   让“从策略到成交”变成可验证链路，而不是黑盒调用。
2. 鉴权、链索引、token profile、模拟校验等底座能力统一后，
   策略团队能把精力放在 alpha 和风控，而不是重复造接入轮子。
3. 我们把链路健康度暴露为接口（status/probe/path），
   让评估不止看收益，还能看“执行基础设施是否可靠”。

OnchainOS 在这里承担的是“执行基础设施层”角色，核心价值是可验证与可复用。

## 3) 盈利原理（简洁版）

AlphaOS 当前策略是跨 DEX 价差兑现，不做方向预测：

```text
grossEdgeBps = ((sellBid - buyAsk) / buyAsk) * 10_000
grossUsd = notionalUsd * grossEdgeBps / 10_000
netUsd = grossUsd - totalCostUsd
```

执行前会做风险调整：

```text
riskAdjustedNetEdgeBps >= minNetEdgeBps(mode)
```

`mode` 为 `paper` 或 `live`。

## 4) 风控不是“附加项”，而是产品核心

1. 成本层
- 双边手续费
- 双边滑点（仓位/流动性/波动驱动）
- 延迟惩罚
- MEV 惩罚

2. 准入层（Live Gate）
- 24h 模拟净收益 > 0
- 24h 模拟胜率 >= 55%
- 24h 权限失败 = 0
- 拒单率 / 延迟 / 滑点偏差在动态阈值内

3. 熔断层（Circuit Breaker）
- 连续失败超限
- 日内回撤超限
- 权限失败累计
- 执行质量恶化
- 触发后自动降级 `paper`

## 5) 传播性设计：从技术结果到可验证表达

我们不把传播理解为营销包装，而是**把真实执行证据产品化**：

1. 实时观测：
- `/demo` + `/api/v1/stream/metrics` 展示机会、成交、PnL、模式、官方链路状态。

2. 可复盘证据：
- `/api/v1/backtest/snapshot` + `/api/v1/replay/sandbox` 形成“可追溯、可复验”闭环。

3. 可转发内容：
- `/api/v1/growth/share/latest` 输出战报。
- `/api/v1/growth/moments` 输出“日报/最新成交/最佳单/连胜/风控事件”等传播文案。

这个设计的意义是：让社区讨论从“你说你赚了”变成“我们都能复验你的执行质量”。

## 6) 对 OnchainOS 生态的价值

如果 AlphaOS 跑通，带来的不是单个策略收益，而是三层增量：

1. 基础设施层：验证 OnchainOS 在真实策略循环里的稳定性与可用性。
2. 开发者层：给后续 builder 提供可复用的 skill runtime 模板（可插拔策略、统一风控、统一观测）。
3. 市场层：把“发现 alpha”升级为“兑现 alpha + 可传播 alpha”，提升生态信息透明度和开发者信心。

## 7) 诚恳边界与下一步

当前仍有边界：

1. 当前主策略是 `dex-arbitrage` 单策略，生态广度仍需扩展。
2. live 链路受权限/白名单约束时，会降级 paper，仍需持续打通更多真实权限场景。
3. 传播能力已打底（moments/share），下一步会继续做更强的内容生成和可视化导出。

下一阶段方向：

1. 多策略插件化扩展（保持统一风控框架）。
2. 更细颗粒执行质量画像（按链、按时段、按路由）。
3. 面向生态伙伴的标准化“执行可信报告”模板。

## 8) 代码锚点

- 策略逻辑：`src/skills/alphaos/plugins/dex-arbitrage.ts`
- 成本模型：`src/skills/alphaos/runtime/cost-model.ts`
- 风险调整模拟：`src/skills/alphaos/runtime/simulator.ts`
- 引擎与降级：`src/skills/alphaos/engine/alpha-engine.ts`
- 门控与熔断：`src/skills/alphaos/runtime/risk-engine.ts`
- OnchainOS 链路探针：`src/skills/alphaos/runtime/onchainos-client.ts`
