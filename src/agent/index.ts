import { randomUUID } from "crypto";
import { evaluatePolicy, DEFAULT_POLICY } from "../policy/index";
import { transferHbar, getBalance } from "../hedera/index";
import { recordAuditEntry } from "../audit/index";
import { parseInstruction } from "../nlp/index";
import type { InstructionParseResult } from "../nlp/index";
import type {
  ActionRequest,
  PolicyDecision,
  AuditEntry,
  ActorContext,
  PolicyConfig,
  HederaConfig,
} from "../types/index";
import { ActionRequestSchema } from "../types/index";

// ── Agent ─────────────────────────────────────────────────────────────────────

export interface AgentOptions {
  policy?: PolicyConfig;
  hedera?: HederaConfig;
  /** When true, skip actual execution even if policy allows (dry-run mode) */
  dryRun?: boolean;
  verbose?: boolean;
}

export interface AgentResult {
  request: ActionRequest;
  decision: PolicyDecision;
  auditEntry: AuditEntry;
}

export interface InstructionResult extends Partial<AgentResult> {
  /** True if the NL parser successfully produced a draft request */
  parsed: boolean;
  /** The raw parse result (useful for debugging failed parses) */
  parseResult: InstructionParseResult;
}

/** Raw input to runAgent: caller supplies the action fields + actor. */
export type RunAgentInput = Omit<Partial<ActionRequest>, "actor"> & {
  action: ActionRequest["action"];
  initiatorId: ActionRequest["initiatorId"];
  actor: ActorContext;
};

/**
 * The core Sentinel agent.
 *
 * Flow:
 *   1. Validate the incoming request (Zod schema)
 *   2. Run deterministic policy checks (includes actor-role + approvals)
 *   3. If allowed (and not dry-run): execute the action via Hedera wrappers
 *   4. Write an immutable audit entry to HCS
 */
export async function runAgent(
  rawRequest: RunAgentInput,
  options: AgentOptions = {}
): Promise<AgentResult> {
  const { policy = DEFAULT_POLICY, hedera, dryRun = false, verbose = false } = options;

  // 1. Build and validate request
  const request = ActionRequestSchema.parse({
    id: randomUUID(),
    timestamp: Date.now(),
    ...rawRequest,
  });

  if (verbose) {
    console.log(
      `[agent] Request ${request.id}: ${request.action} ` +
        `from ${request.initiatorId} actor=${request.actor.actorId} role=${request.actor.role}`
    );
  }

  // 2. Policy evaluation
  const decision = evaluatePolicy(request, policy);

  if (verbose) {
    const verdict = decision.allowed ? "ALLOWED" : "DENIED";
    console.log(
      `[agent] Decision: ${verdict}  rule=${decision.ruleId}  reason="${decision.reason}"`
    );
  }

  // 3. Execute (if permitted and not a dry run)
  let outcome: AuditEntry["outcome"] | undefined;

  if (decision.allowed && !dryRun) {
    outcome = await executeAction(request, hedera, verbose);
  } else if (decision.allowed && dryRun) {
    if (verbose) console.log("[agent] Dry-run mode – skipping execution.");
  }

  // 4. Audit
  const auditEntry = await recordAuditEntry(request, decision, outcome, hedera);

  if (verbose) {
    console.log(
      `[agent] Audit entry ${auditEntry.auditId} written to topic ${auditEntry.topicId}`
    );
  }

  return { request, decision, auditEntry };
}

/**
 * Runs the agent from a natural-language instruction.
 *
 * The NLP layer produces a draft ActionRequest which is then fed through
 * the same validate → policy → execute → audit pipeline as `runAgent`.
 * If parsing fails, no audit entry is written and `parsed: false` is
 * returned so the caller can surface the error.
 */
export async function runInstruction(
  instruction: string,
  actor: ActorContext,
  options: AgentOptions & { defaultInitiatorId?: string } = {}
): Promise<InstructionResult> {
  const { defaultInitiatorId, ...agentOptions } = options;
  const parseResult = parseInstruction(instruction, defaultInitiatorId);

  if (!parseResult.ok || !parseResult.draft) {
    if (agentOptions.verbose) {
      console.log(`[agent] NL parse failed: ${parseResult.error}`);
    }
    return { parsed: false, parseResult };
  }

  const result = await runAgent(
    {
      ...parseResult.draft,
      actor,
      instruction,
    },
    agentOptions
  );

  return { parsed: true, parseResult, ...result };
}

// ── Action dispatcher ─────────────────────────────────────────────────────────

async function executeAction(
  request: ActionRequest,
  config: HederaConfig | undefined,
  verbose: boolean
): Promise<AuditEntry["outcome"]> {
  try {
    switch (request.action) {
      case "transfer_hbar": {
        const result = await transferHbar(
          request.initiatorId,
          request.recipientId!,
          request.amountTinybar!,
          config
        );
        if (verbose) {
          console.log(
            result.success
              ? `[agent] Transfer OK – txId=${result.txId}`
              : `[agent] Transfer FAILED – ${result.errorMessage}`
          );
        }
        return {
          success: result.success,
          txId: result.txId || undefined,
          errorMessage: result.errorMessage,
        };
      }

      case "check_balance": {
        const result = await getBalance(request.initiatorId, config);
        if (verbose) {
          console.log(`[agent] Balance of ${result.accountId}: ${result.hbar} HBAR`);
        }
        return { success: true };
      }

      case "write_audit":
      case "read_audit":
        // Handled by the audit module separately; nothing to execute here.
        return { success: true };

      default: {
        const exhaustive: never = request.action;
        return { success: false, errorMessage: `Unknown action: ${exhaustive}` };
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { success: false, errorMessage };
  }
}
