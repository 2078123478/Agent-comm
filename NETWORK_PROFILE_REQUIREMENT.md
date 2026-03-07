# Network Profile Requirement

版本日期：2026-03-07
定位：为 AlphaOS / agent-comm / discovery 增加一层“网络配置画像（network profile）”，实现 **X Layer recommended / EVM compatible** 的配置减负能力。

---

## 1. 背景

当前 AlphaOS / agent-comm / discovery 已经具备基础运行能力，但用户在首次接入时仍然需要手工理解并填写大量链与基础设施配置，例如：

- `ONCHAINOS_CHAIN_INDEX`
- `COMM_CHAIN_ID`
- `COMM_RPC_URL`
- `ONCHAINOS_AUTH_MODE`
- token / chain metadata 相关默认行为
- 是否启用 probe / simulate / relay / private submit

这带来两个问题：

1. **对评委/演示不够友好**：虽然系统实际上已经天然偏向 X Layer / OnchainOS，但这种推荐路径没有被明确产品化。
2. **对用户不够友好**：如果把所有配置都暴露为自由输入，EVM 通用性看似保留了，但首次接入门槛过高，传播效率差。

因此需要增加一层 network profile：

- 默认推荐 **X Layer + OnchainOS** 的收敛路径
- 同时保留 **EVM-compatible** 的通用能力
- 把“推荐默认值”“自动探测”“必须手填”三类边界明确下来

---

## 2. 产品目标

### 2.1 要达成的目标

- 让用户可以通过选择一个 profile，而不是手填一堆链参数，快速启动系统
- 明确产品定位为：
  - **X Layer recommended**
  - **EVM compatible**
- 把当前已存在的 OnchainOS / X Layer 生态能力收敛为“默认路径”
- 降低 agent-comm / discovery 的首次配置成本

### 2.2 不要达成的目标

- 不要把产品写死成“只支持 X Layer”
- 不要在当前阶段承诺所有 EVM 网络都开箱即用
- 不要把 paymaster / x402 / AA / private submit 等高级能力包装成当前默认可用能力
- 不要把 network profile 做成新的复杂抽象层或多租户配置系统

---

## 3. Requirement 边界

### 3.1 Must

#### Must 1：支持 profile 选择
系统必须允许至少选择以下两类 profile：

1. `xlayer-recommended`
2. `evm-custom`

#### Must 2：提供 X Layer 推荐默认值
当用户选择 `xlayer-recommended` 时，系统必须能够自动带出一组推荐默认值，至少包括：

- `ONCHAINOS_CHAIN_INDEX=196`
- `COMM_CHAIN_ID=196`
- 推荐 RPC（支持主/备）
- `COMM_LISTENER_MODE=poll`
- `ONCHAINOS_AUTH_MODE` 的推荐默认值
- 推荐 starter pair（如 `ETH/USDC`）
- Onchain probe / token metadata / chain metadata 的默认启用策略

#### Must 3：保留 EVM 通用能力
即使引入 `xlayer-recommended`，系统也必须保留 `evm-custom` 路径，使用户仍可手动提供：

- chain / chainIndex
- rpc / listener
- auth mode
- relay / private submit / advanced provider

#### Must 4：明确配置分类
系统必须把配置分成三类：

1. **可默认化**
2. **可自动探测**
3. **必须用户手填**

并在产品/文档层清晰呈现。

#### Must 5：不扩大 agent-comm v0.1 边界
引入 network profile 不得顺带承诺：

- ws listener
- 多链并行
- x402 闭环
- paymaster 默认可用
- AA/bundler 默认可用
- private submit 默认可用

---

### 3.2 Should

#### Should 1：优先复用现有 probe/status/token 能力
优先利用当前已有的：

- `integration/onchainos/status`
- `integration/onchainos/probe`
- token metadata / token cache
- supported chain / approve address 相关能力

而不是再造新的探测链路。

#### Should 2：让 profile 成为“配置减负入口”
profile 不应只是文档标签，而应成为用户理解与使用系统时的真实入口，例如：

- 推荐模板
- 启动前校验
- 默认示例 env
- 文档路径

#### Should 3：兼容现有配置结构
当前的 env/config 结构可以继续保留，但 profile 应提供其上层收敛视角，而不是强制推翻现有配置模型。

---

### 3.3 Won’t (for now)

当前阶段不纳入以下能力：

- 自动从官网/链上完整同步所有 provider 配置
- 自动发现最佳 RPC / relay / bundler
- 自动化 wallet / peer onboarding 全流程
- 多 profile 编排系统
- UI 配置中心

---

## 4. 推荐配置分类

### 4.1 可默认化

- `ONCHAINOS_CHAIN_INDEX`
- `COMM_CHAIN_ID`
- 推荐 `COMM_RPC_URL`
- `COMM_LISTENER_MODE=poll`
- 推荐 `ONCHAINOS_AUTH_MODE`
- starter pair（如 `ETH/USDC`）
- probe 开关默认启用

### 4.2 可自动探测

- RPC 与 chainId 是否一致
- token metadata / decimals / address
- supported chain / approve address
- simulate / broadcast 路径可用性
- integration status / diagnostics

### 4.3 必须用户手填

- API key / secret / passphrase / projectId
- `VAULT_MASTER_PASSWORD`
- trusted peer 信息
- live wallet / user wallet address
- 是否开启 live / 风险相关参数

---

## 5. 推荐产品表述

### 5.1 推荐路径

产品应明确表述为：

- **X Layer recommended**：提供一键推荐配置与生态默认值
- **EVM compatible**：底层仍保持通用 EVM 架构，不绑定单一生态

### 5.2 不应表述为

- “只支持 X Layer”
- “所有 X Layer 生态能力默认可用”
- “所有 EVM 网络都开箱即用”

---

## 6. 验收标准

当以下条件满足时，可认为 requirement 达成：

1. 仓库中存在清晰的 network profile 需求/设计/任务文档
2. 已定义 `xlayer-recommended` 与 `evm-custom` 两条产品路径
3. 已明确哪些配置可默认化、自动探测、必须手填
4. 已明确哪些高级能力不在当前承诺范围内
5. 后续实现可据此收敛配置面与文档面
