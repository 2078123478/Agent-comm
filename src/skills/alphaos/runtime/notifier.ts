import type { ExecutionMode } from "../types";
import { addSeconds } from "./time";
import { StateStore } from "./state-store";

export interface NotifyEvent {
  mode: ExecutionMode;
  level: "info" | "warn" | "error";
  event:
    | "alpha_found"
    | "paper_passed"
    | "trade_executed"
    | "risk_alert"
    | "engine_recovered"
    | "discovery_started"
    | "discovery_progress"
    | "discovery_report_ready"
    | "discovery_candidate_approved"
    | "discovery_candidate_executed"
    | "discovery_candidate_failed";
  pair?: string;
  netUsd?: number;
  txHash?: string;
  strategyId?: string;
  sessionId?: string;
  candidateId?: string;
  detail?: string;
}

interface NotifierOptions {
  hookUrl?: string;
  hookToken?: string;
}

export class OpenClawNotifier {
  constructor(
    private readonly store: StateStore,
    private readonly options: NotifierOptions,
  ) {}

  async publish(event: NotifyEvent): Promise<void> {
    if (!this.options.hookUrl || !this.options.hookToken) {
      return;
    }

    const payload: { text: string; mode: "now" } = {
      text: this.formatText(event),
      mode: "now",
    };

    try {
      await this.send(this.options.hookUrl, payload);
    } catch (error) {
      this.store.enqueueOutbox(this.options.hookUrl, JSON.stringify(payload), addSeconds(new Date(), 5).toISOString(), "pending", 0, String(error));
    }
  }

  async flushOutbox(): Promise<void> {
    if (!this.options.hookUrl || !this.options.hookToken) {
      return;
    }

    const rows = this.store.getDueOutbox(new Date().toISOString());
    for (const row of rows) {
      try {
        await this.send(row.endpoint, JSON.parse(row.payload));
        this.store.markOutboxSent(row.id);
      } catch (error) {
        const nextRetryCount = row.retryCount + 1;
        const delaySeconds = Math.min(120, 2 ** nextRetryCount);
        const nextRetryAt = addSeconds(new Date(), delaySeconds).toISOString();
        this.store.markOutboxRetry(row.id, nextRetryCount, nextRetryAt, String(error));
      }
    }
  }

  private formatText(event: NotifyEvent): string {
    const pair = event.pair ?? "na";
    const net = typeof event.netUsd === "number" ? event.netUsd.toFixed(4) : "na";
    const tx = event.txHash ?? "na";
    const strategy = event.strategyId ?? "na";
    const session = event.sessionId ?? "na";
    const candidate = event.candidateId ?? "na";
    const detail = event.detail ? ` detail=${event.detail}` : "";
    return `[alphaos][${event.mode}][${event.level}] ${event.event} strategy=${strategy} pair=${pair} net=${net} tx=${tx} session=${session} candidate=${candidate}${detail}`;
  }

  private async send(url: string, payload: { text: string; mode: "now" }): Promise<void> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.hookToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`hook request failed: ${response.status}`);
    }
  }
}
