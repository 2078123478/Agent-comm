#!/bin/bash
# Agent-Comm 双实例联调演示脚本
# 用法：./scripts/agent-comm-demo.sh [clean]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# 清理模式
if [ "$1" = "clean" ]; then
  echo "清理演示数据..."
  rm -rf data-a data-b
  echo "✅ 清理完成"
  exit 0
fi

echo "=============================================="
echo "Agent-Comm 双实例联调演示"
echo "Network Profile: xlayer-recommended"
echo "=============================================="
echo ""

# 清理旧数据
rm -rf data-a data-b
mkdir -p data-a data-b

# ============================================
# Step 1: 初始化 Instance A 钱包
# ============================================
echo "=== Step 1: 初始化 Instance A 钱包 ==="
export NETWORK_PROFILE_ID=xlayer-recommended
export VAULT_MASTER_PASSWORD=pass123
export DATA_DIR=data-a

WALLET_A=$(npm run dev -- agent-comm:wallet:init 2>&1 | grep -A 20 '"action": "agent-comm:wallet:init"')
echo "$WALLET_A"
echo ""

ADDRESS_A=$(echo "$WALLET_A" | grep '"address"' | cut -d'"' -f4)
PUBKEY_A=$(echo "$WALLET_A" | grep '"pubkey"' | cut -d'"' -f4)
PEER_ID_A="agent-comm"

echo "Instance A:"
echo "  Address: $ADDRESS_A"
echo "  Pubkey:  $PUBKEY_A"
echo "  Peer ID: $PEER_ID_A"
echo ""

# ============================================
# Step 2: 初始化 Instance B 钱包
# ============================================
echo "=== Step 2: 初始化 Instance B 钱包 ==="
export DATA_DIR=data-b

WALLET_B=$(npm run dev -- agent-comm:wallet:init 2>&1 | grep -A 20 '"action": "agent-comm:wallet:init"')
echo "$WALLET_B"
echo ""

ADDRESS_B=$(echo "$WALLET_B" | grep '"address"' | cut -d'"' -f4)
PUBKEY_B=$(echo "$WALLET_B" | grep '"pubkey"' | cut -d'"' -f4)
PEER_ID_B="agent-comm"

echo "Instance B:"
echo "  Address: $ADDRESS_B"
echo "  Pubkey:  $PUBKEY_B"
echo "  Peer ID: $PEER_ID_B"
echo ""

# ============================================
# Step 3: Instance A 注册 Instance B 为 trusted peer
# ============================================
echo "=== Step 3: Instance A 注册 Instance B 为 trusted peer ==="
export DATA_DIR=data-a

npm run dev -- agent-comm:peer:trust \
  peer-b \
  "$ADDRESS_B" \
  "$PUBKEY_B" \
  --name "Instance B" \
  --capabilities ping,start_discovery 2>&1 | grep -A 10 '"action"' || true
echo ""

# ============================================
# Step 4: Instance B 注册 Instance A 为 trusted peer
# ============================================
echo "=== Step 4: Instance B 注册 Instance A 为 trusted peer ==="
export DATA_DIR=data-b

npm run dev -- agent-comm:peer:trust \
  peer-a \
  "$ADDRESS_A" \
  "$PUBKEY_A" \
  --name "Instance A" \
  --capabilities ping,start_discovery 2>&1 | grep -A 10 '"action"' || true
echo ""

# ============================================
# Step 5: 启动 Instance B（带 listener）
# ============================================
echo "=== Step 5: 启动 Instance B（带 listener，后台运行）==="
export DATA_DIR=data-b
export COMM_ENABLED=true
export COMM_LISTENER_MODE=poll
export COMM_POLL_INTERVAL_MS=3000
export PORT=3002
export API_SECRET=demo-secret-b

# 后台启动 Instance B
npm run dev > data-b/instance-b.log 2>&1 &
INSTANCE_B_PID=$!
echo "Instance B PID: $INSTANCE_B_PID"

# 等待服务启动
echo "等待 Instance B 启动..."
sleep 3

# 检查服务是否就绪
for i in {1..10}; do
  if curl -s http://localhost:3002/health > /dev/null 2>&1; then
    echo "✅ Instance B 已就绪"
    break
  fi
  if [ $i -eq 10 ]; then
    echo "❌ Instance B 启动超时"
    kill $INSTANCE_B_PID 2>/dev/null || true
    exit 1
  fi
  sleep 1
done
echo ""

# ============================================
# Step 6: Instance A 发送 ping
# ============================================
echo "=== Step 6: Instance A 发送 ping ==="
export DATA_DIR=data-a
export PORT=3001
export API_SECRET=demo-secret-a
export VAULT_MASTER_PASSWORD=pass123

PING_RESULT=$(npm run dev -- agent-comm:send ping peer-b --echo "Hello from A!" --note "demo" 2>&1 | grep -A 15 '"status"' || true)
echo "$PING_RESULT"
echo ""

# 验证 ping 发送
if echo "$PING_RESULT" | grep -q '"status": "sent"'; then
  echo "✅ Ping 发送成功"
else
  echo "⚠️  Ping 发送结果：$PING_RESULT"
fi
echo ""

# ============================================
# Step 7: Instance A 发送 start_discovery
# ============================================
echo "=== Step 7: Instance A 发送 start_discovery ==="
export VAULT_MASTER_PASSWORD=pass123

DISCOVERY_RESULT=$(npm run dev -- agent-comm:send start_discovery peer-b \
  --strategy-id spread-threshold \
  --pairs ETH/USDC,BTC/USDC \
  --duration-minutes 5 \
  --sample-interval-sec 3 \
  --top-n 5 2>&1 | grep -A 20 '"status"' || true)
echo "$DISCOVERY_RESULT"
echo ""

# 验证 discovery 发送
if echo "$DISCOVERY_RESULT" | grep -q '"status": "sent"'; then
  echo "✅ Start Discovery 发送成功"
else
  echo "⚠️  Discovery 发送结果：$DISCOVERY_RESULT"
fi
echo ""

# ============================================
# Step 8: 验证结果
# ============================================
echo "=== Step 8: 验证结果 ==="
echo ""

# 等待 discovery session 创建
echo "等待 discovery session 创建..."
sleep 2

# 查看 Instance B 的 discovery sessions
echo "--- Instance B 的 active discovery sessions ---"
curl -s http://localhost:3002/api/v1/discovery/sessions/active 2>&1 | head -50 || echo "（无 active sessions）"
echo ""

# 查看 Instance B 的接收消息
echo "--- Instance B 的接收消息（inbound） ---"
curl -s "http://localhost:3002/api/v1/agent-comm/messages?limit=5&direction=inbound" 2>&1 | head -50 || echo "（无消息）"
echo ""

# 查看 Instance A 的发送消息
echo "--- Instance A 的发送消息（outbound） ---"
export PORT=3001
curl -s "http://localhost:3001/api/v1/agent-comm/messages?limit=5&direction=outbound" 2>&1 | head -50 || echo "（无消息）"
echo ""

# ============================================
# 清理
# ============================================
echo "=== 清理 ==="
echo "停止 Instance B (PID: $INSTANCE_B_PID)..."
kill $INSTANCE_B_PID 2>/dev/null || true
sleep 1

echo ""
echo "=============================================="
echo "演示完成！"
echo "=============================================="
echo ""
echo "数据目录保留在 data-a/ 和 data-b/"
echo "运行 './scripts/agent-comm-demo.sh clean' 清理"
echo ""
