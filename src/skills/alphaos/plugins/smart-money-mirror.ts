import crypto from "node:crypto";
import type {
  EvalContext,
  EvalResult,
  ExecutionPlan,
  Opportunity,
  PlanContext,
  ScanContext,
  StrategyPlugin,
  WhaleSignal,
} from "../types";
import { StateStore } from "../runtime/state-store";

function toPair(token: string): string {
  const normalized = token.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${normalized || "TOKEN"}/USDC`;
}

function estimateEdgeBps(signal: WhaleSignal): number {
  const confidenceBoost = signal.confidence * 110;
  const sizeBoost = Math.min(110, Math.log10(Math.max(10, signal.sizeUsd)) * 35);
  return Math.max(65, Math.min(240, confidenceBoost + sizeBoost));
}

export class SmartMoneyMirrorPlugin implements StrategyPlugin {
  readonly id = "smart-money-mirror";
  readonly version = "1.0.0";

  constructor(
    private readonly store: StateStore,
    private readonly minConfidence: number,
  ) {}

  async scan(_ctx: ScanContext): Promise<Opportunity[]> {
    const signals = this.store.claimPendingWhaleSignals(8);
    const opportunities: Opportunity[] = [];

    for (const signal of signals) {
      if (signal.side !== "buy" || signal.confidence < this.minConfidence) {
        this.store.updateWhaleSignalStatus(signal.id, "ignored");
        continue;
      }

      const grossEdgeBps = estimateEdgeBps(signal);
      const buyPrice = 1;
      const sellPrice = Number((1 + grossEdgeBps / 10_000).toFixed(6));

      opportunities.push({
        id: crypto.randomUUID(),
        strategyId: this.id,
        pair: toPair(signal.token),
        buyDex: "smart-wallet-entry",
        sellDex: "momentum-exit",
        buyPrice,
        sellPrice,
        grossEdgeBps,
        detectedAt: new Date().toISOString(),
        metadata: {
          signalId: signal.id,
          wallet: signal.wallet,
          sizeUsd: signal.sizeUsd,
          confidence: signal.confidence,
          sourceTxHash: signal.sourceTxHash ?? null,
          token: signal.token,
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
