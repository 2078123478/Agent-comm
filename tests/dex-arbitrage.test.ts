import { describe, expect, it } from "vitest";
import { DexArbitragePlugin } from "../src/skills/alphaos/plugins/dex-arbitrage";
import type { Opportunity } from "../src/skills/alphaos/types";

function makeOpportunity(grossEdgeBps: number): Opportunity {
  return {
    id: "opp-1",
    strategyId: "dex-arbitrage",
    pair: "ETH/USDC",
    buyDex: "dex-a",
    sellDex: "dex-b",
    buyPrice: 100,
    sellPrice: 101,
    grossEdgeBps,
    detectedAt: new Date().toISOString(),
    metadata: {
      liquidityUsd: 1_000_000,
      volatility: 0,
      avgLatencyMs: 200,
    },
  };
}

describe("DexArbitragePlugin evaluate", () => {
  it("rejects when net edge is below paper threshold", async () => {
    const plugin = new DexArbitragePlugin({
      takerFeeBps: 20,
      mevPenaltyBps: 5,
      riskPolicy: {
        minNetEdgeBpsPaper: 45,
        minNetEdgeBpsLive: 60,
        maxTradePctBalance: 0.03,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      },
      liquidityUsdDefault: 1_000_000,
      volatilityDefault: 0,
      avgLatencyMsDefault: 200,
      evalNotionalUsdDefault: 1000,
    });

    const result = await plugin.evaluate(makeOpportunity(80), { mode: "paper" });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("below threshold");
  });

  it("uses different thresholds for paper and live", async () => {
    const plugin = new DexArbitragePlugin({
      takerFeeBps: 20,
      mevPenaltyBps: 5,
      riskPolicy: {
        minNetEdgeBpsPaper: 45,
        minNetEdgeBpsLive: 60,
        maxTradePctBalance: 0.03,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      },
      liquidityUsdDefault: 1_000_000,
      volatilityDefault: 0,
      avgLatencyMsDefault: 200,
      evalNotionalUsdDefault: 1000,
    });

    const opp = makeOpportunity(110);
    const paper = await plugin.evaluate(opp, { mode: "paper" });
    const live = await plugin.evaluate(opp, { mode: "live" });

    expect(paper.accepted).toBe(true);
    expect(live.accepted).toBe(false);
  });
});
