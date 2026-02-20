/**
 * Budget Status Badge (Feature 5 — Story 8)
 *
 * Progress bar showing spend vs limit with color coding.
 */

import React from 'react';

export interface BudgetStatusBadgeProps {
  currentSpend: number;
  limitUsd: number;
  periodLabel?: string;
  compact?: boolean;
}

export function BudgetStatusBadge({ currentSpend, limitUsd, periodLabel, compact }: BudgetStatusBadgeProps) {
  const pct = limitUsd > 0 ? Math.min((currentSpend / limitUsd) * 100, 100) : 0;
  const color = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: compact ? '100px' : '160px' }}>
      <div style={{ flex: 1, height: compact ? '6px' : '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: compact ? '10px' : '11px', color: '#64748b', whiteSpace: 'nowrap' }}>
        ${currentSpend.toFixed(2)}/${limitUsd.toFixed(2)}
        {periodLabel && ` (${periodLabel})`}
      </span>
    </div>
  );
}

export function AnomalyBadge() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '2px',
      padding: '1px 6px', borderRadius: '4px',
      background: '#fef3c7', color: '#92400e', fontSize: '11px', fontWeight: 600,
    }}>
      ⚠️ Anomaly
    </span>
  );
}
