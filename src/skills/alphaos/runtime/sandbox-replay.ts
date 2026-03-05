import crypto from "node:crypto";
import type { ExecutionMode, RiskPolicy } from "../types";
import { StateStore } from "./state-store";

export interface SandboxReplayRequest {
  hours: number;
  seed: string;
  mode: ExecutionMode;
  strategyId?: string;
  minEdgeBpsOverride?: number;
}

export interface SandboxReplayResult {
  seed: string;
  mode: ExecutionMode;
  hours: number;
  strategyId?: string;
  total: number;
  passed: number;
  rejected: number;
  estimatedNetUsd: number;
  replayNetUsd: number;
  worstDrawdownUsd: number;
  winRate: number;
}

function unitNoise(seed: string): number {
  const hash = crypto.createHash("sha256").update(seed).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

export class SandboxReplayService {
  constructor(
    private readonly store: StateStore,
    private readonly defaultRiskPolicy: RiskPolicy,
  ) {}

  run(request: SandboxReplayRequest): SandboxReplayResult {
    const rows = this.store.getReplayDataset(request.hours, request.strategyId);
    const threshold =
      request.minEdgeBpsOverride ??
      (request.mode === "live"
        ? this.defaultRiskPolicy.minNetEdgeBpsLive
        : this.defaultRiskPolicy.minNetEdgeBpsPaper);

    let passed = 0;
    let rejected = 0;
    let estimatedNetUsd = 0;
    let replayNetUsd = 0;
    let runningPnl = 0;
    let peak = 0;
    let worstDrawdownUsd = 0;

    for (const row of rows) {
      estimatedNetUsd += row.estNetUsd;

      const noise = unitNoise(`${request.seed}:${row.id}`);
      const drift = (noise - 0.5) * 0.7;
      const slipPenalty = Math.abs(drift) * (row.estCostUsd * 0.22);
      const scenarioNet = row.estNetUsd * (1 + drift) - slipPenalty;
      const effectiveEdge = row.grossEdgeBps * (1 + drift * 0.6);
      const allow = effectiveEdge >= threshold && scenarioNet > -row.estCostUsd;

      if (allow) {
        passed += 1;
        replayNetUsd += scenarioNet;
        runningPnl += scenarioNet;
      } else {
        rejected += 1;
      }

      peak = Math.max(peak, runningPnl);
      worstDrawdownUsd = Math.max(worstDrawdownUsd, peak - runningPnl);
    }

    return {
      seed: request.seed,
      mode: request.mode,
      hours: clamp(Math.floor(request.hours), 1, 24 * 30),
      strategyId: request.strategyId,
      total: rows.length,
      passed,
      rejected,
      estimatedNetUsd,
      replayNetUsd,
      worstDrawdownUsd,
      winRate: rows.length > 0 ? passed / rows.length : 0,
    };
  }
}
