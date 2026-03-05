import crypto from "node:crypto";
import type {
  EvalContext,
  EvalResult,
  ExecutionPlan,
  Opportunity,
  PlanContext,
  Quote,
  ScanContext,
  StrategyPlugin,
  WhaleSignal,
} from "../types";
import { StateStore } from "../runtime/state-store";
import { calculateGrossEdgeBps } from "../runtime/cost-model";

function toPair(token: string): string {
  const normalized = token.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${normalized || "TOKEN"}/USDC`;
}

function findExecutableQuotes(
  pair: string,
  quotes: Quote[],
): { buy: Quote; sell: Quote; grossEdgeBps: number } | null {
  const pairQuotes = quotes.filter((quote) => quote.pair === pair);
  if (pairQuotes.length < 2) {
    return null;
  }

  let best: { buy: Quote; sell: Quote; grossEdgeBps: number } | null = null;
  for (const buy of pairQuotes) {
    for (const sell of pairQuotes) {
      if (buy.dex === sell.dex || buy.ask <= 0) {
        continue;
      }
      const grossEdgeBps = calculateGrossEdgeBps(buy.ask, sell.bid);
      if (grossEdgeBps === null) {
        continue;
      }
      if (!best || grossEdgeBps > best.grossEdgeBps) {
        best = { buy, sell, grossEdgeBps };
      }
    }
  }

  if (!best || best.grossEdgeBps <= 0) {
    return null;
  }
  return best;
}

export class SmartMoneyMirrorPlugin implements StrategyPlugin {
  readonly id = "smart-money-mirror";
  readonly version = "1.0.0";

  constructor(
    private readonly store: StateStore,
    private readonly minConfidence: number,
  ) {}

  async scan(ctx: ScanContext): Promise<Opportunity[]> {
    const signals = this.store.claimPendingWhaleSignals(8);
    const opportunities: Opportunity[] = [];

    for (const signal of signals) {
      if (signal.side !== "buy" || signal.confidence < this.minConfidence) {
        this.store.updateWhaleSignalStatus(signal.id, "ignored");
        continue;
      }

      const pair = toPair(signal.token);
      const executable = findExecutableQuotes(pair, ctx.quotes);
      if (!executable) {
        this.store.updateWhaleSignalStatus(signal.id, "ignored");
        continue;
      }

      opportunities.push({
        id: crypto.randomUUID(),
        strategyId: this.id,
        pair,
        buyDex: executable.buy.dex,
        sellDex: executable.sell.dex,
        buyPrice: executable.buy.ask,
        sellPrice: executable.sell.bid,
        grossEdgeBps: executable.grossEdgeBps,
        detectedAt: ctx.nowIso,
        metadata: {
          signalId: signal.id,
          wallet: signal.wallet,
          sizeUsd: signal.sizeUsd,
          confidence: signal.confidence,
          sourceTxHash: signal.sourceTxHash ?? null,
          token: signal.token,
          liquidityUsd: Math.max(25_000, signal.sizeUsd * 4),
          volatility: Math.max(0.01, 1 - signal.confidence),
          avgLatencyMs: 0,
        },
      });

      this.store.updateWhaleSignalStatus(signal.id, "consumed");
    }

    return opportunities;
  }

  async evaluate(input: Opportunity, _ctx: EvalContext): Promise<EvalResult> {
    const confidence = Number(input.metadata?.confidence ?? 0);
    if (confidence < this.minConfidence) {
      return { accepted: false, reason: "confidence below threshold", opportunity: input };
    }

    return {
      accepted: true,
      reason: "high-confidence smart-money signal",
      opportunity: input,
    };
  }

  async plan(input: EvalResult, ctx: PlanContext): Promise<ExecutionPlan | null> {
    if (!input.accepted) {
      return null;
    }

    const signalSize = Number(input.opportunity.metadata?.sizeUsd ?? 0);
    const maxNotional = ctx.balanceUsd * ctx.riskPolicy.maxTradePctBalance;
    const followerNotional = Math.max(75, signalSize * 0.03);

    return {
      opportunityId: input.opportunity.id,
      strategyId: this.id,
      pair: input.opportunity.pair,
      buyDex: input.opportunity.buyDex,
      sellDex: input.opportunity.sellDex,
      buyPrice: input.opportunity.buyPrice,
      sellPrice: input.opportunity.sellPrice,
      notionalUsd: Math.min(maxNotional, followerNotional),
      metadata: input.opportunity.metadata,
    };
  }
}
