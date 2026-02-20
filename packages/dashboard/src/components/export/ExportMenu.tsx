/**
 * [F11-S3] ExportMenu — Dropdown button with JSON/CSV export options
 */
import React, { useCallback, useState } from 'react';
import type { AgentLensEvent, Session } from '@agentlensai/core';
import {
  exportSessionJSON,
  exportSessionCSV,
  triggerDownload,
  getExportFilename,
} from '../../utils/export-utils';

export interface ExportMenuProps {
  sessionId: string;
  session: Session;
  events: AgentLensEvent[];
  chainValid: boolean;
}

export function ExportMenu({
  sessionId,
  session,
  events,
  chainValid,
}: ExportMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(
    async (format: 'json' | 'csv') => {
      setExporting(true);
      setOpen(false);
      try {
        // For large datasets (>5000), use setTimeout to yield to UI
        // Full Web Worker implementation deferred for simplicity
        await new Promise((r) => setTimeout(r, 0));
        const blob =
          format === 'json'
            ? exportSessionJSON(session, events, chainValid)
            : exportSessionCSV(session, events);
        triggerDownload(blob, getExportFilename(sessionId, format));
      } finally {
        setExporting(false);
      }
    },
    [session, events, chainValid, sessionId],
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        disabled={exporting}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg transition-colors disabled:opacity-50"
      >
        {exporting ? (
          <>
            <span className="animate-spin">⏳</span>
            Exporting…
          </>
        ) : (
          <>
            📥 Export
          </>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          {/* Dropdown */}
          <div className="absolute right-0 mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
            <button
              onClick={() => handleExport('json')}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              📄 JSON
            </button>
            <button
              onClick={() => handleExport('csv')}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              📊 CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}
