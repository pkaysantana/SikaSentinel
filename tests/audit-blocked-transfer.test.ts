/**
 * Integration test: blocked-transfer → audit log path.
 *
 * Exercises the full agent pipeline end-to-end against the in-memory
 * stub Hedera backend:
 *
 *   runAgent → evaluatePolicy → (skip execute) → recordAuditEntry → writeAudit
 *   fetchAuditLog → readAudit → parsed AuditEntry[]
 *
 * Each test asserts that a denied request:
 *   1. Returns decision.allowed === false with the expected ruleId
 *   2. Has no outcome.txId (no execution should happen)
 *   3. Is readable from the audit log with the denial reason intact
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { runAgent } from "../src/agent/index";
import { fetchAuditLog } from "../src/audit/index";
import { resetStubState } from "../src/hedera/index";
import type { ActorContext } from "../src/types/index";

const HBAR = 100_000_000;
const TOPIC_ID = "0.0.999999"; // the stub's default topic

function actor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    actorId: "alice@acme.test",
    partnerId: "acme",
    role: "operator",
    approvals: [],
    ...overrides,
  };
}

beforeEach(() => {
  // Each test starts with a clean stub state so assertions on log
  // length aren't polluted by sibling tests.
  resetStubState();
});

// ── 1. Amount over role cap ──────────────────────────────────────────────────

test("blocked transfer (over role cap) is recorded in the audit log", async () => {
  const result = await runAgent({
    action: "transfer_hbar",
    initiatorId: "0.0.12345",
    recipientId: "0.0.800",
    amountTinybar: 20 * HBAR,
    actor: actor(),
  });

  // 1. Denial details
  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.ruleId, "APPROVAL_THRESHOLD");
  assert.match(result.decision.reason, /approval/i);

  // 2. No execution happened
  assert.equal(result.auditEntry.outcome, undefined);

  // 3. Audit entry is readable from the log
  const entries = await fetchAuditLog(TOPIC_ID);
  assert.equal(entries.length, 1);

  const [entry] = entries;
  assert.equal(entry.auditId, result.auditEntry.auditId);
  assert.equal(entry.decision.allowed, false);
  assert.equal(entry.decision.ruleId, "APPROVAL_THRESHOLD");
  assert.equal(entry.request.action, "transfer_hbar");
  assert.equal(entry.request.amountTinybar, 20 * HBAR);
  assert.equal(entry.request.actor.actorId, "alice@acme.test");
  assert.equal(entry.request.actor.role, "operator");
});

// ── 2. Unapproved recipient ──────────────────────────────────────────────────

test("blocked transfer (unapproved recipient) is recorded in the audit log", async () => {
  const result = await runAgent({
    action: "transfer_hbar",
    initiatorId: "0.0.12345",
    recipientId: "0.0.99999", // not on approved list
    amountTinybar: 1 * HBAR,
    actor: actor(),
  });

  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.ruleId, "UNAPPROVED_RECIPIENT");
  assert.equal(result.auditEntry.outcome, undefined);

  const entries = await fetchAuditLog(TOPIC_ID);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].decision.ruleId, "UNAPPROVED_RECIPIENT");
  assert.equal(entries[0].request.recipientId, "0.0.99999");
});

// ── 3. Role-forbidden action ─────────────────────────────────────────────────

test("blocked transfer (viewer role) is recorded in the audit log", async () => {
  const result = await runAgent({
    action: "transfer_hbar",
    initiatorId: "0.0.12345",
    recipientId: "0.0.800",
    amountTinybar: 1 * HBAR,
    actor: actor({ actorId: "eve@acme.test", role: "viewer" }),
  });

  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.ruleId, "ROLE_FORBIDDEN_ACTION");
  assert.equal(result.auditEntry.outcome, undefined);

  const entries = await fetchAuditLog(TOPIC_ID);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].request.actor.role, "viewer");
  assert.equal(entries[0].decision.ruleId, "ROLE_FORBIDDEN_ACTION");
});

// ── 4. Allowed + denied interleaved ──────────────────────────────────────────

test("audit log preserves both allowed and denied entries in order", async () => {
  // Allowed: 5 HBAR within operator cap
  const ok = await runAgent({
    action: "transfer_hbar",
    initiatorId: "0.0.12345",
    recipientId: "0.0.800",
    amountTinybar: 5 * HBAR,
    actor: actor(),
  });
  assert.equal(ok.decision.allowed, true);
  assert.equal(ok.auditEntry.outcome?.success, true);

  // Denied: 40 HBAR over high-value threshold
  const blocked = await runAgent({
    action: "transfer_hbar",
    initiatorId: "0.0.12345",
    recipientId: "0.0.800",
    amountTinybar: 40 * HBAR,
    actor: actor(),
  });
  assert.equal(blocked.decision.allowed, false);

  const entries = await fetchAuditLog(TOPIC_ID);
  assert.equal(entries.length, 2);

  // Order: allowed first, denied second
  assert.equal(entries[0].decision.allowed, true);
  assert.ok(entries[0].outcome?.txId);
  assert.equal(entries[1].decision.allowed, false);
  assert.equal(entries[1].outcome, undefined);
});
