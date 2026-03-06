import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiscoveryEngine } from "../src/skills/alphaos/runtime/discovery/discovery-engine";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import type { DiscoveryCandidate, ExecutionMode, SimulationResult, TradeResult } from "../src/skills/alphaos/types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const stores: Array<{ dir: string; store: StateStore }> = [];

afterEach(() => {
  for (const entry of stores.splice(0)) {
    entry.store.close();
    fs.rmSync(entry.dir, { recursive: true, force: true });
  }
});

function setupStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-discovery-engine-"));
  const store = new StateStore(dir);
  stores.push({ dir, store });
  return { dir, store };
}

function createEngine(
  store: StateStore,
  executeCandidate?: (candidate: DiscoveryCandidate, mode: ExecutionMode) => Promise<{
    effectiveMode: ExecutionMode;
    opportunityId: string;
    simulation: SimulationResult;
    tradeResult: TradeResult;
    degradedToPaper: boolean;
    tradeId?: string;
  }>,
) {
  const notifierEvents: string[] = [];
  const onchain = {
    async getQuotes(pair: string, dexes: string[]) {
      const [dexA, dexB] = dexes;
      return [
        {
          pair,
          dex: dexA ?? "a",
          bid: 99.8,
          ask: 100,
          gasUsd: 1,
          ts: new Date().toISOString(),
        },
        {
          pair,
          dex: dexB ?? "b",
          bid: 102,
          ask: 102.2,
          gasUsd: 1.1,
          ts: new Date().toISOString(),
        },
      ];
    },
  };
  const notifier = {
    async publish(event: { event: string }) {
      notifierEvents.push(event.event);
    },
  };

  const engine = new DiscoveryEngine(
    store,
    onchain as never,
    notifier as never,
    {
      dexes: ["a", "b"],
      defaultDurationMinutes: 30,
      defaultSampleIntervalSec: 2,
      defaultTopN: 20,
      lookbackSamples: 60,
      zEnter: 2,
      volRatioMin: 1.8,
      minSpreadBps: 35,
      notionalUsd: 1000,
      takerFeeBps: 20,
      slippageBps: 12,
      mevPenaltyBps: 5,
      gasUsdDefault: 1.25,
    },
    executeCandidate ??
      (async (candidate, mode) => ({
        effectiveMode: mode,
        opportunityId: `opp-${candidate.id}`,
        simulation: {
          grossUsd: 5,
          feeUsd: 1,
          netUsd: 4,
          netEdgeBps: 40,
          pFail: 0.1,
          expectedShortfall: 0.2,
          latencyAdjustedNetUsd: 3.8,
          pass: true,
          reason: "ok",
        },
        tradeResult: {
          success: true,
          txHash: `tx-${candidate.id}`,
          status: "confirmed",
          grossUsd: 5,
          feeUsd: 1,
          netUsd: 4,
        },
        degradedToPaper: false,
        tradeId: `trade-${candidate.id}`,
      })),
  );

  return { engine, notifierEvents };
}

describe("DiscoveryEngine", () => {
  it("enforces single active session", async () => {
    const { store } = setupStore();
    const { engine } = createEngine(store);

    const first = await engine.startSession({
      strategyId: "spread-threshold",
      pairs: ["ETH/USDC"],
      durationMinutes: 30,
      sampleIntervalSec: 2,
      topN: 5,
    });
    expect(first.status).toBe("active");

    await expect(
      engine.startSession({
        strategyId: "spread-threshold",
        pairs: ["ETH/USDC"],
      }),
    ).rejects.toMatchObject({ code: "session_conflict" });

    await engine.stopSession(first.id);
  });

  it("collects samples, builds report, and approves candidate", async () => {
    const { store } = setupStore();
    let approvals = 0;
    const { engine, notifierEvents } = createEngine(store, async (candidate, mode) => {
      approvals += 1;
      return {
        effectiveMode: mode,
        opportunityId: `opp-${candidate.id}`,
        simulation: {
          grossUsd: 6,
          feeUsd: 1.2,
          netUsd: 4.8,
          netEdgeBps: 48,
          pFail: 0.12,
          expectedShortfall: 0.3,
          latencyAdjustedNetUsd: 4.5,
          pass: true,
          reason: "ok",
        },
        tradeResult: {
          success: true,
          txHash: `tx-${candidate.id}`,
          status: "confirmed",
          grossUsd: 6,
          feeUsd: 1.2,
          netUsd: 4.8,
        },
        degradedToPaper: false,
        tradeId: `trade-${candidate.id}`,
      };
    });

    engine.start();
    const session = await engine.startSession({
      strategyId: "spread-threshold",
      pairs: ["ETH/USDC"],
      durationMinutes: 30,
      sampleIntervalSec: 2,
      topN: 20,
    });

    await sleep(2300);
    const stopped = await engine.stopSession(session.id);
    expect(stopped.status).toBe("stopped");

    const candidates = engine.listCandidates(session.id, 20);
    expect(candidates.length).toBeGreaterThan(0);

    const report = engine.getReport(session.id);
    expect(report).not.toBeNull();
    expect(report?.summary.candidates).toBeGreaterThan(0);

    const top = candidates[0];
    expect(top).toBeTruthy();
    const approve = await engine.approveCandidate(session.id, top!.id, "paper");
    expect(approve.approved).toBe(true);
    expect(approve.tradeResult.success).toBe(true);
    expect(approvals).toBe(1);

    const persisted = store.getDiscoveryCandidate(session.id, top!.id);
    expect(persisted?.status).toBe("executed");
    expect(persisted?.executedTradeId).toBe(`trade-${top!.id}`);
    expect(notifierEvents).toContain("discovery_report_ready");

    engine.stop();
  });
});
