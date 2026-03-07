# Network Profile Design

版本日期：2026-03-07
定位：基于 `NETWORK_PROFILE_REQUIREMENT.md`，设计一层最小的 network profile 收敛方案，用于实现 **X Layer recommended / EVM compatible**。

---

## 1. 设计目标

Network profile 的目标不是取代现有 config，而是在现有 env/config 之上增加一层更高层的产品收敛视角：

- 给出推荐路径
- 降低首次配置成本
- 保持底层 EVM 兼容能力
- 不引入新的重型配置系统

---

## 2. 设计原则

1. **Profile 是上层收敛，不是底层替代**
   - 继续保留现有 env/config 结构
   - profile 只负责填推荐值、触发探测、约束文档

2. **推荐值优先，手填兜底**
   - `xlayer-recommended` 走推荐值
   - `evm-custom` 走显式手填

3. **探测优于猜测**
   - 能 probe / status / token resolve 的，优先自动探测
   - 不要靠静态假设包装成“总是可用”

4. **高级能力保持高级**
   - paymaster / AA / relay / x402 / private submit 等仍停留在高级设置或未来扩展

---

## 3. 目标模型

### 3.1 Profile 类型

```text
NetworkProfile
  ├─ id
  ├─ label
  ├─ mode: recommended | custom
  ├─ defaults
  ├─ probes
  ├─ requiredUserInputs
  └─ capabilityFlags
```

### 3.2 初始支持的 profile

#### 1. `xlayer-recommended`
面向：
- 评委演示
- 首次体验
- OnchainOS/X Layer 贴合路径

特征：
- 自动带出 `196`
- 自动带出推荐 RPC
- 默认 `poll`
- 推荐 auth mode
- 推荐 starter pair
- 默认开启 probe / diagnostics

#### 2. `evm-custom`
面向：
- 非 X Layer EVM 用户
- 高级用户
- 实验性接入

特征：
- 不强给推荐默认值
- 用户手动指定 chain / rpc / auth / provider

---

## 4. 配置映射设计

### 4.1 xlayer-recommended → config 映射

应映射并默认填充：

- `ONCHAINOS_CHAIN_INDEX=196`
- `COMM_CHAIN_ID=196`
- `COMM_RPC_URL=<recommended rpc>`
- `COMM_LISTENER_MODE=poll`
- `ONCHAINOS_AUTH_MODE=<recommended auth>`
- `PAIR=ETH/USDC`

可保留为空但在文档/UI里提示：

- `ONCHAINOS_API_BASE`
- `ONCHAINOS_API_KEY`
- `ONCHAINOS_API_SECRET`
- `ONCHAINOS_PASSPHRASE`
- `ONCHAINOS_PROJECT_ID`
- `VAULT_MASTER_PASSWORD`

### 4.2 evm-custom → config 映射

保留现有自由度：

- chain / chainIndex
- rpc
- auth mode
- relay
- private submit
- wallet / peer / listener

但仍通过统一 config parser 和 probe 流程走同一运行链路。

---

## 5. 探测设计

### 5.1 启动时探测

profile 应触发以下轻量探测：

1. RPC 可连接性
2. RPC chainId 与目标 chain 是否一致
3. Onchain integration status
4. probe 可用性
5. token resolution / token cache 可用性

### 5.2 探测结果分类

结果只分三类：

- `ready`
- `degraded`
- `unavailable`

不引入更复杂状态机。

### 5.3 探测对用户的意义

- `ready`：推荐路径可直接用
- `degraded`：可进入 paper/probe/demo，但不建议 live
- `unavailable`：缺关键依赖，阻止继续

---

## 6. 文档与交互设计

### 6.1 文档结构

后续文档应至少明确两条路径：

#### X Layer 推荐路径
- 默认值是什么
- 哪些项不用填
- 哪些仍要填
- 如何验证 ready

#### EVM 自定义路径
- 需要哪些手填项
- 哪些能力不保证开箱即用

### 6.2 交互方式

当前阶段不做 UI 配置中心。

建议的最小交互形态：

- `.env.example` 中给出 profile 注释块
- README 中给出两条路径
- 启动日志 / status 中显示当前 profile

---

## 7. 边界控制

### 7.1 当前不纳入的实现能力

- 自动切换多个 RPC provider
- 自动选择 bundler / paymaster
- 自动配置 x402 / payment rails
- 自动生成 peer trust 关系
- 自动部署合约或链上注册

### 7.2 当前不纳入的叙事

- “所有 X Layer 生态能力都原生支持”
- “EVM 任意链零配置接入”

---

## 8. 实施导向

### 第一阶段
- 定义 profile 数据结构
- 收敛文档与配置默认值
- 让 status/probe 能表达当前 profile

### 第二阶段
- 将 `.env.example` / README / minimal reuse docs 统一改成 profile 导向
- 启动时展示当前 profile 与诊断结果

### 第三阶段
- 如需要，再逐步把 profile 接入 CLI/API 创建入口

---

## 9. 验收口径

设计完成的标准是：

1. 可以清楚说明 `xlayer-recommended` 与 `evm-custom` 的差异
2. 可以明确列出默认值 / 自动探测 / 必须手填三类边界
3. 不需要引入新的复杂配置系统
4. 为后续代码实施留出清晰路径
