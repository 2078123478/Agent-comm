# Network Profile Task

版本日期：2026-03-07
目标：把 `X Layer recommended / EVM compatible` 的 network profile 思路落成可实施任务。

状态标记：
- `[ ] 待实施`
- `[x] 已完成`

---

## T0：文档基线

### [x] T0.1 新建 NETWORK_PROFILE_REQUIREMENT.md
- 目标：明确 network profile 的产品目标、边界与验收口径

### [x] T0.2 新建 NETWORK_PROFILE_DESIGN.md
- 目标：明确 profile 结构、配置映射、探测分类、交互方式

### [x] T0.3 新建 NETWORK_PROFILE_TASK.md
- 目标：给出后续实施任务分解

---

## T1：配置模型收敛

### [ ] T1.1 定义 profile 数据结构
- 目标文件：
  - 建议新增 `src/skills/alphaos/runtime/network-profile.ts`
- 任务描述：
  - 定义 `xlayer-recommended`
  - 定义 `evm-custom`
  - 定义 defaults / probes / requiredUserInputs / capabilityFlags
- 验收标准：
  - 有统一 profile 定义
  - 不依赖 UI

### [ ] T1.2 将 profile 映射到现有 config
- 目标文件：
  - `src/skills/alphaos/runtime/config.ts`
- 任务描述：
  - 让 profile 能为现有 env/config 提供默认值层
  - 不破坏现有显式配置覆盖能力
- 验收标准：
  - `xlayer-recommended` 能收敛 196 / rpc / poll / auth 默认值
  - `evm-custom` 保持自由输入

### [ ] T1.3 明确默认值、自动探测、必须手填三类配置
- 目标文件：
  - `config.ts`
  - 文档文件
- 验收标准：
  - 三类边界可枚举、可理解

---

## T2：探测与诊断收敛

### [ ] T2.1 统一 profile 级探测入口
- 目标文件：
  - 建议新增 `runtime/network-profile-probe.ts`
  - 或复用现有 onchain probe/status 能力
- 任务描述：
  - 基于现有 `status/probe/token resolve` 组合出 profile readiness
- 验收标准：
  - 至少输出 `ready / degraded / unavailable`

### [ ] T2.2 启动日志 / status 接入 profile 信息
- 目标文件：
  - `src/index.ts`
  - `src/skills/alphaos/api/server.ts`
- 任务描述：
  - 在 status 或启动输出中标识当前 profile
  - 标识推荐路径是否 ready
- 验收标准：
  - 用户能直接看出当前是 xlayer-recommended 还是 evm-custom

---

## T3：文档与示例收敛

### [x] T3.1 更新 `.env.example`
- 任务描述：
  - 把 profile 视角写进示例配置
  - 区分 X Layer recommended 与 EVM custom
- 验收标准：
  - 用户能快速选路径，而不是看一堆散变量

### [x] T3.2 更新 README
- 任务描述：
  - 新增 network profile 章节
  - 明确"X Layer recommended / EVM compatible"
- 验收标准：
  - 产品定位更清晰

### [x] T3.3 更新最小复用文档
- 目标文件：
  - `docs/AGENT_COMM_MIN_REUSE.md`
- 任务描述：
  - 把 agent-comm 的最小复用路径也改成 profile 导向
- 验收标准：
  - 用户知道什么时候用 X Layer 推荐路径，什么时候切 EVM custom

---

## T4：实现验证

### [x] T4.1 补 profile 相关测试
- 目标文件：
  - `tests/config.test.ts`
  - 新增 network profile 测试
- 验收标准：
  - 默认值覆盖逻辑可验证
  - 显式配置优先级可验证

### [x] T4.2 验证 X Layer recommended 路径
- 任务描述：
  - 用 profile 路径跑通 onchain status/probe
  - 跑通 agent-comm / discovery 的推荐配置基线
- 验收标准：
  - 至少能进入 ready 或 degraded with explanation

### [x] T4.3 验证 EVM custom 不被破坏
- 任务描述：
  - 显式配置仍然有效
  - 不因 profile 引入而绑死到 X Layer
- 验收标准：
  - 自定义链配置仍可正常解析

---

## 推荐实施顺序

1. T1.1 ~ T1.3
2. T2.1 ~ T2.2
3. T3.1 ~ T3.3
4. T4.1 ~ T4.3

---

## 完成标准

当以下条件都满足时，可认为 network profile 第一阶段完成：

- 仓库支持 `xlayer-recommended` 与 `evm-custom`
- 配置面已被 profile 收敛
- status/probe 能表达 profile readiness
- README / `.env.example` / 最小复用文档已对齐
- 测试覆盖默认值与显式覆盖逻辑
