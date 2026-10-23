import { ConsoleLogger } from '@nestjs/common';
import { LogBuffer, LogLevel } from './log-buffer';

/** Nest's console logger, plus a copy of every line into a ring buffer for the dashboard. */
export class AdminLogger extends ConsoleLogger {
  constructor(private readonly buffer: LogBuffer) {
    super();
  }

  log(message: unknown, ...rest: unknown[]) {
    this.capture('log', message, rest);
    super.log(message, ...rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.capture('error', message, rest);
    super.error(message, ...rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.capture('warn', message, rest);
    super.warn(message, ...rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.capture('debug', message, rest);
    super.debug(message, ...rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.capture('verbose', message, rest);
    super.verbose(message, ...rest);
  }
  fatal(message: unknown, ...rest: unknown[]) {
    this.capture('fatal', message, rest);
    super.fatal(message, ...rest);
  }

  private capture(level: LogLevel, message: unknown, rest: unknown[]) {
    // Nest's Logger appends its context name as the last string argument.
    const last = rest[rest.length - 1];
    const context = typeof last === 'string' ? last : (this.context ?? null);
    this.buffer.push({
      ts: new Date().toISOString(),
      level,
      context,
      message: stringify(message),
    });
  }
}

function stringify(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}
