/**
 * ReplayScrubber — Canvas-based horizontal timeline scrubber (Story 5.3)
 *
 * Features:
 *  - Horizontal bar with events as colored dots positioned by timestamp
 *  - Color coding per event type (reuses EVENT_COLORS from Timeline)
 *  - Error events as taller red markers
 *  - Current step playhead (vertical line)
 *  - Click-to-jump to nearest event
 *  - Canvas rendering for performance (10K+ events)
 *  - Responsive: resizes with window
 *  - Hover tooltip with event type and timestamp
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentLensEvent } from '@agentlensai/core';

// ─── Types ──────────────────────────────────────────────────────────

export interface ReplayScrubberProps {
  events: AgentLensEvent[];
  currentStep: number;
  onStepChange: (step: number) => void;
  /** [F11-S4] Bookmarked step indices */
  bookmarks?: Set<number>;
}

// ─── Color mapping per event type ───────────────────────────────────
// Matches the palette from Timeline EVENT_STYLES

const EVENT_COLORS: Record<string, string> = {
  session_started: '#16a34a',   // green-600
  session_ended:   '#16a34a',
  tool_call:       '#2563eb',   // blue-600
  tool_response:   '#2563eb',
  tool_error:      '#dc2626',   // red-600
  approval_requested: '#9333ea', // purple-600
  approval_granted:   '#16a34a',
  approval_denied:    '#dc2626',
  approval_expired:   '#ca8a04', // yellow-600
  form_submitted:  '#0d9488',   // teal-600
  form_completed:  '#0d9488',
  form_expired:    '#ea580c',   // orange-600
  llm_call:        '#4f46e5',   // indigo-600
  llm_response:    '#4f46e5',
  cost_tracked:    '#ca8a04',
  alert_triggered: '#dc2626',
  alert_resolved:  '#16a34a',
  custom:          '#6b7280',   // gray-500
};

const ERROR_TYPES = new Set([
  'tool_error',
  'alert_triggered',
  'approval_denied',
]);

function getEventColor(eventType: string): string {
  return EVENT_COLORS[eventType] ?? EVENT_COLORS.custom;
}

function isErrorEvent(ev: AgentLensEvent): boolean {
  return (
    ERROR_TYPES.has(ev.eventType) ||
    ev.severity === 'error' ||
    ev.severity === 'critical'
  );
}

// ─── Constants ──────────────────────────────────────────────────────

const BAR_HEIGHT = 48;
const DOT_RADIUS = 3;
const ERROR_RADIUS = 5;
const PLAYHEAD_COLOR = '#1d4ed8'; // blue-700
const BG_COLOR = '#f9fafb';       // gray-50
const TRACK_COLOR = '#e5e7eb';    // gray-200

// ─── Component ──────────────────────────────────────────────────────

export function ReplayScrubber({
  events,
  currentStep,
  onStepChange,
  bookmarks,
}: ReplayScrubberProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  // ── Compute time range ────────────────────────────────────────

  const timeRange = useMemo(() => {
    if (events.length === 0) return { min: 0, max: 1 };
    const times = events.map((e) => new Date(e.timestamp).getTime());
    const min = Math.min(...times);
    const max = Math.max(...times);
    // Avoid zero-width range
    return { min, max: max === min ? min + 1 : max };
  }, [events]);

  // Pre-compute positions
  const eventPositions = useMemo(() => {
    const padding = 24; // px padding on each side
    const usableWidth = canvasWidth - padding * 2;
    const { min, max } = timeRange;
    const range = max - min;

    return events.map((ev) => {
      const t = new Date(ev.timestamp).getTime();
      const ratio = range > 0 ? (t - min) / range : 0.5;
      return {
        x: padding + ratio * usableWidth,
        isError: isErrorEvent(ev),
        color: getEventColor(ev.eventType),
      };
    });
  }, [events, canvasWidth, timeRange]);

  // ── Resize observer ───────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0) setCanvasWidth(Math.floor(width));
      }
    });
    observer.observe(container);

    // Initial measurement
    setCanvasWidth(Math.floor(container.clientWidth || 800));

    return () => observer.disconnect();
  }, []);

  // ── Draw ──────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = BAR_HEIGHT * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvasWidth, BAR_HEIGHT);

    // Track line
    const trackY = BAR_HEIGHT / 2;
    ctx.strokeStyle = TRACK_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(24, trackY);
    ctx.lineTo(canvasWidth - 24, trackY);
    ctx.stroke();

    // Event dots
    for (let i = 0; i < eventPositions.length; i++) {
      const pos = eventPositions[i];
      const radius = pos.isError ? ERROR_RADIUS : DOT_RADIUS;
      const y = trackY;

      ctx.fillStyle = pos.color;
      ctx.globalAlpha = pos.isError ? 1 : 0.7;
      ctx.beginPath();

      if (pos.isError) {
        // Error: taller vertical marker
        ctx.fillRect(pos.x - 1.5, trackY - ERROR_RADIUS * 2, 3, ERROR_RADIUS * 4);
      } else {
        ctx.arc(pos.x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;

    // Playhead
    if (events.length > 0 && currentStep >= 0 && currentStep < eventPositions.length) {
      const px = eventPositions[currentStep].x;

      // Playhead line
      ctx.strokeStyle = PLAYHEAD_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 4);
      ctx.lineTo(px, BAR_HEIGHT - 4);
      ctx.stroke();

      // Playhead triangle top
      ctx.fillStyle = PLAYHEAD_COLOR;
      ctx.beginPath();
      ctx.moveTo(px - 5, 2);
      ctx.lineTo(px + 5, 2);
      ctx.lineTo(px, 8);
      ctx.closePath();
      ctx.fill();

      // Playhead triangle bottom
      ctx.beginPath();
      ctx.moveTo(px - 5, BAR_HEIGHT - 2);
      ctx.lineTo(px + 5, BAR_HEIGHT - 2);
      ctx.lineTo(px, BAR_HEIGHT - 8);
      ctx.closePath();
      ctx.fill();
    }
  }, [canvasWidth, eventPositions, currentStep, events.length]);

  // ── Click handler → jump to nearest event ─────────────────────

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (events.length === 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;

      // Find nearest event
      let nearest = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < eventPositions.length; i++) {
        const dist = Math.abs(eventPositions[i].x - clickX);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = i;
        }
      }

      onStepChange(nearest);
    },
    [events.length, eventPositions, onStepChange],
  );

  // ── Hover handler → tooltip ───────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (events.length === 0) {
        setTooltip(null);
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;

      // Find nearest event within 10px
      let nearest = -1;
      let nearestDist = Infinity;
      for (let i = 0; i < eventPositions.length; i++) {
        const dist = Math.abs(eventPositions[i].x - mouseX);
        if (dist < nearestDist && dist < 10) {
          nearestDist = dist;
          nearest = i;
        }
      }

      if (nearest >= 0) {
        const ev = events[nearest];
        const time = new Date(ev.timestamp).toLocaleTimeString();
        setTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top - 36,
          text: `${ev.eventType} — ${time}`,
        });
      } else {
        setTooltip(null);
      }
    },
    [events, eventPositions],
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  // ── Render ────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg border border-gray-200 cursor-pointer"
        style={{ height: BAR_HEIGHT }}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-10"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translateX(-50%)',
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
