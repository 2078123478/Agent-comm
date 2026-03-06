import { describe, expect, it } from "vitest";
import type { DiscoverySessionConfig, Quote } from "../src/skills/alphaos/types";
import { MeanReversionStrategy } from "../src/skills/alphaos/runtime/discovery/strategies/mean-reversion";
import { SpreadThresholdStrategy } from "../src/skills/alphaos/runtime/discovery/strategies/spread-threshold";
import type { DiscoveryStrategyContext } from "../src/skills/alphaos/runtime/discovery/strategies/types";
import { VolatilityBreakoutStrategy } from "../src/skills/alphaos/runtime/discovery/strategies/volatility-breakout";

const baseConfig: DiscoverySessionConfig = {
  strategyId: "spread-threshold",
  pairs: ["ETH/USDC"],
  durationMinutes: 30,
  sampleIntervalSec: 5,
  topN: 20,
  lookbackSamples: 60,
  zEnter: 2,
  volRatioMin: 1.8,
  minSpreadBps: 35,
  notionalUsd: 1000,
};

const baseQuotes: Quote[] = [
  {
    pair: "ETH/USDC",
    dex: "dex-a",
    bid: 99.8,
    ask: 100,
    gasUsd: 1,
    ts: new Date().toISOString(),
  },
  {
    pair: "ETH/USDC",
    dex: "dex-b",
    bid: 102,
    ask: 102.2,
    gasUsd: 1.1,
    ts: new Date().toISOString(),
  },
];

function buildContext(overrides: Partial<DiscoveryStrategyContext>): DiscoveryStrategyContext {
  return {
    pair: "ETH/USDC",
    sessionId: "session-1",
    strategyId: "spread-threshold",
    ts: new Date().toISOString(),
    config: baseConfig,
    quotes: baseQuotes,
    historySpreads: Array.from({ length: 60 }, () => 40),
    spreadBps: 120,
    dynamicThresholdBps: 80,
    expectedNetBpsBase: 40,
    expectedNetUsdBase: 4,
    ...overrides,
  };
}

describe("discovery strategies", () => {
  it("spread-threshold emits candidate when spread exceeds dynamic threshold", () => {
    const strategy = new SpreadThresholdStrategy();
    const candidate = strategy.evaluate(
      buildContext({
        strategyId: "spread-threshold",
        spreadBps: 130,
        dynamicThresholdBps: 90,
      }),
    );

    expect(candidate).not.toBeNull();
    expect(candidate?.strategyId).toBe("spread-threshold");
    expect(candidate?.score).toBeCloseTo(40, 6);
    expect(candidate?.expectedNetBps).toBeCloseTo(40, 6);
  });

  it("spread-threshold suppresses signal when spread is below threshold", () => {
    const strategy = new SpreadThresholdStrategy();
    const candidate = strategy.evaluate(
      buildContext({
        strategyId: "spread-threshold",
        spreadBps: 70,
        dynamicThresholdBps: 80,
      }),
    );
    expect(candidate).toBeNull();
  });

  it("mean-reversion requires high z-score plus turning-down hint", () => {
    const strategy = new MeanReversionStrategy();
    const history = Array.from({ length: 58 }, () => 40).concat([130, 135]);

    const accepted = strategy.evaluate(
      buildContext({
        strategyId: "mean-reversion",
        historySpreads: history,
        spreadBps: 120,
        expectedNetBpsBase: 45,
      }),
    );
    expect(accepted).not.toBeNull();
    expect(accepted?.strategyId).toBe("mean-reversion");
    expect(accepted?.score).toBeGreaterThan(0);

    const rejected = strategy.evaluate(
      buildContext({
        strategyId: "mean-reversion",
        historySpreads: history,
        spreadBps: 140,
        expectedNetBpsBase: 45,
      }),
    );
    expect(rejected).toBeNull();
  });

  it("volatility-breakout requires vol ratio and high spread percentile", () => {
    const strategy = new VolatilityBreakoutStrategy();
    const calm = Array.from({ length: 50 }, (_, i) => 22 + (i % 2 ? 0.4 : -0.4));
    const burst = [20, 30, 18, 38, 16, 42, 14, 48, 12, 55];
    const history = calm.concat(burst);

    const accepted = strategy.evaluate(
      buildContext({
        strategyId: "volatility-breakout",
        historySpreads: history,
        spreadBps: 95,
        expectedNetBpsBase: 50,
      }),
    );
    expect(accepted).not.toBeNull();
    expect(accepted?.strategyId).toBe("volatility-breakout");
    expect(accepted?.score).toBeGreaterThan(0);

    const rejected = strategy.evaluate(
      buildContext({
        strategyId: "volatility-breakout",
        historySpreads: Array.from({ length: 60 }, () => 40),
        spreadBps: 50,
        expectedNetBpsBase: 10,
      }),
    );
    expect(rejected).toBeNull();
  });
});
