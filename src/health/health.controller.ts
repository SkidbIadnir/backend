import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** How long `SELECT 1` may take before the check reports the database as down. */
export const HEALTH_DB_TIMEOUT_MS = 3000;

/**
 * Liveness + database check for the Docker `HEALTHCHECK`, the CI smoke test
 * after a deploy and uptime monitoring. Unauthenticated and not throttled
 * (the throttler guard only covers `/admin/*`).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.dataSource.query('SELECT 1'),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timeout')),
            HEALTH_DB_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
      });
    } finally {
      clearTimeout(timer);
    }
    return { status: 'ok' };
  }
}
