/**
 * ContextPanel — Cumulative state display (Story 5.5)
 *
 * Features:
 *  - Resizable right panel (default 40% width, drag to resize)
 *  - Tabbed interface: Summary, LLM History, Tool Results, Approvals
 *  - Collapses to thin bar with expand button
 *  - Updates instantly when step changes (all data computed from events)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentLensEvent,
  LlmCallPayload,
  LlmResponsePayload,
  LlmMessage,
  ToolCallPayload,
  ToolResponsePayload,
  ToolErrorPayload,
  ApprovalRequestedPayload,
  ApprovalDecisionPayload,
  CostTrackedPayload,
} from '@agentlensai/core';

// ─── Types ──────────────────────────────────────────────────────────

export interface ContextPanelProps {
  events: AgentLensEvent[];
  currentStep: number;
  sessionStartTime: string;
}

type TabKey = 'summary' | 'llm' | 'tools' | 'approvals';

interface TabDef {
  key: TabKey;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { key: 'summary',   label: 'Summary',     icon: '📊' },
  { key: 'llm',       label: 'LLM History', icon: '🧠' },
  { key: 'tools',     label: 'Tool Results', icon: '🔧' },
  { key: 'approvals', label: 'Approvals',   icon: '🔐' },
];

// ─── Cumulative context computation ─────────────────────────────────

interface CumulativeContext {
  eventCounts: Record<string, number>;
  cumulativeCost: number;
  elapsedMs: number;
  errorCount: number;
  warningCount: number;
  warnings: string[];
  llmHistory: LlmHistoryEntry[];
  toolResults: ToolResultEntry[];
  approvals: ApprovalEntry[];
}

interface LlmHistoryEntry {
  callId: string;
  provider: string;
  model: string;
  messages: LlmMessage[];
  response?: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  redacted: boolean;
}

interface ToolResultEntry {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
  completed: boolean;
}

interface ApprovalEntry {
  requestId: string;
  action: string;
  status: 'pending' | 'granted' | 'denied' | 'expired';
  urgency?: string;
  decidedBy?: string;
  reason?: string;
}

function computeContext(
  events: AgentLensEvent[],
  currentStep: number,
  sessionStartTime: string,
): CumulativeContext {
  const ctx: CumulativeContext = {
    eventCounts: {},
    cumulativeCost: 0,
    elapsedMs: 0,
    errorCount: 0,
    warningCount: 0,
    warnings: [],
    llmHistory: [],
    toolResults: [],
    approvals: [],
  };

  const llmCallMap = new Map<string, LlmHistoryEntry>();
  const toolCallMap = new Map<string, ToolResultEntry>();
  const approvalMap = new Map<string, ApprovalEntry>();
  const startMs = new Date(sessionStartTime).getTime();

  const upTo = Math.min(currentStep + 1, events.length);

  for (let i = 0; i < upTo; i++) {
    const ev = events[i];
    const p = ev.payload as Record<string, unknown>;

    // Event counts
    ctx.eventCounts[ev.eventType] = (ctx.eventCounts[ev.eventType] || 0) + 1;

    // Elapsed time
    ctx.elapsedMs = new Date(ev.timestamp).getTime() - startMs;

    // Error count
    if (
      ev.severity === 'error' ||
      ev.severity === 'critical' ||
      ev.eventType === 'tool_error' ||
      ev.eventType === 'alert_triggered'
    ) {
      ctx.errorCount++;
    }

    // Warnings
    if (ev.severity === 'warn') {
      ctx.warningCount++;
      ctx.warnings.push(`${ev.eventType}: ${getWarningText(ev)}`);
    }

    // Cost tracking
    if (ev.eventType === 'cost_tracked') {
      const costP = p as unknown as CostTrackedPayload;
      ctx.cumulativeCost += costP.costUsd;
    }

    // LLM history
    if (ev.eventType === 'llm_call') {
      const llmP = p as unknown as LlmCallPayload;
      const entry: LlmHistoryEntry = {
        callId: llmP.callId,
        provider: llmP.provider,
        model: llmP.model,
        messages: llmP.messages,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        redacted: llmP.redacted ?? false,
      };
      llmCallMap.set(llmP.callId, entry);
      ctx.llmHistory.push(entry);
    }

    if (ev.eventType === 'llm_response') {
      const llmR = p as unknown as LlmResponsePayload;
      const entry = llmCallMap.get(llmR.callId);
      if (entry) {
        entry.response = llmR.completion;
        entry.toolCalls = llmR.toolCalls;
        entry.inputTokens = llmR.usage.inputTokens;
        entry.outputTokens = llmR.usage.outputTokens;
        entry.totalTokens = llmR.usage.totalTokens;
        entry.costUsd = llmR.costUsd;
        entry.latencyMs = llmR.latencyMs;
        if (llmR.redacted) entry.redacted = true;
      }
      // Also accumulate cost from llm_response
      ctx.cumulativeCost += llmR.costUsd;
    }

    // Tool results
    if (ev.eventType === 'tool_call') {
      const toolP = p as unknown as ToolCallPayload;
      const entry: ToolResultEntry = {
        callId: toolP.callId,
        toolName: toolP.toolName,
        arguments: toolP.arguments,
        completed: false,
      };
      toolCallMap.set(toolP.callId, entry);
      ctx.toolResults.push(entry);
    }

    if (ev.eventType === 'tool_response') {
      const toolR = p as unknown as ToolResponsePayload;
      const entry = toolCallMap.get(toolR.callId);
      if (entry) {
        entry.result = toolR.result;
        entry.durationMs = toolR.durationMs;
        entry.completed = true;
      }
    }

    if (ev.eventType === 'tool_error') {
      const toolE = p as unknown as ToolErrorPayload;
      const entry = toolCallMap.get(toolE.callId);
      if (entry) {
        entry.error = toolE.error;
        entry.durationMs = toolE.durationMs;
        entry.completed = true;
      }
    }

    // Approvals
    if (ev.eventType === 'approval_requested') {
      const apP = p as unknown as ApprovalRequestedPayload;
      const entry: ApprovalEntry = {
        requestId: apP.requestId,
        action: apP.action,
        status: 'pending',
        urgency: apP.urgency,
      };
      approvalMap.set(apP.requestId, entry);
      ctx.approvals.push(entry);
    }

    if (ev.eventType === 'approval_granted') {
      const apD = p as unknown as ApprovalDecisionPayload;
      const entry = approvalMap.get(apD.requestId);
      if (entry) {
        entry.status = 'granted';
        entry.decidedBy = apD.decidedBy;
        entry.reason = apD.reason;
      }
    }

    if (ev.eventType === 'approval_denied') {
      const apD = p as unknown as ApprovalDecisionPayload;
      const entry = approvalMap.get(apD.requestId);
      if (entry) {
        entry.status = 'denied';
        entry.decidedBy = apD.decidedBy;
        entry.reason = apD.reason;
      }
    }

    if (ev.eventType === 'approval_expired') {
      const apD = p as unknown as ApprovalDecisionPayload;
      const entry = approvalMap.get(apD.requestId);
      if (entry) {
        entry.status = 'expired';
      }
    }
  }

  return ctx;
}

function getWarningText(ev: AgentLensEvent): string {
  const p = ev.payload as Record<string, unknown>;
  if (typeof p.message === 'string') return p.message;
  if (typeof p.error === 'string') return p.error;
  return ev.eventType;
}

// ─── Duration formatting ────────────────────────────────────────────

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins < 60) return `${mins}m ${secs}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '—';
  if (keys.length <= 2) {
    return keys.map(k => {
      const v = args[k];
      const s = typeof v === 'string'
        ? (v.length > 40 ? v.slice(0, 40) + '…' : v)
        : JSON.stringify(v)?.slice(0, 40) ?? '';
      return `${k}: ${s}`;
    }).join(', ');
  }
  return `${keys.length} args`;
}

// ─── Summary Tab ────────────────────────────────────────────────────

function SummaryTab({ ctx }: { ctx: CumulativeContext }): React.ReactElement {
  const sortedCounts = Object.entries(ctx.eventCounts)
    .sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-4 p-3">
      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard icon="⏱️" label="Elapsed" value={formatDurationMs(ctx.elapsedMs)} />
        <MetricCard icon="💰" label="Cost" value={`$${ctx.cumulativeCost.toFixed(4)}`} />
        <MetricCard icon="❌" label="Errors" value={ctx.errorCount} alert={ctx.errorCount > 0} />
        <MetricCard icon="⚠️" label="Warnings" value={ctx.warningCount} />
      </div>

      {/* Event counts by type */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Event Counts</h4>
        <div className="space-y-1">
          {sortedCounts.map(([type, count]) => (
            <div key={type} className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{type.replace(/_/g, ' ')}</span>
              <span className="font-mono text-gray-800 tabular-nums">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Warnings list */}
      {ctx.warnings.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Warnings</h4>
          <div className="space-y-1">
            {ctx.warnings.slice(-10).map((w, i) => (
              <div key={i} className="text-xs text-yellow-700 bg-yellow-50 rounded px-2 py-1 border border-yellow-200">
                {w}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, alert }: {
  icon: string;
  label: string;
  value: string | number;
  alert?: boolean;
}): React.ReactElement {
  return (
    <div className={`rounded-lg border p-2.5 ${
      alert ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
    }`}>
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className={`text-lg font-semibold mt-0.5 ${alert ? 'text-red-700' : 'text-gray-900'}`}>
        {value}
      </div>
    </div>
  );
}

// ─── LLM History Tab ────────────────────────────────────────────────

function LlmHistoryTab({ entries }: { entries: LlmHistoryEntry[] }): React.ReactElement {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <span className="text-2xl block mb-2">🧠</span>
        <p className="text-sm">No LLM calls yet</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {entries.map((entry, idx) => (
        <LlmHistoryEntry key={entry.callId + idx} entry={entry} index={idx} />
      ))}
    </div>
  );
}

function LlmHistoryEntry({ entry, index }: { entry: LlmHistoryEntry; index: number }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-400">#{index + 1}</span>
          <span className="text-sm font-medium text-gray-800">{entry.model}</span>
          {entry.redacted && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">
              REDACTED
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400 font-mono tabular-nums">
          ${entry.costUsd.toFixed(4)}
        </span>
      </div>

      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
        <span>{entry.totalTokens.toLocaleString()} tokens</span>
        <span>({entry.inputTokens.toLocaleString()}↑ {entry.outputTokens.toLocaleString()}↓)</span>
        {entry.latencyMs > 0 && <span>{formatDurationMs(entry.latencyMs)}</span>}
      </div>

      <button
        className="mt-1.5 text-xs text-blue-500 hover:text-blue-700"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '▾ Hide messages' : '▸ Show messages'}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 max-h-80 overflow-y-auto">
          {entry.redacted ? (
            <div className="text-sm text-gray-400 italic bg-gray-50 rounded p-3 border border-gray-200">
              [REDACTED] — Content was redacted for privacy
            </div>
          ) : (
            <>
              {entry.messages.map((msg, mi) => (
                <MessageBubble key={mi} message={msg} />
              ))}
              {entry.response !== undefined && entry.response !== null && (
                <MessageBubble message={{ role: 'assistant', content: entry.response }} />
              )}
              {entry.toolCalls && entry.toolCalls.length > 0 && (
                <div className="text-xs bg-purple-50 rounded p-2 border border-purple-200">
                  <span className="font-medium text-purple-700">Tool calls: </span>
                  {entry.toolCalls.map(tc => tc.name).join(', ')}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const ROLE_COLORS: Record<string, string> = {
  system:    'bg-gray-50 border-gray-200 text-gray-600',
  user:      'bg-blue-50 border-blue-200 text-blue-800',
  assistant: 'bg-green-50 border-green-200 text-green-800',
  tool:      'bg-purple-50 border-purple-200 text-purple-800',
};

function MessageBubble({ message }: { message: LlmMessage }): React.ReactElement {
  const colorClass = ROLE_COLORS[message.role] ?? ROLE_COLORS.system;
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content, null, 2);

  return (
    <div className={`text-xs rounded border p-2 ${colorClass}`}>
      <div className="font-semibold text-xs uppercase opacity-60 mb-0.5">{message.role}</div>
      <div className="whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{content}</div>
    </div>
  );
}

// ─── Tool Results Tab ───────────────────────────────────────────────

function ToolResultsTab({ entries }: { entries: ToolResultEntry[] }): React.ReactElement {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <span className="text-2xl block mb-2">🔧</span>
        <p className="text-sm">No tool calls yet</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {entries.map((entry, idx) => (
        <ToolResultRow key={entry.callId + idx} entry={entry} />
      ))}
    </div>
  );
}

function ToolResultRow({ entry }: { entry: ToolResultEntry }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
            entry.error ? 'bg-red-500' : entry.completed ? 'bg-green-500' : 'bg-yellow-400'
          }`} />
          <span className="text-sm font-medium text-gray-800">{entry.toolName}</span>
        </div>
        <div className="flex items-center gap-2">
          {entry.durationMs !== undefined && (
            <span className="text-xs font-mono text-gray-400 tabular-nums">
              {formatDurationMs(entry.durationMs)}
            </span>
          )}
          {!entry.completed && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">
              pending
            </span>
          )}
        </div>
      </div>

      <div className="text-xs text-gray-500 mt-0.5 truncate ml-4">
        {summarizeArgs(entry.arguments)}
      </div>

      {entry.error && (
        <div className="text-xs text-red-600 mt-1 ml-4 bg-red-50 rounded px-2 py-1 border border-red-200">
          {entry.error}
        </div>
      )}

      <button
        className="mt-1 ml-4 text-xs text-blue-500 hover:text-blue-700"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '▾ Hide details' : '▸ Show details'}
      </button>

      {expanded && (
        <div className="mt-2 ml-4 space-y-2">
          <div>
            <span className="text-xs text-gray-400">Arguments</span>
            <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-2 mt-0.5 overflow-x-auto max-h-32 overflow-y-auto">
              {JSON.stringify(entry.arguments, null, 2)}
            </pre>
          </div>
          {entry.result !== undefined && (
            <div>
              <span className="text-xs text-gray-400">Result</span>
              <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-2 mt-0.5 overflow-x-auto max-h-32 overflow-y-auto">
                {typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Approvals Tab ──────────────────────────────────────────────────

const APPROVAL_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
  granted: { bg: 'bg-green-100',  text: 'text-green-800',  label: 'Granted' },
  denied:  { bg: 'bg-red-100',    text: 'text-red-800',    label: 'Denied' },
  expired: { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Expired' },
};

function ApprovalsTab({ entries }: { entries: ApprovalEntry[] }): React.ReactElement {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <span className="text-2xl block mb-2">🔐</span>
        <p className="text-sm">No approval requests</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {entries.map((entry, idx) => {
        const statusStyle = APPROVAL_STATUS_STYLES[entry.status] ?? APPROVAL_STATUS_STYLES.pending;
        return (
          <div key={entry.requestId + idx} className="px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-800">{entry.action}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                {statusStyle.label}
              </span>
            </div>
            {entry.urgency && (
              <div className="text-xs text-gray-500 mt-0.5">Urgency: {entry.urgency}</div>
            )}
            {entry.decidedBy && (
              <div className="text-xs text-gray-500 mt-0.5">By: {entry.decidedBy}</div>
            )}
            {entry.reason && (
              <div className="text-xs text-gray-500 mt-0.5">Reason: {entry.reason}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ContextPanel Component ────────────────────────────────────

const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_RATIO = 0.7;
const COLLAPSED_WIDTH = 36;

export function ContextPanel({
  events,
  currentStep,
  sessionStartTime,
}: ContextPanelProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabKey>('summary');
  const [collapsed, setCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number | null>(null); // null = use default 40%
  const panelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Compute cumulative context up to current step
  const ctx = useMemo(
    () => computeContext(events, currentStep, sessionStartTime),
    [events, currentStep, sessionStartTime],
  );

  // ── Resize handling ───────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelRef.current?.offsetWidth ?? 400;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartX.current - e.clientX; // dragging left = increase width
      const parentWidth = panelRef.current?.parentElement?.offsetWidth ?? 1000;
      const maxWidth = parentWidth * MAX_PANEL_RATIO;
      const newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, dragStartWidth.current + delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ── Collapsed state ───────────────────────────────────────────

  if (collapsed) {
    return (
      <div
        className="flex-shrink-0 bg-gray-100 border-l border-gray-200 flex flex-col items-center py-3 cursor-pointer hover:bg-gray-200 transition-colors"
        style={{ width: COLLAPSED_WIDTH }}
        onClick={() => setCollapsed(false)}
        title="Expand context panel"
      >
        <span className="text-gray-500 text-sm">◀</span>
        <span
          className="text-xs text-gray-400 mt-2"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
        >
          Context
        </span>
      </div>
    );
  }

  // ── Panel width style ─────────────────────────────────────────

  const widthStyle = panelWidth ? { width: panelWidth } : { width: '40%' };

  return (
    <div
      ref={panelRef}
      className="flex-shrink-0 bg-white border-l border-gray-200 flex flex-col min-w-[200px] relative"
      style={widthStyle}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 active:bg-blue-500 z-10 transition-colors"
        onMouseDown={handleMouseDown}
        title="Drag to resize"
      />

      {/* Header with tabs + collapse button */}
      <div className="flex items-center border-b border-gray-200 bg-gray-50">
        {/* Collapse button */}
        <button
          className="px-2 py-2.5 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
          onClick={() => setCollapsed(true)}
          title="Collapse panel"
        >
          ▶
        </button>

        {/* Tabs */}
        <div className="flex flex-1 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-2.5 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
              {/* Badge for count */}
              {tab.key === 'llm' && ctx.llmHistory.length > 0 && (
                <span className="ml-0.5 text-[10px] bg-indigo-100 text-indigo-600 rounded-full px-1.5">
                  {ctx.llmHistory.length}
                </span>
              )}
              {tab.key === 'tools' && ctx.toolResults.length > 0 && (
                <span className="ml-0.5 text-[10px] bg-blue-100 text-blue-600 rounded-full px-1.5">
                  {ctx.toolResults.length}
                </span>
              )}
              {tab.key === 'approvals' && ctx.approvals.length > 0 && (
                <span className="ml-0.5 text-[10px] bg-purple-100 text-purple-600 rounded-full px-1.5">
                  {ctx.approvals.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'summary' && <SummaryTab ctx={ctx} />}
        {activeTab === 'llm' && <LlmHistoryTab entries={ctx.llmHistory} />}
        {activeTab === 'tools' && <ToolResultsTab entries={ctx.toolResults} />}
        {activeTab === 'approvals' && <ApprovalsTab entries={ctx.approvals} />}
      </div>
    </div>
  );
}
