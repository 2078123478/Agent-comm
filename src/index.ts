import { createLogger } from "./skills/alphaos/runtime/logger";
import { loadConfig } from "./skills/alphaos/runtime/config";
import { createAlphaOsSkill } from "./skills/alphaos/skill";
import { createServer } from "./skills/alphaos/api/server";
import { StateStore } from "./skills/alphaos/runtime/state-store";
import { VaultService } from "./skills/alphaos/runtime/vault";

async function run(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const command = process.argv[2];
  if (command === "vault:set") {
    const alias = process.argv[3];
    const value = process.argv[4];
    const masterPassword = process.env.VAULT_MASTER_PASSWORD;
    if (!alias || !value || !masterPassword) {
      throw new Error("Usage: tsx src/index.ts vault:set <alias> <value> with VAULT_MASTER_PASSWORD");
    }
    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    vault.setSecret(alias, value, masterPassword);
    store.close();
    logger.info({ alias }, "vault secret stored");
    return;
  }

  if (command === "vault:get") {
    const alias = process.argv[3];
    const masterPassword = process.env.VAULT_MASTER_PASSWORD;
    if (!alias || !masterPassword) {
      throw new Error("Usage: tsx src/index.ts vault:get <alias> with VAULT_MASTER_PASSWORD");
    }
    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    const value = vault.getSecret(alias, masterPassword);
    store.close();
    process.stdout.write(`${value}\n`);
    return;
  }

  const skill = createAlphaOsSkill(config, logger);
  const app = createServer(skill.engine, skill.store, skill.manifest, {
    defaultRiskPolicy: config.riskPolicy,
    onchainClient: skill.onchain,
  });

  skill.engine.start();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, skill: skill.manifest.id }, "alphaos started");
  });

  const shutdown = () => {
    skill.engine.stop();
    server.close(() => {
      skill.store.close();
      logger.info("alphaos stopped");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void run();
