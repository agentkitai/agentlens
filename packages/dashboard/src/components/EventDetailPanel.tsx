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
import type { AgentLensEvent, EventSeverity } from '@agentlensai/core';

// ─── Types ──────────────────────────────────────────────────────────

export interface EventDetailPanelProps {
  event: AgentLensEvent | null;
  onClose: () => void;
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

// ─── Component ──────────────────────────────────────────────────────

export function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
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

  if (!event) return null;

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
            <h2 className="text-sm font-semibold text-gray-800 truncate">Event Detail</h2>
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
          {/* Metadata */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Metadata
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

          {/* Payload */}
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
        </div>
      </div>
    </>
  );
}
