export const LOG_LEVELS = [
  'verbose',
  'debug',
  'log',
  'warn',
  'error',
  'fatal',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogEntry {
  ts: string;
  level: LogLevel;
  context: string | null;
  message: string;
}

export interface LogQuery {
  level?: LogLevel;
  context?: string;
  since?: Date;
  limit?: number;
}

/** Fixed-size in-memory ring of recent log lines. Lost on restart; single-instance only. */
export class LogBuffer {
  private readonly entries: LogEntry[] = [];

  constructor(private readonly capacity = 2000) {}

  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
  }

  /** Newest first. `level` is a minimum severity, `context` an exact match. */
  query({ level, context, since, limit = 200 }: LogQuery = {}): LogEntry[] {
    const minRank = level ? LOG_LEVELS.indexOf(level) : 0;
    const out: LogEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.entries[i];
      if (LOG_LEVELS.indexOf(e.level) < minRank) continue;
      if (context && e.context !== context) continue;
      if (since && new Date(e.ts) < since) continue;
      out.push(e);
    }
    return out;
  }
}

export const logBuffer = new LogBuffer();
export const ADMIN_LOG_BUFFER = 'ADMIN_LOG_BUFFER';
