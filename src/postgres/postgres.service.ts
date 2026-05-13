import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SmwsDistillery } from '../entities/smws-distillery.entity';
import * as distilleriesData from '../data/smws_distilleries_json.json';

@Injectable()
export class PostgresService {
  private readonly logger = new Logger(PostgresService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SmwsDistillery)
    private readonly distilleryRepo: Repository<SmwsDistillery>,
  ) {}

  async purgeTables(): Promise<{ purged: string[]; message: string }> {
    const tables = ['smws_live', 'smws_archive', 'smws_lookout', 'smws_distilleries'];
    this.logger.log('Purging all SMWS tables...');

    for (const table of tables) {
      await this.dataSource.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
      this.logger.log(`Purged ${table}`);
    }

    this.logger.log('All tables purged successfully');
    return { purged: tables, message: 'All tables have been purged successfully' };
  }

  async populateDistilleries(): Promise<number> {
    const countResult = await this.distilleryRepo.count();
    if (countResult > 0) {
      this.logger.log(`smws_distilleries already has ${countResult} records, skipping population`);
      return countResult;
    }

    this.logger.log('Populating smws_distilleries table...');

    const entries: Partial<SmwsDistillery>[] = [];
    for (const [category, data] of Object.entries(distilleriesData as unknown as Record<string, { distilleries: { smwsId: number | string; distilleryName: string; region?: string; extra?: string | null }[] }>)) {
      if (data.distilleries && Array.isArray(data.distilleries)) {
        for (const d of data.distilleries) {
          entries.push({
            smwsId: d.smwsId.toString(),
            distilleryName: d.distilleryName,
            region: d.region || null,
            category,
            extraInfo: d.extra || null,
          });
        }
      }
    }

    await this.distilleryRepo.upsert(entries, {
      conflictPaths: ['smwsId', 'category'],
      skipUpdateIfNoValuesChanged: true,
    });

    this.logger.log(`Successfully populated ${entries.length} distillery records`);
    return entries.length;
  }

  async ensureTablesExist(): Promise<{ distilleriesPopulated: number; message: string }> {
    const distilleriesPopulated = await this.populateDistilleries();
    return {
      distilleriesPopulated,
      message: 'Distilleries data checked',
    };
  }

  /**
   * Removes rows whose code doesn't match a valid SMWS bottling pattern (e.g. "59.84", "G4.59").
   * Catches blends, bundles, offers and dirty "CASK NO. ..." values left by the old scraper.
   */
  async cleanInvalidEntries(): Promise<{ deletedLive: number; deletedArchive: number }> {
    // Valid pattern: optional letters, then digits, a dot, then digits — e.g. "59.84", "G4.59", "B1.123"
    const pattern = `^[A-Za-z]*[0-9]+\\.[0-9]+$`;

    const liveResult = await this.dataSource.query(
      `DELETE FROM smws_live WHERE fullcode !~ $1`,
      [pattern],
    );
    const archiveResult = await this.dataSource.query(
      `DELETE FROM smws_archive WHERE code !~ $1`,
      [pattern],
    );

    const deletedLive: number = liveResult[1] ?? 0;
    const deletedArchive: number = archiveResult[1] ?? 0;

    this.logger.log(`Cleaned invalid entries — smws_live: ${deletedLive}, smws_archive: ${deletedArchive}`);
    return { deletedLive, deletedArchive };
  }
}
