import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import { SandboxReplayService } from "../src/skills/alphaos/runtime/sandbox-replay";

describe("SandboxReplayService", () => {
  it("replays deterministic risk outcomes from stored opportunities", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-replay-"));
    const store = new StateStore(tempDir);

    store.insertOpportunity(
      {
        id: "opp-a",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101.2,
        grossEdgeBps: 120,
        detectedAt: new Date().toISOString(),
      },
      1,
      4,
      "planned",
    );

    store.insertOpportunity(
      {
        id: "opp-b",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 100.4,
        grossEdgeBps: 40,
        detectedAt: new Date().toISOString(),
      },
      1,
      -0.5,
      "rejected",
    );

    const replay = new SandboxReplayService(store, {
      minNetEdgeBpsPaper: 45,
      minNetEdgeBpsLive: 60,
      maxTradePctBalance: 0.03,
      maxDailyLossPct: 0.015,
      maxConsecutiveFailures: 3,
    });

    const resultA = replay.run({
      seed: "seed-1",
      mode: "paper",
      hours: 24,
      strategyId: "dex-arbitrage",
    });
    const resultB = replay.run({
      seed: "seed-1",
      mode: "paper",
      hours: 24,
      strategyId: "dex-arbitrage",
    });

    expect(resultA.total).toBe(2);
    expect(resultA.seed).toBe("seed-1");
    expect(resultA.replayNetUsd).toBeCloseTo(resultB.replayNetUsd, 8);
    expect(resultA.worstDrawdownUsd).toBeGreaterThanOrEqual(0);

    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
