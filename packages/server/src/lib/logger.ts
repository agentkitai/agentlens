const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

function getThreshold(): number {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
  return LEVELS[env] ?? LEVELS.info;
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export function createLogger(namespace: string): Logger {
  const write = (level: Level, msg: string, data?: unknown) => {
    if (LEVELS[level] < getThreshold()) return;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      ns: namespace,
      msg,
    };
    if (data !== undefined) entry.data = data;
    const line = JSON.stringify(entry);
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  };

  return {
    debug: (msg, data?) => write('debug', msg, data),
    info: (msg, data?) => write('info', msg, data),
    warn: (msg, data?) => write('warn', msg, data),
    error: (msg, data?) => write('error', msg, data),
  };
}
