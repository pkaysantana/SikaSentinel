import { randomUUID } from "crypto";
import type { ActionRequest, PolicyDecision, PolicyConfig } from "../types/index";

// ── Default policy (override via PolicyConfig) ──────────────────────────────

export const DEFAULT_POLICY: PolicyConfig = {
  /** 10 HBAR max per transfer */
  maxTransferTinybar: 10 * 100_000_000,
  approvedRecipients: ["0.0.800", "0.0.98", "0.0.2"],
  enforceApprovedRecipients: true,
};

// ── Individual rule evaluators ──────────────────────────────────────────────

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

// ── Rule registry ───────────────────────────────────────────────────────────

type RuleEvaluator = (
  request: ActionRequest,
  config: PolicyConfig
) => PolicyDecision | null;

const RULES: Array<{ id: string; evaluate: RuleEvaluator }> = [
  {
    id: "REQUIRED_FIELDS",
    evaluate: (req) => checkRequiredFields(req),
  },
  {
    id: "AMOUNT_LIMIT",
    evaluate: (req, cfg) => checkAmountLimit(req, cfg),
  },
  {
    id: "APPROVED_RECIPIENT",
    evaluate: (req, cfg) => checkApprovedRecipient(req, cfg),
  },
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
    decidedAt: Date.now(),
  };
}

// Re-export for convenience
export { randomUUID };
