import type { DiscoveryStrategy } from "./types";
import {
  clamp,
  percentileRank,
  pickBestTwoSidedQuotes,
  stdDev,
} from "./types";

export class VolatilityBreakoutStrategy implements DiscoveryStrategy {
  readonly id = "volatility-breakout" as const;

  evaluate(ctx: Parameters<DiscoveryStrategy["evaluate"]>[0]) {
    const history = ctx.historySpreads;
    if (history.length < Math.max(20, ctx.config.lookbackSamples / 2)) {
      return null;
    }
    const window = history.slice(-ctx.config.lookbackSamples);
    const shortWindow = window.slice(-10);
    const baselineWindow = window.slice(0, Math.max(5, window.length - 10));
    const shortVol = stdDev(shortWindow);
    const baseVol = Math.max(0.000001, stdDev(baselineWindow));
    const volRatio = shortVol / baseVol;
    const spreadPercentile = percentileRank(window, ctx.spreadBps);

    const sided = pickBestTwoSidedQuotes(ctx.quotes);
    if (
      !sided ||
      volRatio < ctx.config.volRatioMin ||
      spreadPercentile < 0.9 ||
      ctx.spreadBps <= ctx.config.minSpreadBps
    ) {
      return null;
    }

    const volatilityBoost = clamp((volRatio - ctx.config.volRatioMin) * 0.35 + 1, 1, 2.2);
    const percentileBoost = clamp(0.8 + spreadPercentile, 0.8, 1.8);
    const expectedNetBps = Math.max(0, ctx.expectedNetBpsBase * volatilityBoost);
    if (expectedNetBps <= 0) {
      return null;
    }

    const score = volRatio * 20 + spreadPercentile * 30 + expectedNetBps;
    return {
      sessionId: ctx.sessionId,
      strategyId: this.id,
      pair: ctx.pair,
      buyDex: sided.buy.dex,
      sellDex: sided.sell.dex,
      signalTs: ctx.ts,
      score,
      expectedNetBps,
      expectedNetUsd: (ctx.config.notionalUsd * expectedNetBps) / 10_000,
      confidence: clamp(0.45 + (volatilityBoost * percentileBoost) / 3, 0.1, 0.99),
      reason: `vol ratio ${volRatio.toFixed(2)} with spread percentile ${(spreadPercentile * 100).toFixed(1)}%`,
      input: {
        spreadBps: ctx.spreadBps,
        shortVol,
        baseVol,
        volRatio,
        spreadPercentile,
        volatilityBoost,
      },
    };
  }
}
