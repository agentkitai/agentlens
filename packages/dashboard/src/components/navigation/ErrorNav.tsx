/**
 * [F11-S2] ErrorNav — Previous/Next error navigation buttons with counter
 */
import React, { useCallback, useMemo } from 'react';
import { findNextError, findPrevError, getErrorPosition } from '../../hooks/useErrorIndices';

export interface ErrorNavProps {
  errorIndices: number[];
  currentIndex: number;
  onNavigate: (index: number) => void;
}

export function ErrorNav({
  errorIndices,
  currentIndex,
  onNavigate,
}: ErrorNavProps): React.ReactElement | null {
  if (errorIndices.length === 0) return null;

  const nextIdx = useMemo(() => findNextError(errorIndices, currentIndex), [errorIndices, currentIndex]);
  const prevIdx = useMemo(() => findPrevError(errorIndices, currentIndex), [errorIndices, currentIndex]);
  const position = useMemo(() => getErrorPosition(errorIndices, currentIndex), [errorIndices, currentIndex]);

  const handlePrev = useCallback(() => {
    if (prevIdx !== null) onNavigate(prevIdx);
  }, [prevIdx, onNavigate]);

  const handleNext = useCallback(() => {
    if (nextIdx !== null) onNavigate(nextIdx);
  }, [nextIdx, onNavigate]);

  return (
    <div className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1">
      <button
        onClick={handlePrev}
        disabled={prevIdx === null}
        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-30 disabled:cursor-not-allowed font-medium"
        title="Previous Error (Shift+Ctrl+E)"
        aria-label="Previous error"
      >
        ↑ Prev
      </button>
      <span className="text-xs text-red-700 font-medium px-1">
        {position > 0 ? `Error ${position} of ${errorIndices.length}` : `${errorIndices.length} error${errorIndices.length !== 1 ? 's' : ''}`}
      </span>
      <button
        onClick={handleNext}
        disabled={nextIdx === null}
        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-30 disabled:cursor-not-allowed font-medium"
        title="Next Error (Shift+E)"
        aria-label="Next error"
      >
        Next ↓
      </button>
    </div>
  );
}
