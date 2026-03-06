import crypto from "node:crypto";
import type { AlphaOsConfig } from "../config";
import type { StateStore } from "../state-store";
import type { VaultService } from "../vault";
import { encodeEnvelope } from "./calldata-codec";
import { deriveSharedKey, encrypt } from "./ecdh-crypto";
import { registerPeer } from "./peer-registry";
import { generateShadowWallet, restoreShadowWallet, type ShadowWallet } from "./shadow-wallet";
import { sendCalldata, type SendResult } from "./tx-sender";
import {
  AGENT_COMM_ENVELOPE_VERSION,
  agentCommandSchema,
  type AgentCommand,
  type AgentPeer,
  type AgentPeerCapability,
  type PingCommandPayload,
  type StartDiscoveryCommandPayload,
} from "./types";

const DEFAULT_TRUSTED_PEER_CAPABILITIES: AgentPeerCapability[] = ["ping", "start_discovery"];

export interface AgentCommEntrypointDependencies {
  config: AlphaOsConfig;
  store: StateStore;
  vault: VaultService;
}

export interface AgentCommIdentity {
  address: string;
  pubkey: string;
  chainId: number;
  walletAlias: string;
  defaultSenderPeerId: string;
}

export interface InitCommWalletOptions {
  masterPassword?: string;
  privateKey?: string;
  senderPeerId?: string;
}

export interface InitCommWalletResult extends AgentCommIdentity {
  source: "generated" | "restored";
  replaced: boolean;
}

export interface RegisterTrustedPeerOptions {
  peerId: string;
  walletAddress: string;
  pubkey: string;
  name?: string;
  capabilities?: AgentPeerCapability[];
  metadata?: Record<string, unknown>;
}

export interface SendCommCommandOptions {
  masterPassword?: string;
  peerId: string;
  senderPeerId?: string;
  command: AgentCommand;
}

export interface SendCommCommandResult extends AgentCommIdentity, SendResult {
  peerId: string;
  recipient: string;
  senderPeerId: string;
  commandType: AgentCommand["type"];
}

interface ResolvedLocalWallet {
  wallet: ShadowWallet;
  identity: AgentCommIdentity;
}

function getRequiredMasterPassword(masterPassword?: string): string {
  const resolved = masterPassword ?? process.env.VAULT_MASTER_PASSWORD;
  if (!resolved) {
    throw new Error("VAULT_MASTER_PASSWORD is required for agent-comm wallet access");
  }
  return resolved;
}

function getRequiredCommRpcUrl(config: AlphaOsConfig): string {
  if (!config.commRpcUrl) {
    throw new Error("COMM_RPC_URL is required to send agent-comm messages");
  }
  return config.commRpcUrl;
}

function resolveSenderPeerId(config: AlphaOsConfig, senderPeerId?: string): string {
  const resolved = senderPeerId?.trim();
  return resolved && resolved.length > 0 ? resolved : config.commWalletAlias;
}

function toIdentity(
  config: AlphaOsConfig,
  wallet: ShadowWallet,
  senderPeerId?: string,
): AgentCommIdentity {
  return {
    address: wallet.getAddress(),
    pubkey: wallet.getPublicKey(),
    chainId: config.commChainId,
    walletAlias: config.commWalletAlias,
    defaultSenderPeerId: resolveSenderPeerId(config, senderPeerId),
  };
}

function resolveLocalWallet(
  deps: AgentCommEntrypointDependencies,
  masterPassword: string,
  senderPeerId?: string,
): ResolvedLocalWallet {
  const privateKey = deps.vault.getSecret(deps.config.commWalletAlias, masterPassword);
  const wallet = restoreShadowWallet(privateKey);
  return {
    wallet,
    identity: toIdentity(deps.config, wallet, senderPeerId),
  };
}

function getTrustedPeer(store: StateStore, peerId: string): AgentPeer {
  const peer = store.getAgentPeer(peerId);
  if (!peer) {
    throw new Error(`Trusted peer not found: ${peerId}`);
  }
  if (peer.status !== "trusted") {
    throw new Error(`Peer is not trusted: ${peerId}`);
  }
  return peer;
}

export function getCommIdentity(
  deps: AgentCommEntrypointDependencies,
  options: { masterPassword?: string; senderPeerId?: string } = {},
): AgentCommIdentity {
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  return resolveLocalWallet(deps, masterPassword, options.senderPeerId).identity;
}

