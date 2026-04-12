/**
 * Context Engine
 *
 * Assembles the runtime context that sits between intent parsing and policy
 * evaluation.  The context snapshot makes every policy decision fully
 * explainable: it records exactly what the engine knew about the actor,
 * the recipient, and the treasury at the moment the clearing decision was made.
 *
 * Pipeline position:
 *   Intent Agent → Context Engine → Clearing Agent → Execution Adapter → Evidence Layer
 */

import type { ActionRequest, PolicyConfig, ActorRole } from "../types/index";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CapSnapshot {
  tinybar: number;
  hbar: number;
}

/**
 * The full runtime context snapshot produced by the Context Engine.
 * This is passed to the Clearing Agent (policy evaluator) and recorded
 * in the audit trail.
 */
export interface RuntimeContext {
  /** Stable actor identifier */
  actorId: string;
  /** Display name, if supplied */
  actorDisplayName: string | undefined;
  /** Partner organisation the actor belongs to */
  partnerId: string;
  /** Role assigned to this actor */
  actorRole: ActorRole;
  /** How many co-approvals the actor already carries on this request */
  approvalsHeld: number;
  /** How many co-approvals are required to unlock high-value/over-cap transfers */
  approvalsRequired: number;
  /**
   * Whether the requested recipient is on the approved list.
   * null when the action does not have a recipient (e.g. check_balance).
   */
  recipientApproved: boolean | null;
  /** The requested recipient account, if present */
  recipientId: string | null;
  /** This role's single-actor transfer cap */
  roleCap: CapSnapshot;
  /** Hard global transfer ceiling (any role) */
  globalCap: CapSnapshot;
  /** Amount at or above which multi-approval is always required */
  highValueThreshold: CapSnapshot;
  /** Amount requested (null for non-transfer actions) */
  requestedAmount: CapSnapshot | null;
  /**
   * Treasury mode reflects whether the execution layer is connected to a
   * real Hedera network ("live") or running against in-memory stubs ("stub").
   */
  treasuryMode: "live" | "stub";
  /**
   * Corridor status: "open" when the recipient is approved (or recipient
   * enforcement is off), "restricted" when the recipient is not on the list.
   * null when not applicable.
   */
  corridorStatus: "open" | "restricted" | null;
}

// ── Builder ──────────────────────────────────────────────────────────────────

const HBAR = 100_000_000;

/**
 * Builds the RuntimeContext for a given request and policy.
 *
 * @param request   Validated action request (post-intent-parse)
 * @param policy    Active policy configuration
 * @param stubMode  Whether the execution layer is in stub/demo mode
 */
export function buildRuntimeContext(
  request: ActionRequest,
  policy: PolicyConfig,
  stubMode: boolean
): RuntimeContext {
  const role = request.actor.role;
  const roleLimits = policy.roleLimits[role];

  const roleCap: CapSnapshot = {
    tinybar: roleLimits?.maxTransferTinybar ?? 0,
    hbar: (roleLimits?.maxTransferTinybar ?? 0) / HBAR,
  };

  const globalCap: CapSnapshot = {
    tinybar: policy.maxTransferTinybar,
    hbar: policy.maxTransferTinybar / HBAR,
  };

  const highValueThreshold: CapSnapshot = {
    tinybar: policy.highValueThresholdTinybar,
    hbar: policy.highValueThresholdTinybar / HBAR,
  };

  const isTransfer = request.action === "transfer_hbar";

  const requestedAmount: CapSnapshot | null =
    isTransfer && request.amountTinybar !== undefined
      ? { tinybar: request.amountTinybar, hbar: request.amountTinybar / HBAR }
      : null;

  const recipientId = request.recipientId ?? null;

  let recipientApproved: boolean | null = null;
  let corridorStatus: "open" | "restricted" | null = null;

  if (isTransfer && recipientId !== null) {
    if (!policy.enforceApprovedRecipients) {
      recipientApproved = true;
      corridorStatus = "open";
    } else {
      recipientApproved = policy.approvedRecipients.includes(recipientId);
      corridorStatus = recipientApproved ? "open" : "restricted";
    }
  }

  const uniqueApprovals = Array.from(
    new Set((request.actor.approvals ?? []).filter((id) => id !== request.actor.actorId))
  );

  return {
    actorId: request.actor.actorId,
    actorDisplayName: request.actor.displayName,
    partnerId: request.actor.partnerId,
    actorRole: role,
    approvalsHeld: uniqueApprovals.length,
    approvalsRequired: policy.approvalsRequired,
    recipientApproved,
    recipientId,
    roleCap,
    globalCap,
    highValueThreshold,
    requestedAmount,
    treasuryMode: stubMode ? "stub" : "live",
    corridorStatus,
  };
}

// ── Printer ──────────────────────────────────────────────────────────────────

/**
 * Renders the RuntimeContext as a structured terminal block.
 * Designed to be dropped into demo/CLI output between the Intent Agent
 * and Clearing Agent sections.
 */
export function printRuntimeContext(ctx: RuntimeContext): void {
  const f = (label: string, value: string): void => {
    console.log(`  ${label.padEnd(24)}  ${value}`);
  };

  console.log();
  console.log("  ┌─ Context Engine ─────────────────────────────────────┐");
  f("actor id",           ctx.actorId);
  f("display name",       ctx.actorDisplayName ?? "(none)");
  f("partner",            ctx.partnerId);
  f("role",               ctx.actorRole.toUpperCase());
  f("approvals held",     `${ctx.approvalsHeld} / ${ctx.approvalsRequired} required`);

  if (ctx.requestedAmount !== null) {
    f("requested amount",   `${ctx.requestedAmount.hbar.toFixed(8)} HBAR`);
  }

  f("role cap",           `${ctx.roleCap.hbar.toFixed(2)} HBAR`);
  f("global cap",         `${ctx.globalCap.hbar.toFixed(2)} HBAR`);
  f("high-value floor",   `${ctx.highValueThreshold.hbar.toFixed(2)} HBAR`);

  if (ctx.recipientId !== null) {
    const approvedLabel = ctx.recipientApproved === true
      ? "✔  approved"
      : ctx.recipientApproved === false
        ? "✘  NOT on approved list"
        : "—";
    f("recipient",         ctx.recipientId);
    f("recipient status",  approvedLabel);
    f("corridor",          ctx.corridorStatus ?? "—");
  }

  f("treasury mode",      ctx.treasuryMode.toUpperCase());
  console.log("  └─────────────────────────────────────────────────────────┘");
}
