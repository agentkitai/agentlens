/**
 * AlertToast — Toast notification component for real-time alerts (Story 12.5)
 *
 * This component can be wired up to SSE events when Epic 14 is implemented.
 * For now, it provides the UI and a simple imperative API for showing toasts.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';

export interface Toast {
  id: string;
  type: 'alert' | 'info' | 'success';
  title: string;
  message: string;
  timestamp: string;
}

interface AlertToastProps {
  /** Optional: external toasts to display (e.g., from SSE) */
  toasts?: Toast[];
  /** Auto-dismiss after this many ms (default: 8000) */
  dismissAfterMs?: number;
}

/**
 * Toast container — renders toasts in the top-right corner.
 * Will be connected to EventBus/SSE in Epic 14.
 */
export function AlertToastContainer({
  toasts: externalToasts = [],
  dismissAfterMs = 8000,
}: AlertToastProps): React.ReactElement {
  const [internalToasts, setInternalToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const allToasts = [...externalToasts, ...internalToasts];

  const dismiss = useCallback((id: string) => {
    setInternalToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  // Auto-dismiss
  useEffect(() => {
    for (const toast of allToasts) {
      if (!timersRef.current.has(toast.id)) {
        const timer = setTimeout(() => dismiss(toast.id), dismissAfterMs);
        timersRef.current.set(toast.id, timer);
      }
    }
  }, [allToasts, dismiss, dismissAfterMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  if (allToasts.length === 0) return <></>;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {allToasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-lg border shadow-lg p-4 animate-slide-in ${
            toast.type === 'alert'
              ? 'bg-red-50 border-red-200'
              : toast.type === 'success'
                ? 'bg-green-50 border-green-200'
                : 'bg-blue-50 border-blue-200'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <span className="text-lg">
                {toast.type === 'alert' ? '🔴' : toast.type === 'success' ? '✅' : 'ℹ️'}
              </span>
              <div>
                <p
                  className={`text-sm font-semibold ${
                    toast.type === 'alert'
                      ? 'text-red-800'
                      : toast.type === 'success'
                        ? 'text-green-800'
                        : 'text-blue-800'
                  }`}
                >
                  {toast.title}
                </p>
                <p
                  className={`text-xs mt-0.5 ${
                    toast.type === 'alert'
                      ? 'text-red-600'
                      : toast.type === 'success'
                        ? 'text-green-600'
                        : 'text-blue-600'
                  }`}
                >
                  {toast.message}
                </p>
              </div>
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-gray-400 hover:text-gray-600 text-sm"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
