import { Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import * as distilleriesData from '../data/smws_distilleries_json.json';

@Injectable()
export class PostgresService {
  private readonly logger = new Logger(PostgresService.name);
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'postgres',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
    });
  }

  async checkConnection(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      return true;
    } catch (error) {
      this.logger.error('Database connection failed:', error);
      return false;
    }
  }

  async checkTablesExist(): Promise<{
    smws_live: boolean;
    smws_archive: boolean;
    smws_lookout: boolean;
    smws_distilleries: boolean;
  }> {
    const client = await this.pool.connect();
    try {
      const tableNames = [
        'smws_live',
        'smws_archive',
        'smws_lookout',
        'smws_distilleries',
      ];

      const results = {
        smws_live: false,
        smws_archive: false,
        smws_lookout: false,
        smws_distilleries: false,
      };

      for (const tableName of tableNames) {
        const result = await client.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )`,
          [tableName],
        );
        results[tableName] = result.rows[0].exists;
      }

      return results;
    } finally {
      client.release();
    }
  }

  async createTables(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      this.logger.log('Creating smws_live table...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS smws_live (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          fullCode VARCHAR(100) NOT NULL UNIQUE,
          distillery_code VARCHAR(10) NOT NULL,
          cask_no VARCHAR(50) NOT NULL,
          price VARCHAR(50),
          profile TEXT,
          abv VARCHAR(20),
          age VARCHAR(50),
          cask_type VARCHAR(100),
          distillery VARCHAR(255),
          region VARCHAR(100),
          available VARCHAR(50),
          url TEXT,
          is_new BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.logger.log('Creating smws_archive table...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS smws_archive (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          code VARCHAR(100) NOT NULL UNIQUE,
          price VARCHAR(50),
          description TEXT,
          abv VARCHAR(20),
          age VARCHAR(50),
          cask_type VARCHAR(100),
          distillery VARCHAR(255),
          region VARCHAR(100),
          bottle_size VARCHAR(50),
          url TEXT,
          is_new BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.logger.log('Creating smws_lookout table...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS smws_lookout (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          code VARCHAR(100) NOT NULL UNIQUE,
          distillery VARCHAR(255)
        )
      `);

      this.logger.log('Creating smws_distilleries table...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS smws_distilleries (
          id SERIAL PRIMARY KEY,
          smws_id VARCHAR(10) NOT NULL,
          distillery_name VARCHAR(255) NOT NULL,
          region VARCHAR(100),
          category VARCHAR(50) NOT NULL,
          extra_info TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(smws_id, category)
        )
      `);

      await client.query('COMMIT');
      this.logger.log('All tables created successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to create tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async populateDistilleries(): Promise<number> {
    const client = await this.pool.connect();
    try {
      // Check if table already has data
      const countResult = await client.query(
        'SELECT COUNT(*) FROM smws_distilleries',
      );
      const count = parseInt(countResult.rows[0].count);

      if (count > 0) {
        this.logger.log(
          `smws_distilleries already has ${count} records, skipping population`,
        );
        return count;
      }

      this.logger.log('Populating smws_distilleries table...');
      let inserted = 0;

      // Iterate through each category in the JSON
      for (const [category, data] of Object.entries(distilleriesData)) {
        if (data.distilleries && Array.isArray(data.distilleries)) {
          for (const distillery of data.distilleries) {
            await client.query(
              `INSERT INTO smws_distilleries 
               (smws_id, distillery_name, region, category, extra_info) 
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (smws_id, category) DO NOTHING`,
              [
                distillery.smwsId.toString(),
                distillery.distilleryName,
                distillery.region || null,
                category,
                distillery.extra || null,
              ],
            );
            inserted++;
          }
        }
      }

      this.logger.log(
        `Successfully populated ${inserted} distillery records`,
      );
      return inserted;
    } finally {
      client.release();
    }
  }

  async purgeTables(): Promise<{ purged: string[]; message: string }> {
    const client = await this.pool.connect();
    try {
      this.logger.log('Purging all SMWS tables...');

      const tables = [
        'smws_live',
        'smws_archive',
        'smws_lookout',
        'smws_distilleries',
      ];

      await client.query('BEGIN');

      for (const table of tables) {
        await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
        this.logger.log(`Purged ${table}`);
      }

      await client.query('COMMIT');

      this.logger.log('All tables purged successfully');

      return {
        purged: tables,
        message: 'All tables have been purged successfully',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to purge tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureTablesExist(): Promise<{
    tablesExisted: {
      smws_live: boolean;
      smws_archive: boolean;
      smws_lookout: boolean;
      smws_distilleries: boolean;
    };
    tablesCreated: boolean;
    distilleriesPopulated: number;
    message: string;
  }> {
    const existingTables = await this.checkTablesExist();
    const allExist = Object.values(existingTables).every((exists) => exists);

    if (!allExist) {
      await this.createTables();
    }

    // Populate distilleries data
    const distilleriesPopulated = await this.populateDistilleries();

    return {
      tablesExisted: existingTables,
      tablesCreated: !allExist,
      distilleriesPopulated,
      message: allExist
        ? 'All tables already exist, distilleries data checked'
        : 'Tables created and distilleries data populated',
    };
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
