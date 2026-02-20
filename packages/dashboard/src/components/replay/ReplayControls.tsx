/**
 * ReplayControls — Play/pause, step navigation, speed selector, keyboard shortcuts (Story 5.2)
 *
 * Features:
 *  - Play/pause button with auto-advance at selected speed
 *  - Step back (←) / step forward (→) buttons
 *  - Speed selector (1x, 2x, 5x, 10x)
 *  - Step counter "Step 23 of 847"
 *  - Keyboard: Space=play/pause, ArrowRight=step forward, ArrowLeft=step back, Home=first, End=last
 *  - Updates URL ?step=N via pushState (no navigation)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { findNextError, findPrevError } from '../../hooks/useErrorIndices';

// ─── Types ──────────────────────────────────────────────────────────

export interface ReplayControlsProps {
  currentStep: number;
  totalSteps: number;
  onStepChange: (step: number) => void;
  disabled?: boolean;
  /** Pre-computed error event indices for Shift+E / Shift+Ctrl+E navigation */
  errorIndices?: number[];
}

const SPEED_OPTIONS = [1, 2, 5, 10] as const;
type Speed = (typeof SPEED_OPTIONS)[number];

/** Base interval in ms at 1x speed */
const BASE_INTERVAL_MS = 500;

// ─── Component ──────────────────────────────────────────────────────

export function ReplayControls({
  currentStep,
  totalSteps,
  onStepChange,
  disabled = false,
  errorIndices = [],
}: ReplayControlsProps): React.ReactElement {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef(currentStep);

  // Keep stepRef in sync
  stepRef.current = currentStep;

  const isAtEnd = currentStep >= totalSteps - 1;
  const isAtStart = currentStep <= 0;

  // ── Step helpers ────────────────────────────────────────────────

  const stepForward = useCallback(() => {
    if (stepRef.current < totalSteps - 1) {
      onStepChange(stepRef.current + 1);
    }
  }, [totalSteps, onStepChange]);

  const stepBackward = useCallback(() => {
    if (stepRef.current > 0) {
      onStepChange(stepRef.current - 1);
    }
  }, [onStepChange]);

  const goToFirst = useCallback(() => {
    onStepChange(0);
  }, [onStepChange]);

  const goToLast = useCallback(() => {
    onStepChange(totalSteps - 1);
  }, [totalSteps, onStepChange]);

  // ── Play / pause ──────────────────────────────────────────────

  const stopPlaying = useCallback(() => {
    setPlaying(false);
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPlaying = useCallback(() => {
    if (isAtEnd) return;
    setPlaying(true);
  }, [isAtEnd]);

  const togglePlay = useCallback(() => {
    if (playing) {
      stopPlaying();
    } else {
      startPlaying();
    }
  }, [playing, stopPlaying, startPlaying]);

  // Pause at end
  useEffect(() => {
    if (playing && isAtEnd) {
      stopPlaying();
    }
  }, [playing, isAtEnd, stopPlaying]);

  // Auto-advance interval
  useEffect(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (playing && !disabled) {
      intervalRef.current = setInterval(() => {
        if (stepRef.current < totalSteps - 1) {
          onStepChange(stepRef.current + 1);
        }
      }, BASE_INTERVAL_MS / speed);
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [playing, speed, totalSteps, onStepChange, disabled]);

  // ── URL sync ──────────────────────────────────────────────────

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('step', String(currentStep));
    window.history.replaceState(null, '', url.toString());
  }, [currentStep]);

  // ── Keyboard shortcuts ────────────────────────────────────────

  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Shift+E = next error, Shift+Ctrl+E = previous error
      if (e.key === 'E' && e.shiftKey) {
        e.preventDefault();
        if (playing) stopPlaying();
        if (e.ctrlKey || e.metaKey) {
          const prev = findPrevError(errorIndices, stepRef.current);
          if (prev !== null) onStepChange(prev);
        } else {
          const next = findNextError(errorIndices, stepRef.current);
          if (next !== null) onStepChange(next);
        }
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (playing) stopPlaying();
          stepForward();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (playing) stopPlaying();
          stepBackward();
          break;
        case 'Home':
          e.preventDefault();
          if (playing) stopPlaying();
          goToFirst();
          break;
        case 'End':
          e.preventDefault();
          if (playing) stopPlaying();
          goToLast();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [disabled, togglePlay, stopPlaying, stepForward, stepBackward, goToFirst, goToLast, playing, errorIndices, onStepChange]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 px-4 py-2.5 shadow-sm">
      {/* Step backward */}
      <button
        onClick={stepBackward}
        disabled={disabled || isAtStart}
        className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Step back (←)"
        aria-label="Step back"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>

      {/* Play / Pause */}
      <button
        onClick={togglePlay}
        disabled={disabled || (isAtEnd && !playing)}
        className="p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Step forward */}
      <button
        onClick={stepForward}
        disabled={disabled || isAtEnd}
        className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Step forward (→)"
        aria-label="Step forward"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>

      {/* Divider */}
      <div className="w-px h-6 bg-gray-200" />

      {/* Step counter */}
      <span className="text-sm text-gray-600 font-mono tabular-nums min-w-[120px] text-center">
        Step {totalSteps === 0 ? 0 : currentStep + 1} of {totalSteps}
      </span>

      {/* Divider */}
      <div className="w-px h-6 bg-gray-200" />

      {/* Speed selector */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-400 mr-1">Speed</span>
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            disabled={disabled}
            className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
              speed === s
                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
