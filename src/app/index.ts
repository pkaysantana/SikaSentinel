/**
 * SikaHub Sentinel – programmatic entry point.
 *
 * Import this module to embed the Sentinel agent in a larger application.
 * For a standalone CLI use `src/cli.ts`.
 */

export { runAgent } from "../agent/index.js";
export type { AgentOptions, AgentResult } from "../agent/index.js";

export { evaluatePolicy, DEFAULT_POLICY } from "../policy/index.js";

export { getBalance, transferHbar, ensureTopic, writeAudit, readAudit } from "../hedera/index.js";

export { recordAuditEntry, fetchAuditLog, printAuditEntry } from "../audit/index.js";

export type {
  ActionRequest,
  PolicyDecision,
  AuditEntry,
  PolicyConfig,
  HederaConfig,
} from "../types/index.js";

export { ActionRequestSchema, PolicyDecisionSchema, AuditEntrySchema } from "../types/index.js";
