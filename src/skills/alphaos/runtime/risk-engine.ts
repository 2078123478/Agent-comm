import type { GateCheck, RiskPolicy } from "../types";

export class RiskEngine {
  constructor(private readonly policy: RiskPolicy) {}

  canPromoteToLive(input: GateCheck): { passed: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (!input.liveEnabled) {
      reasons.push("LIVE_ENABLED is false");
    }
    if (input.simulationNetUsd24h <= 0) {
      reasons.push("simulation net in last 24h must be > 0");
    }
    if (input.simulationWinRate24h < 0.55) {
      reasons.push("simulation win rate in last 24h must be >= 55%");
    }
    if (input.consecutiveFailures >= this.policy.maxConsecutiveFailures) {
      reasons.push("consecutive failures exceeded threshold");
    }
    return { passed: reasons.length === 0, reasons };
  }

  shouldCircuitBreak(consecutiveFailures: number, dailyNetUsd: number, balanceUsd: number): { breakNow: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (consecutiveFailures >= this.policy.maxConsecutiveFailures) {
      reasons.push("max consecutive failures hit");
    }
    if (dailyNetUsd < 0 && Math.abs(dailyNetUsd) > balanceUsd * this.policy.maxDailyLossPct) {
      reasons.push("max daily loss threshold exceeded");
    }
    return { breakNow: reasons.length > 0, reasons };
  }

  maxNotional(balanceUsd: number): number {
    return Math.max(0, balanceUsd * this.policy.maxTradePctBalance);
  }
}
