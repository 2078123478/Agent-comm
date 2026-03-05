import crypto from "node:crypto";
import type {
  EvalContext,
  EvalResult,
  ExecutionPlan,
  Opportunity,
  PlanContext,
  ScanContext,
  StrategyPlugin,
} from "../types";

export class DexArbitragePlugin implements StrategyPlugin {
  readonly id = "dex-arbitrage";
  readonly version = "1.0.0";

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
      },
    ];
  }

  async evaluate(input: Opportunity, _ctx: EvalContext): Promise<EvalResult> {
    if (input.grossEdgeBps <= 0) {
      return { accepted: false, reason: "non-positive gross edge", opportunity: input };
    }
    return { accepted: true, reason: "positive gross edge", opportunity: input };
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
        source: "dex-arbitrage",
      },
    };
  }
}
