/**
 * [F11-S1] SearchBar — Debounced text search input with result count badge
 *
 * Features:
 *  - 200ms debounced input
 *  - Clear button
 *  - "N of M results" counter
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface SearchBarProps {
  onQueryChange: (query: string) => void;
  resultCount: number;
  totalCount: number;
  placeholder?: string;
}

export function SearchBar({
  onQueryChange,
  resultCount,
  totalCount,
  placeholder = 'Search events…',
}: SearchBarProps): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputValue(val);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onQueryChange(val);
      }, 200);
    },
    [onQueryChange],
  );

  const handleClear = useCallback(() => {
    setInputValue('');
    if (timerRef.current) clearTimeout(timerRef.current);
    onQueryChange('');
  }, [onQueryChange]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const hasQuery = inputValue.length > 0;

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 max-w-md">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input
          type="text"
          value={inputValue}
          onChange={handleChange}
          placeholder={placeholder}
          className="w-full pl-9 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-colors"
          aria-label="Search events"
        />
        {hasQuery && (
          <button
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>
      {hasQuery && (
        <span className="text-xs text-gray-500 whitespace-nowrap">
          <span className="font-semibold text-gray-700">{resultCount}</span>
          {' of '}
          <span>{totalCount}</span>
          {' results'}
        </span>
      )}
    </div>
  );
}
