/**
 * [F11-S4] BookmarkProvider — React Context for replay bookmarks with sessionStorage persistence
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface BookmarkContextValue {
  bookmarks: Set<number>;
  toggle: (step: number) => void;
  clear: () => void;
  isBookmarked: (step: number) => boolean;
}

const BookmarkContext = createContext<BookmarkContextValue>({
  bookmarks: new Set(),
  toggle: () => {},
  clear: () => {},
  isBookmarked: () => false,
});

export function useBookmarks(): BookmarkContextValue {
  return useContext(BookmarkContext);
}

function storageKey(sessionId: string): string {
  return `bookmarks:${sessionId}`;
}

export function BookmarkProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const [bookmarks, setBookmarks] = useState<Set<number>>(() => {
    try {
      const stored = sessionStorage.getItem(storageKey(sessionId));
      return stored ? new Set(JSON.parse(stored) as number[]) : new Set();
    } catch {
      return new Set();
    }
  });

  // Persist on change
  useEffect(() => {
    sessionStorage.setItem(storageKey(sessionId), JSON.stringify([...bookmarks]));
  }, [bookmarks, sessionId]);

  const toggle = useCallback((step: number) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setBookmarks(new Set());
  }, []);

  const isBookmarked = useCallback(
    (step: number) => bookmarks.has(step),
    [bookmarks],
  );

  return (
    <BookmarkContext.Provider value={{ bookmarks, toggle, clear, isBookmarked }}>
      {children}
    </BookmarkContext.Provider>
  );
}
