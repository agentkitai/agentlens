/**
 * agentlens guardrails — Guardrail rule management
 */
import { parseArgs } from 'node:util';
import { createClientFromConfig } from '../lib/client.js';
import { printTable, printJson, formatTimestamp, truncate } from '../lib/output.js';

const HELP = `Usage: agentlens guardrails <subcommand> [options]

Manage guardrail rules for automated agent safety.

Subcommands:
  list                     List all guardrail rules
  get <id>                 Show detailed rule config, state, and recent triggers
  create                   Create a new guardrail rule
  enable <id>              Enable a guardrail rule
  disable <id>             Disable a guardrail rule
  history <id>             Show trigger history for a rule
  delete <id>              Delete a guardrail rule

Options:
  --format <fmt>           Output format: table (default) or json
  --url <url>              Server URL (overrides config)
  -h, --help               Show help

Examples:
  agentlens guardrails list
  agentlens guardrails list --agent my-agent --status enabled
  agentlens guardrails get rule_01HX...
  agentlens guardrails create --name "High Error Rate" --condition-type error_rate_threshold \\
    --condition-config '{"threshold":50}' --action-type pause_agent --action-config '{}'
  agentlens guardrails enable rule_01HX...
  agentlens guardrails disable rule_01HX...
  agentlens guardrails history rule_01HX... --limit 20
  agentlens guardrails delete rule_01HX... --force`;

export async function runGuardrailsCommand(argv: string[]): Promise<void> {
  const subcommand = argv[0];
  const rest = argv.slice(1);

  switch (subcommand) {
    case 'list':
      return handleList(rest);
    case 'get':
      return handleGet(rest);
    case 'create':
      return handleCreate(rest);
    case 'enable':
      return handleEnable(rest);
    case 'disable':
      return handleDisable(rest);
    case 'history':
      return handleHistory(rest);
    case 'delete':
      return handleDelete(rest);
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      return;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.log(HELP);
      process.exit(1);
  }
}

// ─── List ──────────────────────────────────────────────────────────

async function handleList(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      agent: { type: 'string', short: 'a' },
      status: { type: 'string', short: 's' },
      format: { type: 'string', short: 'f' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log('Usage: agentlens guardrails list [--agent <id>] [--status enabled|disabled|all]');
    return;
  }

  const client = createClientFromConfig(values.url);
  const isJson = values.format === 'json';

  const result = await client.listGuardrails({
    agentId: values.agent,
  });

  let rules = result.rules;

  // Filter by status if specified
  if (values.status === 'enabled') {
    rules = rules.filter((r) => r.enabled);
  } else if (values.status === 'disabled') {
    rules = rules.filter((r) => !r.enabled);
  }

  if (isJson) {
    printJson(rules);
    return;
  }

  console.log('\nGuardrail Rules\n');
  if (rules.length === 0) {
    console.log('No guardrail rules found.');
    return;
  }

  const headers = ['ID', 'Name', 'Condition', 'Status', 'Agent', 'Dry Run'];
  const rows = rules.map((r) => [
    truncate(r.id, 16),
    truncate(r.name, 24),
    r.conditionType,
    r.enabled ? '\x1b[32menabled\x1b[0m' : '\x1b[31mdisabled\x1b[0m',
    r.agentId ?? '(all)',
    r.dryRun ? 'yes' : 'no',
  ]);
  printTable(headers, rows);
}

// ─── Get ───────────────────────────────────────────────────────────

async function handleGet(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      format: { type: 'string', short: 'f' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log('Usage: agentlens guardrails get <id>');
    return;
  }

  const client = createClientFromConfig(values.url);
  const isJson = values.format === 'json';
  const ruleId = positionals[0]!;

  const result = await client.getGuardrailStatus(ruleId);

  if (isJson) {
    printJson(result);
    return;
  }

  const { rule, state, recentTriggers } = result;
  console.log(`\nGuardrail Rule — ${rule.name}\n`);
  console.log(`  ID:              ${rule.id}`);
  console.log(`  Status:          ${rule.enabled ? '\x1b[32menabled\x1b[0m' : '\x1b[31mdisabled\x1b[0m'}`);
  console.log(`  Dry Run:         ${rule.dryRun ? 'yes' : 'no'}`);
  console.log(`  Agent:           ${rule.agentId ?? '(all agents)'}`);
  console.log(`  Condition:       ${rule.conditionType}`);
  console.log(`  Condition Config:${JSON.stringify(rule.conditionConfig)}`);
  console.log(`  Action:          ${rule.actionType}`);
  console.log(`  Action Config:   ${JSON.stringify(rule.actionConfig)}`);
  console.log(`  Cooldown:        ${rule.cooldownMinutes} min`);
  console.log(`  Created:         ${formatTimestamp(rule.createdAt)}`);
  console.log(`  Updated:         ${formatTimestamp(rule.updatedAt)}`);

  if (state) {
    console.log('\n  State:');
    console.log(`    Trigger Count:   ${state.triggerCount}`);
    if (state.lastTriggeredAt) {
      console.log(`    Last Triggered:  ${formatTimestamp(state.lastTriggeredAt)}`);
    }
    if (state.currentValue != null) {
      console.log(`    Current Value:   ${state.currentValue}`);
    }
  }

  if (recentTriggers.length > 0) {
    console.log('\n  Recent Triggers:');
    const headers = ['Time', 'Value', 'Threshold', 'Executed', 'Result'];
    const rows = recentTriggers.map((t) => [
      formatTimestamp(t.triggeredAt),
      String(t.conditionValue),
      String(t.conditionThreshold),
      t.actionExecuted ? 'yes' : 'no',
      t.actionResult ?? '-',
    ]);
    printTable(headers, rows);
  }
}

