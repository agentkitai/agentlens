import React from 'react';

export interface MetricCard {
  label: string;
  value: number | string;
  /** previous period value for trend calculation */
  previousValue?: number;
  currentValue?: number;
}

function TrendBadge({ current, previous }: { current: number; previous: number }): React.ReactElement {
  if (previous === 0 && current === 0) {
    return <span className="text-xs text-gray-400 font-medium">—</span>;
  }

  if (current > previous) {
    const pct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 100;
    return (
      <span className="inline-flex items-center text-xs font-medium text-green-600">
        ↑ {pct}%
      </span>
    );
  }

  if (current < previous) {
    const pct = previous > 0 ? Math.round(((previous - current) / previous) * 100) : 100;
    return (
      <span className="inline-flex items-center text-xs font-medium text-red-600">
        ↓ {pct}%
      </span>
    );
  }

  return <span className="text-xs text-gray-400 font-medium">—</span>;
}

function SkeletonCard(): React.ReactElement {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-6">
      <div className="h-4 w-24 rounded bg-gray-200" />
      <div className="mt-3 h-8 w-16 rounded bg-gray-200" />
      <div className="mt-2 h-3 w-12 rounded bg-gray-200" />
    </div>
  );
}

interface MetricsGridProps {
  cards: MetricCard[];
  loading: boolean;
}

export function MetricsGrid({ cards, loading }: MetricsGridProps): React.ReactElement {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <p className="text-sm font-medium text-gray-500">{card.label}</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{card.value}</p>
          {card.currentValue !== undefined && card.previousValue !== undefined && (
            <div className="mt-2">
              <TrendBadge current={card.currentValue} previous={card.previousValue} />
              <span className="ml-1 text-xs text-gray-400">vs prev 24h</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
