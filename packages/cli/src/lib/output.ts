/**
 * CLI Output Formatting Utilities
 */

/**
 * Print data as a simple aligned table to stdout.
 */
export function printTable(
  headers: string[],
  rows: string[][],
): void {
  const colWidths = headers.map((h, i) => {
    const maxData = rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), 0);
    return Math.max(h.length, maxData);
  });

  const sep = colWidths.map((w) => '─'.repeat(w + 2)).join('┼');
  const formatRow = (cells: string[]) =>
    cells.map((cell, i) => ` ${(cell ?? '').padEnd(colWidths[i]!)} `).join('│');

  console.log(formatRow(headers));
  console.log(sep);
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

/**
 * Print JSON to stdout (pretty if tty, compact otherwise).
 */
export function printJson(data: unknown): void {
  const indent = process.stdout.isTTY ? 2 : 0;
  console.log(JSON.stringify(data, null, indent));
}

/**
 * Format a timestamp for table display.
 */
export function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return ts;
  }
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDuration(startedAt: string, endedAt?: string): string {
  if (!endedAt) return 'running';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
}

/**
 * Truncate a string to a max length with "…" suffix.
 */
export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}
