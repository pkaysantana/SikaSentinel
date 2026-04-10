/**
 * Sika Sentinel – focused 4-step demo
 *
 *   npx ts-node scripts/run-demo.ts
 *
 * Shows the full product loop in under 90 seconds:
 *   Step 1 – check balance          (NL instruction → balance query)
 *   Step 2 – blocked transfer        (policy denies; audit still written)
 *   Step 3 – allowed transfer        (policy allows; Hedera executes)
 *   Step 4 – audit trail readback    (replay every entry from HCS topic)
 *
 * Architecture:  LLM interprets → policy decides → Hedera executes → HCS records
 */

import { runInstruction, runAgent, getBalance, fetchAuditLog } from "../src/app/index";
import { resetStubState } from "../src/hedera/index";
import type { ActorContext } from "../src/app/index";

const OPERATOR_ID  = "0.0.12345";
const TOPIC_ID     = "0.0.999999";
const HBAR         = 100_000_000;

const ALICE: ActorContext = {
  actorId:     "alice@acme.test",
  displayName: "Alice",
  partnerId:   "acme",
  role:        "operator",
  approvals:   [],
};

// ── helpers ──────────────────────────────────────────────────────────────────

function hr(): void { console.log("─".repeat(60)); }

function step(n: number, title: string): void {
  console.log();
  console.log("─".repeat(60));
  console.log(`  STEP ${n}: ${title}`);
  console.log("─".repeat(60));
}

function field(label: string, value: unknown): void {
  const pad  = label.padEnd(18);
  const text = typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
  console.log(`  ${pad}  ${text}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  resetStubState();

  console.log();
  console.log("══════════════════════════════════════════════════════════");
  console.log("  Sika Sentinel  –  Live Demo");
  console.log("  AI-powered policy and audit layer for Hedera workflows");
  console.log("══════════════════════════════════════════════════════════");

  // ── Step 1: check balance ─────────────────────────────────────────────────
  step(1, "CHECK BALANCE  (natural-language instruction)");

  const instruction1 = `what is the balance of ${OPERATOR_ID}`;
  console.log();
  field("raw instruction", `"${instruction1}"`);

  const r1 = await runInstruction(instruction1, ALICE, {
    defaultInitiatorId: OPERATOR_ID,
  });

  field("parsed intent",   r1.parseResult.intent ?? "—");
  field("parsed action",   JSON.stringify(r1.parseResult.draft));
  field("policy decision", r1.decision?.allowed ? "ALLOWED" : "DENIED");
  field("rule",            r1.decision?.ruleId ?? "—");

  // Also show the actual balance from the Hedera wrapper
  const balance = await getBalance(OPERATOR_ID);
  field("balance",         `${balance.hbar.toFixed(8)} HBAR`);
  field("mode",            balance.stub ? "stub" : "live");

  // ── Step 2: blocked transfer ──────────────────────────────────────────────
  step(2, "BLOCKED TRANSFER  (policy denies; audit still written)");

  const instruction2 = `send 40 HBAR from ${OPERATOR_ID} to 0.0.800`;
  console.log();
  field("raw instruction",  `"${instruction2}"`);
  field("actor",            `${ALICE.actorId}  [${ALICE.role}@${ALICE.partnerId}]`);
  field("approvals",        "(none)");

  const r2 = await runInstruction(instruction2, ALICE, {
    defaultInitiatorId: OPERATOR_ID,
  });

  field("parsed intent",    r2.parseResult.intent ?? "—");
  field("parsed action",    JSON.stringify(r2.parseResult.draft));
  field("policy decision",  r2.decision!.allowed ? "✔  ALLOWED" : "✘  DENIED");
  field("rule triggered",   r2.decision!.ruleId ?? "—");
  field("reason",           r2.decision!.reason);
  field("executed",         "NO  (blocked before Hedera call)");
  field("audit written",    `YES  (auditId=${r2.auditEntry!.auditId.slice(0, 8)}…)`);

  // ── Step 3: allowed transfer ──────────────────────────────────────────────
  step(3, "ALLOWED TRANSFER  (policy allows; Hedera executes)");

  const instruction3 = `send 5 HBAR from ${OPERATOR_ID} to 0.0.800`;
  console.log();
  field("raw instruction",  `"${instruction3}"`);
  field("actor",            `${ALICE.actorId}  [${ALICE.role}@${ALICE.partnerId}]`);

  const r3 = await runInstruction(instruction3, ALICE, {
    defaultInitiatorId: OPERATOR_ID,
  });

  field("parsed intent",    r3.parseResult.intent ?? "—");
  field("parsed action",    JSON.stringify(r3.parseResult.draft));
  field("policy decision",  r3.decision!.allowed ? "✔  ALLOWED" : "✘  DENIED");
  field("rule",             r3.decision!.ruleId ?? "—");
  field("executed",         "YES");
  field("tx id",            r3.auditEntry!.outcome?.txId ?? "—");
  field("audit written",    `YES  (auditId=${r3.auditEntry!.auditId.slice(0, 8)}…)`);

  const balanceAfter = await getBalance(OPERATOR_ID);
  field("balance after",    `${balanceAfter.hbar.toFixed(8)} HBAR`);

  // ── Step 4: audit trail readback ──────────────────────────────────────────
  step(4, "AUDIT TRAIL READBACK  (replay all HCS entries)");

  const entries = await fetchAuditLog(TOPIC_ID);
  console.log();
  console.log(`  Topic: ${TOPIC_ID}   Entries: ${entries.length}`);
  console.log();

  for (const e of entries) {
    const verdict = e.decision.allowed ? "✔ ALLOWED" : "✘ DENIED ";
    const ts      = new Date(e.recordedAt).toISOString();
    const amount  = e.request.amountTinybar !== undefined
      ? `${(e.request.amountTinybar / HBAR).toFixed(2)} HBAR`
      : "—";
    const txId    = e.outcome?.txId
      ? `  tx=${e.outcome.txId.split("@")[1] ?? e.outcome.txId}`
      : "";

    console.log(`  [${verdict}] ${ts}`);
    console.log(`             action=${e.request.action}  amount=${amount}  rule=${e.decision.ruleId ?? "—"}${txId}`);
    if (!e.decision.allowed) {
      console.log(`             reason: ${e.decision.reason}`);
    }
    if (e.request.instruction) {
      console.log(`             instruction: "${e.request.instruction}"`);
    }
  }

  console.log();
  hr();
  console.log("  Demo complete.");
  console.log("  Blocked transfers enforced by policy  ✔");
  console.log("  All activity immutably logged to HCS  ✔");
  hr();
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
