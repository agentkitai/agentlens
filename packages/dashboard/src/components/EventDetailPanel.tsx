/**
 * EventDetailPanel — Side panel for full event details (Story 7.4)
 *
 * Features:
 *  - Full JSON payload with syntax highlighting (react-json-view-lite)
 *  - Collapsible tree viewer for nested objects
 *  - Event metadata, timing, severity, hash
 *  - Close button + Escape to close
 *  - Click another event updates panel
 */
import React, { useCallback, useEffect } from 'react';
import { JsonView, darkStyles, allExpanded, collapseAllNested } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import type {
  AgentLensEvent,
  EventSeverity,
  LlmCallPayload,
  LlmResponsePayload,
  LlmMessage,
} from '@agentlensai/core';

// ─── Types ──────────────────────────────────────────────────────────

export interface EventDetailPanelProps {
  event: AgentLensEvent | null;
  onClose: () => void;
  /** All session events — used to find paired llm_response for llm_call events */
  allEvents?: AgentLensEvent[];
}

// ─── Severity badge ─────────────────────────────────────────────────

const SEVERITY_COLORS: Record<EventSeverity, string> = {
  debug:    'bg-gray-100 text-gray-700',
  info:     'bg-blue-100 text-blue-700',
  warn:     'bg-yellow-100 text-yellow-800',
  error:    'bg-red-100 text-red-700',
  critical: 'bg-red-200 text-red-900',
};

function SeverityBadge({ severity }: { severity: EventSeverity }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[severity]}`}>
      {severity}
    </span>
  );
}

// ─── Metadata row ───────────────────────────────────────────────────

function MetaRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs font-medium text-gray-500 w-24 flex-shrink-0">{label}</span>
      <span className={`text-xs text-gray-800 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ─── LLM helpers ────────────────────────────────────────────────────

function getMessageContentText(content: LlmMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      title={`Copy ${label}`}
    >
      {copied ? '✓ Copied' : `📋 Copy ${label}`}
    </button>
  );
}

// ─── Message role colors ────────────────────────────────────────────

const ROLE_STYLES: Record<string, { bg: string; text: string; align: string; font: string }> = {
  system:    { bg: 'bg-gray-100', text: 'text-gray-700', align: 'self-start', font: 'font-mono' },
  user:      { bg: 'bg-blue-50', text: 'text-blue-900', align: 'self-start', font: '' },
  assistant: { bg: 'bg-green-50', text: 'text-green-900', align: 'self-end', font: '' },
  tool:      { bg: 'bg-gray-100', text: 'text-gray-700', align: 'self-start', font: 'font-mono' },
};

function getMessageRoleStyle(role: string) {
  return ROLE_STYLES[role] ?? ROLE_STYLES.user;
}

// ─── LLM Detail View ───────────────────────────────────────────────

