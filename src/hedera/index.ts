/**
 * Hedera wrappers.
 *
 * Every function accepts an optional `HederaConfig`:
 *   - If a valid config is supplied, the real `@hashgraph/sdk` is used and
 *     transactions are submitted to the configured network.
 *   - If no config is supplied (or the config is incomplete) the wrappers
 *     fall back to deterministic in-memory stubs, so demos and tests run
 *     without any credentials.
 *
 * Live clients are cached per-operator to avoid rebuilding gRPC channels
 * on every call.
 */

import {
  AccountBalanceQuery,
  AccountId,
  Client,
  Hbar,
  HbarUnit,
  PrivateKey,
  TopicCreateTransaction,
  TopicId,
  TopicMessageSubmitTransaction,
  TransferTransaction,
} from "@hashgraph/sdk";

import type { HederaConfig } from "../types/index";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BalanceResult {
  accountId: string;
  hbar: number;
  tinybar: number;
  stub: boolean;
}

export interface TransferResult {
  success: boolean;
  txId: string;
  fromId: string;
  toId: string;
  amountTinybar: number;
  consensusTimestamp?: string;
  errorMessage?: string;
  stub: boolean;
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
  stub: boolean;
}

export interface AuditReadResult {
  topicId: string;
  messages: Array<{
    sequenceNumber: number;
    consensusTimestamp: string;
    contents: string;
  }>;
  stub: boolean;
}

// ── Client cache ─────────────────────────────────────────────────────────────

const clientCache = new Map<string, Client>();

