# Agent-Comm 联调演示报告

**日期**: 2026-03-07  
**Network Profile**: xlayer-recommended  
**状态**: 部分完成 ✅ (链上发送需要测试网 ETH)

---

## ✅ 已完成验证

### 1. Network Profile 配置
```bash
export NETWORK_PROFILE_ID=xlayer-recommended
```
- ✅ chainId 自动设置为 196
- ✅ RPC URL 自动设置为 https://rpc.xlayer.tech
- ✅ Listener mode 默认为 poll
- ✅ Auth mode 默认为 hmac

### 2. Wallet 初始化
**Instance A**:
- Address: `0xE39F01B4d7680FD6942B729E0723812F5F93a3b1`
- Pubkey: `0x0292eb16ab7e6613248489b8db164f0ae5eaa3fa08a84faf72c6ac5716b550c63f`
- Peer ID: `agent-comm`

**Instance B**:
- Address: `0xf8f303B4797625858e4056AD971f1Dc346aa1216`
- Pubkey: `0x0206530533b1fa40603495b857204613636aa6ae5ee9f494bf64e5d2bb989d2ba1`
- Peer ID: `agent-comm`

### 3. Peer 注册
**Instance A 注册 Instance B**:
```json
{
  "peerId": "peer-b",
  "name": "Instance B",
  "walletAddress": "0xf8f303B4797625858e4056AD971f1Dc346aa1216",
  "pubkey": "0x0206530533b1fa40603495b857204613636aa6ae5ee9f494bf64e5d2bb989d2ba1",
  "status": "trusted",
  "capabilities": ["ping", "start_discovery"]
}
```

**Instance B 注册 Instance A**:
```json
{
  "peerId": "peer-a",
  "name": "Instance A",
  "walletAddress": "0xE39F01B4d7680FD6942B729E0723812F5F93a3b1",
  "pubkey": "0x0292eb16ab7e6613248489b8db164f0ae5eaa3fa08a84faf72c6ac5716b550c63f",
  "status": "trusted",
  "capabilities": ["ping", "start_discovery"]
}
```

### 4. Service 启动
- ✅ Instance B 成功启动（带 COMM_ENABLED=true + poll listener）
- ✅ Health check 通过
- ✅ HTTP API 就绪

---

## ⏸️ 待完成（需要测试网 ETH）

### 链上消息发送
**问题**: 新生成的钱包没有 ETH 余额，无法支付 gas 费

**错误信息**:
```
Error: Failed to send calldata transaction on chain 196:
The total cost (gas * gas fee + value) of executing this transaction
exceeds the balance of the account.
```

**解决方案**:
1. **获取测试网 ETH**: 从 X Layer faucet 申请测试币
2. **导入已有钱包**: 使用 `--private-key` 参数导入有余额的钱包
3. **Mock 模式** (待实现): 添加离线模拟模式用于演示

---

## 使用已有钱包继续演示

如果你已经有 X Layer 测试网 ETH，可以这样继续：

```bash
# 1. 导入你的钱包（替换 <your_private_key>）
export NETWORK_PROFILE_ID=xlayer-recommended
export VAULT_MASTER_PASSWORD=pass123
export DATA_DIR=data-demo

npm run dev -- agent-comm:wallet:init --private-key 0x<your_private_key>

# 2. 重复演示步骤（peer trust + 启动服务 + 发送消息）
./scripts/agent-comm-demo.sh
```

---

## 脚本用法

```bash
# 运行演示
./scripts/agent-comm-demo.sh

# 清理演示数据
./scripts/agent-comm-demo.sh clean
```

---

## 下一步

1. **获取测试网 ETH** 后重新运行完整演示
2. 或者实现 **mock/offline 模式** 用于无币演示
3. 或者使用 **HTTP API 直接测试**（绕过链上发送，验证消息处理逻辑）