// ─── Create ────────────────────────────────────────────────────────

async function handleCreate(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: 'string' },
      description: { type: 'string' },
      agent: { type: 'string', short: 'a' },
      'condition-type': { type: 'string' },
      'condition-config': { type: 'string' },
      'action-type': { type: 'string' },
      'action-config': { type: 'string' },
      'dry-run': { type: 'boolean', default: true },
      cooldown: { type: 'string' },
      enabled: { type: 'boolean', default: false },
      format: { type: 'string', short: 'f' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log('Usage: agentlens guardrails create --name <n> --condition-type <type> --condition-config <json> --action-type <type> --action-config <json> [--agent <id>] [--dry-run (default: true)] [--enabled (default: false)] [--cooldown <min>]');
    return;
  }

  if (!values.name || !values['condition-type'] || !values['condition-config'] || !values['action-type'] || !values['action-config']) {
    console.error('Error: --name, --condition-type, --condition-config, --action-type, and --action-config are required');
    process.exit(1);
  }

  let conditionConfig: Record<string, unknown>;
  let actionConfig: Record<string, unknown>;
  try {
    conditionConfig = JSON.parse(values['condition-config']);
  } catch {
    console.error('Error: --condition-config must be valid JSON');
    process.exit(1);
  }
  try {
    actionConfig = JSON.parse(values['action-config']);
  } catch {
    console.error('Error: --action-config must be valid JSON');
    process.exit(1);
  }

  const client = createClientFromConfig(values.url);
  const isJson = values.format === 'json';

  const rule = await client.createGuardrail({
    name: values.name,
    description: values.description,
    conditionType: values['condition-type'],
    conditionConfig: conditionConfig!,
    actionType: values['action-type'],
    actionConfig: actionConfig!,
    agentId: values.agent,
    enabled: values.enabled ?? false,
    dryRun: values['dry-run'] ?? true,
    cooldownMinutes: values.cooldown ? parseInt(values.cooldown, 10) : 5,
  });

  if (isJson) {
    printJson(rule);
    return;
  }

  console.log(`\n✓ Created guardrail rule: ${rule.id}`);
  console.log(`  Name: ${rule.name}`);
  console.log(`  Condition: ${rule.conditionType}`);
  console.log(`  Action: ${rule.actionType}`);
  console.log(`  Dry Run: ${rule.dryRun ? 'yes' : 'no'}`);
}

// ─── Enable / Disable ──────────────────────────────────────────────

async function handleEnable(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: {
      format: { type: 'string', short: 'f' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log('Usage: agentlens guardrails enable <id>');
    return;
  }

  const client = createClientFromConfig(values.url);
  const rule = await client.enableGuardrail(positionals[0]!);

  if (values.format === 'json') {
    printJson(rule);
    return;
  }

  console.log(`✓ Enabled guardrail: ${rule.name} (${rule.id})`);
}

async function handleDisable(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: {
      format: { type: 'string', short: 'f' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log('Usage: agentlens guardrails disable <id>');
    return;
  }

  const client = createClientFromConfig(values.url);
  const rule = await client.disableGuardrail(positionals[0]!);

  if (values.format === 'json') {
    printJson(rule);
    return;
  }

  console.log(`✓ Disabled guardrail: ${rule.name} (${rule.id})`);
}

// ─── History ───────────────────────────────────────────────────────

async function handleHistory(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: {
      limit: { type: 'string', short: 'l' },
      format: { type: 'string', short: 'f' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log('Usage: agentlens guardrails history <id> [--limit <n>]');
    return;
  }

  const client = createClientFromConfig(values.url);
  const isJson = values.format === 'json';
  const ruleId = positionals[0]!;
  const limit = values.limit ? parseInt(values.limit, 10) : 50;

  const result = await client.getGuardrailHistory({ ruleId, limit });

  if (isJson) {
    printJson(result);
    return;
  }

  console.log(`\nTrigger History — ${ruleId} (${result.total} total)\n`);
  if (result.triggers.length === 0) {
    console.log('No triggers found.');
    return;
  }

  const headers = ['Time', 'Value', 'Threshold', 'Executed', 'Result'];
  const rows = result.triggers.map((t) => [
    formatTimestamp(t.triggeredAt),
    String(t.conditionValue),
    String(t.conditionThreshold),
    t.actionExecuted ? 'yes' : 'no',
    t.actionResult ?? '-',
  ]);
  printTable(headers, rows);
}

// ─── Delete ────────────────────────────────────────────────────────

async function handleDelete(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: {
      force: { type: 'boolean', default: false },
      format: { type: 'string', short: 'f' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log('Usage: agentlens guardrails delete <id> [--force]');
    return;
  }

  const client = createClientFromConfig(values.url);
  const ruleId = positionals[0]!;

  if (!values.force) {
    // In non-interactive context, --force is required
    console.error(`Warning: This will permanently delete guardrail ${ruleId}.`);
    console.error('Use --force to confirm.');
    process.exit(1);
  }

  await client.deleteGuardrail(ruleId);

  if (values.format === 'json') {
    printJson({ ok: true, id: ruleId });
    return;
  }

  console.log(`✓ Deleted guardrail: ${ruleId}`);
}
