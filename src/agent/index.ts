import { randomUUID } from "crypto";
import { evaluatePolicy, DEFAULT_POLICY } from "../policy/index.js";
import { transferHbar, getBalance } from "../hedera/index.js";
import { recordAuditEntry } from "../audit/index.js";
import type {
  ActionRequest,
  PolicyDecision,
  AuditEntry,
  PolicyConfig,
  HederaConfig,
} from "../types/index.js";
import { ActionRequestSchema } from "../types/index.js";

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

/**
 * The core Sentinel agent.
 *
 * Flow:
 *   1. Validate the incoming request (Zod schema)
 *   2. Run deterministic policy checks
 *   3. If allowed (and not dry-run): execute the action via Hedera wrappers
 *   4. Write an immutable audit entry to HCS
 */
export async function runAgent(
  rawRequest: Partial<ActionRequest> & Pick<ActionRequest, "action" | "initiatorId">,
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
    console.log(`[agent] Request ${request.id}: ${request.action} from ${request.initiatorId}`);
  }

  // 2. Policy evaluation
  const decision = evaluatePolicy(request, policy);

  if (verbose) {
    const verdict = decision.allowed ? "ALLOWED" : "DENIED";
    console.log(`[agent] Decision: ${verdict}  rule=${decision.ruleId}  reason="${decision.reason}"`);
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
    console.log(`[agent] Audit entry ${auditEntry.auditId} written to topic ${auditEntry.topicId}`);
  }

  return { request, decision, auditEntry };
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
