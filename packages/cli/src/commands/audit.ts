/**
 * agentlens audit — Audit trail verification
 */
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { createClientFromConfig } from '../lib/client.js';
import { printJson } from '../lib/output.js';

const HELP = `Usage: agentlens audit verify [options]

Verify audit trail hash chain integrity.

Options:
  --from <date>         Start date (ISO 8601)
  --to <date>           End date (ISO 8601)
  --session-id <id>     Verify a single session
  --output <path>       Save signed JSON report to file
  --format <fmt>        Output format: table (default) or json
  --url <url>           Server URL (overrides config)
  -h, --help            Show help

Examples:
  agentlens audit verify --from 2026-01-01 --to 2026-02-01
  agentlens audit verify --session-id sess_abc
  agentlens audit verify --from 2026-01-01 --to 2026-02-01 --output report.json`;

export async function runAuditCommand(argv: string[]): Promise<void> {
  const subcommand = argv[0];

  if (subcommand === 'verify') {
    await runAuditVerify(argv.slice(1));
  } else if (subcommand === '--help' || subcommand === '-h' || !subcommand) {
    console.log(HELP);
  } else {
    console.error(`Unknown audit subcommand: ${subcommand}`);
    console.log(HELP);
    process.exit(1);
  }
}

async function runAuditVerify(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      'session-id': { type: 'string' },
      output: { type: 'string' },
      format: { type: 'string', default: 'table' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const sessionId = values['session-id'];
  const from = values.from;
  const to = values.to;

  if (!sessionId && (!from || !to)) {
    console.error('Error: Provide --from/--to or --session-id');
    console.log(HELP);
    process.exit(1);
  }

  const client = createClientFromConfig(values.url);
  const report = await client.verifyAudit({
    from: from || undefined,
    to: to || undefined,
    sessionId: sessionId || undefined,
  });

  // Save to file if requested
  if (values.output) {
    writeFileSync(values.output, JSON.stringify(report, null, 2));
    console.log(`Report saved to ${values.output}`);
  }

  // Output
  if (values.format === 'json') {
    printJson(report);
  } else {
    // Human-readable table output
    const statusIcon = report.verified ? '\x1b[32m✓ VERIFIED\x1b[0m' : '\x1b[31m✗ FAILED\x1b[0m';
    console.log('');
    console.log('Audit Trail Verification');
    console.log('========================');
    console.log(`Status:     ${statusIcon}`);
    console.log(`Verified:   ${report.verifiedAt}`);
    if (report.range) {
      console.log(`Range:      ${report.range.from} → ${report.range.to}`);
    }
    if (report.sessionId) {
      console.log(`Session:    ${report.sessionId}`);
    }
    console.log(`Sessions:   ${report.sessionsVerified}`);
    console.log(`Events:     ${report.totalEvents.toLocaleString()}`);
    console.log(`First Hash: ${report.firstHash ?? 'N/A'}`);
    console.log(`Last Hash:  ${report.lastHash ?? 'N/A'}`);
    console.log(`Signed:     ${report.signature ? 'Yes (hmac-sha256)' : 'No'}`);

    if (report.brokenChains.length > 0) {
      console.log('');
      console.log('Broken Chains:');
      console.log('  Session     | Failed At | Event ID             | Reason');
      console.log('  ' + '─'.repeat(80));
      for (const bc of report.brokenChains) {
        console.log(`  ${bc.sessionId.padEnd(12)}| index ${String(bc.failedAtIndex).padEnd(4)}| ${bc.failedEventId.padEnd(21)}| ${bc.reason}`);
      }
    } else {
      console.log('');
      console.log('Broken Chains: None');
    }
    console.log('');
  }

  // Exit code
  if (!report.verified) {
    process.exit(1);
  }
}
