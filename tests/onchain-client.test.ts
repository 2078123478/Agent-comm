import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnchainOsClient } from "../src/skills/alphaos/runtime/onchainos-client";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OnchainOsClient v6 integration", () => {
  const originalFetch = globalThis.fetch;
  const stores: StateStore[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const store of stores.splice(0)) {
      store.close();
    }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds hmac signature with query and includes project header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));

    const mockFetch = vi.fn(async () => jsonResponse({ data: [{ fromTokenAmount: "100", toTokenAmount: "1" }] }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const client = new OnchainOsClient({
      apiBase: "http://localhost:9999",
      apiKey: "k1",
      apiSecret: "s1",
      passphrase: "p1",
      projectId: "proj-1",
      authMode: "hmac",
      apiKeyHeader: "X-API-Key",
      gasUsdDefault: 1,
      chainIndex: "196",
      requireSimulate: true,
      enableCompatFallback: true,
      tokenCacheTtlSeconds: 600,
      tokenProfilePath: "/api/v6/market/token/profile/current",
    });

    await client.getQuoteV6({
      chainIndex: "196",
      fromTokenAddress: "0xfrom",
      toTokenAddress: "0xto",
      amount: "1000000",
    });

    const call = (mockFetch.mock.calls as unknown as Array<[URL, { headers: Record<string, string> }]>)[0];
    const url = new URL(String(call[0]));
    const headers = call[1].headers;

    const timestamp = "2026-03-01T00:00:00.000Z";
    const message = `${timestamp}GET${url.pathname}${url.search}`;
    const expectedSign = crypto.createHmac("sha256", "s1").update(message).digest("base64");

    expect(headers["OK-ACCESS-KEY"]).toBe("k1");
    expect(headers["OK-ACCESS-PASSPHRASE"]).toBe("p1");
    expect(headers["OK-ACCESS-PROJECT"]).toBe("proj-1");
    expect(headers["OK-ACCESS-SIGN"]).toBe(expectedSign);
  });

  it("falls back to legacy path on 404/405 when enabled", async () => {
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(async () => jsonResponse({ code: "404" }, 404))
      .mockImplementationOnce(async () => jsonResponse({ data: [{ fromTokenAmount: "100", toTokenAmount: "1" }] }, 200));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const client = new OnchainOsClient({
      apiBase: "http://localhost:9999",
      apiKey: "k1",
      authMode: "bearer",
      apiKeyHeader: "X-API-Key",
      gasUsdDefault: 1,
      chainIndex: "196",
      requireSimulate: true,
      enableCompatFallback: true,
      tokenCacheTtlSeconds: 600,
      tokenProfilePath: "/api/v6/market/token/profile/current",
    });

    const quote = await client.getQuoteV6({
      chainIndex: "196",
      fromTokenAddress: "0xfrom",
      toTokenAddress: "0xto",
      amount: "1000000",
    });

    expect(Number(quote.fromTokenAmount)).toBe(100);
    expect(client.getIntegrationStatus().lastFallbackAt).toBeTruthy();
  });

  it("resolves token with cache hit and stale-cache fallback", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-token-"));
    tempDirs.push(tempDir);
    const store = new StateStore(tempDir);
    stores.push(store);

    const mockFetch = vi.fn(async () =>
      jsonResponse({ data: [{ tokenContractAddress: "0xeth", tokenDecimal: "18" }] }),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const client = new OnchainOsClient({
      apiBase: "http://localhost:9999",
      apiKey: "k1",
      authMode: "bearer",
      apiKeyHeader: "X-API-Key",
      gasUsdDefault: 1,
      chainIndex: "196",
      requireSimulate: true,
      enableCompatFallback: true,
      tokenCacheTtlSeconds: 600,
      tokenProfilePath: "/api/v6/market/token/profile/current",
      store,
    });

    const first = await client.resolveToken("ETH/USDC", "base", "196");
    expect(first.source).toBe("remote");

    const second = await client.resolveToken("ETH/USDC", "base", "196");
    expect(second.source).toBe("cache");

    store.upsertTokenCache({
      symbol: "ETH",
      chainIndex: "196",
      address: "0xeth-old",
      decimals: 18,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const failingFetch = vi.fn(async () => {
      throw new Error("network down");
    });
    globalThis.fetch = failingFetch as unknown as typeof fetch;

    const staleFallback = await client.resolveToken("ETH/USDC", "base", "196");
    expect(staleFallback.source).toBe("cache");
    expect(staleFallback.address).toBe("0xeth-old");
  });

  it("classifies restricted simulate error for live flow", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-live-"));
    tempDirs.push(tempDir);
    const store = new StateStore(tempDir);
    stores.push(store);

    const mockFetch = vi
      .fn()
      .mockImplementationOnce(async () => jsonResponse({ data: [{ tokenContractAddress: "0xeth", tokenDecimal: "18" }] }))
      .mockImplementationOnce(async () => jsonResponse({ data: [{ tokenContractAddress: "0xusdc", tokenDecimal: "6" }] }))
      .mockImplementationOnce(async () => jsonResponse({ data: [{ fromTokenAmount: "1000000", toTokenAmount: "330000000000000000" }] }))
      .mockImplementationOnce(async () => jsonResponse({ data: [{ txData: "0xabc", to: "0xrouter", value: "0" }] }))
      .mockImplementationOnce(async () => jsonResponse({ code: "FORBIDDEN", msg: "whitelist required" }, 403));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const client = new OnchainOsClient({
      apiBase: "http://localhost:9999",
      apiKey: "k1",
      authMode: "bearer",
      apiKeyHeader: "X-API-Key",
      gasUsdDefault: 1,
      chainIndex: "196",
      requireSimulate: true,
      enableCompatFallback: false,
      tokenCacheTtlSeconds: 600,
      tokenProfilePath: "/api/v6/market/token/profile/current",
      store,
    });

    const result = await client.executePlan({
      opportunityId: "opp-1",
      strategyId: "dex-arbitrage",
      pair: "ETH/USDC",
      buyDex: "a",
      sellDex: "b",
      buyPrice: 100,
      sellPrice: 101,
      notionalUsd: 100,
    });

    expect(result.success).toBe(false);
    expect(["permission_denied", "whitelist_restricted"]).toContain(result.errorType);
  });

  it("probes v6 integration without broadcasting", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-probe-"));
    tempDirs.push(tempDir);
    const store = new StateStore(tempDir);
    stores.push(store);

    const mockFetch = vi
      .fn()
      .mockImplementationOnce(async () => jsonResponse({ data: [{ tokenContractAddress: "0xeth", tokenDecimal: "18" }] }))
      .mockImplementationOnce(async () => jsonResponse({ data: [{ tokenContractAddress: "0xusdc", tokenDecimal: "6" }] }))
      .mockImplementationOnce(async () => jsonResponse({ data: [{ fromTokenAmount: "1000000", toTokenAmount: "330000000000000000" }] }))
      .mockImplementationOnce(async () => jsonResponse({ data: [{ txData: "0xabc", to: "0xrouter", value: "0" }] }))
      .mockImplementationOnce(async () => jsonResponse({ data: [{ success: true, message: "ok" }] }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const client = new OnchainOsClient({
      apiBase: "http://localhost:9999",
      apiKey: "k1",
      authMode: "bearer",
      apiKeyHeader: "X-API-Key",
      gasUsdDefault: 1,
      chainIndex: "196",
      requireSimulate: true,
      enableCompatFallback: true,
      tokenCacheTtlSeconds: 600,
      tokenProfilePath: "/api/v6/market/token/profile/current",
      store,
    });

    const probe = await client.probeConnection({
      pair: "ETH/USDC",
      chainIndex: "196",
      notionalUsd: 25,
      userWalletAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(probe.ok).toBe(true);
    expect(probe.mode).toBe("v6");
    expect(probe.quotePath).toContain("/api/v6/dex/aggregator/quote");
    expect(probe.swapPath).toContain("/api/v6/dex/aggregator/swap");
    expect(probe.simulatePath).toContain("/api/v6/dex/pre-transaction/simulate");
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });
});
