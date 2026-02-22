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
    user_alerts: boolean;
  }> {
    const client = await this.pool.connect();
    try {
      const tableNames = [
        'smws_live',
        'smws_archive',
        'smws_lookout',
        'smws_distilleries',
        'user_alerts',
      ];

      const results = {
        smws_live: false,
        smws_archive: false,
        smws_lookout: false,
        smws_distilleries: false,
        user_alerts: false,
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
          distillery_code VARCHAR(10),
          cask_no VARCHAR(50),
          price VARCHAR(50),
          profile TEXT,
          abv VARCHAR(20),
          age VARCHAR(50),
          cask_type VARCHAR(100),
          distillery VARCHAR(255),
          region VARCHAR(100),
          available BOOLEAN DEFAULT TRUE,
          url TEXT,
          is_new BOOLEAN DEFAULT FALSE,
          new_since TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Add new_since column if it doesn't exist (migration)
      await client.query(`
        ALTER TABLE smws_live 
        ADD COLUMN IF NOT EXISTS new_since TIMESTAMP
      `);
      
      // Change available to BOOLEAN if it's still VARCHAR (migration)
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'smws_live' AND column_name = 'available' 
            AND data_type = 'character varying'
          ) THEN
            ALTER TABLE smws_live 
            ALTER COLUMN available TYPE BOOLEAN 
            USING CASE WHEN available = 'true' THEN TRUE ELSE FALSE END;
          END IF;
        END $$;
      `);
      
      // Make distillery_code and cask_no nullable (migration)
      await client.query(`
        DO $$
        BEGIN
          ALTER TABLE smws_live 
          ALTER COLUMN distillery_code DROP NOT NULL;
        EXCEPTION
          WHEN undefined_column THEN NULL;
          WHEN others THEN NULL;
        END $$;
      `);
      
      await client.query(`
        DO $$
        BEGIN
          ALTER TABLE smws_live 
          ALTER COLUMN cask_no DROP NOT NULL;
        EXCEPTION
          WHEN undefined_column THEN NULL;
          WHEN others THEN NULL;
        END $$;
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

      this.logger.log('Creating user_alerts table...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_alerts (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(100) NOT NULL,
          guild_id VARCHAR(100) NOT NULL,
          alert_type VARCHAR(50) NOT NULL,
          alert_value VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT unique_alert UNIQUE(user_id, guild_id, alert_type, alert_value)
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

  async query(sql: string, params?: any[]): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } catch (error) {
      this.logger.error('Query failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
