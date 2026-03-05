import { describe, expect, it } from "vitest";
import { estimateLatencyPenalty, estimateSlippage } from "../src/skills/alphaos/runtime/cost-model";

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
});
