/**
 * DistributionChart — SVG Box Plot (Story 6.4)
 *
 * Renders a box plot for a single metric across multiple variants.
 * No external chart library — pure SVG.
 *
 * Box plot elements:
 *  - Median line
 *  - Q1-Q3 box
 *  - Whiskers at 1.5×IQR (clamped to data range)
 *  - Outlier dots beyond whiskers
 */
import React, { useMemo } from 'react';

// ─── Types ──────────────────────────────────────────────────────────

export interface VariantDistribution {
  variantId: string;
  variantName: string;
  values: number[];
  color: string;
}

export interface DistributionChartProps {
  metric: string;
  metricLabel: string;
  variants: VariantDistribution[];
}

// ─── Stat Helpers ───────────────────────────────────────────────────

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
}

function computeBoxStats(values: number[]): BoxStats | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const fenceLow = q1 - 1.5 * iqr;
  const fenceHigh = q3 + 1.5 * iqr;

  // Whiskers: furthest data points within fences
  const whiskerLow = sorted.find((v) => v >= fenceLow) ?? min;
  const whiskerHigh = [...sorted].reverse().find((v) => v <= fenceHigh) ?? max;

  // Outliers: points beyond fences
  const outliers = sorted.filter((v) => v < fenceLow || v > fenceHigh);

  return { min, q1, median, q3, max, whiskerLow, whiskerHigh, outliers };
}

// ─── SVG Constants ──────────────────────────────────────────────────

const CHART_WIDTH = 600;
const CHART_HEIGHT = 200;
const PADDING_LEFT = 60;
const PADDING_RIGHT = 20;
const PADDING_TOP = 30;
const PADDING_BOTTOM = 40;
const PLOT_WIDTH = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

// ─── Component ──────────────────────────────────────────────────────

export function DistributionChart({
  metric,
  metricLabel,
  variants,
}: DistributionChartProps): React.ReactElement {
  const { allStats, globalMin, globalMax, scale } = useMemo(() => {
    const stats = variants.map((v) => ({
      ...v,
      stats: computeBoxStats(v.values),
    }));

    // Global range for shared x-axis
    let gMin = Infinity;
    let gMax = -Infinity;
    for (const s of stats) {
      if (!s.stats) continue;
      gMin = Math.min(gMin, s.stats.min);
      gMax = Math.max(gMax, s.stats.max);
    }

    // Add 5% padding on each side
    if (gMin === Infinity) {
      gMin = 0;
      gMax = 1;
    }
    const range = gMax - gMin || 1;
    gMin -= range * 0.05;
    gMax += range * 0.05;

    const scaleFn = (val: number) =>
      PADDING_LEFT + ((val - gMin) / (gMax - gMin)) * PLOT_WIDTH;

    return { allStats: stats, globalMin: gMin, globalMax: gMax, scale: scaleFn };
  }, [variants]);

  const variantCount = allStats.length;
  const boxHeight = Math.min(30, (PLOT_HEIGHT - 10) / Math.max(variantCount, 1));
  const gap = variantCount > 1 ? (PLOT_HEIGHT - variantCount * boxHeight) / (variantCount + 1) : (PLOT_HEIGHT - boxHeight) / 2;

  // Generate axis ticks
  const ticks = useMemo(() => {
    const range = globalMax - globalMin;
    const rawStep = range / 5;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const step = Math.ceil(rawStep / magnitude) * magnitude || 1;
    const t: number[] = [];
    let v = Math.ceil(globalMin / step) * step;
    while (v <= globalMax) {
      t.push(v);
      v += step;
    }
    return t;
  }, [globalMin, globalMax]);

  const hasData = allStats.some((s) => s.stats !== null);

  if (!hasData) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
        No distribution data available for <strong>{metricLabel}</strong>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium text-gray-700">{metricLabel}</h4>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full max-w-[600px]"
        role="img"
        aria-label={`Box plot for ${metricLabel}`}
      >
        {/* Grid lines */}
        {ticks.map((t) => (
          <line
            key={`grid-${t}`}
            x1={scale(t)}
            x2={scale(t)}
            y1={PADDING_TOP}
            y2={PADDING_TOP + PLOT_HEIGHT}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        ))}

        {/* X-axis ticks */}
        {ticks.map((t) => (
          <text
            key={`tick-${t}`}
            x={scale(t)}
            y={CHART_HEIGHT - 8}
            textAnchor="middle"
            fontSize={10}
            fill="#6b7280"
          >
            {formatTickValue(t)}
          </text>
        ))}

        {/* Box plots */}
        {allStats.map((v, idx) => {
          if (!v.stats) return null;
          const y = PADDING_TOP + gap * (idx + 1) + boxHeight * idx;
          const midY = y + boxHeight / 2;
          const { q1, q3, median, whiskerLow, whiskerHigh, outliers } = v.stats;

          return (
            <g key={v.variantId} aria-label={`${v.variantName} distribution`}>
              {/* Whisker line */}
              <line
                x1={scale(whiskerLow)}
                x2={scale(whiskerHigh)}
                y1={midY}
                y2={midY}
                stroke={v.color}
                strokeWidth={1.5}
              />

              {/* Whisker caps */}
              <line
                x1={scale(whiskerLow)}
                x2={scale(whiskerLow)}
                y1={y + boxHeight * 0.2}
                y2={y + boxHeight * 0.8}
                stroke={v.color}
                strokeWidth={1.5}
              />
              <line
                x1={scale(whiskerHigh)}
                x2={scale(whiskerHigh)}
                y1={y + boxHeight * 0.2}
                y2={y + boxHeight * 0.8}
                stroke={v.color}
                strokeWidth={1.5}
              />

              {/* IQR box */}
              <rect
                x={scale(q1)}
                y={y}
                width={Math.max(scale(q3) - scale(q1), 1)}
                height={boxHeight}
                fill={v.color}
                fillOpacity={0.2}
                stroke={v.color}
                strokeWidth={1.5}
                rx={2}
              />

              {/* Median line */}
              <line
                x1={scale(median)}
                x2={scale(median)}
                y1={y}
                y2={y + boxHeight}
                stroke={v.color}
                strokeWidth={2.5}
              />

              {/* Outlier dots */}
              {outliers.map((o, oi) => (
                <circle
                  key={`outlier-${oi}`}
                  cx={scale(o)}
                  cy={midY}
                  r={2.5}
                  fill={v.color}
                  fillOpacity={0.6}
                />
              ))}

              {/* Label */}
              <text
                x={PADDING_LEFT - 6}
                y={midY}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={11}
                fill="#374151"
                fontWeight={500}
              >
                {v.variantName.length > 8
                  ? v.variantName.slice(0, 8) + '…'
                  : v.variantName}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatTickValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (v / 1_000).toFixed(1) + 'k';
  if (abs < 0.01 && abs > 0) return v.toExponential(1);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}
