import { StateStore } from "../state-store";
import type { AgentPeer, AgentPeerCapability, AgentPeerStatus } from "./types";

export interface RegisterPeerInput {
  peerId: string;
  walletAddress: string;
  pubkey: string;
  name?: string;
  status?: AgentPeerStatus;
  capabilities?: AgentPeerCapability[];
  metadata?: Record<string, unknown>;
}

export function registerPeer(store: StateStore, peer: RegisterPeerInput): AgentPeer {
  return store.upsertAgentPeer(peer);
}

export function getTrustedPeers(store: StateStore): AgentPeer[] {
  return store.listAgentPeers(1000, "trusted");
}

export function trustPeer(store: StateStore, peerId: string): AgentPeer {
  const peer = store.getAgentPeer(peerId);
  if (!peer) {
    throw new Error(`Peer not found: ${peerId}`);
  }

  return store.upsertAgentPeer({
    peerId: peer.peerId,
    walletAddress: peer.walletAddress,
    pubkey: peer.pubkey,
    name: peer.name,
    status: "trusted",
    capabilities: peer.capabilities,
    metadata: peer.metadata,
  });
}

export class PeerRegistry {
  constructor(private readonly store: StateStore) {}

  registerPeer(peer: RegisterPeerInput): AgentPeer {
    return registerPeer(this.store, peer);
  }

  getTrustedPeers(): AgentPeer[] {
    return getTrustedPeers(this.store);
  }

  trustPeer(peerId: string): AgentPeer {
    return trustPeer(this.store, peerId);
  }
}
