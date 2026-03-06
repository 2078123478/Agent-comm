import type { StateStore } from "../state-store";
import type { DiscoveryEngine } from "../discovery/discovery-engine";
import type { OnchainOsClient } from "../onchainos-client";
import type { AgentCommand } from "./types";

export interface TaskRouterOptions {
  discovery: DiscoveryEngine;
  // TODO(agent-comm): wire onchain probing/execution commands through this router.
  onchain: OnchainOsClient;
  store: StateStore;
}

export interface RouteResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function routeCommand(
  options: TaskRouterOptions,
  command: AgentCommand,
): Promise<RouteResult> {
  try {
    switch (command.type) {
      case "ping":
        return { success: true, result: "pong" };

      case "start_discovery": {
        const payload = command.payload;
        if (!payload.strategyId) {
          return { success: false, error: "strategyId is required" };
        }
        const session = await options.discovery.startSession({
          strategyId: payload.strategyId,
          pairs: payload.pairs ?? [],
          durationMinutes: payload.durationMinutes,
          sampleIntervalSec: payload.sampleIntervalSec,
          topN: payload.topN,
        });
        return { success: true, result: session };
      }

      case "get_discovery_report": {
        const payload = command.payload;
        const report = options.discovery.getReport(payload.sessionId);
        if (!report) {
          return { success: false, error: "report not ready" };
        }
        return { success: true, result: report };
      }

      case "approve_candidate": {
        const payload = command.payload;
        const result = await options.discovery.approveCandidate(
          payload.sessionId,
          payload.candidateId,
          payload.mode ?? "paper",
        );
        return { success: true, result };
      }

      case "probe_onchainos":
      case "request_mode_change":
        return {
          success: false,
          error: `command reserved for future version: ${command.type}`,
        };

      default:
        return {
          success: false,
          error: `unsupported command type: ${(command as { type: string }).type}`,
        };
    }
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
}
