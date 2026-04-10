import { randomUUID } from "crypto";
import type {
  ActionRequest,
  PolicyDecision,
  PolicyConfig,
  ActorRole,
  RoleLimits,
} from "../types/index";

// ── Default policy (override via PolicyConfig) ──────────────────────────────

const HBAR = 100_000_000;

const DEFAULT_ROLE_LIMITS: Record<ActorRole, RoleLimits> = {
  viewer: {
    maxTransferTinybar: 0,
    allowedActions: ["check_balance", "read_audit"],
  },
  operator: {
    maxTransferTinybar: 10 * HBAR,
    allowedActions: ["transfer_hbar", "check_balance", "read_audit"],
  },
  approver: {
    maxTransferTinybar: 50 * HBAR,
    allowedActions: ["transfer_hbar", "check_balance", "read_audit", "write_audit"],
  },
  admin: {
    maxTransferTinybar: 1_000 * HBAR,
    allowedActions: ["transfer_hbar", "check_balance", "read_audit", "write_audit"],
  },
};

export const DEFAULT_POLICY: PolicyConfig = {
  /** Hard ceiling: 1000 HBAR per transfer regardless of role */
  maxTransferTinybar: 1_000 * HBAR,
  approvedRecipients: ["0.0.800", "0.0.98", "0.0.2"],
  enforceApprovedRecipients: true,
  roleLimits: DEFAULT_ROLE_LIMITS,
  /** Any transfer requiring co-sign needs 1 extra approval on top of the initiator */
  approvalsRequired: 1,
  /** Anything ≥ 25 HBAR is high-value and always needs approvals */
  highValueThresholdTinybar: 25 * HBAR,
};

// ── Individual rule evaluators ──────────────────────────────────────────────

function checkRequiredFields(request: ActionRequest): PolicyDecision | null {
  if (request.action === "transfer_hbar") {
    if (request.amountTinybar === undefined) {
      return buildDecision(request.id, false, "MISSING_AMOUNT", {});
    }
    if (!request.recipientId) {
      return buildDecision(request.id, false, "MISSING_RECIPIENT", {});
    }
  }
  return null;
}

/** Rule: the actor's role must be allowed to perform this action at all. */
function checkActorRole(
  request: ActionRequest,
  config: PolicyConfig
): PolicyDecision | null {
  const limits = config.roleLimits[request.actor.role];
  if (!limits) {
    return buildDecision(request.id, false, "UNKNOWN_ROLE", {
      role: request.actor.role,
    });
  }
  if (!limits.allowedActions.includes(request.action)) {
    return buildDecision(request.id, false, "ROLE_FORBIDDEN_ACTION", {
      role: request.actor.role,
      action: request.action,
    });
  }
  return null;
}

/** Rule: transfer must be within the global amount ceiling. */
function checkAmountLimit(
  request: ActionRequest,
  config: PolicyConfig
): PolicyDecision | null {
  if (request.action !== "transfer_hbar") return null;

  const amount = request.amountTinybar ?? 0;
  if (amount > config.maxTransferTinybar) {
    return buildDecision(request.id, false, "AMOUNT_LIMIT", {
      amount,
      limit: config.maxTransferTinybar,
    });
  }
  return null;
}

/** Rule: recipient must be on the approved list (if enforcement is on). */
function checkApprovedRecipient(
  request: ActionRequest,
  config: PolicyConfig
): PolicyDecision | null {
  if (request.action !== "transfer_hbar") return null;
  if (!config.enforceApprovedRecipients) return null;

  const recipient = request.recipientId;
  if (!recipient) {
    return buildDecision(request.id, false, "MISSING_RECIPIENT", {});
  }
  if (!config.approvedRecipients.includes(recipient)) {
    return buildDecision(request.id, false, "UNAPPROVED_RECIPIENT", { recipient });
  }
  return null;
}

/**
 * Rule: if the transfer exceeds the initiator role's solo cap or the
 * high-value threshold, the request must carry `approvalsRequired`
 * co-signatures from distinct actors (excluding the initiator).
 * Admins bypass approval thresholds.
 */
