import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";

function createStore(prefix: string): { dir: string; store: StateStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, store: new StateStore(dir) };
}

describe("StateStore P0 safety", () => {
  it("rolls back trade insert when pnl update fails inside transaction", () => {
    const { dir, store } = createStore("alphaos-state-");
    const db = (store as unknown as { alphaDb: Database.Database }).alphaDb;
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS test_abort_pnl_insert
      BEFORE INSERT ON pnl_daily
      BEGIN
        SELECT RAISE(ABORT, 'forced pnl failure');
      END;
    `);

    store.insertOpportunity(
      {
        id: "opp-rollback",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: new Date().toISOString(),
      },
      1,
      1,
      "executed",
    );

    expect(() =>
      store.insertTrade(
        "opp-rollback",
        "paper",
        {
          success: true,
          txHash: "tx-rollback",
          status: "confirmed",
          grossUsd: 4,
          feeUsd: 1,
          netUsd: 3,
        },
        new Date().toISOString(),
      ),
    ).toThrow(/forced pnl failure/);

    expect((store.listTrades(10) as unknown[]).length).toBe(0);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("claims whale signals atomically through pending -> processing -> consumed/ignored", () => {
    const { dir, store } = createStore("alphaos-state-");
    const first = store.insertWhaleSignal({
      wallet: "0xabc",
      token: "ETH",
      side: "buy",
      sizeUsd: 20000,
      confidence: 0.9,
    });
    const second = store.insertWhaleSignal({
      wallet: "0xdef",
      token: "SOL",
      side: "sell",
      sizeUsd: 10000,
      confidence: 0.8,
    });

    const claimed = store.claimPendingWhaleSignals(10);
    expect(claimed.length).toBe(2);
    expect(claimed.every((signal) => signal.status === "processing")).toBe(true);
    expect(store.claimPendingWhaleSignals(10).length).toBe(0);

    store.updateWhaleSignalStatus(first, "consumed");
    store.updateWhaleSignalStatus(second, "ignored");

    expect(store.listWhaleSignals("processing", 10).length).toBe(0);
    expect(store.listWhaleSignals("consumed", 10).length).toBe(1);
    expect(store.listWhaleSignals("ignored", 10).length).toBe(1);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
