import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

import { evaluatePolicy, DEFAULT_POLICY } from "../src/policy/index";
import type { ActionRequest, ActorContext } from "../src/types/index";

// ── Fixtures ────────────────────────────────────────────────────────────────

const HBAR = 100_000_000;

function actor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    actorId: "alice@acme.test",
    partnerId: "acme",
    role: "operator",
    approvals: [],
    ...overrides,
  };
}

function transferRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    id: randomUUID(),
    timestamp: Date.now(),
    action: "transfer_hbar",
    initiatorId: "0.0.12345",
    recipientId: "0.0.800",
    amountTinybar: 5 * HBAR,
    actor: actor(),
    ...overrides,
  };
}

// ── Happy path ──────────────────────────────────────────────────────────────

test("allows transfer within role cap to approved recipient", () => {
  const decision = evaluatePolicy(transferRequest());
  assert.equal(decision.allowed, true);
  assert.equal(decision.ruleId, "ALLOW_ALL");
});

// ── Required fields ─────────────────────────────────────────────────────────

test("denies transfer with missing amount", () => {
  const decision = evaluatePolicy(
    transferRequest({ amountTinybar: undefined })
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "MISSING_AMOUNT");
});

test("denies transfer with missing recipient", () => {
  const decision = evaluatePolicy(
    transferRequest({ recipientId: undefined })
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "MISSING_RECIPIENT");
});

// ── Actor role ──────────────────────────────────────────────────────────────

test("denies viewer attempting a transfer (ROLE_FORBIDDEN_ACTION)", () => {
  const decision = evaluatePolicy(
    transferRequest({ actor: actor({ role: "viewer" }) })
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "ROLE_FORBIDDEN_ACTION");
});

test("allows viewer check_balance action", () => {
  const decision = evaluatePolicy({
    id: randomUUID(),
    timestamp: Date.now(),
    action: "check_balance",
    initiatorId: "0.0.12345",
    actor: actor({ role: "viewer" }),
  });
  assert.equal(decision.allowed, true);
});

// ── Amount limit (global) ───────────────────────────────────────────────────

test("denies transfer above global max", () => {
  const decision = evaluatePolicy(
    transferRequest({
      amountTinybar: 5_000 * HBAR,
      actor: actor({ role: "admin" }),
    })
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "AMOUNT_LIMIT");
});

// ── Approved recipient ──────────────────────────────────────────────────────

test("denies transfer to unapproved recipient", () => {
  const decision = evaluatePolicy(
    transferRequest({ recipientId: "0.0.99999" })
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "UNAPPROVED_RECIPIENT");
});

test("allows unapproved recipient when enforcement is off", () => {
  const decision = evaluatePolicy(
    transferRequest({ recipientId: "0.0.99999" }),
    { ...DEFAULT_POLICY, enforceApprovedRecipients: false }
  );
  assert.equal(decision.allowed, true);
});

// ── Approval threshold ──────────────────────────────────────────────────────

test("denies operator above role cap without approvals", () => {
  const decision = evaluatePolicy(
    transferRequest({ amountTinybar: 20 * HBAR })
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "APPROVAL_THRESHOLD");
  assert.equal(decision.context?.trigger, "role_cap");
  assert.equal(decision.context?.have, 0);
  assert.equal(decision.context?.need, 1);
});

test("allows operator above role cap with one co-signer", () => {
  const decision = evaluatePolicy(
    transferRequest({
      amountTinybar: 20 * HBAR,
      actor: actor({ approvals: ["bob@acme.test"] }),
    })
  );
  assert.equal(decision.allowed, true);
});

test("rejects self-approval — initiator's own id in approvals list doesn't count", () => {
  const decision = evaluatePolicy(
    transferRequest({
      amountTinybar: 20 * HBAR,
      actor: actor({ approvals: ["alice@acme.test"] }),
    })
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "APPROVAL_THRESHOLD");
});

test("de-duplicates repeated approvers", () => {
  const decision = evaluatePolicy(
    transferRequest({
      amountTinybar: 20 * HBAR,
      actor: actor({ approvals: ["bob@acme.test", "bob@acme.test"] }),
    }),
    { ...DEFAULT_POLICY, approvalsRequired: 2 }
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.context?.have, 1);
});

test("denies high-value transfer even within role cap", () => {
  // Approver role cap is 50 HBAR, high-value threshold is 25 HBAR.
  // An approver transferring 30 HBAR is under cap but above high-value.
  const decision = evaluatePolicy(
    transferRequest({
      amountTinybar: 30 * HBAR,
      actor: actor({ role: "approver" }),
    })
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "APPROVAL_THRESHOLD");
  assert.equal(decision.context?.trigger, "high_value");
});

test("admin bypasses approval threshold", () => {
  const decision = evaluatePolicy(
    transferRequest({
      amountTinybar: 500 * HBAR,
      recipientId: "0.0.800",
      actor: actor({ role: "admin" }),
    })
  );
  assert.equal(decision.allowed, true);
});
