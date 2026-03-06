import { getAddress, type Address } from "viem";
import type { StateStore } from "../state-store";
import { decodeEnvelope } from "./calldata-codec";
import { decrypt, deriveSharedKey } from "./ecdh-crypto";
import type { ShadowWallet } from "./shadow-wallet";
import {
  agentCommandSchema,
  type AgentCommand,
  type AgentMessage,
  type AgentPeer,
} from "./types";
import type { TransactionEvent } from "./tx-listener";

export interface InboxProcessorOptions {
  wallet: ShadowWallet;
  store: StateStore;
}

export interface ProcessInboxResult {
  message: AgentMessage;
  command: AgentCommand;
}

export class InboxProcessingError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "InboxProcessingError";
    this.code = code;
    this.details = details;
  }
}

function normalizeAddress(value: string, label: string): Address {
  try {
    return getAddress(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InboxProcessingError("INVALID_ADDRESS", `Invalid ${label}: ${reason}`, {
      value,
    });
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withInboxError<T>(
  code: string,
  message: string,
  details: Record<string, unknown> | undefined,
  run: () => T,
): T {
  try {
    return run();
  } catch (error) {
    throw new InboxProcessingError(code, `${message}: ${toErrorMessage(error)}`, details);
  }
}

function getTrustedPeer(store: StateStore, peerId: string, txHash: string): AgentPeer {
  const peer = store.getAgentPeer(peerId);
  if (!peer || peer.status !== "trusted") {
    throw new InboxProcessingError(
      "PEER_NOT_TRUSTED",
      "Trusted peer not found for inbound envelope",
      {
        txHash,
        senderPeerId: peerId,
      },
    );
  }
  return peer;
}

function findInboundMessage(store: StateStore, peerId: string, nonce: string): AgentMessage | null {
  return store.findAgentMessage(peerId, "inbound", nonce);
}

function parseCommand(plaintext: string): AgentCommand {
  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext);
  } catch (error) {
    const reason = toErrorMessage(error);
    throw new InboxProcessingError("INVALID_COMMAND_JSON", `Invalid command JSON: ${reason}`);
  }

  try {
    return agentCommandSchema.parse(decoded);
  } catch (error) {
    const reason = toErrorMessage(error);
    throw new InboxProcessingError("INVALID_COMMAND", `Invalid command payload: ${reason}`);
  }
}

export async function processInbox(
  options: InboxProcessorOptions,
  event: TransactionEvent,
): Promise<ProcessInboxResult> {
  const localAddress = normalizeAddress(options.wallet.getAddress(), "wallet address");
  const eventRecipient = normalizeAddress(event.to, "transaction recipient");
  if (eventRecipient !== localAddress) {
    throw new InboxProcessingError("RECIPIENT_MISMATCH", "Transaction is not addressed to this wallet", {
      txHash: event.txHash,
      expected: localAddress,
      received: eventRecipient,
    });
  }

  const envelope = withInboxError(
    "INVALID_ENVELOPE",
    "Failed to decode calldata envelope",
    { txHash: event.txHash },
    () => decodeEnvelope(event.calldata),
  );

  const envelopeRecipient = normalizeAddress(envelope.recipient, "envelope recipient");
  if (envelopeRecipient !== localAddress) {
    throw new InboxProcessingError("ENVELOPE_RECIPIENT_MISMATCH", "Envelope recipient does not match wallet", {
      txHash: event.txHash,
      expected: localAddress,
      received: envelopeRecipient,
    });
  }

  const trustedPeer = getTrustedPeer(options.store, envelope.senderPeerId, event.txHash);

  const senderAddress = normalizeAddress(event.from, "transaction sender");
  const peerWalletAddress = normalizeAddress(trustedPeer.walletAddress, "peer wallet address");
  if (senderAddress !== peerWalletAddress) {
    throw new InboxProcessingError("PEER_WALLET_MISMATCH", "Transaction sender does not match trusted peer wallet", {
      txHash: event.txHash,
      senderPeerId: trustedPeer.peerId,
      expected: peerWalletAddress,
      received: senderAddress,
    });
  }

  if (trustedPeer.pubkey.toLowerCase() !== envelope.senderPubkey.toLowerCase()) {
    throw new InboxProcessingError("PEER_PUBKEY_MISMATCH", "Envelope senderPubkey does not match trusted peer", {
      txHash: event.txHash,
      senderPeerId: trustedPeer.peerId,
    });
  }

  const sharedKey = withInboxError(
    "ECDH_DERIVE_FAILED",
    "Failed to derive shared key",
    { txHash: event.txHash },
    () => deriveSharedKey(options.wallet.privateKey, envelope.senderPubkey),
  );

  const plaintext = withInboxError(
    "DECRYPT_FAILED",
    "Failed to decrypt inbound envelope",
    {
      txHash: event.txHash,
      senderPeerId: trustedPeer.peerId,
    },
    () => decrypt(envelope.ciphertext, sharedKey),
  );

  const command = parseCommand(plaintext);
  if (command.type !== envelope.command.type) {
    throw new InboxProcessingError("COMMAND_TYPE_MISMATCH", "Envelope command descriptor does not match plaintext command", {
      txHash: event.txHash,
      envelopeType: envelope.command.type,
      plaintextType: command.type,
    });
  }

  const existingMessage = findInboundMessage(options.store, trustedPeer.peerId, envelope.nonce);
  if (existingMessage) {
    return {
      message: existingMessage,
      command,
    };
  }

  try {
    const message = options.store.insertAgentMessage({
      direction: "inbound",
      peerId: trustedPeer.peerId,
      txHash: event.txHash,
      nonce: envelope.nonce,
      commandType: command.type,
      ciphertext: envelope.ciphertext,
      status: "decrypted",
      sentAt: envelope.timestamp,
      receivedAt: event.timestamp,
    });

    return {
      message,
      command,
    };
  } catch (error) {
    const reason = toErrorMessage(error);
    const duplicateMessage = findInboundMessage(options.store, trustedPeer.peerId, envelope.nonce);
    if (duplicateMessage) {
      return {
        message: duplicateMessage,
        command,
      };
    }
    throw new InboxProcessingError("MESSAGE_INSERT_FAILED", `Failed to persist inbound message: ${reason}`, {
      txHash: event.txHash,
      senderPeerId: trustedPeer.peerId,
      nonce: envelope.nonce,
    });
  }
}
