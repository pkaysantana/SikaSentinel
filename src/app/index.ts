/**
 * SikaHub Sentinel – programmatic entry point.
 *
 * Import this module to embed the Sentinel agent in a larger application.
 * For a standalone CLI use `src/cli.ts`.
 */

export { runAgent } from "../agent/index";
export type { AgentOptions, AgentResult } from "../agent/index";

export { evaluatePolicy, DEFAULT_POLICY } from "../policy/index";

export { getBalance, transferHbar, ensureTopic, writeAudit, readAudit } from "../hedera/index";

export { recordAuditEntry, fetchAuditLog, printAuditEntry } from "../audit/index";

export type {
  ActionRequest,
  PolicyDecision,
  AuditEntry,
  PolicyConfig,
  HederaConfig,
} from "../types/index";

export { ActionRequestSchema, PolicyDecisionSchema, AuditEntrySchema } from "../types/index";
