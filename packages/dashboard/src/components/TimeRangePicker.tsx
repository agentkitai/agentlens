import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface TimeRange {
  label: string;
  from: string; // ISO string
  to?: string;  // ISO string (defaults to now)
  range?: string; // shorthand for API (e.g., '1h', '24h', '7d')
  granularity: string; // 'minute' | 'hour' | 'day'
}

const PRESETS: Array<{ label: string; rangeName: string; offsetMs: number; granularity: string }> = [
  { label: 'Last 1 hour',  rangeName: '1h',  offsetMs: 3_600_000,       granularity: 'hour' },
  { label: 'Last 6 hours', rangeName: '6h',  offsetMs: 21_600_000,      granularity: 'hour' },
  { label: 'Last 24 hours', rangeName: '24h', offsetMs: 86_400_000,     granularity: 'hour' },
  { label: 'Last 3 days',  rangeName: '3d',  offsetMs: 259_200_000,     granularity: 'hour' },
  { label: 'Last 7 days',  rangeName: '7d',  offsetMs: 604_800_000,     granularity: 'day' },
  { label: 'Last 30 days', rangeName: '30d', offsetMs: 2_592_000_000,   granularity: 'day' },
];

function presetToTimeRange(preset: (typeof PRESETS)[number]): TimeRange {
  const now = new Date();
  return {
    label: preset.label,
    from: new Date(now.getTime() - preset.offsetMs).toISOString(),
    to: now.toISOString(),
    range: preset.rangeName,
    granularity: preset.granularity,
  };
}

export const DEFAULT_TIME_RANGE: TimeRange = presetToTimeRange(PRESETS[2]); // Last 24 hours

interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

export function TimeRangePicker({ value, onChange }: TimeRangePickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCustom(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handlePreset = useCallback((preset: (typeof PRESETS)[number]) => {
    onChange(presetToTimeRange(preset));
    setOpen(false);
    setShowCustom(false);
  }, [onChange]);

  const handleCustomApply = useCallback(() => {
    if (!customFrom) return;
    const fromDate = new Date(customFrom);
    const toDate = customTo ? new Date(customTo) : new Date();
    const diffMs = toDate.getTime() - fromDate.getTime();
    const granularity = diffMs <= 86_400_000 ? 'hour' : 'day';

    onChange({
      label: `${fromDate.toLocaleDateString()} – ${toDate.toLocaleDateString()}`,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      granularity,
    });
    setOpen(false);
    setShowCustom(false);
  }, [customFrom, customTo, onChange]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
      >
        <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        {value.label}
        <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg">
          {!showCustom ? (
            <div className="py-1">
              {PRESETS.map((p) => (
                <button
                  key={p.rangeName}
                  onClick={() => handlePreset(p)}
                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors ${
                    value.range === p.rangeName ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <hr className="my-1 border-gray-100" />
              <button
                onClick={() => setShowCustom(true)}
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Custom range…
              </button>
            </div>
          ) : (
            <div className="p-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
                <input
                  type="datetime-local"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To (empty = now)</label>
                <input
                  type="datetime-local"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCustom(false)}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Back
                </button>
                <button
                  onClick={handleCustomApply}
                  disabled={!customFrom}
                  className="flex-1 rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
