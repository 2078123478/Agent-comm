#!/bin/bash
# Network Profile 验证脚本 — T4.2 / T4.3
# 用法：./scripts/test-network-profile.sh [xlayer-recommended|evm-custom]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

PROFILE="${1:-xlayer-recommended}"

echo "=============================================="
echo "Network Profile 验证测试"
echo "Profile: $PROFILE"
echo "=============================================="
echo ""

# 清理环境变量
unset NETWORK_PROFILE
unset ONCHAINOS_API_BASE
unset ONCHAINOS_API_KEY
unset ONCHAINOS_API_SECRET
unset ONCHAINOS_PASSPHRASE
unset ONCHAINOS_PROJECT_ID
unset COMM_RPC_URL
unset COMM_CHAIN_ID
unset ONCHAINOS_CHAIN_INDEX

if [ "$PROFILE" = "xlayer-recommended" ]; then
  echo "=== T4.2: 验证 X Layer Recommended 路径 ==="
  echo ""
  
  # 设置最小环境变量（模拟用户只填了 NETWORK_PROFILE）
  export NETWORK_PROFILE="xlayer-recommended"
  
  echo "环境变量:"
  echo "  NETWORK_PROFILE=$NETWORK_PROFILE"
  echo ""
  
  # 运行 TypeScript 验证脚本
  npx tsx -e "
    import { loadConfig } from './src/skills/alphaos/runtime/config';
    import { getNetworkProfileReadinessSnapshot } from './src/skills/alphaos/runtime/network-profile-probe';
    
    const config = loadConfig();
    
    console.log('Config 解析结果:');
    console.log('  networkProfileId:', config.networkProfileId);
    console.log('  pair:', config.pair);
    console.log('  onchainChainIndex:', config.onchainChainIndex);
    console.log('  commChainId:', config.commChainId);
    console.log('  commRpcUrl:', config.commRpcUrl);
    console.log('  commListenerMode:', config.commListenerMode);
    console.log('  onchainAuthMode:', config.onchainAuthMode);
    console.log('');
    
    // 验证默认值
    const assertions = [
      ['networkProfileId', config.networkProfileId === 'xlayer-recommended'],
      ['pair', config.pair === 'ETH/USDC'],
      ['onchainChainIndex', config.onchainChainIndex === '196'],
      ['commChainId', config.commChainId === 196],
      ['commRpcUrl', config.commRpcUrl === 'https://rpc.xlayer.tech'],
      ['commListenerMode', config.commListenerMode === 'poll'],
      ['onchainAuthMode', config.onchainAuthMode === 'hmac'],
    ];
    
    console.log('默认值验证:');
    let allPassed = true;
    for (const [name, passed] of assertions) {
      console.log('  ' + (passed ? '✅' : '❌') + ' ' + name);
      if (!passed) allPassed = false;
    }
    console.log('');
    
    // 获取 readiness 快照
    const diagnostics = getNetworkProfileReadinessSnapshot({ config });
    
    console.log('Readiness 诊断:');
    console.log('  Profile:', diagnostics.profile.label);
    console.log('  Readiness:', diagnostics.readiness);
    console.log('  Summary:', diagnostics.summary);
    console.log('');
    
    console.log('诊断检查项:');
    for (const check of diagnostics.checks) {
      const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
      console.log('  ' + icon + ' ' + check.label + ': ' + check.summary);
    }
    console.log('');
    
    if (!allPassed) {
      console.error('❌ 部分默认值验证失败');
      process.exit(1);
    }
    
    console.log('✅ X Layer Recommended 路径验证通过');
  "
  
elif [ "$PROFILE" = "evm-custom" ]; then
  echo "=== T4.3: 验证 EVM Custom 路径 ==="
  echo ""
  
  # 测试 1: evm-custom 没有显式配置时应为 unavailable
  echo "--- 测试 1: 无显式配置（应为 unavailable） ---"
  export NETWORK_PROFILE="evm-custom"
  unset COMM_RPC_URL
  unset COMM_CHAIN_ID
  unset ONCHAINOS_CHAIN_INDEX
  
  npx tsx -e "
    import { loadConfig } from './src/skills/alphaos/runtime/config';
    import { getNetworkProfileReadinessSnapshot } from './src/skills/alphaos/runtime/network-profile-probe';
    
    const config = loadConfig();
    const diagnostics = getNetworkProfileReadinessSnapshot({ config });
    
    console.log('Profile:', diagnostics.profile.id);
    console.log('Readiness:', diagnostics.readiness);
    console.log('');
    
    if (diagnostics.readiness !== 'unavailable') {
      console.error('❌ 期望 readiness=unavailable，实际=' + diagnostics.readiness);
      process.exit(1);
    }
    
    console.log('✅ 无配置时正确标记为 unavailable');
  "
  
  echo ""
  echo "--- 测试 2: 提供显式配置（应正常解析） ---"
  export NETWORK_PROFILE="evm-custom"
  export ONCHAINOS_CHAIN_INDEX="8453"
  export COMM_CHAIN_ID="8453"
  export COMM_RPC_URL="https://rpc.base.example"
  export COMM_LISTENER_MODE="poll"
  export ONCHAINOS_AUTH_MODE="bearer"
  
  npx tsx -e "
    import { loadConfig } from './src/skills/alphaos/runtime/config';
    import { getNetworkProfileReadinessSnapshot } from './src/skills/alphaos/runtime/network-profile-probe';
    
    const config = loadConfig();
    
    console.log('Config 解析结果:');
    console.log('  networkProfileId:', config.networkProfileId);
    console.log('  onchainChainIndex:', config.onchainChainIndex);
    console.log('  commChainId:', config.commChainId);
    console.log('  commRpcUrl:', config.commRpcUrl);
    console.log('  commListenerMode:', config.commListenerMode);
    console.log('  onchainAuthMode:', config.onchainAuthMode);
    console.log('');
    
    // 验证显式配置被正确读取
    const assertions = [
      ['networkProfileId', config.networkProfileId === 'evm-custom'],
      ['onchainChainIndex', config.onchainChainIndex === '8453'],
      ['commChainId', config.commChainId === 8453],
      ['commRpcUrl', config.commRpcUrl === 'https://rpc.base.example'],
      ['commListenerMode', config.commListenerMode === 'poll'],
      ['onchainAuthMode', config.onchainAuthMode === 'bearer'],
    ];
    
    console.log('显式配置验证:');
    let allPassed = true;
    for (const [name, passed] of assertions) {
      console.log('  ' + (passed ? '✅' : '❌') + ' ' + name);
      if (!passed) allPassed = false;
    }
    console.log('');
    
    const diagnostics = getNetworkProfileReadinessSnapshot({ config });
    console.log('Readiness:', diagnostics.readiness);
    console.log('');
    
    if (!allPassed) {
      console.error('❌ 部分配置验证失败');
      process.exit(1);
    }
    
    console.log('✅ EVM Custom 路径验证通过（显式配置未被破坏）');
  "
  
else
  echo "❌ 未知 profile: $PROFILE"
  echo "用法：$0 [xlayer-recommended|evm-custom]"
  exit 1
fi

echo ""
echo "=============================================="
echo "验证完成！"
echo "=============================================="
