import { randomUUID } from "crypto";
import { writeAudit, readAudit, ensureTopic } from "../hedera/index.js";
import type {
  ActionRequest,
  PolicyDecision,
  AuditEntry,
  HederaConfig,
} from "../types/index.js";

// ── Audit service ─────────────────────────────────────────────────────────────

/**
 * Constructs an AuditEntry and writes it to the HCS topic.
 */
export async function recordAuditEntry(
  request: ActionRequest,
  decision: PolicyDecision,
  outcome?: AuditEntry["outcome"],
  config?: HederaConfig
): Promise<AuditEntry> {
  const topic = await ensureTopic("SikaHub-Sentinel-Audit", config);

  const entry: AuditEntry = {
    auditId: randomUUID(),
    request,
    decision,
    outcome,
    topicId: topic.topicId,
    recordedAt: Date.now(),
  };

  const result = await writeAudit(topic.topicId, JSON.stringify(entry), config);

  if (!result.success) {
    console.warn(`[audit] Failed to write audit entry: ${result.errorMessage}`);
  }

  return entry;
}

/**
 * Fetches and parses all audit entries from the HCS topic.
 */
export async function fetchAuditLog(
  topicId: string,
  config?: HederaConfig
): Promise<AuditEntry[]> {
  const result = await readAudit(topicId, config);

  return result.messages.flatMap((msg) => {
    try {
      return [JSON.parse(msg.contents) as AuditEntry];
    } catch {
      console.warn(`[audit] Could not parse message seq=${msg.sequenceNumber}`);
      return [];
    }
  });
}

/**
 * Pretty-prints an audit entry to stdout.
 */
export function printAuditEntry(entry: AuditEntry): void {
  const status = entry.decision.allowed ? "ALLOWED" : "DENIED ";
  const action = entry.request.action.padEnd(16);
  const from = entry.request.initiatorId;
  const to = entry.request.recipientId ?? "—";
  const amount = entry.request.amountTinybar !== undefined
    ? `${(entry.request.amountTinybar / 100_000_000).toFixed(8)} HBAR`
    : "—";
  const rule = entry.decision.ruleId ?? "—";
  const ts = new Date(entry.recordedAt).toISOString();

  console.log(`  [${status}] ${ts}  action=${action} from=${from} to=${to} amount=${amount} rule=${rule}`);
  if (!entry.decision.allowed) {
    console.log(`           reason: ${entry.decision.reason}`);
  }
  if (entry.outcome) {
    const ex = entry.outcome.success ? "OK" : `ERR: ${entry.outcome.errorMessage}`;
    console.log(`           execution: ${ex}${entry.outcome.txId ? `  txId=${entry.outcome.txId}` : ""}`);
  }
}
