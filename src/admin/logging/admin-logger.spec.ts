import { Logger } from '@nestjs/common';
import { AdminLogger } from './admin-logger';
import { LogBuffer } from './log-buffer';

describe('AdminLogger', () => {
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = new LogBuffer();
    const logger = new AdminLogger(buffer);
    // Silence the console output; we only care what lands in the buffer.
    for (const m of [
      'log',
      'error',
      'warn',
      'debug',
      'verbose',
      'fatal',
    ] as const) {
      jest
        .spyOn(Object.getPrototypeOf(AdminLogger.prototype), m)
        .mockImplementation();
    }
    Logger.overrideLogger(logger);
  });

  afterEach(() => {
    Logger.overrideLogger(['log', 'error', 'warn']);
    jest.restoreAllMocks();
  });

  it('captures a line with its level, context and message', () => {
    new Logger('Scraper').warn('slow page');
    expect(buffer.query()).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: 'Scraper',
        message: 'slow page',
      }),
    ]);
  });

  it('takes the context from the last argument for error(message, stack)', () => {
    new Logger('Auth').error('boom', 'stack trace');
    const [entry] = buffer.query();
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('boom');
    // Logger appends its own context last, after the stack.
    expect(entry.context).toBe('Auth');
  });

  it('stringifies objects and errors instead of throwing', () => {
    new Logger('X').log({ a: 1 });
    new Logger('X').log(new Error('bad'));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    new Logger('X').log(circular);
    expect(
      buffer
        .query()
        .map((e) => e.message)
        .reverse(),
    ).toEqual(['{"a":1}', 'bad', '[object Object]']);
  });
});
