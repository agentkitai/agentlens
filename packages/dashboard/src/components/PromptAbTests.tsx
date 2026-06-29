/**
 * Active A/B tests for a prompt (#150) — shows the traffic split per variant.
 * Per-variant metrics are comparable via the existing per-version analytics.
 */
import React from 'react';
import { useApi } from '../hooks/useApi';
import { listAbTests } from '../api/prompt-ab';

export function PromptAbTests({ templateId }: { templateId: string }): React.ReactElement | null {
  const { data } = useApi(() => listAbTests(templateId), [templateId]);
  const active = (data?.abTests ?? []).filter((t) => t.status === 'active');
  if (active.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">A/B tests</h3>
      <div className="space-y-3">
        {active.map((t) => {
          const total = t.variants.reduce((s, v) => s + v.weight, 0) || 1;
          return (
            <div key={t.id}>
              <div className="text-xs text-gray-500 mb-1">{t.environment} · traffic split</div>
              <div className="flex flex-wrap gap-2">
                {t.variants.map((v) => (
                  <span key={v.versionId} className="text-xs bg-indigo-50 text-indigo-700 rounded px-2 py-1">
                    {v.label}: {Math.round((v.weight / total) * 100)}%{' '}
                    <span className="text-indigo-400">({v.versionId.slice(0, 8)})</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PromptAbTests;
