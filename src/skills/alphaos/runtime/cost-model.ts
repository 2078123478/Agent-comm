export interface CostModelInput {
  grossEdgeBps: number;
  notionalUsd: number;
  takerFeeBps: number;
  mevPenaltyBps: number;
  slippageBps?: number;
  liquidityUsd: number;
  volatility: number;
  avgLatencyMs: number;
  gasBuyUsd: number;
  gasSellUsd: number;
}

export interface CostModelBreakdown {
  feeBps: number;
  slippagePerLegBps: number;
  slippageBps: number;
  latencyPenaltyBps: number;
  latencyPenaltyUsd: number;
  mevPenaltyBps: number;
  netEdgeBps: number;
  tradeFeeBuyUsd: number;
  tradeFeeSellUsd: number;
  slippageBuyUsd: number;
  slippageSellUsd: number;
  mevUsd: number;
  totalCostUsd: number;
}

export interface NetOutcome {
  grossUsd: number;
  netUsd: number;
  netEdgeBps: number;
}

export interface TailRiskContext {
  volatility?: number;
  avgLatencyMs?: number;
  liquidityUsd?: number;
  slippageBps?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 计算套利交易的毛边际（单位：bps）
 * 公式：((sell.bid - buy.ask) / buy.ask) * 10_000
 *
 * @param buyAsk - 买入DEX的卖价
 * @param sellBid - 卖出DEX的买价
 * @returns 毛边际（bps），如果价格无效返回 null
 */
export function calculateGrossEdgeBps(buyAsk: number, sellBid: number): number | null {
  if (
    !Number.isFinite(buyAsk) ||
    !Number.isFinite(sellBid) ||
    buyAsk <= 0 ||
    sellBid <= 0
  ) {
    return null;
  }
  return ((sellBid - buyAsk) / buyAsk) * 10_000;
}

export function estimateSlippage(
  notionalUsd: number,
  liquidityUsd: number,
  volatility: number,
  slippageBps = 12,
): number {
  const safeNotional = Math.max(0, notionalUsd);
  const safeLiquidity = Math.max(liquidityUsd, 1000);
  const safeVolatility = Math.max(0, volatility);
  const slippageScale = clamp(Math.max(0, slippageBps) / 12, 0.25, 4);
  const baseBps = 3 * slippageScale;
  const impactExponent = 0.5;
  return (
    baseBps +
    Math.pow(safeNotional / safeLiquidity, impactExponent) *
      10 *
      slippageScale *
      (1 + safeVolatility)
  );
}

export function estimateLatencyPenalty(avgLatencyMs: number, edgeBps: number): number {
  const decayPer100ms = 0.01;
  return Math.max(0, edgeBps) * decayPer100ms * (Math.max(0, avgLatencyMs) / 100);
}

export function calculateCostBreakdown(input: CostModelInput): CostModelBreakdown {
  const safeNotional = Math.max(0, input.notionalUsd);
  const feeBps = Math.max(0, input.takerFeeBps) * 2;
  const mevPenaltyBps = Math.max(0, input.mevPenaltyBps);
  const slippagePerLegBps = estimateSlippage(
    safeNotional,
    input.liquidityUsd,
    input.volatility,
    input.slippageBps,
  );
  const slippageBps = slippagePerLegBps * 2;
  const latencyPenaltyBps = estimateLatencyPenalty(input.avgLatencyMs, input.grossEdgeBps);
  const netEdgeBps =
    input.grossEdgeBps - feeBps - slippageBps - latencyPenaltyBps - mevPenaltyBps;
  const tradeFeeBuyUsd = safeNotional * Math.max(0, input.takerFeeBps) / 10_000;
  const tradeFeeSellUsd = safeNotional * Math.max(0, input.takerFeeBps) / 10_000;
  const slippageBuyUsd = safeNotional * slippagePerLegBps / 10_000;
  const slippageSellUsd = safeNotional * slippagePerLegBps / 10_000;
  const latencyPenaltyUsd = safeNotional * latencyPenaltyBps / 10_000;
  const mevUsd = safeNotional * mevPenaltyBps / 10_000;
  const totalCostUsd =
    Math.max(0, input.gasBuyUsd) +
    Math.max(0, input.gasSellUsd) +
    tradeFeeBuyUsd +
    tradeFeeSellUsd +
    slippageBuyUsd +
    slippageSellUsd +
    latencyPenaltyUsd +
    mevUsd;
  return {
    feeBps,
    slippagePerLegBps,
    slippageBps,
    latencyPenaltyBps,
    latencyPenaltyUsd,
    mevPenaltyBps,
    netEdgeBps,
    tradeFeeBuyUsd,
    tradeFeeSellUsd,
    slippageBuyUsd,
    slippageSellUsd,
    mevUsd,
    totalCostUsd,
  };
}

export function calculateNetOutcome(
  grossEdgeBps: number,
  notionalUsd: number,
  totalCostUsd: number,
): NetOutcome {
  const safeNotional = Math.max(0, notionalUsd);
  const grossUsd = safeNotional * grossEdgeBps / 10_000;
  const netUsd = grossUsd - Math.max(0, totalCostUsd);
  const netEdgeBps = safeNotional > 0 ? (netUsd / safeNotional) * 10_000 : -Infinity;
  return {
    grossUsd,
    netUsd,
    netEdgeBps,
  };
}

export function estimateFailureProbability(
  avgLatencyMs: number,
  netEdgeBps: number,
  volatility: number,
): number {
  const baseFail = 0.03;
  const latencyRisk = Math.min(0.4, Math.max(0, avgLatencyMs) / 5000 * 0.35);
  const edgeRisk = netEdgeBps <= 0 ? 0.35 : Math.max(0, (35 - netEdgeBps) / 220);
  const volRisk = Math.min(0.2, Math.max(0, volatility) * 0.4);
  return clamp(baseFail + latencyRisk + edgeRisk + volRisk, 0.01, 0.95);
}

export function estimateExpectedShortfall(
  notionalUsd: number,
  pFail: number,
  totalCostUsd: number,
  netEdgeBps: number,
  context: TailRiskContext = {},
): number {
  const safeNotional = Math.max(0, notionalUsd);
  const safePFail = clamp(pFail, 0, 1);
  const safeVolatility = clamp(Math.max(0, context.volatility ?? 0), 0, 1);
  const safeLatencyMs = Math.max(0, context.avgLatencyMs ?? 0);
  const safeLiquidityUsd = Math.max(1000, context.liquidityUsd ?? safeNotional * 10);
  const safeSlippageBps = Math.max(0, context.slippageBps ?? 12);

  const downsideBps = Math.max(0, -netEdgeBps);
  const volatilityTailBps = 10 + safeVolatility * 120;
  const latencyTailBps = Math.min(20, (safeLatencyMs / 3000) * 20);
  const liquidityTailBps = Math.min(25, (safeNotional / safeLiquidityUsd) * 80);
  const slippageTailBps = Math.min(20, safeSlippageBps * 0.4);
  const positiveEdgeReliefBps = netEdgeBps > 0 ? Math.min(8, netEdgeBps * 0.06) : 0;

  const tailMoveBps = Math.max(
    12,
    6 +
      downsideBps * 0.8 +
      volatilityTailBps +
      latencyTailBps +
      liquidityTailBps +
      slippageTailBps -
      positiveEdgeReliefBps,
  );
  const tailMoveUsd = safeNotional * tailMoveBps / 10_000;
  return safePFail * (Math.max(0, totalCostUsd) + tailMoveUsd);
}
