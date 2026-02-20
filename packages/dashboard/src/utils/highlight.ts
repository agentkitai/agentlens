/**
 * [F11-S1] Search match text highlighting utility
 *
 * Wraps matched substrings in <mark> elements with yellow background.
 * Escapes HTML to prevent XSS from payload content.
 */
import React from 'react';

/**
 * Highlight all occurrences of `query` in `text`.
 * Returns a React node with <mark> wrappers around matches.
 * If query is empty, returns the original text.
 */
export function highlightMatches(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = lowerText.indexOf(lowerQuery, lastIndex);
  let key = 0;

  while (matchIndex !== -1) {
    // Text before match
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }
    // Matched text
    parts.push(
      React.createElement(
        'mark',
        { key: key++, className: 'bg-yellow-200 rounded-sm px-0.5' },
        text.slice(matchIndex, matchIndex + query.length),
      ),
    );
    lastIndex = matchIndex + query.length;
    matchIndex = lowerText.indexOf(lowerQuery, lastIndex);
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 0 ? text : React.createElement(React.Fragment, null, ...parts);
}
