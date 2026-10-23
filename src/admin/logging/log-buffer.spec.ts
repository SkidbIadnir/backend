import { LogBuffer, LogEntry } from './log-buffer';

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  ts: new Date().toISOString(),
  level: 'log',
  context: 'Test',
  message: 'm',
  ...over,
});

describe('LogBuffer', () => {
  it('drops the oldest entries past its capacity', () => {
    const buf = new LogBuffer(3);
    for (let i = 0; i < 5; i++) buf.push(entry({ message: `m${i}` }));
    expect(buf.query().map((e) => e.message)).toEqual(['m4', 'm3', 'm2']);
  });

  it('returns newest first and honours limit', () => {
    const buf = new LogBuffer();
    for (let i = 0; i < 5; i++) buf.push(entry({ message: `m${i}` }));
    expect(buf.query({ limit: 2 }).map((e) => e.message)).toEqual(['m4', 'm3']);
  });

  it('treats level as a minimum severity', () => {
    const buf = new LogBuffer();
    buf.push(entry({ level: 'debug', message: 'd' }));
    buf.push(entry({ level: 'warn', message: 'w' }));
    buf.push(entry({ level: 'error', message: 'e' }));
    expect(buf.query({ level: 'warn' }).map((e) => e.message)).toEqual([
      'e',
      'w',
    ]);
  });

  it('filters by exact context and by since', () => {
    const buf = new LogBuffer();
    buf.push(
      entry({ context: 'A', ts: '2026-01-01T00:00:00.000Z', message: 'old' }),
    );
    buf.push(
      entry({ context: 'B', ts: '2026-06-01T00:00:00.000Z', message: 'b' }),
    );
    buf.push(
      entry({ context: 'A', ts: '2026-06-02T00:00:00.000Z', message: 'a' }),
    );
    expect(buf.query({ context: 'A' }).map((e) => e.message)).toEqual([
      'a',
      'old',
    ]);
    expect(
      buf.query({ since: new Date('2026-03-01') }).map((e) => e.message),
    ).toEqual(['a', 'b']);
  });
});
