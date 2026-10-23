/** Environment access for the admin API. Read lazily so tests can set vars after import. */
export const adminConfig = {
  /** Comma-separated allowlist of admin emails. Empty/unset means nobody is an admin. */
  get emails(): string[] {
    return (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  },
  /** Admin routes reject sessions older than this, however long the token itself is valid. */
  get sessionMaxHours(): number {
    const n = parseInt(process.env.ADMIN_SESSION_MAX_HOURS ?? '12', 10);
    return Number.isFinite(n) && n > 0 ? n : 12;
  },
  get rateLimitPerMinute(): number {
    const n = parseInt(process.env.ADMIN_RATE_LIMIT_PER_MINUTE ?? '60', 10);
    return Number.isFinite(n) && n > 0 ? n : 60;
  },
};
