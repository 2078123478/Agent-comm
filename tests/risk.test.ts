import { describe, expect, it } from "vitest";
import { RiskEngine } from "../src/skills/alphaos/runtime/risk-engine";

describe("RiskEngine", () => {
  const risk = new RiskEngine({
    minNetEdgeBpsPaper: 45,
    minNetEdgeBpsLive: 60,
    maxTradePctBalance: 0.03,
    maxDailyLossPct: 0.015,
    maxConsecutiveFailures: 3,
  });

  it("blocks live gate when constraints fail", () => {
    const gate = risk.canPromoteToLive({
      simulationNetUsd24h: -1,
      simulationWinRate24h: 0.2,
      consecutiveFailures: 3,
      liveEnabled: true,
    });

    expect(gate.passed).toBe(false);
    expect(gate.reasons.length).toBeGreaterThan(0);
  });

  it("triggers circuit breaker on max losses", () => {
    const decision = risk.shouldCircuitBreak(4, -100, 1000);
    expect(decision.breakNow).toBe(true);
  });
});
