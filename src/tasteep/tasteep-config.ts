/**
 * Environment access for the Tasteep project. All variables are namespaced
 * `TASTEEP_*` so nothing is shared with the SMWS project (see `.env.example`).
 */
export const tasteepConfig = {
  get jwtSecret(): string {
    return (process.env.TASTEEP_JWT_SECRET ?? process.env.JWT_SECRET) as string;
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
  get smtp() {
    const host = process.env.TASTEEP_SMTP_HOST;
    if (!host) return null;
    return {
      host,
      port: parseInt(process.env.TASTEEP_SMTP_PORT ?? '587', 10),
      secure: process.env.TASTEEP_SMTP_SECURE === 'true',
      user: process.env.TASTEEP_SMTP_USER,
      pass: process.env.TASTEEP_SMTP_PASS,
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
};

/** JWT `aud` claim. Keeps Tasteep tokens from ever validating against the SMWS guard, and vice versa. */
export const TASTEEP_JWT_AUDIENCE = 'tasteep';
