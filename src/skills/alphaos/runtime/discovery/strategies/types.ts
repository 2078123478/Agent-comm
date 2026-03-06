import type { DiscoveryCandidate, DiscoverySessionConfig, DiscoveryStrategyId, Quote } from "../../../types";

export interface DiscoveryStrategyContext {
  pair: string;
  sessionId: string;
  strategyId: DiscoveryStrategyId;
  ts: string;
  config: DiscoverySessionConfig;
  quotes: Quote[];
  historySpreads: number[];
  spreadBps: number;
  dynamicThresholdBps: number;
  expectedNetBpsBase: number;
  expectedNetUsdBase: number;
}

export interface DiscoveryStrategy {
  id: DiscoveryStrategyId;
  evaluate(ctx: DiscoveryStrategyContext): Omit<DiscoveryCandidate, "id" | "status"> | null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }
  const avg = mean(values);
  const variance = values.reduce((sum, value) => {
    const d = value - avg;
    return sum + d * d;
  }, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

export function percentileRank(values: number[], current: number): number {
  if (values.length === 0) {
    return 0;
  }
  let count = 0;
  for (const value of values) {
    if (value <= current) {
      count += 1;
    }
  }
  return count / values.length;
}

export function pickBestTwoSidedQuotes(quotes: Quote[]): { buy: Quote; sell: Quote } | null {
  if (quotes.length < 2) {
    return null;
  }
  const buy = [...quotes].sort((a, b) => a.ask - b.ask)[0];
  const sell = [...quotes].sort((a, b) => b.bid - a.bid)[0];
  if (!buy || !sell || buy.dex === sell.dex || buy.ask <= 0 || sell.bid <= 0) {
    return null;
  }
  return { buy, sell };
}
