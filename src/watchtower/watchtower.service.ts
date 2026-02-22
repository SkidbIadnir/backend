import { Injectable, Logger } from '@nestjs/common';
import { PostgresService } from '../postgres/postgres.service';
import { LiveWhiskyEntry } from './types/live-whisky-entry.type';

@Injectable()
export class WatchtowerService {
  private readonly logger = new Logger(WatchtowerService.name);

  constructor(private readonly postgresService: PostgresService) {}

  async getAllLiveEntries(): Promise<LiveWhiskyEntry[]> {
    try {
      const query = `
        SELECT
          id,
          name,
          fullCode,
          distillery_code AS "distilleryCode",
          cask_no AS "caskNo",
          price,
          profile,
          abv,
          age,
          cask_type AS "caskType",
          distillery,
          region,
          available,
          url,
          is_new AS "isNew",
          new_since AS "newSince",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM smws_live
        ORDER BY created_at DESC
      `;

      return await this.postgresService.query(query);
    } catch (error) {
      this.logger.error('Failed to fetch live entries:', error);
      throw error;
    }
  }
}
