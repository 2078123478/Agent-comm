import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/skills/alphaos/runtime/agent-comm/entrypoints", async () => {
  const actual = await vi.importActual<typeof import("../src/skills/alphaos/runtime/agent-comm/entrypoints")>(
    "../src/skills/alphaos/runtime/agent-comm/entrypoints",
  );
  return {
    ...actual,
    sendCommPing: vi.fn(),
    sendCommStartDiscovery: vi.fn(),
  };
});

import { createServer } from "../src/skills/alphaos/api/server";
import {
  sendCommPing,
  sendCommStartDiscovery,
  type AgentCommEntrypointDependencies,
} from "../src/skills/alphaos/runtime/agent-comm/entrypoints";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import { VaultService } from "../src/skills/alphaos/runtime/vault";
import type { EngineModeResponse, SkillManifest } from "../src/skills/alphaos/types";

const TEST_API_SECRET = "unit-test-api-secret";
const stores: StateStore[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

type ApiResponse = {
  status: number;
  body: unknown;
};

async function invokeApi(
  app: ReturnType<typeof createServer>,
  method: "POST",
  url: string,
  payload?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<ApiResponse> {
  const socket = new PassThrough();
  (socket as { remoteAddress?: string }).remoteAddress = "127.0.0.1";
  const socketDestroy = socket.destroy.bind(socket);
  (socket as { destroy: () => PassThrough }).destroy = () => socket;

  let raw = "";
  let req: http.IncomingMessage;
  const write = socket.write.bind(socket);
  (socket as { write: (...args: unknown[]) => boolean }).write = (...args: unknown[]) => {
    const chunk = args[0];
    if (Buffer.isBuffer(chunk)) {
      raw += chunk.toString("utf8");
    } else if (typeof chunk === "string") {
      raw += chunk;
    }
    return write(...(args as Parameters<typeof write>));
  };

  req = new http.IncomingMessage(socket as never);
  req.method = method;
  req.url = url;
  req.headers = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    req.headers[key.toLowerCase()] = value;
  }

  const payloadText = payload ? JSON.stringify(payload) : undefined;
  if (payloadText) {
    req.push(payloadText);
    req.headers["content-type"] = "application/json";
    req.headers["content-length"] = String(Buffer.byteLength(payloadText));
  }
  req.push(null);

  const res = new http.ServerResponse(req);
  res.assignSocket(socket as never);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`request timeout ${method} ${url}`)), 1500);
    const clear = () => clearTimeout(timeout);

    req.on("error", (error) => {
      clear();
      reject(error);
    });
    res.on("error", (error) => {
      clear();
      reject(error);
    });
    res.on("finish", () => {
      clear();
      resolve();
    });

    (
      app as unknown as {
        handle: (r: http.IncomingMessage, s: http.ServerResponse, n: (e?: unknown) => void) => void;
      }
    ).handle(req, res, (error?: unknown) => {
      if (error) {
        clear();
        reject(error);
      }
    });
  });

  const splitAt = raw.indexOf("\r\n\r\n");
  const text = splitAt >= 0 ? raw.slice(splitAt + 4) : "";
  socketDestroy();
  return {
    status: res.statusCode,
    body: JSON.parse(text),
  };
}

function buildApp() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-agent-comm-send-api-"));
  tempDirs.push(tempDir);
  const store = new StateStore(tempDir);
  stores.push(store);
  const vault = new VaultService(store);
  const config = {
    commWalletAlias: "agent-comm",
    commChainId: 196,
  } as AgentCommEntrypointDependencies["config"];

  const engine = {
    getCurrentMode: () => "paper",
    requestMode: (mode: "paper" | "live"): EngineModeResponse => ({
      ok: true,
      requestedMode: mode,
      currentMode: mode,
      reasons: [],
    }),
  };

  const manifest: SkillManifest = {
    id: "alphaos",
    version: "0.2.0",
    description: "test",
    strategyIds: ["dex-arbitrage"],
  };

  const app = createServer(engine as never, store, manifest, {
    apiSecret: TEST_API_SECRET,
    demoPublic: false,
    agentCommSendDeps: {
      config,
      vault,
    },
  });

  return {
    app,
    store,
    vault,
    config,
  };
}

describe("agent-comm send API", () => {
  it("keeps send routes behind bearer auth", async () => {
    const { app } = buildApp();

    const response = await invokeApi(app, "POST", "/api/v1/agent-comm/send/ping", {
      peerId: "peer-b",
    });

    expect(response.status).toBe(401);
    expect(vi.mocked(sendCommPing)).not.toHaveBeenCalled();
  });

  it("forwards ping and start-discovery sends to the existing entrypoints", async () => {
    const { app, store, vault, config } = buildApp();

    vi.mocked(sendCommPing).mockResolvedValue({
      address: "0x1111111111111111111111111111111111111111",
      pubkey: "03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chainId: 196,
      walletAlias: "agent-comm",
      defaultSenderPeerId: "agent-comm",
      txHash: "0xping",
      nonce: "ping-nonce",
      sentAt: "2026-03-06T00:00:00.000Z",
      peerId: "peer-b",
      recipient: "0x9999999999999999999999999999999999999999",
      senderPeerId: "agent-a",
      commandType: "ping",
    });
    vi.mocked(sendCommStartDiscovery).mockResolvedValue({
      address: "0x1111111111111111111111111111111111111111",
      pubkey: "03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chainId: 196,
      walletAlias: "agent-comm",
      defaultSenderPeerId: "agent-comm",
      txHash: "0xdiscovery",
      nonce: "discovery-nonce",
      sentAt: "2026-03-06T00:00:01.000Z",
      peerId: "peer-b",
      recipient: "0x9999999999999999999999999999999999999999",
      senderPeerId: "agent-a",
      commandType: "start_discovery",
    });

    const pingResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/send/ping",
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        echo: "hello",
        note: "smoke",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(pingResponse.status).toBe(200);
    expect((pingResponse.body as { txHash: string }).txHash).toBe("0xping");
    expect(vi.mocked(sendCommPing)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendCommPing)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        echo: "hello",
        note: "smoke",
      },
    );

    const discoveryResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/send/start-discovery",
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        strategyId: "spread-threshold",
        pairs: ["eth/usdc", "BTC/USDC"],
        durationMinutes: 30,
        sampleIntervalSec: 5,
        topN: 10,
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(discoveryResponse.status).toBe(200);
    expect((discoveryResponse.body as { txHash: string }).txHash).toBe("0xdiscovery");
    expect(vi.mocked(sendCommStartDiscovery)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendCommStartDiscovery)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        strategyId: "spread-threshold",
        pairs: ["ETH/USDC", "BTC/USDC"],
        durationMinutes: 30,
        sampleIntervalSec: 5,
        topN: 10,
      },
    );
  });
});
