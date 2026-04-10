import { z } from "zod";

// ── Actor Context ───────────────────────────────────────────────────────────

/**
 * Roles available to actors inside partner-operated workflows.
 *
 * - viewer:   read-only access (balances, audit log)
 * - operator: can initiate everyday transfers up to role limits
 * - approver: can co-sign / approve high-value operator actions
 * - admin:    full privileges, can bypass approval thresholds
 */
export const ActorRoleSchema = z.enum(["viewer", "operator", "approver", "admin"]);
export type ActorRole = z.infer<typeof ActorRoleSchema>;

export const ActorContextSchema = z.object({
  /** Stable identifier for the acting user (e.g. email, SSO subject) */
  actorId: z.string().min(1),
  /** Display name, purely informational */
  displayName: z.string().optional(),
  /** Partner organisation the actor belongs to */
  partnerId: z.string().min(1),
  /** Role assigned to the actor within this partner */
  role: ActorRoleSchema,
  /**
   * IDs of other actors who have already approved this request.
   * Used by the approval-threshold rule to decide whether a high-value
   * action has collected enough signatures.
   */
  approvals: z.array(z.string()).default([]),
  /** Optional session/request correlation id for tracing */
  sessionId: z.string().optional(),
});

export type ActorContext = z.infer<typeof ActorContextSchema>;

// ── Action Request ──────────────────────────────────────────────────────────

export const ActionTypeSchema = z.enum([
  "transfer_hbar",
  "check_balance",
  "write_audit",
  "read_audit",
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionRequestSchema = z.object({
  /** Unique request identifier */
  id: z.string().uuid(),
  /** Unix timestamp (ms) when the request was created */
  timestamp: z.number().int().positive(),
  /** Type of action the agent wants to perform */
  action: ActionTypeSchema,
  /** Hedera account that initiates the action */
  initiatorId: z.string().regex(/^0\.0\.\d+$/, "Must be a Hedera account ID (e.g. 0.0.12345)"),
  /** Target account for transfers (required for transfer_hbar) */
  recipientId: z.string().regex(/^0\.0\.\d+$/).optional(),
  /** Amount in tinybar (1 HBAR = 100 000 000 tinybar) */
  amountTinybar: z.number().int().nonnegative().optional(),
  /** The human/agent issuing the request */
  actor: ActorContextSchema,
  /** Original natural-language instruction, if any */
  instruction: z.string().optional(),
  /** Free-form metadata for audit or diagnostic actions */
  metadata: z.record(z.unknown()).optional(),
});

export type ActionRequest = z.infer<typeof ActionRequestSchema>;

// ── Policy Decision ─────────────────────────────────────────────────────────

export const PolicyDecisionSchema = z.object({
  requestId: z.string().uuid(),
  /** Whether the action is permitted */
  allowed: z.boolean(),
  /** Human-readable explanation */
  reason: z.string(),
  /** Which policy rule was the deciding factor */
  ruleId: z.string().optional(),
  /**
   * Additional structured context about the decision.
   * For approval-threshold rules this includes how many signatures
   * were collected vs. how many are required.
   */
  context: z.record(z.unknown()).optional(),
  /** Timestamp of the decision */
  decidedAt: z.number().int().positive(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

// ── Audit Entry ─────────────────────────────────────────────────────────────

export const AuditEntrySchema = z.object({
  /** Unique audit record identifier */
  auditId: z.string().uuid(),
  /** The original action request */
  request: ActionRequestSchema,
  /** The policy decision made */
  decision: PolicyDecisionSchema,
  /** Outcome after execution (only if allowed and executed) */
  outcome: z
    .object({
      success: z.boolean(),
      txId: z.string().optional(),
      errorMessage: z.string().optional(),
    })
    .optional(),
  /** Hedera consensus topic ID where this was written */
  topicId: z.string().optional(),
  /** Recorded at timestamp */
  recordedAt: z.number().int().positive(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// ── Policy Config ───────────────────────────────────────────────────────────

export interface RoleLimits {
  /** Max single-transfer amount this role may initiate without approvals (tinybar) */
  maxTransferTinybar: number;
  /** Actions this role is allowed to perform */
  allowedActions: ActionType[];
}

export interface PolicyConfig {
  /** Hard ceiling for any single transfer, regardless of role (tinybar) */
  maxTransferTinybar: number;
  /** Approved recipient account IDs */
  approvedRecipients: string[];
  /** Whether to require a recipient to be on the approved list */
  enforceApprovedRecipients: boolean;
  /** Per-role caps and permitted actions */
  roleLimits: Record<ActorRole, RoleLimits>;
  /**
   * Approval threshold: transfers whose amount exceeds a role's solo cap
   * must collect this many additional approvals (from distinct actors)
   * before they are allowed.
   */
  approvalsRequired: number;
  /**
   * Transfers at or above this amount always require multi-approval,
   * even if the initiating role's solo cap would otherwise permit them.
   */
  highValueThresholdTinybar: number;
}

// ── Hedera Config ───────────────────────────────────────────────────────────

export interface HederaConfig {
  /** Hedera network: "testnet" | "mainnet" | "previewnet" */
  network: "testnet" | "mainnet" | "previewnet";
  /** Operator account ID (0.0.XXXXX) */
  operatorId: string;
  /** Operator private key (DER-encoded hex or PEM) */
  operatorKey: string;
  /** Consensus topic ID used for audit writes */
  auditTopicId?: string;
}
