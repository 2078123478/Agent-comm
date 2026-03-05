import type { ExecutionMode, ExecutionPlan, RiskPolicy, SimulationResult } from "../types";

export interface SimulatorOptions {
  slippageBps: number;
  takerFeeBps: number;
  gasUsdDefault: number;
}

export class Simulator {
  constructor(private readonly options: SimulatorOptions) {}

  estimate(plan: ExecutionPlan, mode: ExecutionMode, risk: RiskPolicy): SimulationResult {
    const grossUsd = ((plan.sellPrice - plan.buyPrice) / plan.buyPrice) * plan.notionalUsd;
    const feeUsd =
      plan.notionalUsd * (2 * this.options.takerFeeBps) / 10_000 +
      plan.notionalUsd * this.options.slippageBps / 10_000 +
      this.options.gasUsdDefault;
    const netUsd = grossUsd - feeUsd;
    const netEdgeBps = (netUsd / plan.notionalUsd) * 10_000;
    const min = mode === "live" ? risk.minNetEdgeBpsLive : risk.minNetEdgeBpsPaper;
    const pass = netEdgeBps >= min;
    return {
      grossUsd,
      feeUsd,
      netUsd,
      netEdgeBps,
      pass,
      reason: pass ? "net edge passed" : `net edge ${netEdgeBps.toFixed(2)}bps below ${min}bps`,
    };
  }
}
