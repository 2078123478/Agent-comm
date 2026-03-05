import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AlphaEngine } from "../src/skills/alphaos/engine/alpha-engine";
import { RiskEngine } from "../src/skills/alphaos/runtime/risk-engine";
import { Simulator } from "../src/skills/alphaos/runtime/simulator";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import type { SimulationResult, StrategyPlugin } from "../src/skills/alphaos/types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AlphaEngine degraded-to-paper", () => {
  it("degrades live restricted trade to paper execution", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-engine-"));
    const store = new StateStore(tempDir);

    let scanned = false;
    const plugin: StrategyPlugin = {
      id: "dex-arbitrage",
      version: "1.0.0",
      async scan() {
        if (scanned) {
          return [];
        }
        scanned = true;
        return [
          {
            id: "opp-live-1",
            strategyId: "dex-arbitrage",
            pair: "ETH/USDC",
            buyDex: "a",
            sellDex: "b",
            buyPrice: 100,
            sellPrice: 102,
            grossEdgeBps: 200,
            detectedAt: new Date().toISOString(),
          },
        ];
      },
      async evaluate(opportunity) {
        return { accepted: true, reason: "ok", opportunity };
      },
      async plan(input) {
        return {
          opportunityId: input.opportunity.id,
          strategyId: "dex-arbitrage",
          pair: input.opportunity.pair,
          buyDex: input.opportunity.buyDex,
          sellDex: input.opportunity.sellDex,
          buyPrice: input.opportunity.buyPrice,
          sellPrice: input.opportunity.sellPrice,
          notionalUsd: 50,
        };
      },
    };

    const marketWatch = {
      async fetch() {
        return [
          { pair: "ETH/USDC", dex: "a", bid: 99.8, ask: 100, gasUsd: 1, ts: new Date().toISOString() },
          { pair: "ETH/USDC", dex: "b", bid: 102, ask: 102.2, gasUsd: 1, ts: new Date().toISOString() },
        ];
      },
    };

    const notifier = {
      async publish() {
        return;
      },
      async flushOutbox() {
        return;
      },
    };

    const logger = {
      info() {
        return;
      },
      error() {
        return;
      },
    };

    const executor = {
      async execute(mode: "paper" | "live", _plan: unknown, simulation: SimulationResult) {
        if (mode === "live") {
          return {
            success: false,
            txHash: "",
            status: "failed" as const,
            grossUsd: 0,
            feeUsd: 0,
            netUsd: 0,
            errorType: "permission_denied" as const,
            error: "403 whitelist required",
          };
        }
        return {
          success: true,
          txHash: "paper-tx-1",
          status: "confirmed" as const,
          grossUsd: simulation.grossUsd,
          feeUsd: simulation.feeUsd,
          netUsd: simulation.netUsd,
        };
      },
    };

    const engine = new AlphaEngine(
      {
        id: "alphaos",
        version: "0.3.0",
        description: "test",
        strategyIds: ["dex-arbitrage"],
      },
      [plugin],
      {
        intervalMs: 25,
        pair: "ETH/USDC",
        dexes: ["a", "b"],
        startMode: "live",
        liveEnabled: true,
        autoPromoteToLive: false,
        paperStartingBalanceUsd: 1000,
        liveBalanceUsd: 1000,
        riskPolicy: {
          minNetEdgeBpsPaper: 1,
          minNetEdgeBpsLive: 1,
          maxTradePctBalance: 0.5,
          maxDailyLossPct: 0.015,
          maxConsecutiveFailures: 3,
        },
      },
      logger as never,
      marketWatch as never,
      new Simulator({ slippageBps: 1, takerFeeBps: 1, gasUsdDefault: 0.1 }),
      new RiskEngine({
        minNetEdgeBpsPaper: 1,
        minNetEdgeBpsLive: 1,
        maxTradePctBalance: 0.5,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      }),
      store,
      notifier as never,
      executor as never,
    );

    engine.start();
    await sleep(120);
    engine.stop();

    const opps = store.listOpportunities(10) as Array<{ id: string; status: string }>;
    const trades = store.listTrades(10) as Array<{ mode: string; tx_hash: string }>;

    expect(opps.some((o) => o.id === "opp-live-1" && o.status === "degraded_to_paper")).toBe(true);
    expect(trades.some((t) => t.mode === "paper")).toBe(true);
    expect(trades.some((t) => t.mode === "live")).toBe(false);

    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
