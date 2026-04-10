/**
 * Sika Sentinel – interactive demo script
 *
 * Run with:  npx ts-node scripts/demo.ts
 *
 * Walks through scenarios that exercise every policy rule:
 *   - natural-language instruction parsing
 *   - allowed transfer within role cap
 *   - denied: amount over role cap without approvals
 *   - allowed: amount over role cap WITH co-signer approval
 *   - denied: unapproved recipient
 *   - denied: viewer role attempting a transfer (role forbidden)
 *   - denied: high-value transfer without approvals
 *   - allowed: admin bypass on high-value transfer
 *   - audit log replay
 */

import {
  runAgent,
  runInstruction,
  getBalance,
  fetchAuditLog,
  printAuditEntry,
} from "../src/app/index";
import type { ActorContext } from "../src/app/index";

const OPERATOR_ACCOUNT = "0.0.12345";

const ALICE: ActorContext = {
  actorId: "alice@acme.test",
  displayName: "Alice (Operator)",
  partnerId: "acme",
  role: "operator",
  approvals: [],
};

const BOB_APPROVER: ActorContext = {
  ...ALICE,
  approvals: ["bob@acme.test"], // Alice, co-signed by Bob
};

const EVE_VIEWER: ActorContext = {
  actorId: "eve@acme.test",
  displayName: "Eve (Viewer)",
  partnerId: "acme",
  role: "viewer",
  approvals: [],
};

const ROOT_ADMIN: ActorContext = {
  actorId: "root@acme.test",
  displayName: "Root (Admin)",
  partnerId: "acme",
  role: "admin",
  approvals: [],
};

async function main(): Promise<void> {
  banner("Sika Sentinel – Demo");

  // ── 1. Initial balance ─────────────────────────────────────────────────
  section("1. Initial balance");
  const balance = await getBalance(OPERATOR_ACCOUNT);
  console.log(`  ${balance.accountId}: ${balance.hbar.toFixed(8)} HBAR\n`);

  // ── 2. NL instruction – allowed small transfer ────────────────────────
  section("2. NL instruction: 'send 5 HBAR from 0.0.12345 to 0.0.800'");
  await demoInstruction("send 5 HBAR from 0.0.12345 to 0.0.800", ALICE);

  // ── 3. Denied – amount over operator cap, no approvals ────────────────
  section("3. Operator tries 20 HBAR (over 10 HBAR role cap, no approvals)");
  await demoTransfer(ALICE, OPERATOR_ACCOUNT, "0.0.800", 20);

  // ── 4. Allowed – same amount, this time with one approval ─────────────
  section("4. Same 20 HBAR transfer, co-signed by bob@acme.test");
  await demoTransfer(BOB_APPROVER, OPERATOR_ACCOUNT, "0.0.800", 20);

  // ── 5. Denied – unapproved recipient ──────────────────────────────────
  section("5. Transfer 1 HBAR to unapproved recipient 0.0.99999");
  await demoTransfer(ALICE, OPERATOR_ACCOUNT, "0.0.99999", 1);

  // ── 6. Denied – viewer trying to transfer ─────────────────────────────
  section("6. Viewer role tries to transfer 1 HBAR");
  await demoTransfer(EVE_VIEWER, OPERATOR_ACCOUNT, "0.0.800", 1);

  // ── 7. Denied – high-value transfer without approvals ────────────────
  section("7. Operator tries 40 HBAR (high-value threshold, no approvals)");
  await demoTransfer(ALICE, OPERATOR_ACCOUNT, "0.0.800", 40);

  // ── 8. Allowed – admin bypasses approvals on high-value ──────────────
  section("8. Admin performs 100 HBAR transfer (bypasses approvals)");
  await demoTransfer(ROOT_ADMIN, OPERATOR_ACCOUNT, "0.0.2", 100);

  // ── 9. NL instruction – balance check ────────────────────────────────
  section("9. NL instruction: \"what's the balance of 0.0.12345\"");
  await demoInstruction("what's the balance of 0.0.12345", ALICE);

  // ── 10. NL parse failure ─────────────────────────────────────────────
  section("10. NL instruction: 'do the needful' (unrecognised intent)");
  await demoInstruction("do the needful", ALICE);

  // ── 11. Final balance ────────────────────────────────────────────────
  section("11. Final balance");
  const finalBalance = await getBalance(OPERATOR_ACCOUNT);
  console.log(`  ${finalBalance.accountId}: ${finalBalance.hbar.toFixed(8)} HBAR\n`);

  // ── 12. Audit log replay ─────────────────────────────────────────────
  section("12. Audit log replay (topic 0.0.999999)");
  const entries = await fetchAuditLog("0.0.999999");
  console.log(`  ${entries.length} entries found:\n`);
  entries.forEach(printAuditEntry);

  banner("Demo complete.");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function demoTransfer(
  actor: ActorContext,
  from: string,
  to: string,
  amountHbar: number
): Promise<void> {
  const result = await runAgent({
    action: "transfer_hbar",
    initiatorId: from,
    recipientId: to,
    amountTinybar: Math.round(amountHbar * 100_000_000),
    actor,
  });
  const verdict = result.decision.allowed ? "✔  ALLOWED" : "✘  DENIED";
  console.log(`  ${verdict}  –  ${result.decision.reason}`);
  if (result.auditEntry.outcome?.txId) {
    console.log(`       txId: ${result.auditEntry.outcome.txId}`);
  }
  console.log();
}

async function demoInstruction(
  instruction: string,
  actor: ActorContext
): Promise<void> {
  const result = await runInstruction(instruction, actor, {
    defaultInitiatorId: OPERATOR_ACCOUNT,
  });

  if (!result.parsed) {
    console.log(`  ✘  PARSE FAILED  –  ${result.parseResult.error}\n`);
    return;
  }

  console.log(`  [intent=${result.parseResult.intent}]`);
  const verdict = result.decision!.allowed ? "✔  ALLOWED" : "✘  DENIED";
  console.log(`  ${verdict}  –  ${result.decision!.reason}`);
  if (result.auditEntry?.outcome?.txId) {
    console.log(`       txId: ${result.auditEntry.outcome.txId}`);
  }
  console.log();
}

function section(title: string): void {
  console.log(`── ${title}`);
}

function banner(title: string): void {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  ${title}`);
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
