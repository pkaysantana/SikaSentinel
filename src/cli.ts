#!/usr/bin/env node
/**
 * SikaHub Sentinel CLI
 *
 * Usage examples:
 *   npx ts-node src/cli.ts transfer --from 0.0.12345 --to 0.0.800 --amount 5
 *   npx ts-node src/cli.ts balance --account 0.0.12345
 *   npx ts-node src/cli.ts audit --topic 0.0.999999
 */

import { Command } from "commander";
import { runAgent } from "./agent/index";
import { getBalance } from "./hedera/index";
import { fetchAuditLog, printAuditEntry } from "./audit/index";
import { DEFAULT_POLICY } from "./policy/index";

const program = new Command();

program
  .name("sentinel")
  .description("SikaHub Sentinel – AI-powered policy enforcement agent for Hedera")
  .version("0.1.0");

// ── transfer ──────────────────────────────────────────────────────────────────

program
  .command("transfer")
  .description("Submit a HBAR transfer through the policy engine")
  .requiredOption("--from <accountId>", "Initiator account (0.0.XXXXX)")
  .requiredOption("--to <accountId>", "Recipient account (0.0.XXXXX)")
  .requiredOption("--amount <hbar>", "Amount in HBAR (e.g. 5 = 5 HBAR)", parseFloat)
  .option("--dry-run", "Validate and audit without executing", false)
  .option("--verbose", "Print detailed logs", false)
  .action(async (opts) => {
    const amountTinybar = Math.round(opts.amount * 100_000_000);

    console.log(`\nSikaHub Sentinel – Transfer Request`);
    console.log(`  From:    ${opts.from}`);
    console.log(`  To:      ${opts.to}`);
    console.log(`  Amount:  ${opts.amount} HBAR (${amountTinybar} tinybar)`);
    console.log(`  Dry-run: ${opts.dryRun}\n`);

    try {
      const result = await runAgent(
        {
          action: "transfer_hbar",
          initiatorId: opts.from,
          recipientId: opts.to,
          amountTinybar,
        },
        { dryRun: opts.dryRun, verbose: opts.verbose }
      );

      const verdict = result.decision.allowed ? "✔  ALLOWED" : "✘  DENIED";
      console.log(`${verdict}  –  ${result.decision.reason}`);
      if (result.auditEntry.outcome?.txId) {
        console.log(`TxID: ${result.auditEntry.outcome.txId}`);
      }
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── balance ───────────────────────────────────────────────────────────────────

program
  .command("balance")
  .description("Query the HBAR balance for an account")
  .requiredOption("--account <accountId>", "Account to query (0.0.XXXXX)")
  .action(async (opts) => {
    try {
      const result = await getBalance(opts.account);
      console.log(`\nBalance for ${result.accountId}:`);
      console.log(`  ${result.hbar.toFixed(8)} HBAR  (${result.tinybar} tinybar)\n`);
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── policy ────────────────────────────────────────────────────────────────────

program
  .command("policy")
  .description("Display the active policy configuration")
  .action(() => {
    console.log("\nActive Policy Configuration:");
    console.log(
      `  Max transfer:          ${DEFAULT_POLICY.maxTransferTinybar / 100_000_000} HBAR`
    );
    console.log(
      `  Enforce approved list: ${DEFAULT_POLICY.enforceApprovedRecipients}`
    );
    console.log(
      `  Approved recipients:   ${DEFAULT_POLICY.approvedRecipients.join(", ")}\n`
    );
  });

// ── audit ─────────────────────────────────────────────────────────────────────

program
  .command("audit")
  .description("Read and display audit entries from a Hedera Consensus topic")
  .option("--topic <topicId>", "HCS topic ID (0.0.XXXXX)", "0.0.999999")
  .action(async (opts) => {
    try {
      const entries = await fetchAuditLog(opts.topic);
      if (entries.length === 0) {
        console.log("\nNo audit entries found.\n");
        return;
      }
      console.log(`\nAudit Log – topic ${opts.topic} (${entries.length} entries):\n`);
      entries.forEach(printAuditEntry);
      console.log();
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── parse ─────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
