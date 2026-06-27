/**
 * Rendering helpers for OTLP-ingested "custom" events (Claude Code and other
 * OpenTelemetry sources). These arrive as eventType='custom' with payload.type
 * 'otlp_log' or 'otlp_metric', so without help every one renders as the same
 * gray "otlp_log" / "otlp_metric" blob. These helpers derive a meaningful
 * title, icon, and detail fields from the OTLP event name / metric name /
 * attributes — covering user_prompt, assistant_response, hook_*, skill_activated,
 * plugin_loaded, mcp_server_connection, permission_mode_changed, and every
 * metric (token.usage, cost.usage, active_time.total, session.count, …).
 *
 * Returns null / [] for non-OTLP events so callers can fall back to their
 * existing rendering.
 */
import type { AgentLensEvent } from '@agentkitai/agentlens-core';

interface OtlpData {
  body?: string;
  name?: string;
  value?: number;
  attributes?: Record<string, unknown>;
}

function otlpKind(event: AgentLensEvent): 'log' | 'metric' | null {
  const p = event.payload as { type?: string } | undefined;
  if (p?.type === 'otlp_log') return 'log';
  if (p?.type === 'otlp_metric') return 'metric';
  return null;
}

function otlpData(event: AgentLensEvent): OtlpData {
  return ((event.payload as unknown as { data?: OtlpData }).data) ?? {};
}

/** Identity/boilerplate attribute keys hidden from detail views. */
const NOISE_KEYS = new Set([
  'session.id', 'organization.id', 'user.id', 'user.email',
  'user.account_uuid', 'user.account_id', 'terminal.type',
]);

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(Number.isInteger(n) ? n : Number(n.toFixed(4)));
}

/** True when this event is an OTLP-ingested generic custom event. */
export function isOtlpEvent(event: AgentLensEvent): boolean {
  return otlpKind(event) !== null;
}

/** Human title for an OTLP custom event, or null if it isn't one. */
export function otlpTitle(event: AgentLensEvent): string | null {
  const kind = otlpKind(event);
  if (!kind) return null;
  const data = otlpData(event);
  if (kind === 'metric') {
    const name = (data.name ?? 'metric').replace(/^claude_code\./, '');
    const attrs = data.attributes ?? {};
    const sub = typeof attrs.type === 'string' ? ` (${attrs.type})` : '';
    const v = typeof data.value === 'number' ? data.value : 0;
    if ((data.name ?? '').includes('cost')) return `${name} = $${v.toFixed(4)}${sub}`;
    return `${name} = ${fmtNum(v)}${sub}`;
  }
  const attrs = data.attributes ?? {};
  const name =
    (typeof attrs['event.name'] === 'string' && attrs['event.name']) ||
    (typeof data.body === 'string' && data.body) ||
    'log';
  return String(name).replace(/^claude_code\./, '');
}

const ICONS: Array<[RegExp, string]> = [
  [/cost/, '💰'], [/token/, '🔢'], [/active_time|duration/, '⏱️'],
  [/^session/, '▶️'], [/lines_of_code|code_edit|commit|pull_request/, '✏️'],
  [/user_prompt/, '💬'], [/assistant_response/, '🤖'], [/tool/, '🔧'],
  [/hook/, '🪝'], [/skill|plugin|mcp/, '🧩'], [/permission/, '🔐'],
];

/** Icon for an OTLP custom event, or null if it isn't one. */
export function otlpIcon(event: AgentLensEvent): string | null {
  const kind = otlpKind(event);
  if (!kind) return null;
  const data = otlpData(event);
  const key = String(
    data.name ?? (data.attributes?.['event.name'] as string | undefined) ?? data.body ?? '',
  );
  for (const [re, icon] of ICONS) if (re.test(key)) return icon;
  return kind === 'metric' ? '📈' : '📝';
}

/** Ordered [label, value] detail pairs (boilerplate identity keys removed). */
export function otlpDetailFields(event: AgentLensEvent): Array<[string, string]> {
  const kind = otlpKind(event);
  if (!kind) return [];
  const data = otlpData(event);
  const out: Array<[string, string]> = [];
  if (kind === 'metric') {
    if (data.name) out.push(['metric', String(data.name)]);
    if (typeof data.value === 'number') out.push(['value', fmtNum(data.value)]);
  } else if (data.body) {
    out.push(['event', String(data.body)]);
  }
  for (const [k, v] of Object.entries(data.attributes ?? {})) {
    if (NOISE_KEYS.has(k)) continue;
    if (v === undefined || v === null || v === '') continue;
    out.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  }
  return out;
}
