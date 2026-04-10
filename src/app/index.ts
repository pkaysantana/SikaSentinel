/**
 * Sika Sentinel – programmatic entry point.
 *
 * Import this module to embed the Sentinel agent in a larger application.
 * For a standalone CLI use `src/cli.ts`.
 */

export { runAgent, runInstruction } from "../agent/index";
export type { AgentOptions, AgentResult, InstructionResult } from "../agent/index";

export { evaluatePolicy, DEFAULT_POLICY } from "../policy/index";

export { parseInstruction } from "../nlp/index";
export type { InstructionParseResult } from "../nlp/index";

export { getBalance, transferHbar, ensureTopic, writeAudit, readAudit } from "../hedera/index";

export { recordAuditEntry, fetchAuditLog, printAuditEntry } from "../audit/index";

export type {
  ActionRequest,
  PolicyDecision,
  AuditEntry,
  ActorContext,
  ActorRole,
  PolicyConfig,
  HederaConfig,
} from "../types/index";

export {
  ActionRequestSchema,
  PolicyDecisionSchema,
  AuditEntrySchema,
  ActorContextSchema,
} from "../types/index";
