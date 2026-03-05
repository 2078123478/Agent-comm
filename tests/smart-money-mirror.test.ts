import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import { SmartMoneyMirrorPlugin } from "../src/skills/alphaos/plugins/smart-money-mirror";

describe("SmartMoneyMirrorPlugin", () => {
  it("converts high-confidence whale signals into opportunities", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-signal-"));
    const store = new StateStore(tempDir);
    store.insertWhaleSignal({
      wallet: "0xabc",
      token: "eth",
      side: "buy",
      sizeUsd: 200000,
      confidence: 0.9,
      sourceTxHash: "0x123",
    });

    const plugin = new SmartMoneyMirrorPlugin(store, 0.62);
    const opportunities = await plugin.scan({ pair: "ETH/USDC", quotes: [], nowIso: new Date().toISOString() });

    expect(opportunities.length).toBe(1);
    expect(opportunities[0].strategyId).toBe("smart-money-mirror");
    expect(opportunities[0].pair).toContain("/USDC");

    const signals = store.listWhaleSignals("consumed", 10);
    expect(signals.length).toBe(1);

    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