function checkApprovalThreshold(
  request: ActionRequest,
  config: PolicyConfig
): PolicyDecision | null {
  if (request.action !== "transfer_hbar") return null;

  const amount = request.amountTinybar ?? 0;
  const role = request.actor.role;
  if (role === "admin") return null;

  const roleCap = config.roleLimits[role]?.maxTransferTinybar ?? 0;
  const needsApprovalForRoleCap = amount > roleCap;
  const needsApprovalForHighValue = amount >= config.highValueThresholdTinybar;

  if (!needsApprovalForRoleCap && !needsApprovalForHighValue) return null;

  // De-duplicate approvals and exclude the initiator (self-approval is invalid).
  const uniqueApprovals = Array.from(
    new Set((request.actor.approvals ?? []).filter((id) => id !== request.actor.actorId))
  );
  const have = uniqueApprovals.length;
  const need = config.approvalsRequired;

  if (have >= need) return null;

  return buildDecision(request.id, false, "APPROVAL_THRESHOLD", {
    amount,
    roleCap,
    highValueThreshold: config.highValueThresholdTinybar,
    have,
    need,
    trigger: needsApprovalForHighValue ? "high_value" : "role_cap",
  });
}

// ── Rule registry ───────────────────────────────────────────────────────────

type RuleEvaluator = (
  request: ActionRequest,
  config: PolicyConfig
) => PolicyDecision | null;

const RULES: Array<{ id: string; evaluate: RuleEvaluator }> = [
  { id: "REQUIRED_FIELDS", evaluate: (req) => checkRequiredFields(req) },
  { id: "ACTOR_ROLE", evaluate: (req, cfg) => checkActorRole(req, cfg) },
  { id: "AMOUNT_LIMIT", evaluate: (req, cfg) => checkAmountLimit(req, cfg) },
  { id: "APPROVED_RECIPIENT", evaluate: (req, cfg) => checkApprovedRecipient(req, cfg) },
  { id: "APPROVAL_THRESHOLD", evaluate: (req, cfg) => checkApprovalThreshold(req, cfg) },
];

// ── Public evaluator ────────────────────────────────────────────────────────

/**
 * Deterministically evaluates all policy rules in order.
 * Returns the first denial, or an "ALLOW_ALL" decision if all rules pass.
 */
export function evaluatePolicy(
  request: ActionRequest,
  config: PolicyConfig = DEFAULT_POLICY
): PolicyDecision {
  for (const rule of RULES) {
    const decision = rule.evaluate(request, config);
    if (decision !== null) return decision;
  }

  return {
    requestId: request.id,
    allowed: true,
    reason: "All policy rules passed.",
    ruleId: "ALLOW_ALL",
    decidedAt: Date.now(),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const RULE_MESSAGES: Record<string, (ctx: Record<string, unknown>) => string> = {
  MISSING_AMOUNT: () => "Transfer action requires an amountTinybar.",
  MISSING_RECIPIENT: () => "Transfer action requires a recipientId.",
  AMOUNT_LIMIT: (ctx) =>
    `Amount ${ctx.amount} tinybar exceeds policy limit of ${ctx.limit} tinybar.`,
  UNAPPROVED_RECIPIENT: (ctx) =>
    `Recipient ${ctx.recipient} is not on the approved recipients list.`,
  UNKNOWN_ROLE: (ctx) => `Actor role '${ctx.role}' is not recognised.`,
  ROLE_FORBIDDEN_ACTION: (ctx) =>
    `Role '${ctx.role}' is not permitted to perform action '${ctx.action}'.`,
  APPROVAL_THRESHOLD: (ctx) =>
    `Transfer of ${ctx.amount} tinybar requires ${ctx.need} approval(s) ` +
    `(trigger: ${ctx.trigger}); only ${ctx.have} supplied.`,
};

function buildDecision(
  requestId: string,
  allowed: boolean,
  ruleId: string,
  ctx: Record<string, unknown>
): PolicyDecision {
  const messageFn = RULE_MESSAGES[ruleId];
  const reason = messageFn ? messageFn(ctx) : `Policy rule '${ruleId}' denied the request.`;
  return {
    requestId,
    allowed,
    reason,
    ruleId,
    context: Object.keys(ctx).length > 0 ? ctx : undefined,
    decidedAt: Date.now(),
  };
}

// Re-export for convenience
export { randomUUID };
