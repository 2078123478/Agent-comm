import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import { SmartMoneyMirrorPlugin } from "../src/skills/alphaos/plugins/smart-money-mirror";

describe("SmartMoneyMirrorPlugin", () => {
  it("builds executable opportunities from realtime quotes", async () => {
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
    const opportunities = await plugin.scan({
      pair: "ETH/USDC",
      quotes: [
        { pair: "ETH/USDC", dex: "dex-a", bid: 99.7, ask: 100, gasUsd: 1, ts: new Date().toISOString() },
        { pair: "ETH/USDC", dex: "dex-b", bid: 100.1, ask: 99.8, gasUsd: 1, ts: new Date().toISOString() },
        { pair: "ETH/USDC", dex: "dex-c", bid: 101, ask: 101.2, gasUsd: 1, ts: new Date().toISOString() },
      ],
      nowIso: new Date().toISOString(),
    });

    expect(opportunities.length).toBe(1);
    expect(opportunities[0]?.strategyId).toBe("smart-money-mirror");
    expect(opportunities[0]?.pair).toBe("ETH/USDC");
    expect(opportunities[0]?.buyDex).toBe("dex-b");
    expect(opportunities[0]?.sellDex).toBe("dex-c");
    expect(opportunities[0]?.buyPrice).toBe(99.8);
    expect(opportunities[0]?.sellPrice).toBe(101);
    expect(opportunities[0]?.grossEdgeBps).toBeCloseTo(((101 - 99.8) / 99.8) * 10_000, 6);

    const signals = store.listWhaleSignals("consumed", 10);
    expect(signals.length).toBe(1);

    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
