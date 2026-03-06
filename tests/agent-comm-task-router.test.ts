import { describe, expect, it, vi } from "vitest";
import { routeCommand } from "../src/skills/alphaos/runtime/agent-comm/task-router";

function createRouterOptions() {
  return {
    discovery: {
      startSession: vi.fn(),
      getReport: vi.fn(),
      approveCandidate: vi.fn(),
    },
    onchain: {},
    store: {},
  } as never;
}

describe("agent-comm task router", () => {
  it("rejects probe_onchainos as reserved command", async () => {
    const result = await routeCommand(createRouterOptions(), {
      type: "probe_onchainos",
      payload: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("reserved for future version");
  });

  it("rejects request_mode_change as reserved command", async () => {
    const result = await routeCommand(createRouterOptions(), {
      type: "request_mode_change",
      payload: {
        requestedMode: "paper",
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("reserved for future version");
  });
});
