import type {
  ChartPoint,
  DiscoveryCandidate,
  DiscoveryReport,
  DiscoverySession,
  DiscoverySessionSummary,
} from "../../types";
import { StateStore } from "../state-store";

export interface DiscoveryReportBuildInput {
  session: DiscoverySession;
  topN: number;
}

export class DiscoveryReportBuilder {
  constructor(private readonly store: StateStore) {}

  build(input: DiscoveryReportBuildInput): DiscoveryReport {
    const { session, topN } = input;
    const candidates = this.store.listDiscoveryCandidates(session.id, Math.max(1, Math.min(200, topN)));
    const samples = this.store.listDiscoverySamples(session.id, 5000);

    const charts: Record<string, ChartPoint[]> = {};
    for (const sample of samples) {
      const arr = charts[sample.pair] ?? [];
      arr.push({
        ts: sample.ts,
        pair: sample.pair,
        spreadBps: sample.spreadBps,
        volatility: sample.volatility,
        zScore: sample.zScore,
      });
      charts[sample.pair] = arr;
    }

    let topPair: string | undefined;
    let topScore: number | undefined;
    if (candidates.length > 0) {
      const top = candidates[0];
      topPair = top?.pair;
      topScore = top?.score;
    }

    const summary: DiscoverySessionSummary & {
      strategyId: DiscoverySession["strategyId"];
      startedAt: string;
      endedAt?: string;
      pairs: string[];
    } = {
      strategyId: session.strategyId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      pairs: session.pairs,
      status: session.status,
      samples: samples.length,
      candidates: candidates.length,
      topPair,
      topScore,
    };

    return {
      sessionId: session.id,
      generatedAt: new Date().toISOString(),
      summary,
      topCandidates: candidates,
      charts,
    };
  }
}
