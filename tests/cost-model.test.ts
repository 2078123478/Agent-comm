import { describe, expect, it } from "vitest";
import {
  estimateExpectedShortfall,
  estimateLatencyPenalty,
  estimateSlippage,
} from "../src/skills/alphaos/runtime/cost-model";

describe("cost-model helpers", () => {
  it("estimates slippage from notional/liquidity/volatility", () => {
    const low = estimateSlippage(1000, 1_000_000, 0);
    const high = estimateSlippage(10000, 100_000, 0.1);

    expect(low).toBeCloseTo(3.316227766, 6);
    expect(high).toBeGreaterThan(low);
  });

  it("estimates latency penalty by edge decay", () => {
    const penalty = estimateLatencyPenalty(250, 100);
    expect(penalty).toBeCloseTo(2.5, 6);
  });

  it("increases expected shortfall under high volatility tail risk", () => {
    const lowVol = estimateExpectedShortfall(1000, 0.2, 5, 20, {
      volatility: 0.01,
      avgLatencyMs: 200,
      liquidityUsd: 1_000_000,
      slippageBps: 12,
    });
    const highVol = estimateExpectedShortfall(1000, 0.2, 5, 20, {
      volatility: 0.3,
      avgLatencyMs: 200,
      liquidityUsd: 1_000_000,
      slippageBps: 12,
    });

    expect(highVol).toBeGreaterThan(lowVol);
  });
});