function getClient(config: HederaConfig): Client {
  const cacheKey = `${config.network}:${config.operatorId}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const client =
    config.network === "mainnet"
      ? Client.forMainnet()
      : config.network === "previewnet"
        ? Client.forPreviewnet()
        : Client.forTestnet();

  const operatorId = AccountId.fromString(config.operatorId);
  const operatorKey = PrivateKey.fromString(config.operatorKey);
  client.setOperator(operatorId, operatorKey);

  clientCache.set(cacheKey, client);
  return client;
}

/** Explicitly close any cached clients (useful in tests and graceful shutdown). */
export function closeHederaClients(): void {
  for (const client of clientCache.values()) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
  clientCache.clear();
}

// ── Stub state (in-memory, for demos and tests) ──────────────────────────────

const STUB_BALANCES: Record<string, number> = {
  "0.0.800": 1_000_000_000_000, // 10 000 HBAR
  "0.0.98": 500_000_000_000,
  "0.0.2": 2_000_000_000_000,
  "0.0.12345": 50_000_000_000, // 500 HBAR – demo operator
};

let stubSequence = 1;
const stubMessagesByTopic: Map<string, AuditReadResult["messages"]> = new Map();

function stubMessages(topicId: string): AuditReadResult["messages"] {
  let bucket = stubMessagesByTopic.get(topicId);
  if (!bucket) {
    bucket = [];
    stubMessagesByTopic.set(topicId, bucket);
  }
  return bucket;
}

/** Reset all stub state. Intended for tests. */
export function resetStubState(): void {
  stubSequence = 1;
  stubMessagesByTopic.clear();
  Object.assign(STUB_BALANCES, {
    "0.0.800": 1_000_000_000_000,
    "0.0.98": 500_000_000_000,
    "0.0.2": 2_000_000_000_000,
    "0.0.12345": 50_000_000_000,
  });
}

// ── getBalance ───────────────────────────────────────────────────────────────

export async function getBalance(
  accountId: string,
  config?: HederaConfig
): Promise<BalanceResult> {
  if (!config) return stubGetBalance(accountId);

  try {
    const client = getClient(config);
    const balance = await new AccountBalanceQuery()
      .setAccountId(AccountId.fromString(accountId))
      .execute(client);

    const tinybar = balance.hbars.toTinybars().toNumber();
    return {
      accountId,
      tinybar,
      hbar: tinybar / 100_000_000,
      stub: false,
    };
  } catch (err) {
    throw wrapSdkError("getBalance", err);
  }
}

async function stubGetBalance(accountId: string): Promise<BalanceResult> {
  await simulateDelay(40);
  const tinybar = STUB_BALANCES[accountId] ?? 0;
  return { accountId, hbar: tinybar / 100_000_000, tinybar, stub: true };
}

// ── transferHbar ─────────────────────────────────────────────────────────────

export async function transferHbar(
  fromId: string,
  toId: string,
  amountTinybar: number,
  config?: HederaConfig
): Promise<TransferResult> {
  if (!config) return stubTransferHbar(fromId, toId, amountTinybar);

  try {
    const client = getClient(config);
    const tx = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(fromId), Hbar.from(-amountTinybar, HbarUnit.Tinybar))
      .addHbarTransfer(AccountId.fromString(toId), Hbar.from(amountTinybar, HbarUnit.Tinybar))
      .execute(client);

    const receipt = await tx.getReceipt(client);
    const ok = receipt.status.toString() === "SUCCESS";
    return {
      success: ok,
      txId: tx.transactionId.toString(),
      fromId,
      toId,
      amountTinybar,
      consensusTimestamp: new Date().toISOString(),
      errorMessage: ok ? undefined : receipt.status.toString(),
      stub: false,
    };
  } catch (err) {
    return {
      success: false,
      txId: "",
      fromId,
      toId,
      amountTinybar,
      errorMessage: err instanceof Error ? err.message : String(err),
      stub: false,
    };
  }
}

async function stubTransferHbar(
  fromId: string,
  toId: string,
  amountTinybar: number
): Promise<TransferResult> {
  await simulateDelay(120);

  if (fromId === toId) {
    return failedStubTransfer(fromId, toId, amountTinybar, "Sender and recipient must differ.");
  }
  if (amountTinybar <= 0) {
    return failedStubTransfer(fromId, toId, amountTinybar, "Amount must be positive.");
  }

  const senderBalance = STUB_BALANCES[fromId] ?? 0;
  if (senderBalance < amountTinybar) {
    return failedStubTransfer(
      fromId,
      toId,
      amountTinybar,
      `Insufficient balance: have ${senderBalance}, need ${amountTinybar}.`
    );
  }

  STUB_BALANCES[fromId] = senderBalance - amountTinybar;
  STUB_BALANCES[toId] = (STUB_BALANCES[toId] ?? 0) + amountTinybar;

  return {
    success: true,
    txId: buildFakeTxId(fromId),
    fromId,
    toId,
    amountTinybar,
    consensusTimestamp: new Date().toISOString(),
    stub: true,
  };
}

function failedStubTransfer(
  fromId: string,
  toId: string,
  amountTinybar: number,
  errorMessage: string
): TransferResult {
  return {
    success: false,
    txId: "",
    fromId,
    toId,
    amountTinybar,
    errorMessage,
    stub: true,
  };
}

// ── ensureTopic ──────────────────────────────────────────────────────────────

export async function ensureTopic(
  memo: string,
  config?: HederaConfig
): Promise<TopicInfo> {
  if (!config) {
    await simulateDelay(20);
    return { topicId: "0.0.999999", memo, createdAt: Date.now(), stub: true };
  }

  // If the caller supplied an explicit topic, trust it.
  if (config.auditTopicId) {
    return { topicId: config.auditTopicId, memo, createdAt: Date.now(), stub: false };
  }

  try {
    const client = getClient(config);
    const tx = await new TopicCreateTransaction().setTopicMemo(memo).execute(client);
    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId;
    if (!topicId) throw new Error("TopicCreateTransaction returned no topicId.");
    return {
      topicId: topicId.toString(),
      memo,
      createdAt: Date.now(),
      stub: false,
    };
  } catch (err) {
    throw wrapSdkError("ensureTopic", err);
  }
}

// ── writeAudit ───────────────────────────────────────────────────────────────

export async function writeAudit(
  topicId: string,
  message: string,
  config?: HederaConfig
): Promise<AuditWriteResult> {
  if (!config) {
    await simulateDelay(30);
    const seq = stubSequence++;
    stubMessages(topicId).push({
      sequenceNumber: seq,
      consensusTimestamp: new Date().toISOString(),
      contents: message,
    });
    return {
      success: true,
      topicId,
      sequenceNumber: seq,
      consensusTimestamp: new Date().toISOString(),
      stub: true,
    };
  }

  try {
    const client = getClient(config);
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const seq = receipt.topicSequenceNumber?.toNumber() ?? -1;
    return {
      success: receipt.status.toString() === "SUCCESS",
      topicId,
      sequenceNumber: seq,
      consensusTimestamp: new Date().toISOString(),
      stub: false,
    };
  } catch (err) {
    return {
      success: false,
      topicId,
      sequenceNumber: -1,
      errorMessage: err instanceof Error ? err.message : String(err),
      stub: false,
    };
  }
}

// ── readAudit ────────────────────────────────────────────────────────────────

/**
 * Reads audit messages from a Hedera Consensus Service topic.
 *
 * Live mode: reads from the Hedera mirror-node REST API. (The SDK's
 * `TopicMessageQuery` is a streaming subscription and is not well-suited
 * to one-shot reads.)
 *
 * Stub mode: returns in-memory messages written via `writeAudit`.
 */
export async function readAudit(
  topicId: string,
  config?: HederaConfig
): Promise<AuditReadResult> {
  if (!config) {
    await simulateDelay(30);
    return {
      topicId,
      messages: [...stubMessages(topicId)],
      stub: true,
    };
  }

  const base =
    config.network === "mainnet"
      ? "https://mainnet-public.mirrornode.hedera.com"
      : config.network === "previewnet"
        ? "https://previewnet.mirrornode.hedera.com"
        : "https://testnet.mirrornode.hedera.com";

  const url = `${base}/api/v1/topics/${encodeURIComponent(topicId)}/messages?limit=100&order=asc`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Mirror node ${res.status}: ${res.statusText}`);
    }
    const body = (await res.json()) as {
      messages?: Array<{
        sequence_number: number;
        consensus_timestamp: string;
        message: string;
      }>;
    };
    const messages = (body.messages ?? []).map((m) => ({
      sequenceNumber: m.sequence_number,
      consensusTimestamp: m.consensus_timestamp,
      // Mirror node returns base64
      contents: Buffer.from(m.message, "base64").toString("utf8"),
    }));
    return { topicId, messages, stub: false };
  } catch (err) {
    throw wrapSdkError("readAudit", err);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function simulateDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFakeTxId(accountId: string): string {
  const ts = Date.now();
  const seconds = Math.floor(ts / 1000);
  const nanos = (ts % 1000) * 1_000_000;
  return `${accountId}@${seconds}.${nanos}`;
}

function wrapSdkError(op: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`Hedera ${op} failed: ${msg}`);
}
