import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import { VaultService } from "../src/skills/alphaos/runtime/vault";

describe("VaultService", () => {
  it("encrypts and decrypts a secret", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-vault-"));
    const store = new StateStore(tempDir);
    const vault = new VaultService(store);

    vault.setSecret("k1", "super-secret", "pass123");
    const loaded = vault.getSecret("k1", "pass123");

    expect(loaded).toBe("super-secret");
    expect(() => vault.getSecret("k1", "bad-pass")).toThrow();

    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
