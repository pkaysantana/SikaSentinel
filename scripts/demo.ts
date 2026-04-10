/**
 * SikaHub Sentinel – interactive demo script
 *
 * Run with:  npx ts-node scripts/demo.ts
 *
 * Walks through a series of transfer scenarios to demonstrate:
 *   - allowed transfers (within limit, approved recipient)
 *   - denied transfers (over limit, unapproved recipient)
 *   - balance queries
 *   - audit log replay
 */

import { runAgent, getBalance, fetchAuditLog, printAuditEntry } from "../src/app/index";

const OPERATOR = "0.0.12345";

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  SikaHub Sentinel – Demo");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── 1. Check initial balance ─────────────────────────────────────────────
  section("1. Initial Balance");
  const balance = await getBalance(OPERATOR);
  console.log(`  ${balance.accountId}: ${balance.hbar.toFixed(8)} HBAR\n`);

  // ── 2. Allowed transfer (5 HBAR → approved recipient) ────────────────────
  section("2. Transfer 5 HBAR to approved recipient 0.0.800");
  await demo({
    action: "transfer_hbar",
    initiatorId: OPERATOR,
    recipientId: "0.0.800",
    amountTinybar: 5 * 100_000_000,
  });

  // ── 3. Denied – exceeds limit (15 HBAR > 10 HBAR limit) ─────────────────
  section("3. Transfer 15 HBAR (exceeds 10 HBAR limit)");
  await demo({
    action: "transfer_hbar",
    initiatorId: OPERATOR,
    recipientId: "0.0.800",
    amountTinybar: 15 * 100_000_000,
  });

  // ── 4. Denied – unapproved recipient ────────────────────────────────────
  section("4. Transfer 1 HBAR to unapproved recipient 0.0.99999");
  await demo({
    action: "transfer_hbar",
    initiatorId: OPERATOR,
    recipientId: "0.0.99999",
    amountTinybar: 1 * 100_000_000,
  });

  // ── 5. Dry-run allowed transfer ──────────────────────────────────────────
  section("5. Dry-run: Transfer 2 HBAR to 0.0.98");
  await demo(
    {
      action: "transfer_hbar",
      initiatorId: OPERATOR,
      recipientId: "0.0.98",
      amountTinybar: 2 * 100_000_000,
    },
    { dryRun: true }
  );

  // ── 6. Balance after transfers ───────────────────────────────────────────
  section("6. Balance After Transfers");
  const finalBalance = await getBalance(OPERATOR);
  console.log(`  ${finalBalance.accountId}: ${finalBalance.hbar.toFixed(8)} HBAR\n`);

  // ── 7. Replay audit log ──────────────────────────────────────────────────
  section("7. Audit Log Replay (topic 0.0.999999)");
  const entries = await fetchAuditLog("0.0.999999");
  console.log(`  ${entries.length} entries found:\n`);
  entries.forEach(printAuditEntry);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Demo complete.");
  console.log("═══════════════════════════════════════════════════════════\n");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type DemoInput = {
  action: "transfer_hbar" | "check_balance" | "write_audit" | "read_audit";
  initiatorId: string;
  recipientId?: string;
  amountTinybar?: number;
};

async function demo(input: DemoInput, opts: { dryRun?: boolean } = {}): Promise<void> {
  const result = await runAgent(input, { dryRun: opts.dryRun ?? false });
  const verdict = result.decision.allowed ? "✔  ALLOWED" : "✘  DENIED";
  const dryTag = opts.dryRun ? " [dry-run]" : "";
  console.log(`  ${verdict}${dryTag}  –  ${result.decision.reason}`);
  if (result.auditEntry.outcome?.txId) {
    console.log(`       txId: ${result.auditEntry.outcome.txId}`);
  }
  console.log();
}

function section(title: string): void {
  console.log(`── ${title}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
