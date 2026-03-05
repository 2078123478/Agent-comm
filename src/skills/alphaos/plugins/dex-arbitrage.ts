import crypto from "node:crypto";
import type {
  EvalContext,
  EvalResult,
  ExecutionPlan,
  Opportunity,
  PlanContext,
  RiskPolicy,
  ScanContext,
  StrategyPlugin,
} from "../types";
import { calculateCostBreakdown } from "../runtime/cost-model";

interface DexArbitrageOptions {
  takerFeeBps: number;
  mevPenaltyBps: number;
  riskPolicy: RiskPolicy;
  liquidityUsdDefault: number;
  volatilityDefault: number;
  avgLatencyMsDefault: number;
  evalNotionalUsdDefault: number;
}

const defaultRiskPolicy: RiskPolicy = {
  minNetEdgeBpsPaper: 45,
  minNetEdgeBpsLive: 60,
  maxTradePctBalance: 0.03,
  maxDailyLossPct: 0.015,
  maxConsecutiveFailures: 3,
};

const defaultOptions: DexArbitrageOptions = {
  takerFeeBps: 20,
  mevPenaltyBps: 5,
  riskPolicy: defaultRiskPolicy,
  liquidityUsdDefault: 250000,
  volatilityDefault: 0.02,
  avgLatencyMsDefault: 250,
  evalNotionalUsdDefault: 1000,
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function quoteLatencyMs(ts: string, nowIso: string): number | null {
  const quoteMs = Date.parse(ts);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(quoteMs) || !Number.isFinite(nowMs)) {
    return null;
  }
  return Math.max(0, nowMs - quoteMs);
}

function estimateLiquidityUsdFromQuotes(buyAsk: number, buyBid: number, sellAsk: number, sellBid: number): number {
  const buySpreadBps = ((buyAsk - buyBid) / Math.max(1, buyAsk)) * 10_000;
  const sellSpreadBps = ((sellAsk - sellBid) / Math.max(1, sellAsk)) * 10_000;
  const combinedSpread = Math.max(1, (buySpreadBps + sellSpreadBps) / 2);
  return Math.max(25_000, Math.min(2_000_000, 1_000_000 / combinedSpread));
}

export class DexArbitragePlugin implements StrategyPlugin {
  readonly id = "dex-arbitrage";
  readonly version = "1.0.0";

  constructor(private readonly options: DexArbitrageOptions = defaultOptions) {}

  async scan(ctx: ScanContext): Promise<Opportunity[]> {
    if (ctx.quotes.length < 2) {
      return [];
    }

    const sortedByAsk = [...ctx.quotes].sort((a, b) => a.ask - b.ask);
    const sortedByBid = [...ctx.quotes].sort((a, b) => b.bid - a.bid);
    const buy = sortedByAsk[0];
    const sell = sortedByBid[0];

    if (!buy || !sell || buy.dex === sell.dex || sell.bid <= buy.ask) {
      return [];
    }

    const grossEdgeBps = ((sell.bid - buy.ask) / buy.ask) * 10_000;

    return [
      {
        id: crypto.randomUUID(),
        strategyId: this.id,
        pair: ctx.pair,
        buyDex: buy.dex,
        sellDex: sell.dex,
        buyPrice: buy.ask,
        sellPrice: sell.bid,
        grossEdgeBps,
        detectedAt: ctx.nowIso,
        metadata: {
          liquidityUsd: estimateLiquidityUsdFromQuotes(buy.ask, buy.bid, sell.ask, sell.bid),
          volatility: Math.max(0.005, Math.min(0.5, Math.abs(grossEdgeBps) / 10_000)),
          avgLatencyMs: 0,
        },
      },
    ];
  }

  async evaluate(input: Opportunity, ctx: EvalContext): Promise<EvalResult> {
    const nowIso = ctx.nowIso ?? new Date().toISOString();
    const buyQuote = ctx.quotes?.find((quote) => quote.dex === input.buyDex && quote.pair === input.pair);
    const sellQuote = ctx.quotes?.find((quote) => quote.dex === input.sellDex && quote.pair === input.pair);
    const observedLatencies = [buyQuote, sellQuote]
      .map((quote) => (quote ? quoteLatencyMs(quote.ts, nowIso) : null))
      .filter((value): value is number => value !== null);
    const avgLatencyMs =
      asNumber(input.metadata?.avgLatencyMs) ??
      (observedLatencies.length > 0
        ? observedLatencies.reduce((sum, value) => sum + value, 0) / observedLatencies.length
        : this.options.avgLatencyMsDefault);

    const liquidityUsd =
      asNumber(input.metadata?.liquidityUsd) ?? this.options.liquidityUsdDefault;
    const volatility = asNumber(input.metadata?.volatility) ?? this.options.volatilityDefault;
    const breakdown = calculateCostBreakdown({
      grossEdgeBps: input.grossEdgeBps,
      notionalUsd: this.options.evalNotionalUsdDefault,
      takerFeeBps: this.options.takerFeeBps,
      mevPenaltyBps: this.options.mevPenaltyBps,
      liquidityUsd,
      volatility,
      avgLatencyMs,
      gasBuyUsd: 0,
      gasSellUsd: 0,
    });
    const threshold =
      ctx.mode === "live"
        ? this.options.riskPolicy.minNetEdgeBpsLive
        : this.options.riskPolicy.minNetEdgeBpsPaper;
    const accepted = breakdown.netEdgeBps >= threshold;
    return {
      accepted,
      reason: accepted
        ? `net edge ${breakdown.netEdgeBps.toFixed(1)} bps`
        : `net edge ${breakdown.netEdgeBps.toFixed(1)} bps below threshold`,
      opportunity: input,
    };
  }

  async plan(input: EvalResult, ctx: PlanContext): Promise<ExecutionPlan | null> {
    if (!input.accepted) {
      return null;
    }

    const notionalUsd = Math.max(20, ctx.balanceUsd * ctx.riskPolicy.maxTradePctBalance);
    return {
      opportunityId: input.opportunity.id,
      strategyId: this.id,
      pair: input.opportunity.pair,
      buyDex: input.opportunity.buyDex,
      sellDex: input.opportunity.sellDex,
      buyPrice: input.opportunity.buyPrice,
      sellPrice: input.opportunity.sellPrice,
      notionalUsd,
      metadata: {
        ...input.opportunity.metadata,
        source: "dex-arbitrage",
      },
    };
  }
}
