/**
 * Tests for CLI guardrails command (Story 4.4)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock SDK client ────────────────────────────────────────────────

const mockListGuardrails = vi.fn();
const mockGetGuardrail = vi.fn();
const mockCreateGuardrail = vi.fn();
const mockUpdateGuardrail = vi.fn();
const mockDeleteGuardrail = vi.fn();
const mockEnableGuardrail = vi.fn();
const mockDisableGuardrail = vi.fn();
const mockGetGuardrailHistory = vi.fn();
const mockGetGuardrailStatus = vi.fn();

vi.mock('@agentlensai/sdk', () => {
  return {
    AgentLensClient: class MockAgentLensClient {
      listGuardrails = mockListGuardrails;
      getGuardrail = mockGetGuardrail;
      createGuardrail = mockCreateGuardrail;
      updateGuardrail = mockUpdateGuardrail;
      deleteGuardrail = mockDeleteGuardrail;
      enableGuardrail = mockEnableGuardrail;
      disableGuardrail = mockDisableGuardrail;
      getGuardrailHistory = mockGetGuardrailHistory;
      getGuardrailStatus = mockGetGuardrailStatus;
    },
  };
});

vi.mock('../lib/config.js', () => ({
  loadConfig: () => ({ url: 'http://localhost:3400', apiKey: 'test' }),
}));

// ─── Helpers ────────────────────────────────────────────────────────

let consoleOutput: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
  consoleOutput = [];
  originalLog = console.log;
  originalError = console.error;
  console.log = (...args: unknown[]) => consoleOutput.push(args.join(' '));
  console.error = (...args: unknown[]) => consoleOutput.push(args.join(' '));
  vi.clearAllMocks();
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

// ─── Sample data ────────────────────────────────────────────────────

const sampleRule = {
  id: 'rule_001',
  tenantId: 'default',
  name: 'High Error Rate',
  description: 'Pause agent on high errors',
  enabled: true,
  conditionType: 'error_rate_threshold',
  conditionConfig: { threshold: 50 },
  actionType: 'pause_agent',
  actionConfig: { reason: 'Error rate exceeded' },
  agentId: 'agent-1',
  cooldownMinutes: 10,
  dryRun: false,
  createdAt: '2026-02-08T10:00:00Z',
  updatedAt: '2026-02-08T10:00:00Z',
};

const sampleTrigger = {
  id: 'trig_001',
  ruleId: 'rule_001',
  tenantId: 'default',
  triggeredAt: '2026-02-08T11:00:00Z',
  conditionValue: 55.0,
  conditionThreshold: 50.0,
  actionExecuted: true,
  actionResult: 'Agent paused',
  metadata: {},
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('guardrails command', () => {
  it('shows help with --help flag', async () => {
    const { runGuardrailsCommand } = await import('../commands/guardrails.js');
    await runGuardrailsCommand(['--help']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Usage: agentlens guardrails');
    expect(output).toContain('list');
    expect(output).toContain('create');
    expect(output).toContain('enable');
    expect(output).toContain('delete');
  });

  it('lists guardrail rules in a table', async () => {
    mockListGuardrails.mockResolvedValue({ rules: [sampleRule] });
    const { runGuardrailsCommand } = await import('../commands/guardrails.js');

    await runGuardrailsCommand(['list']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Guardrail Rules');
    expect(output).toContain('High Error Rate');
    expect(output).toContain('error_rate_threshold');
    expect(mockListGuardrails).toHaveBeenCalled();
  });

  it('lists rules filtered by status', async () => {
    const disabledRule = { ...sampleRule, id: 'rule_002', enabled: false };
    mockListGuardrails.mockResolvedValue({ rules: [sampleRule, disabledRule] });
    const { runGuardrailsCommand } = await import('../commands/guardrails.js');

    await runGuardrailsCommand(['list', '--status', 'disabled']);

    const output = consoleOutput.join('\n');
    // Only the disabled rule should appear
    expect(output).not.toContain('rule_001');
    expect(output).toContain('rule_002');
  });

  it('shows detailed rule with get subcommand', async () => {
    mockGetGuardrailStatus.mockResolvedValue({
      rule: sampleRule,
      state: { ruleId: 'rule_001', tenantId: 'default', triggerCount: 3, lastTriggeredAt: '2026-02-08T11:00:00Z' },
      recentTriggers: [sampleTrigger],
    });
    const { runGuardrailsCommand } = await import('../commands/guardrails.js');

    await runGuardrailsCommand(['get', 'rule_001']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('High Error Rate');
    expect(output).toContain('rule_001');
    expect(output).toContain('Trigger Count');
    expect(output).toContain('3');
    expect(mockGetGuardrailStatus).toHaveBeenCalledWith('rule_001');
  });

  it('creates a guardrail rule', async () => {
    mockCreateGuardrail.mockResolvedValue(sampleRule);
    const { runGuardrailsCommand } = await import('../commands/guardrails.js');

    await runGuardrailsCommand([
      'create',
      '--name', 'High Error Rate',
      '--condition-type', 'error_rate_threshold',
      '--condition-config', '{"threshold":50}',
      '--action-type', 'pause_agent',
      '--action-config', '{"reason":"Error rate exceeded"}',
      '--agent', 'agent-1',
    ]);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Created guardrail rule');
    expect(output).toContain('rule_001');
    expect(mockCreateGuardrail).toHaveBeenCalledWith(expect.objectContaining({
      name: 'High Error Rate',
      conditionType: 'error_rate_threshold',
      actionType: 'pause_agent',
      agentId: 'agent-1',
    }));
  });

  it('enables a guardrail rule', async () => {
    mockEnableGuardrail.mockResolvedValue({ ...sampleRule, enabled: true });
    const { runGuardrailsCommand } = await import('../commands/guardrails.js');

    await runGuardrailsCommand(['enable', 'rule_001']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Enabled guardrail');
    expect(mockEnableGuardrail).toHaveBeenCalledWith('rule_001');
  });

  it('disables a guardrail rule', async () => {
    mockDisableGuardrail.mockResolvedValue({ ...sampleRule, enabled: false });
    const { runGuardrailsCommand } = await import('../commands/guardrails.js');

    await runGuardrailsCommand(['disable', 'rule_001']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Disabled guardrail');
    expect(mockDisableGuardrail).toHaveBeenCalledWith('rule_001');
  });

  it('shows trigger history', async () => {
    mockGetGuardrailHistory.mockResolvedValue({
      triggers: [sampleTrigger],
      total: 1,
    });
    const { runGuardrailsCommand } = await import('../commands/guardrails.js');

    await runGuardrailsCommand(['history', 'rule_001', '--limit', '10']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Trigger History');
    expect(output).toContain('1 total');
    expect(output).toContain('Agent paused');
    expect(mockGetGuardrailHistory).toHaveBeenCalledWith({ ruleId: 'rule_001', limit: 10 });
  });

  it('deletes a guardrail rule with --force', async () => {
    mockDeleteGuardrail.mockResolvedValue({ ok: true });
    const { runGuardrailsCommand } = await import('../commands/guardrails.js');

    await runGuardrailsCommand(['delete', 'rule_001', '--force']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Deleted guardrail');
    expect(mockDeleteGuardrail).toHaveBeenCalledWith('rule_001');
  });

  it('outputs JSON when --format json on list', async () => {
    mockListGuardrails.mockResolvedValue({ rules: [sampleRule] });
    const { runGuardrailsCommand } = await import('../commands/guardrails.js');

    await runGuardrailsCommand(['list', '--format', 'json']);

    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('High Error Rate');
  });
});
