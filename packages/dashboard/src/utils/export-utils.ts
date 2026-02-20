/**
 * [F11-S3] Export utilities — JSON and CSV session export
 */
import type { AgentLensEvent, Session } from '@agentlensai/core';

const VERSION = '0.12.1'; // TODO: import from package.json or build-time constant

export function exportSessionJSON(
  session: Session,
  events: AgentLensEvent[],
  chainValid: boolean,
): Blob {
  const data = {
    exportedAt: new Date().toISOString(),
    agentlensVersion: VERSION,
    session,
    chainValid,
    events,
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export function exportSessionCSV(
  _session: Session,
  events: AgentLensEvent[],
): Blob {
  const headers = [
    'id',
    'timestamp',
    'eventType',
    'severity',
    'toolName',
    'model',
    'durationMs',
    'costUsd',
    'payloadSummary',
  ];

  const rows = events.map((ev) => {
    const p = ev.payload as Record<string, unknown>;
    const toolName = (p.toolName as string) ?? '';
    const model = (p.model as string) ?? '';
    const durationMs = (p.durationMs as number) ?? (p.latencyMs as number) ?? '';
    const costUsd = (p.costUsd as number) ?? '';
    const summary = JSON.stringify(p).slice(0, 200).replace(/"/g, '""');

    return [
      ev.id,
      ev.timestamp,
      ev.eventType,
      ev.severity,
      toolName,
      model,
      String(durationMs),
      String(costUsd),
      `"${summary}"`,
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  return new Blob([csv], { type: 'text/csv' });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function getExportFilename(sessionId: string, ext: 'json' | 'csv'): string {
  const date = new Date().toISOString().slice(0, 10);
  return `session-${sessionId}-${date}.${ext}`;
}
