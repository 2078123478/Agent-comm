import { describe, expect, it } from "vitest";
import { Simulator } from "../src/skills/alphaos/runtime/simulator";

describe("Simulator", () => {
  it("computes net edge and pass status", () => {
    const simulator = new Simulator({
      slippageBps: 10,
      takerFeeBps: 20,
      gasUsdDefault: 1,
    });

    const result = simulator.estimate(
      {
        opportunityId: "opp-1",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101.4,
        notionalUsd: 1000,
      },
      "paper",
      {
        minNetEdgeBpsPaper: 45,
        minNetEdgeBpsLive: 60,
        maxTradePctBalance: 0.03,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      },
    );

    expect(result.grossUsd).toBeGreaterThan(0);
    expect(result.netEdgeBps).toBeGreaterThan(45);
    expect(result.pass).toBe(true);
  });
});