function LlmDetailView({
  callPayload,
  responsePayload,
}: {
  callPayload: LlmCallPayload;
  responsePayload: LlmResponsePayload | null;
}) {
  const isRedacted = callPayload.redacted || responsePayload?.redacted;

  // Build the full prompt text for copy-to-clipboard
  const promptText = React.useMemo(() => {
    if (isRedacted) return '[Content redacted]';
    const parts: string[] = [];
    if (callPayload.systemPrompt) {
      parts.push(`[system]\n${callPayload.systemPrompt}`);
    }
    for (const msg of callPayload.messages) {
      parts.push(`[${msg.role}]\n${getMessageContentText(msg.content)}`);
    }
    return parts.join('\n\n');
  }, [callPayload, isRedacted]);

  const completionText = React.useMemo(() => {
    if (!responsePayload) return '';
    if (responsePayload.redacted) return '[Content redacted]';
    return responsePayload.completion ?? '';
  }, [responsePayload]);

  return (
    <div className="space-y-4">
      {/* ── Prompt Section ───────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Prompt
          </h3>
          <CopyButton text={promptText} label="prompt" />
        </div>

        {isRedacted ? (
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-400 italic">
            [Content redacted]
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* System prompt (separate field) */}
            {callPayload.systemPrompt && (
              <div className={`rounded-lg px-3 py-2 text-sm max-w-[90%] self-start bg-gray-100 text-gray-700 font-mono`}>
                <div className="text-xs font-semibold text-gray-500 mb-1">system</div>
                <div className="whitespace-pre-wrap break-words">{callPayload.systemPrompt}</div>
              </div>
            )}

            {/* Messages in chat-bubble style */}
            {callPayload.messages.map((msg, i) => {
              const rs = getMessageRoleStyle(msg.role);
              const text = getMessageContentText(msg.content);
              return (
                <div key={i} className={`rounded-lg px-3 py-2 text-sm max-w-[90%] ${rs.align} ${rs.bg} ${rs.text} ${rs.font}`}>
                  <div className="text-xs font-semibold text-gray-500 mb-1">{msg.role}</div>
                  <div className="whitespace-pre-wrap break-words">{text || <span className="italic text-gray-400">(empty)</span>}</div>
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-1 text-xs text-gray-500">
                      Tool calls: {msg.toolCalls.map((tc) => tc.name).join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Completion Section ───────────────────────────── */}
      {responsePayload && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Completion
            </h3>
            {completionText && <CopyButton text={completionText} label="completion" />}
          </div>

          {responsePayload.redacted ? (
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-400 italic">
              [Content redacted]
            </div>
          ) : (
            <div className="bg-green-50 rounded-lg p-3 text-sm text-green-900">
              {responsePayload.completion ? (
                <div className="whitespace-pre-wrap break-words">{responsePayload.completion}</div>
              ) : (
                <div className="italic text-gray-400">
                  {responsePayload.toolCalls && responsePayload.toolCalls.length > 0
                    ? `(tool_use: ${responsePayload.toolCalls.map((tc) => tc.name).join(', ')})`
                    : '(no completion text)'}
                </div>
              )}

              {/* Tool calls from response */}
              {responsePayload.toolCalls && responsePayload.toolCalls.length > 0 && (
                <div className="mt-2 pt-2 border-t border-green-200">
                  <div className="text-xs font-semibold text-gray-500 mb-1">Tool Calls</div>
                  {responsePayload.toolCalls.map((tc, i) => (
                    <div key={i} className="text-xs font-mono bg-white/60 rounded px-2 py-1 mt-1">
                      <span className="font-semibold">{tc.name}</span>
                      <span className="text-gray-500 ml-1">({tc.id})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Metadata Section ─────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          LLM Metadata
        </h3>
        <div className="bg-gray-50 rounded-lg p-3">
          <MetaRow label="Provider" value={
            <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
              {callPayload.provider}
            </span>
          } />
          <MetaRow label="Model" value={
            <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
              {callPayload.model}
            </span>
          } />
          {responsePayload && (
            <>
              <MetaRow label="Finish Reason" value={responsePayload.finishReason} />
              <MetaRow label="Latency" value={formatMs(responsePayload.latencyMs)} mono />
              <MetaRow label="Cost" value={
                <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs font-medium">
                  {formatCost(responsePayload.costUsd)}
                </span>
              } />
            </>
          )}

          {/* Parameters */}
          {callPayload.parameters && Object.keys(callPayload.parameters).length > 0 && (
            <>
              <div className="border-t border-gray-200 my-2" />
              <div className="text-xs font-semibold text-gray-500 mb-1">Parameters</div>
              {callPayload.parameters.temperature !== undefined && (
                <MetaRow label="Temperature" value={String(callPayload.parameters.temperature)} mono />
              )}
              {callPayload.parameters.maxTokens !== undefined && (
                <MetaRow label="Max Tokens" value={String(callPayload.parameters.maxTokens)} mono />
              )}
              {callPayload.parameters.topP !== undefined && (
                <MetaRow label="Top P" value={String(callPayload.parameters.topP)} mono />
              )}
              {callPayload.parameters.stopSequences && callPayload.parameters.stopSequences.length > 0 && (
                <MetaRow label="Stop Seqs" value={callPayload.parameters.stopSequences.join(', ')} mono />
              )}
            </>
          )}

          {/* Token breakdown */}
          {responsePayload && (
            <>
              <div className="border-t border-gray-200 my-2" />
              <div className="text-xs font-semibold text-gray-500 mb-1">Token Usage</div>
              <MetaRow label="Input" value={formatTokenCount(responsePayload.usage.inputTokens)} mono />
              <MetaRow label="Output" value={formatTokenCount(responsePayload.usage.outputTokens)} mono />
              <MetaRow label="Total" value={formatTokenCount(responsePayload.usage.totalTokens)} mono />
              {responsePayload.usage.thinkingTokens !== undefined && responsePayload.usage.thinkingTokens > 0 && (
                <MetaRow label="Thinking" value={formatTokenCount(responsePayload.usage.thinkingTokens)} mono />
              )}
              {responsePayload.usage.cacheReadTokens !== undefined && responsePayload.usage.cacheReadTokens > 0 && (
                <MetaRow label="Cache Read" value={formatTokenCount(responsePayload.usage.cacheReadTokens)} mono />
              )}
              {responsePayload.usage.cacheWriteTokens !== undefined && responsePayload.usage.cacheWriteTokens > 0 && (
                <MetaRow label="Cache Write" value={formatTokenCount(responsePayload.usage.cacheWriteTokens)} mono />
              )}
            </>
          )}
        </div>
      </section>

      {/* ── Tools Section (if tools provided in call) ──── */}
      {callPayload.tools && callPayload.tools.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Tools ({callPayload.tools.length})
          </h3>
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            {callPayload.tools.map((tool, i) => (
              <div key={i} className="border border-gray-200 rounded p-2 bg-white">
                <div className="text-sm font-medium text-gray-800 font-mono">{tool.name}</div>
                {tool.description && (
                  <div className="text-xs text-gray-500 mt-0.5">{tool.description}</div>
                )}
                {tool.parameters && Object.keys(tool.parameters).length > 0 && (
                  <div className="mt-1">
                    <JsonView
                      data={tool.parameters as Record<string, unknown>}
                      style={darkStyles}
                      shouldExpandNode={collapseAllNested}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────

export function EventDetailPanel({ event, onClose, allEvents }: EventDetailPanelProps) {
  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Find paired LLM event
  const llmPair = React.useMemo(() => {
    if (!event || !allEvents) return null;

    if (event.eventType === 'llm_call') {
      const callPayload = event.payload as LlmCallPayload;
      const responseEvent = allEvents.find(
        (e) => e.eventType === 'llm_response' && (e.payload as LlmResponsePayload).callId === callPayload.callId,
      );
      return {
        callPayload,
        responsePayload: responseEvent ? (responseEvent.payload as LlmResponsePayload) : null,
      };
    }

    if (event.eventType === 'llm_response') {
      const responsePayload = event.payload as LlmResponsePayload;
      const callEvent = allEvents.find(
        (e) => e.eventType === 'llm_call' && (e.payload as LlmCallPayload).callId === responsePayload.callId,
      );
      return {
        callPayload: callEvent ? (callEvent.payload as LlmCallPayload) : null,
        responsePayload,
      };
    }

    return null;
  }, [event, allEvents]);

  if (!event) return null;

  const isLlmEvent = event.eventType === 'llm_call' || event.eventType === 'llm_response';

  return (
    <>
      {/* Backdrop (click to close) */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-xl z-50 flex flex-col border-l border-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-gray-800 truncate">
              {isLlmEvent ? '🧠 LLM Call Detail' : 'Event Detail'}
            </h2>
            <SeverityBadge severity={event.severity} />
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors"
            aria-label="Close panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* LLM-specific detail view (Story 4.3) */}
          {isLlmEvent && llmPair && llmPair.callPayload && (
            <LlmDetailView
              callPayload={llmPair.callPayload}
              responsePayload={llmPair.responsePayload}
            />
          )}

          {/* Orphan llm_response without paired llm_call — show response data directly */}
          {isLlmEvent && llmPair && !llmPair.callPayload && llmPair.responsePayload && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                LLM Response (no paired call found)
              </h3>
              <div className="bg-gray-50 rounded-lg p-3">
                <MetaRow label="Provider" value={
                  <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
                    {llmPair.responsePayload.provider}
                  </span>
                } />
                <MetaRow label="Model" value={
                  <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
                    {llmPair.responsePayload.model}
                  </span>
                } />
                <MetaRow label="Finish Reason" value={llmPair.responsePayload.finishReason} />
                <MetaRow label="Latency" value={formatMs(llmPair.responsePayload.latencyMs)} mono />
                <MetaRow label="Cost" value={
                  <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs font-medium">
                    {formatCost(llmPair.responsePayload.costUsd)}
                  </span>
                } />
                <div className="border-t border-gray-200 my-2" />
                <div className="text-xs font-semibold text-gray-500 mb-1">Token Usage</div>
                <MetaRow label="Input" value={formatTokenCount(llmPair.responsePayload.usage.inputTokens)} mono />
                <MetaRow label="Output" value={formatTokenCount(llmPair.responsePayload.usage.outputTokens)} mono />
                <MetaRow label="Total" value={formatTokenCount(llmPair.responsePayload.usage.totalTokens)} mono />
              </div>
              {llmPair.responsePayload.completion && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Completion
                    </h3>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 text-sm text-green-900 whitespace-pre-wrap break-words">
                    {llmPair.responsePayload.completion}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Standard metadata (shown for all events) */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {isLlmEvent ? 'Event Metadata' : 'Metadata'}
            </h3>
            <div className="bg-gray-50 rounded-lg p-3">
              <MetaRow label="Event ID" value={event.id} mono />
              <MetaRow label="Type" value={
                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                  {event.eventType}
                </span>
              } />
              <MetaRow label="Session ID" value={event.sessionId} mono />
              <MetaRow label="Agent ID" value={event.agentId} mono />
              <MetaRow label="Severity" value={<SeverityBadge severity={event.severity} />} />
              <MetaRow label="Timestamp" value={new Date(event.timestamp).toISOString()} mono />
            </div>
          </section>

          {/* Hash chain */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Hash Chain
            </h3>
            <div className="bg-gray-50 rounded-lg p-3">
              <MetaRow label="Hash" value={event.hash} mono />
              <MetaRow label="Prev Hash" value={event.prevHash ?? '(genesis)'} mono />
            </div>
          </section>

          {/* Custom metadata */}
          {Object.keys(event.metadata).length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Custom Metadata
              </h3>
              <div className="bg-gray-50 rounded-lg p-2 overflow-x-auto">
                <JsonView
                  data={event.metadata as Record<string, unknown>}
                  style={darkStyles}
                  shouldExpandNode={allExpanded}
                />
              </div>
            </section>
          )}

          {/* Payload (raw JSON — for non-LLM events or as fallback) */}
          {!isLlmEvent && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Payload
              </h3>
              <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                <JsonView
                  data={event.payload as Record<string, unknown>}
                  style={darkStyles}
                  shouldExpandNode={collapseAllNested}
                />
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