export function initCommWallet(
  deps: AgentCommEntrypointDependencies,
  options: InitCommWalletOptions = {},
): InitCommWalletResult {
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const wallet = options.privateKey
    ? restoreShadowWallet(options.privateKey)
    : generateShadowWallet();
  const replaced = deps.store.getVaultItem(deps.config.commWalletAlias) !== null;

  deps.vault.setSecret(deps.config.commWalletAlias, wallet.privateKey, masterPassword);

  return {
    ...toIdentity(deps.config, wallet, options.senderPeerId),
    source: options.privateKey ? "restored" : "generated",
    replaced,
  };
}

export function registerTrustedPeerEntry(
  deps: Pick<AgentCommEntrypointDependencies, "store">,
  options: RegisterTrustedPeerOptions,
): AgentPeer {
  return registerPeer(deps.store, {
    peerId: options.peerId,
    walletAddress: options.walletAddress,
    pubkey: options.pubkey,
    name: options.name,
    status: "trusted",
    capabilities: options.capabilities ?? DEFAULT_TRUSTED_PEER_CAPABILITIES,
    metadata: options.metadata,
  });
}

export async function sendCommCommand(
  deps: AgentCommEntrypointDependencies,
  options: SendCommCommandOptions,
): Promise<SendCommCommandResult> {
  const command = agentCommandSchema.parse(options.command);
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const local = resolveLocalWallet(deps, masterPassword, options.senderPeerId);
  const peer = getTrustedPeer(deps.store, options.peerId);
  const senderPeerId = resolveSenderPeerId(deps.config, options.senderPeerId);
  const nonce = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sharedKey = deriveSharedKey(local.wallet.privateKey, peer.pubkey);
  const ciphertext = encrypt(JSON.stringify(command), sharedKey);
  const calldata = encodeEnvelope({
    version: AGENT_COMM_ENVELOPE_VERSION,
    senderPeerId,
    senderPubkey: local.identity.pubkey,
    recipient: peer.walletAddress,
    nonce,
    timestamp,
    command: {
      type: command.type,
      schemaVersion: 1,
    },
    ciphertext,
    signature: local.identity.pubkey,
  });
  const result = await sendCalldata(
    {
      rpcUrl: getRequiredCommRpcUrl(deps.config),
      chainId: deps.config.commChainId,
      walletAlias: deps.config.commWalletAlias,
      store: deps.store,
      outboundMessage: {
        peerId: peer.peerId,
      },
    },
    local.wallet,
    peer.walletAddress,
    calldata,
  );

  return {
    ...local.identity,
    ...result,
    peerId: peer.peerId,
    recipient: peer.walletAddress,
    senderPeerId,
    commandType: command.type,
  };
}

export async function sendCommPing(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    peerId: string;
    senderPeerId?: string;
    echo?: PingCommandPayload["echo"];
    note?: PingCommandPayload["note"];
  },
): Promise<SendCommCommandResult> {
  return sendCommCommand(deps, {
    masterPassword: options.masterPassword,
    peerId: options.peerId,
    senderPeerId: options.senderPeerId,
    command: {
      type: "ping",
      payload: {
        ...(options.echo ? { echo: options.echo } : {}),
        ...(options.note ? { note: options.note } : {}),
      },
    },
  });
}

export async function sendCommStartDiscovery(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    peerId: string;
    senderPeerId?: string;
    strategyId: string;
    pairs?: StartDiscoveryCommandPayload["pairs"];
    durationMinutes?: StartDiscoveryCommandPayload["durationMinutes"];
    sampleIntervalSec?: StartDiscoveryCommandPayload["sampleIntervalSec"];
    topN?: StartDiscoveryCommandPayload["topN"];
  },
): Promise<SendCommCommandResult> {
  return sendCommCommand(deps, {
    masterPassword: options.masterPassword,
    peerId: options.peerId,
    senderPeerId: options.senderPeerId,
    command: {
      type: "start_discovery",
      payload: {
        strategyId: options.strategyId as StartDiscoveryCommandPayload["strategyId"],
        ...(options.pairs ? { pairs: options.pairs } : {}),
        ...(options.durationMinutes ? { durationMinutes: options.durationMinutes } : {}),
        ...(options.sampleIntervalSec ? { sampleIntervalSec: options.sampleIntervalSec } : {}),
        ...(options.topN ? { topN: options.topN } : {}),
      },
    },
  });
}
