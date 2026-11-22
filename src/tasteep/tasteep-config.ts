/**
 * Environment access for the Tasteep project. All variables are namespaced
 * `TASTEEP_*` (see `.env.example`).
 */
export const tasteepConfig = {
  /**
   * Signs and verifies bearer tokens (and, by default, OTP hashes and photo
   * URLs). `TASTEEP_JWT_SECRET` is the canonical name; legacy `JWT_SECRET` is
   * used when it is unset or empty. Throws when neither is set, so a
   * misconfigured deploy fails at startup instead of on the first request.
   */
  get jwtSecret(): string {
    const secret = process.env.TASTEEP_JWT_SECRET || process.env.JWT_SECRET;
    if (!secret) {
      throw new Error(
        'No JWT secret configured: set TASTEEP_JWT_SECRET (or the legacy JWT_SECRET).',
      );
    }
    return secret;
  },
  /** Lifetime of an issued bearer token. Sessions are revocable server-side regardless. */
  get jwtExpiresIn(): string {
    return process.env.TASTEEP_JWT_EXPIRES_IN ?? '365d';
  },

  // --- Email OTP ---------------------------------------------------------------
  get otpTtlMinutes(): number {
    return parseInt(process.env.TASTEEP_OTP_TTL_MINUTES ?? '10', 10);
  },
  get otpMaxAttempts(): number {
    return parseInt(process.env.TASTEEP_OTP_MAX_ATTEMPTS ?? '5', 10);
  },
  /** Minimum seconds between two codes for the same address. */
  get otpResendCooldownSeconds(): number {
    return parseInt(
      process.env.TASTEEP_OTP_RESEND_COOLDOWN_SECONDS ?? '60',
      10,
    );
  },

  // --- Google Sign-In ----------------------------------------------------------
  /** Comma-separated list of accepted OAuth client ids (iOS, Android, web can all differ). */
  get googleClientIds(): string[] {
    return (process.env.TASTEEP_GOOGLE_CLIENT_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },

  // --- Discord OAuth -----------------------------------------------------------
  get discordClientId(): string | undefined {
    return process.env.TASTEEP_DISCORD_CLIENT_ID || undefined;
  },
  get discordClientSecret(): string | undefined {
    return process.env.TASTEEP_DISCORD_CLIENT_SECRET || undefined;
  },
  /** Redirect URI registered on the Discord application, e.g. `tasteep://auth/discord`. */
  get discordRedirectUri(): string | undefined {
    return process.env.TASTEEP_DISCORD_REDIRECT_URI || undefined;
  },

  // --- Mail (SMTP) -------------------------------------------------------------
  /**
   * `null` when `TASTEEP_SMTP_HOST` is unset (dev mode: OTPs are logged).
   * Once a host is set, the user and password are required: throws when
   * either is missing, rather than failing later at send time with `530`.
   */
  get smtp() {
    const host = process.env.TASTEEP_SMTP_HOST;
    if (!host) return null;
    const user = process.env.TASTEEP_SMTP_USER;
    const pass = process.env.TASTEEP_SMTP_PASS;
    const missing = [
      !user && 'TASTEEP_SMTP_USER',
      !pass && 'TASTEEP_SMTP_PASS',
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(
        `TASTEEP_SMTP_HOST is set but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing. ` +
          'Set them, or unset TASTEEP_SMTP_HOST to log OTP codes instead of emailing them.',
      );
    }
    return {
      host,
      port: parseInt(process.env.TASTEEP_SMTP_PORT ?? '587', 10),
      secure: process.env.TASTEEP_SMTP_SECURE === 'true',
      user: user as string,
      pass: pass as string,
      from: process.env.TASTEEP_SMTP_FROM ?? 'Tasteep <no-reply@localhost>',
    };
  },

  // --- Nominatim ---------------------------------------------------------------
  get nominatimBaseUrl(): string {
    return (
      process.env.TASTEEP_NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org'
    );
  },
  /** Nominatim's usage policy requires a real, identifying User-Agent. */
  get nominatimUserAgent(): string | undefined {
    return process.env.TASTEEP_NOMINATIM_USER_AGENT || undefined;
  },

  // --- Tasting photos ----------------------------------------------------------
  /** Where processed photos are written. Mount a persistent volume here in production. */
  get photosDir(): string {
    return process.env.TASTEEP_PHOTOS_DIR || './data/photos';
  },
  /**
   * Key for signing photo URLs. Falls back to a key derived from the JWT
   * secret, so rotating either one invalidates every issued photo URL.
   */
  get photoUrlSecret(): string | undefined {
    return process.env.TASTEEP_PHOTO_URL_SECRET || undefined;
  },
  /**
   * Public origin of this API (e.g. `https://api.tasteep.eu`), prefixed to
   * signed photo URLs. Empty means relative photo URLs.
   */
  get appUrl(): string {
    return (process.env.APP_URL ?? '').replace(/\/+$/, '');
  },

  // --- Feedback ----------------------------------------------------------------
  /** Feedback messages one user may send per rolling hour (default 5). */
  get feedbackMaxPerHour(): number {
    const n = parseInt(process.env.TASTEEP_FEEDBACK_MAX_PER_HOUR ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 5;
  },

  // --- SMWS bottles scraper ----------------------------------------------------
  /** Nightly scrape of smws.eu. Manual runs from `/admin/smws` work either way. */
  get smwsScraperEnabled(): boolean {
    return process.env.TASTEEP_SMWS_SCRAPER_ENABLED !== 'false';
  },
  /** Minimum gap between two requests to smws.eu, in ms (default 3000). */
  get smwsRequestIntervalMs(): number {
    const ms = parseInt(process.env.TASTEEP_SMWS_REQUEST_INTERVAL_MS ?? '', 10);
    return Number.isFinite(ms) && ms >= 500 ? ms : 3000;
  },
  get smwsUserAgent(): string {
    return (
      process.env.TASTEEP_SMWS_USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0'
    );
  },
};

/** JWT `aud` claim, so a token minted for another app on the same secret is rejected. */
export const TASTEEP_JWT_AUDIENCE = 'tasteep';
