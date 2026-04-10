/**
 * Runtime configuration loader.
 *
 * Reads environment variables (via dotenv if present), normalises them into
 * a `HederaConfig`, and decides whether the Hedera wrappers should run in
 * live mode or stub mode.
 *
 * Stub mode is chosen automatically when any of the required operator
 * credentials are missing — this keeps the demo runnable with zero setup
 * while letting real deployments flip to live mode just by filling in .env.
 */

import { config as loadDotenv } from "dotenv";
import type { HederaConfig } from "../types/index";

let dotenvLoaded = false;

function ensureDotenv(): void {
  if (dotenvLoaded) return;
  loadDotenv();
  dotenvLoaded = true;
}

export interface RuntimeConfig {
  /** Hedera operator/network config — undefined in stub mode */
  hedera?: HederaConfig;
  /** True when at least one Hedera credential is missing and we must stub */
  stubMode: boolean;
  /** Explanation of which mode was chosen and why */
  modeReason: string;
}

/**
 * Loads runtime configuration from environment variables.
 *
 * Env vars consumed:
 *   HEDERA_NETWORK          "testnet" | "mainnet" | "previewnet"  (default: testnet)
 *   HEDERA_OPERATOR_ID      0.0.XXXXX
 *   HEDERA_OPERATOR_KEY     DER/hex/PEM-encoded private key
 *   HEDERA_AUDIT_TOPIC_ID   0.0.XXXXX (optional; auto-created if missing)
 *   SIKA_FORCE_STUB         "1" | "true" to force stub mode even with creds
 */
export function loadRuntimeConfig(): RuntimeConfig {
  ensureDotenv();

  const forceStub = /^(1|true|yes)$/i.test(process.env.SIKA_FORCE_STUB ?? "");
  const network = (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase();
  const operatorId = process.env.HEDERA_OPERATOR_ID?.trim();
  const operatorKey = process.env.HEDERA_OPERATOR_KEY?.trim();
  const auditTopicId = process.env.HEDERA_AUDIT_TOPIC_ID?.trim() || undefined;

  if (forceStub) {
    return {
      stubMode: true,
      modeReason: "SIKA_FORCE_STUB is set — using in-memory stubs.",
    };
  }

  if (!operatorId || !operatorKey) {
    return {
      stubMode: true,
      modeReason:
        "HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY missing — using in-memory stubs.",
    };
  }

  if (!/^0\.0\.\d+$/.test(operatorId)) {
    return {
      stubMode: true,
      modeReason: `HEDERA_OPERATOR_ID '${operatorId}' is not a valid Hedera id — using stubs.`,
    };
  }

  if (!["testnet", "mainnet", "previewnet"].includes(network)) {
    return {
      stubMode: true,
      modeReason: `HEDERA_NETWORK '${network}' is not supported — using stubs.`,
    };
  }

  return {
    stubMode: false,
    modeReason: `Live Hedera ${network} using operator ${operatorId}.`,
    hedera: {
      network: network as HederaConfig["network"],
      operatorId,
      operatorKey,
      auditTopicId,
    },
  };
}
