/**
 * Hedera wrappers – stub implementations suitable for demos and offline testing.
 *
 * Each function mirrors the signature of a real Hedera SDK call but returns
 * controlled fake data. Replace the stub bodies with real SDK calls once you
 * have operator credentials and a live topic ID.
 */

import type { HederaConfig } from "../types/index";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BalanceResult {
  accountId: string;
  hbar: number;
  tinybar: number;
}

export interface TransferResult {
  success: boolean;
  txId: string;
  fromId: string;
  toId: string;
  amountTinybar: number;
  consensusTimestamp?: string;
  errorMessage?: string;
}

export interface TopicInfo {
  topicId: string;
  memo: string;
  createdAt: number;
  stub: boolean;
}

export interface AuditWriteResult {
  success: boolean;
  topicId: string;
  sequenceNumber: number;
  consensusTimestamp?: string;
  errorMessage?: string;
}

export interface AuditReadResult {
  topicId: string;
  messages: Array<{
    sequenceNumber: number;
    consensusTimestamp: string;
    contents: string;
  }>;
}

// ── Stub state (in-memory for demos) ─────────────────────────────────────────

const STUB_BALANCES: Record<string, number> = {
  "0.0.800": 1_000_000_000_000, // 10 000 HBAR
  "0.0.98": 500_000_000_000,
  "0.0.2": 2_000_000_000_000,
  "0.0.12345": 150_000_000, // 1.5 HBAR – demo operator
};

let stubSequence = 1;
const stubMessages: AuditReadResult["messages"] = [];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the HBAR balance for the given account.
 *
 * Stub: returns a pre-seeded in-memory value; unknown accounts default to 0.
 */
export async function getBalance(
  accountId: string,
  _config?: HederaConfig
): Promise<BalanceResult> {
  await simulateDelay(80);
  const tinybar = STUB_BALANCES[accountId] ?? 0;
  return {
    accountId,
    hbar: tinybar / 100_000_000,
    tinybar,
  };
}

/**
 * Submits a CryptoTransfer transaction.
 *
 * Stub: validates that from ≠ to and amount > 0, then mutates in-memory
 * balances and returns a fake transaction ID.
 */
export async function transferHbar(
  fromId: string,
  toId: string,
  amountTinybar: number,
  _config?: HederaConfig
): Promise<TransferResult> {
  await simulateDelay(300);

  if (fromId === toId) {
    return {
      success: false,
      txId: "",
      fromId,
      toId,
      amountTinybar,
      errorMessage: "Sender and recipient must differ.",
    };
  }
  if (amountTinybar <= 0) {
    return {
      success: false,
      txId: "",
      fromId,
      toId,
      amountTinybar,
      errorMessage: "Amount must be positive.",
    };
  }

  const senderBalance = STUB_BALANCES[fromId] ?? 0;
  if (senderBalance < amountTinybar) {
    return {
      success: false,
      txId: "",
      fromId,
      toId,
      amountTinybar,
      errorMessage: `Insufficient balance: have ${senderBalance}, need ${amountTinybar}.`,
    };
  }

  STUB_BALANCES[fromId] = senderBalance - amountTinybar;
  STUB_BALANCES[toId] = (STUB_BALANCES[toId] ?? 0) + amountTinybar;

  const txId = buildFakeTxId(fromId);
  return {
    success: true,
    txId,
    fromId,
    toId,
    amountTinybar,
    consensusTimestamp: new Date().toISOString(),
  };
}

/**
 * Ensures a Hedera Consensus Service topic exists.
 *
 * Stub: returns the provided topicId or creates a deterministic fake one.
 */
export async function ensureTopic(
  memo: string,
  config?: HederaConfig
): Promise<TopicInfo> {
  await simulateDelay(200);
  const topicId = config?.auditTopicId ?? "0.0.999999";
  return {
    topicId,
    memo,
    createdAt: Date.now(),
    stub: true,
  };
}

/**
 * Writes a message to a Hedera Consensus Service topic.
 *
 * Stub: appends the message to an in-memory buffer and returns a fake result.
 */
export async function writeAudit(
  topicId: string,
  message: string,
  _config?: HederaConfig
): Promise<AuditWriteResult> {
  await simulateDelay(150);
  const seq = stubSequence++;
  stubMessages.push({
    sequenceNumber: seq,
    consensusTimestamp: new Date().toISOString(),
    contents: message,
  });
  return {
    success: true,
    topicId,
    sequenceNumber: seq,
    consensusTimestamp: new Date().toISOString(),
  };
}

/**
 * Reads messages from a Hedera Consensus Service topic.
 *
 * Stub: returns messages from the in-memory buffer filtered to the given topic.
 * (The stub ignores topicId since it's a single shared buffer.)
 */
export async function readAudit(
  topicId: string,
  _config?: HederaConfig
): Promise<AuditReadResult> {
  await simulateDelay(100);
  return {
    topicId,
    messages: [...stubMessages],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function simulateDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFakeTxId(accountId: string): string {
  const ts = Date.now();
  // Format: 0.0.XXXXX@<seconds>.<nanos>
  const seconds = Math.floor(ts / 1000);
  const nanos = (ts % 1000) * 1_000_000;
  return `${accountId}@${seconds}.${nanos}`;
}
