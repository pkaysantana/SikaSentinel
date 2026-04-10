#!/usr/bin/env node
/**
 * Sika Sentinel CLI
 *
 * Usage examples:
 *   npx ts-node src/cli.ts transfer \
 *       --from 0.0.12345 --to 0.0.800 --amount 5 \
 *       --actor alice@acme.test --role operator --partner acme
 *
 *   npx ts-node src/cli.ts instruct "send 5 HBAR from 0.0.12345 to 0.0.800" \
 *       --actor alice@acme.test --role operator --partner acme
 *
 *   npx ts-node src/cli.ts balance --account 0.0.12345
 *   npx ts-node src/cli.ts audit --topic 0.0.999999
 *   npx ts-node src/cli.ts policy
 */

import { Command, Option } from "commander";
import { runAgent, runInstruction } from "./agent/index";
import { getBalance } from "./hedera/index";
import { fetchAuditLog, printAuditEntry } from "./audit/index";
import { DEFAULT_POLICY } from "./policy/index";
import type { ActorContext, ActorRole } from "./types/index";

const program = new Command();

program
  .name("sentinel")
  .description("Sika Sentinel – AI-powered policy and audit layer for Hedera workflows")
  .version("0.1.0");

// ── Shared actor options ─────────────────────────────────────────────────────

const ROLE_CHOICES: ActorRole[] = ["viewer", "operator", "approver", "admin"];

function attachActorOptions(cmd: Command): Command {
  return cmd
    .requiredOption("--actor <id>", "Actor identifier (e.g. alice@acme.test)")
    .addOption(
      new Option("--role <role>", "Actor role")
        .choices(ROLE_CHOICES)
        .default("operator")
    )
    .requiredOption("--partner <partnerId>", "Partner organisation id")
    .option(
      "--approvals <ids...>",
      "Space-separated list of co-signer actor ids",
      [] as string[]
    )
    .option("--display-name <name>", "Human-readable actor name");
}

function buildActor(opts: {
  actor: string;
  role: ActorRole;
  partner: string;
  approvals?: string[];
  displayName?: string;
}): ActorContext {
  return {
    actorId: opts.actor,
    role: opts.role,
    partnerId: opts.partner,
    approvals: opts.approvals ?? [],
    displayName: opts.displayName,
  };
}

// ── transfer ──────────────────────────────────────────────────────────────────

attachActorOptions(
  program
    .command("transfer")
    .description("Submit a HBAR transfer through the policy engine")
    .requiredOption("--from <accountId>", "Initiator account (0.0.XXXXX)")
    .requiredOption("--to <accountId>", "Recipient account (0.0.XXXXX)")
    .requiredOption("--amount <hbar>", "Amount in HBAR (e.g. 5 = 5 HBAR)", parseFloat)
    .option("--dry-run", "Validate and audit without executing", false)
    .option("--verbose", "Print detailed logs", false)
).action(async (opts) => {
  const amountTinybar = Math.round(opts.amount * 100_000_000);
  const actor = buildActor(opts);

  console.log(`\nSika Sentinel – Transfer Request`);
  console.log(`  Actor:   ${actor.actorId}  [${actor.role}@${actor.partnerId}]`);
  console.log(`  From:    ${opts.from}`);
  console.log(`  To:      ${opts.to}`);
  console.log(`  Amount:  ${opts.amount} HBAR (${amountTinybar} tinybar)`);
  if (actor.approvals.length) {
    console.log(`  Co-signs: ${actor.approvals.join(", ")}`);
  }
  console.log(`  Dry-run: ${opts.dryRun}\n`);

  try {
    const result = await runAgent(
      {
        action: "transfer_hbar",
        initiatorId: opts.from,
        recipientId: opts.to,
        amountTinybar,
        actor,
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

// ── instruct (natural-language) ──────────────────────────────────────────────

attachActorOptions(
  program
    .command("instruct")
    .description("Run the agent from a natural-language instruction")
    .argument("<instruction>", "Free-form instruction, e.g. 'send 5 HBAR to 0.0.800'")
    .option("--default-from <accountId>", "Default initiator if the instruction omits one")
    .option("--dry-run", "Validate and audit without executing", false)
    .option("--verbose", "Print detailed logs", false)
).action(async (instruction: string, opts) => {
  const actor = buildActor(opts);

  console.log(`\nSika Sentinel – Instruction`);
  console.log(`  Actor: ${actor.actorId}  [${actor.role}@${actor.partnerId}]`);
  console.log(`  Text:  "${instruction}"\n`);

  try {
    const result = await runInstruction(instruction, actor, {
      defaultInitiatorId: opts.defaultFrom,
      dryRun: opts.dryRun,
      verbose: opts.verbose,
    });

    if (!result.parsed) {
      console.log(`✘  PARSE FAILED  –  ${result.parseResult.error}`);
      process.exit(2);
    }

    console.log(`[parsed intent] ${result.parseResult.intent}`);
    console.log(
      `[draft] ${JSON.stringify(result.parseResult.draft)}`
    );

    const verdict = result.decision!.allowed ? "✔  ALLOWED" : "✘  DENIED";
    console.log(`${verdict}  –  ${result.decision!.reason}`);
    if (result.auditEntry?.outcome?.txId) {
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
    const p = DEFAULT_POLICY;
    console.log("\nActive Policy Configuration:");
    console.log(`  Global max transfer:    ${p.maxTransferTinybar / 100_000_000} HBAR`);
    console.log(`  High-value threshold:   ${p.highValueThresholdTinybar / 100_000_000} HBAR`);
    console.log(`  Approvals required:     ${p.approvalsRequired}`);
    console.log(`  Enforce approved list:  ${p.enforceApprovedRecipients}`);
    console.log(`  Approved recipients:    ${p.approvedRecipients.join(", ")}`);
    console.log(`  Role limits:`);
    for (const [role, limits] of Object.entries(p.roleLimits)) {
      console.log(
        `    ${role.padEnd(9)} cap=${limits.maxTransferTinybar / 100_000_000} HBAR  ` +
          `actions=[${limits.allowedActions.join(", ")}]`
      );
    }
    console.log();
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
