import { z } from "zod";

// ── Action Request ──────────────────────────────────────────────────────────

export const ActionRequestSchema = z.object({
  /** Unique request identifier */
  id: z.string().uuid(),
  /** Unix timestamp (ms) when the request was created */
  timestamp: z.number().int().positive(),
  /** Type of action the agent wants to perform */
  action: z.enum(["transfer_hbar", "check_balance", "write_audit", "read_audit"]),
  /** Hedera account that initiates the action */
  initiatorId: z.string().regex(/^0\.0\.\d+$/, "Must be a Hedera account ID (e.g. 0.0.12345)"),
  /** Target account for transfers (required for transfer_hbar) */
  recipientId: z.string().regex(/^0\.0\.\d+$/).optional(),
  /** Amount in tinybar (1 HBAR = 100 000 000 tinybar) */
  amountTinybar: z.number().int().nonnegative().optional(),
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

export interface PolicyConfig {
  /** Maximum allowed single transfer in tinybar */
  maxTransferTinybar: number;
  /** Approved recipient account IDs */
  approvedRecipients: string[];
  /** Whether to require a recipient to be on the approved list */
  enforceApprovedRecipients: boolean;
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
