/**
 * Deterministic natural-language instruction parser.
 *
 * This is intentionally a lightweight rule-based parser rather than an LLM
 * call — the policy and audit layers need to be reproducible, and the NLP
 * stage is structured so it can later be swapped for a model-backed parser
 * without changing downstream schemas.
 *
 * Supported intents (case-insensitive):
 *   - transfer_hbar:
 *       "send 5 HBAR to 0.0.800"
 *       "transfer 12.5 hbar from 0.0.12345 to 0.0.98"
 *       "pay 0.0.2 2 HBAR"
 *   - check_balance:
 *       "what's the balance of 0.0.12345"
 *       "check balance for 0.0.800"
 *       "balance 0.0.2"
 *   - read_audit:
 *       "show me the audit log"
 *       "read audit topic 0.0.999999"
 */

import type { ActionRequest, ActionType } from "../types/index";

export interface InstructionParseResult {
  /** True if the parser recognised an intent */
  ok: boolean;
  /** Draft action request (missing id, timestamp, actor — filled by the agent) */
  draft?: Pick<
    ActionRequest,
    "action" | "initiatorId" | "recipientId" | "amountTinybar" | "metadata"
  >;
  /** If parsing failed, why */
  error?: string;
  /** The normalised lowercased instruction actually analysed */
  normalised: string;
  /** Which intent pattern matched */
  intent?: ActionType;
}

const HEDERA_ID = /0\.0\.\d+/g;
// Amount followed by (tiny)?bar/hbar — captures numeric with optional decimal.
const AMOUNT = /(\d+(?:\.\d+)?)\s*(hbar|tinybar)/i;

/**
 * Parses a free-form natural-language instruction into a draft ActionRequest.
 * The parser is deterministic and will not invent values; missing details
 * produce an `ok: false` result with a descriptive error.
 */
export function parseInstruction(
  instruction: string,
  defaultInitiatorId?: string
): InstructionParseResult {
  const normalised = instruction.trim().toLowerCase();

  if (!normalised) {
    return { ok: false, error: "Empty instruction.", normalised };
  }

  // ── Intent: transfer ───────────────────────────────────────────────────
  if (/\b(send|transfer|pay|move)\b/.test(normalised)) {
    return parseTransfer(normalised, instruction, defaultInitiatorId);
  }

  // ── Intent: check_balance ──────────────────────────────────────────────
  if (/\bbalance\b/.test(normalised)) {
    return parseBalance(normalised, defaultInitiatorId);
  }

  // ── Intent: read_audit ─────────────────────────────────────────────────
  if (/\baudit\b/.test(normalised)) {
    return parseAudit(normalised, defaultInitiatorId);
  }

  return {
    ok: false,
    error: "Could not recognise any supported intent (transfer / balance / audit).",
    normalised,
  };
}

// ── Intent parsers ──────────────────────────────────────────────────────────

function parseTransfer(
  normalised: string,
  original: string,
  defaultInitiatorId?: string
): InstructionParseResult {
  const ids = extractHederaIds(normalised);
  const amount = extractAmountTinybar(normalised);

  if (amount === null) {
    return {
      ok: false,
      intent: "transfer_hbar",
      normalised,
      error: "Transfer instruction must include an amount like '5 HBAR' or '250000000 tinybar'.",
    };
  }

  // Extract explicit from/to based on prepositions to avoid ambiguity.
  const fromMatch = normalised.match(/from\s+(0\.0\.\d+)/);
  const toMatch = normalised.match(/to\s+(0\.0\.\d+)/);

  let initiatorId = fromMatch?.[1] ?? defaultInitiatorId;
  let recipientId = toMatch?.[1];

  // Fallback heuristic: "pay 0.0.2 5 HBAR" → first id is recipient.
  if (!recipientId && ids.length > 0) {
    if (ids.length === 1) {
      recipientId = ids[0];
    } else if (ids.length >= 2 && !fromMatch) {
      // Assume first is recipient, second is initiator (rarely used).
      recipientId = ids[0];
      initiatorId = initiatorId ?? ids[1];
    }
  }

  if (!initiatorId) {
    return {
      ok: false,
      intent: "transfer_hbar",
      normalised,
      error: "Transfer instruction needs an initiator (use 'from 0.0.X' or supply a default).",
    };
  }
  if (!recipientId) {
    return {
      ok: false,
      intent: "transfer_hbar",
      normalised,
      error: "Transfer instruction needs a recipient ('to 0.0.X').",
    };
  }

  return {
    ok: true,
    intent: "transfer_hbar",
    normalised,
    draft: {
      action: "transfer_hbar",
      initiatorId,
      recipientId,
      amountTinybar: amount,
      metadata: { rawInstruction: original },
    },
  };
}

function parseBalance(
  normalised: string,
  defaultInitiatorId?: string
): InstructionParseResult {
  const ids = extractHederaIds(normalised);
  const initiatorId = ids[0] ?? defaultInitiatorId;

  if (!initiatorId) {
    return {
      ok: false,
      intent: "check_balance",
      normalised,
      error: "Balance instruction needs an account id (0.0.X) or a default initiator.",
    };
  }

  return {
    ok: true,
    intent: "check_balance",
    normalised,
    draft: {
      action: "check_balance",
      initiatorId,
    },
  };
}

function parseAudit(
  normalised: string,
  defaultInitiatorId?: string
): InstructionParseResult {
  const ids = extractHederaIds(normalised);
  const topicId = ids[0];

  if (!defaultInitiatorId) {
    return {
      ok: false,
      intent: "read_audit",
      normalised,
      error: "Audit instruction needs a default initiator to attribute the read.",
    };
  }

  return {
    ok: true,
    intent: "read_audit",
    normalised,
    draft: {
      action: "read_audit",
      initiatorId: defaultInitiatorId,
      metadata: topicId ? { topicId } : undefined,
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractHederaIds(text: string): string[] {
  const matches = text.match(HEDERA_ID);
  return matches ? Array.from(new Set(matches)) : [];
}

function extractAmountTinybar(text: string): number | null {
  const m = text.match(AMOUNT);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (Number.isNaN(value) || value < 0) return null;
  if (unit === "hbar") return Math.round(value * 100_000_000);
  return Math.round(value); // tinybar
}
