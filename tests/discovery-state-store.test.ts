import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiscoveryReport, DiscoverySessionConfig } from "../src/skills/alphaos/types";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";

function createStore(prefix: string): { dir: string; store: StateStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, store: new StateStore(dir) };
}

describe("discovery state store", () => {
  it("persists discovery session lifecycle with samples/candidates/report", () => {
    const { dir, store } = createStore("alphaos-discovery-state-");
    const now = new Date().toISOString();
    const config: DiscoverySessionConfig = {
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

    const session = store.insertDiscoverySession({
      strategyId: "spread-threshold",
      pairs: config.pairs,
      startedAt: now,
      plannedEndAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      config,
    });
    expect(store.getActiveDiscoverySession()?.id).toBe(session.id);

    const sampleId = store.insertDiscoverySample({
      sessionId: session.id,
      pair: "ETH/USDC",
      ts: now,
      dexAMid: 100,
      dexBMid: 102,
      spreadBps: 200,
      volatility: 12,
      zScore: 3.1,
      features: { dexA: "a", dexB: "b" },
    });
    expect(sampleId.length).toBeGreaterThan(0);
    expect(store.listDiscoverySamples(session.id, 10).length).toBe(1);
    expect(store.getLatestDiscoverySampleTs(session.id)).toBe(now);

    const candidateId = store.insertDiscoveryCandidate({
      sessionId: session.id,
      strategyId: "spread-threshold",
      pair: "ETH/USDC",
      buyDex: "a",
      sellDex: "b",
      signalTs: now,
      score: 55,
      expectedNetBps: 48,
      expectedNetUsd: 4.8,
      confidence: 0.82,
      reason: "spread>threshold",
      input: { spreadBps: 200 },
      approvedAt: undefined,
      executedTradeId: undefined,
    });
    const candidate = store.getDiscoveryCandidate(session.id, candidateId);
    expect(candidate?.status).toBe("pending");

    store.updateDiscoveryCandidateStatus(candidateId, "approved", now);
    store.updateDiscoveryCandidateExecution(candidateId, "executed", "trade-1");
    const updatedCandidate = store.getDiscoveryCandidate(session.id, candidateId);
    expect(updatedCandidate?.status).toBe("executed");
    expect(updatedCandidate?.executedTradeId).toBe("trade-1");

    store.updateDiscoverySessionSummary(session.id, {
      samples: 1,
      candidates: 1,
      topPair: "ETH/USDC",
      topScore: 55,
      status: "active",
    });
    store.updateDiscoverySessionStatus(session.id, "completed", now);
    expect(store.getActiveDiscoverySession()).toBeNull();
    expect(store.getDiscoverySession(session.id)?.status).toBe("completed");

    const report: DiscoveryReport = {
      sessionId: session.id,
      generatedAt: now,
      summary: {
        strategyId: "spread-threshold",
        startedAt: now,
        endedAt: now,
        pairs: ["ETH/USDC"],
        status: "completed",
        samples: 1,
        candidates: 1,
        topPair: "ETH/USDC",
        topScore: 55,
      },
      topCandidates: store.listDiscoveryCandidates(session.id, 10),
      charts: {
        "ETH/USDC": [
          {
            ts: now,
            pair: "ETH/USDC",
            spreadBps: 200,
            volatility: 12,
            zScore: 3.1,
          },
        ],
      },
    };
    store.upsertDiscoveryReport(session.id, report, now);
    expect(store.getDiscoveryReport(session.id)?.summary.candidates).toBe(1);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
