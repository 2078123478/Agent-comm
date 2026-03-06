import type { DiscoveryStrategy } from "./types";
import {
  clamp,
  mean,
  pickBestTwoSidedQuotes,
  stdDev,
} from "./types";

export class MeanReversionStrategy implements DiscoveryStrategy {
  readonly id = "mean-reversion" as const;

  evaluate(ctx: Parameters<DiscoveryStrategy["evaluate"]>[0]) {
    const history = ctx.historySpreads;
    if (history.length < Math.max(20, ctx.config.lookbackSamples / 2)) {
      return null;
    }
    const baseline = history.slice(-ctx.config.lookbackSamples);
    const avg = mean(baseline);
    const sigma = stdDev(baseline);
    if (!Number.isFinite(sigma) || sigma <= 0) {
      return null;
    }

    const z = (ctx.spreadBps - avg) / sigma;
    const previous = baseline[baseline.length - 2] ?? ctx.spreadBps;
    const reversionHint = ctx.spreadBps < previous;
    const sided = pickBestTwoSidedQuotes(ctx.quotes);
    if (!sided || !reversionHint || z <= ctx.config.zEnter || ctx.spreadBps <= ctx.config.minSpreadBps) {
      return null;
    }

    const confidenceAdjustment = clamp((z - ctx.config.zEnter) / 3 + 0.6, 0.2, 1.2);
    const expectedNetBps = Math.max(0, ctx.expectedNetBpsBase * confidenceAdjustment);
    if (expectedNetBps <= 0) {
      return null;
    }

    return {
      sessionId: ctx.sessionId,
      strategyId: this.id,
      pair: ctx.pair,
      buyDex: sided.buy.dex,
      sellDex: sided.sell.dex,
      signalTs: ctx.ts,
      score: z * confidenceAdjustment,
      expectedNetBps,
      expectedNetUsd: (ctx.config.notionalUsd * expectedNetBps) / 10_000,
      confidence: clamp(0.5 + confidenceAdjustment / 3, 0.1, 0.98),
      reason: `z-score ${z.toFixed(2)} > ${ctx.config.zEnter.toFixed(2)} and spread turning down`,
      input: {
        spreadBps: ctx.spreadBps,
        meanBps: avg,
        stdBps: sigma,
        zScore: z,
        previousSpreadBps: previous,
        confidenceAdjustment,
      },
    };
  }
}
