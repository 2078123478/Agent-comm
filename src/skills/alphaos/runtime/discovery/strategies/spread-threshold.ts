import type { DiscoveryStrategy } from "./types";
import { clamp, pickBestTwoSidedQuotes } from "./types";

export class SpreadThresholdStrategy implements DiscoveryStrategy {
  readonly id = "spread-threshold" as const;

  evaluate(ctx: Parameters<DiscoveryStrategy["evaluate"]>[0]) {
    if (ctx.spreadBps <= ctx.dynamicThresholdBps || ctx.spreadBps <= 0) {
      return null;
    }
    const sided = pickBestTwoSidedQuotes(ctx.quotes);
    if (!sided) {
      return null;
    }

    const edgeBps = ctx.spreadBps - ctx.dynamicThresholdBps;
    const score = edgeBps;
    const confidence = clamp(0.45 + edgeBps / 120, 0.1, 0.98);

    return {
      sessionId: ctx.sessionId,
      strategyId: this.id,
      pair: ctx.pair,
      buyDex: sided.buy.dex,
      sellDex: sided.sell.dex,
      signalTs: ctx.ts,
      score,
      expectedNetBps: edgeBps,
      expectedNetUsd: (ctx.config.notionalUsd * edgeBps) / 10_000,
      confidence,
      reason: `spread ${ctx.spreadBps.toFixed(2)}bps > threshold ${ctx.dynamicThresholdBps.toFixed(2)}bps`,
      input: {
        spreadBps: ctx.spreadBps,
        dynamicThresholdBps: ctx.dynamicThresholdBps,
        notionalUsd: ctx.config.notionalUsd,
      },
    };
  }
}
