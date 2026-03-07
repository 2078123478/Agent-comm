# Agent-Comm 联调演示脚本

## 演示目标

用 Network Profile 推荐路径，跑通双实例 Agent-Comm 通信：
1. 初始化两个实例的通信钱包
2. 互相注册为 trusted peer
3. Instance A 发送 ping → Instance B 接收
4. Instance A 发送 start_discovery → Instance B 创建 discovery session

## 环境准备

### Instance A（发送方）
```bash
cd /home/wilsen/apps/apps/onchainos
export NETWORK_PROFILE_ID=xlayer-recommended
export VAULT_MASTER_PASSWORD=pass123
export API_SECRET=demo-secret-a
export PORT=3001
export DATA_DIR=data-a
```

### Instance B（接收方 + listener）
```bash
cd /home/wilsen/apps/apps/onchainos
export NETWORK_PROFILE_ID=xlayer-recommended
export VAULT_MASTER_PASSWORD=pass123
export API_SECRET=demo-secret-b
export PORT=3002
export DATA_DIR=data-b
export COMM_ENABLED=true
export COMM_LISTENER_MODE=poll
export COMM_POLL_INTERVAL_MS=3000
```

## 演示步骤

### Step 1: 初始化 Instance A 钱包
```bash
cd /home/wilsen/apps/apps/onchainos
export NETWORK_PROFILE_ID=xlayer-recommended
export VAULT_MASTER_PASSWORD=pass123
export DATA_DIR=data-a

npm run dev -- agent-comm:wallet:init
# 记录输出：address_a, pubkey_a, defaultSenderPeerId_a
```

### Step 2: 初始化 Instance B 钱包
```bash
export DATA_DIR=data-b
npm run dev -- agent-comm:wallet:init
# 记录输出：address_b, pubkey_b, defaultSenderPeerId_b
```

### Step 3: Instance A 注册 Instance B 为 trusted peer
```bash
npm run dev -- agent-comm:peer:trust \
  peer-b \
  <address_b> \
  <pubkey_b> \
  --name "Instance B" \
  --capabilities ping,start_discovery
```

### Step 4: Instance B 注册 Instance A 为 trusted peer
```bash
export DATA_DIR=data-b
npm run dev -- agent-comm:peer:trust \
  peer-a \
  <address_a> \
  <pubkey_a> \
  --name "Instance A" \
  --capabilities ping,start_discovery
```

### Step 5: 启动 Instance B（带 listener）
```bash
export DATA_DIR=data-b
export COMM_ENABLED=true
export COMM_LISTENER_MODE=poll
npm run dev
# 保持后台运行
```

### Step 6: Instance A 发送 ping
```bash
export DATA_DIR=data-a
npm run dev -- agent-comm:send ping peer-b --echo "Hello from A!" --note "demo"
```

### Step 7: Instance A 发送 start_discovery
```bash
npm run dev -- agent-comm:send start_discovery peer-b \
  --strategy-id spread-threshold \
  --pairs ETH/USDC,BTC/USDC \
  --duration-minutes 5 \
  --sample-interval-sec 3 \
  --top-n 5
```

### Step 8: 验证结果
```bash
# 查看 Instance B 的 discovery session
curl -s http://localhost:3002/api/v1/discovery/sessions/active | jq

# 查看 Instance A 的发送历史
curl -s http://localhost:3001/api/v1/agent-comm/messages?limit=10 | jq

# 查看 Instance B 的接收历史
curl -s http://localhost:3002/api/v1/agent-comm/messages?limit=10 | jq
```

## 预期输出

### Wallet Init
```json
{
  "address": "0x...",
  "pubkey": "0x...",
  "chainId": 196,
  "walletAlias": "agent-comm",
  "defaultSenderPeerId": "agent-comm"
}
```

### Ping 发送成功
```json
{
  "status": "sent",
  "messageId": "...",
  "peerId": "peer-b",
  "command": "ping",
  "echo": "Hello from A!"
}
```

### Discovery Session 创建
```json
{
  "sessionId": "...",
  "strategyId": "spread-threshold",
  "status": "running",
  "pairs": ["ETH/USDC", "BTC/USDC"],
  "durationMinutes": 5,
  "sampleIntervalSec": 3,
  "topN": 5
}
```

## 清理
```bash
# 停止 Instance B（Ctrl+C）
# 清理数据目录（可选）
rm -rf data-a data-b
```
