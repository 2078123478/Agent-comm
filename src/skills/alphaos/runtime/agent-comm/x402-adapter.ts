import type { StateStore } from "../state-store";
import type { X402Mode, X402Proof } from "./types";

export interface X402AdapterOptions {
  mode: X402Mode;
  store: StateStore;
}

export interface X402VerificationResult {
  valid: boolean;
  payer?: string;
  amount?: string;
  asset?: string;
  error?: string;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readProofField(proof: X402Proof, field: string): string | undefined {
  const value = (proof as Record<string, unknown>)[field];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const metadata = proof.metadata as Record<string, unknown> | undefined;
  if (metadata && typeof metadata[field] === "string") {
    return (metadata[field] as string).trim();
  }
  return undefined;
}

export async function verifyX402(
  options: X402AdapterOptions,
  proof: X402Proof,
): Promise<X402VerificationResult> {
  if (options.mode === "disabled") {
    return { valid: true };
  }

  try {
    if (proof.scheme !== "x402") {
      return { valid: false, error: "invalid proof scheme" };
    }

    const payer = readProofField(proof, "payer");
    const amount = readProofField(proof, "amount");
    const asset = readProofField(proof, "asset");
    const signature = proof.signature;

    if (!payer || !amount || !asset || !signature) {
      return { valid: false, error: "missing required fields" };
    }

    if (proof.expiresAt) {
      const expiresAt = new Date(proof.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
        return { valid: false, error: "proof expired or invalid expiresAt" };
      }
    }

    // NOTE: current implementation only performs structural checks.
    // Signature authenticity is NOT verified yet; cryptographic verification will be added later.
    return { valid: true, payer, amount, asset };
  } catch (error) {
    return { valid: false, error: toErrorMessage(error) };
  }
}
