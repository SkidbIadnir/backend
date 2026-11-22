import { tasteepConfig } from './tasteep-config';

describe('tasteepConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  describe('jwtSecret', () => {
    beforeEach(() => {
      delete process.env.TASTEEP_JWT_SECRET;
      delete process.env.JWT_SECRET;
    });

    it('prefers TASTEEP_JWT_SECRET', () => {
      process.env.TASTEEP_JWT_SECRET = 'canonical';
      process.env.JWT_SECRET = 'legacy';
      expect(tasteepConfig.jwtSecret).toBe('canonical');
    });

    it('falls back to the legacy JWT_SECRET', () => {
      process.env.JWT_SECRET = 'legacy';
      expect(tasteepConfig.jwtSecret).toBe('legacy');
    });

    it('falls back when TASTEEP_JWT_SECRET is empty', () => {
      process.env.TASTEEP_JWT_SECRET = '';
      process.env.JWT_SECRET = 'legacy';
      expect(tasteepConfig.jwtSecret).toBe('legacy');
    });

    it('throws a message naming both variables when neither is set', () => {
      expect(() => tasteepConfig.jwtSecret).toThrow(
        /TASTEEP_JWT_SECRET.*JWT_SECRET/,
      );
    });
  });

  describe('smtp', () => {
    beforeEach(() => {
      for (const k of Object.keys(process.env)) {
        if (k.startsWith('TASTEEP_SMTP_')) delete process.env[k];
      }
    });

    it('is null without a host (dev mode)', () => {
      expect(tasteepConfig.smtp).toBeNull();
    });

    it('returns the settings when host, user and password are set', () => {
      process.env.TASTEEP_SMTP_HOST = 'smtp.example.com';
      process.env.TASTEEP_SMTP_USER = 'u';
      process.env.TASTEEP_SMTP_PASS = 'p';
      expect(tasteepConfig.smtp).toMatchObject({
        host: 'smtp.example.com',
        port: 587,
        user: 'u',
        pass: 'p',
      });
    });

    it('throws when the host is set without credentials', () => {
      process.env.TASTEEP_SMTP_HOST = 'smtp.example.com';
      expect(() => tasteepConfig.smtp).toThrow(
        /TASTEEP_SMTP_USER and TASTEEP_SMTP_PASS are missing/,
      );
    });

    it('names the one missing credential', () => {
      process.env.TASTEEP_SMTP_HOST = 'smtp.example.com';
      process.env.TASTEEP_SMTP_USER = 'u';
      expect(() => tasteepConfig.smtp).toThrow(/TASTEEP_SMTP_PASS is missing/);
    });
  });
});
