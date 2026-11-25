import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The schema as of the switch from `synchronize` + `scripts/db/*.sql` to
 * migrations (generated with `migration:generate` against an empty database).
 *
 * - **Empty database** (CI, a new environment, a fresh local one): creates
 *   everything below.
 * - **Existing database** (`tasteep_users` is there: dev, preprod and prod
 *   before the switch): creates nothing it already has, only catches up on
 *   what the hand-written scripts were for (`001-tasting-photos.sql`,
 *   `002-tasteep-feedback.sql`), and renames the one constraint whose
 *   script-made name differs from TypeORM's, so the schema then matches the
 *   entities exactly.
 *
 * Not revertible: `down` would drop every table.
 */
export class Baseline1795529563637 implements MigrationInterface {
  name = 'Baseline1795529563637';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('tasteep_users')) {
      await catchUp(queryRunner);
      return;
    }
    for (const sql of CREATE_SCHEMA) await queryRunner.query(sql);
  }

  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'The baseline migration cannot be reverted: it would drop every table.',
      ),
    );
  }
}

/** Brings a database built by `synchronize` and the old SQL scripts up to the baseline. */
async function catchUp(queryRunner: QueryRunner): Promise<void> {
  // 001-tasting-photos.sql
  await queryRunner.query(
    `ALTER TABLE "tasteep_tastings" ADD COLUMN IF NOT EXISTS "photo_id" uuid`,
  );
  // 002-tasteep-feedback.sql, with TypeORM's DDL so nothing differs afterwards.
  if (!(await queryRunner.hasTable('tasteep_feedback'))) {
    for (const sql of CREATE_FEEDBACK) await queryRunner.query(sql);
    return;
  }
  // The script declared the FK inline, so Postgres named it.
  await queryRunner.query(
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasteep_feedback_user_id_fkey') THEN
         ALTER TABLE "tasteep_feedback" RENAME CONSTRAINT "tasteep_feedback_user_id_fkey" TO "FK_a41ebb8bb6543cce5ec9b0f98cf";
       END IF;
     END $$`,
  );
}

const CREATE_FEEDBACK = [
  `CREATE TABLE "tasteep_feedback" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "type" text NOT NULL, "message" text NOT NULL, "app_version" text, "platform" text, "status" text NOT NULL DEFAULT 'new', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6228639d6812d0af77de669befb" PRIMARY KEY ("id"))`,
  `CREATE INDEX "tasteep_feedback_status_created_idx" ON "tasteep_feedback" ("status", "created_at")`,
  `CREATE INDEX "tasteep_feedback_user_idx" ON "tasteep_feedback" ("user_id")`,
  `ALTER TABLE "tasteep_feedback" ADD CONSTRAINT "FK_a41ebb8bb6543cce5ec9b0f98cf" FOREIGN KEY ("user_id") REFERENCES "tasteep_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
];

const CREATE_SCHEMA = [
  `CREATE TABLE "tasteep_users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" text, "display_name" text NOT NULL, "provider" text NOT NULL, "provider_id" text NOT NULL, "theme_mode" text NOT NULL DEFAULT 'light', "score_scale" text NOT NULL DEFAULT 'hundred', "unit_system" text NOT NULL DEFAULT 'metric', "currency" text NOT NULL DEFAULT '£', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "tasteep_users_provider_uq" UNIQUE ("provider", "provider_id"), CONSTRAINT "PK_b1af269826944490015f8db03c2" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX "tasteep_users_email_uq" ON "tasteep_users" ("email") WHERE email IS NOT NULL`,
  `CREATE TABLE "tasteep_regions" ("id" text NOT NULL, "name" text NOT NULL, "parent_id" text, "lat" double precision, "lon" double precision, "sort_order" smallint NOT NULL DEFAULT '0', "aliases" text array, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_1f73d4d1add403718dd2877963c" PRIMARY KEY ("id"))`,
  `CREATE INDEX "tasteep_regions_parent_idx" ON "tasteep_regions" ("parent_id")`,
  `CREATE TABLE "tasteep_smws_codes" ("code" text NOT NULL, "distillery_name" text NOT NULL, "category" text NOT NULL, "region" text, "region_id" text, "extra" text, "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2ed9657f2539cae049faef6fca0" PRIMARY KEY ("code"))`,
  `CREATE TABLE "tasteep_smws_catalog" ("sku" text NOT NULL, "product_id" integer, "url" text NOT NULL, "kind" text NOT NULL, "code" text, "distillery_code" text, "cask_no" text, "batch" text, "name" text NOT NULL, "price_text" text, "price_amount" numeric(10,2), "price_currency" text, "abv" numeric(4,1), "age" text, "cask_type" text, "distilled_date" date, "profile" text, "region_text" text, "region_id" text, "categories" text array NOT NULL DEFAULT '{}', "released_at" TIMESTAMP WITH TIME ZONE, "in_stock" boolean NOT NULL, "stock" integer, "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, "delisted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5750f7adb6070a56d44fd94f4b8" PRIMARY KEY ("sku"))`,
  `CREATE INDEX "tasteep_smws_catalog_in_stock_idx" ON "tasteep_smws_catalog" ("in_stock")`,
  `CREATE INDEX "tasteep_smws_catalog_region_idx" ON "tasteep_smws_catalog" ("region_id")`,
  `CREATE INDEX "tasteep_smws_catalog_distillery_code_idx" ON "tasteep_smws_catalog" ("distillery_code")`,
  `CREATE INDEX "tasteep_smws_catalog_url_idx" ON "tasteep_smws_catalog" ("url")`,
  `CREATE UNIQUE INDEX "tasteep_smws_catalog_code_key" ON "tasteep_smws_catalog" ("code") WHERE "code" IS NOT NULL`,
  `CREATE TABLE "tasteep_tastings" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "name" text NOT NULL, "category" text NOT NULL DEFAULT 'whisky', "photo_path" text, "photo_id" uuid, "distillery" text, "region" text, "region_id" text, "smws_sku" text, "abv" numeric, "price" numeric, "age_statement" text, "cask_type" text, "date_tasted" TIMESTAMP WITH TIME ZONE, "location" text, "score" smallint, "appearance" text, "tags" text array NOT NULL DEFAULT '{}', "nose" text, "palate" text, "finish" text, "lat" double precision, "lon" double precision, "location_precision" text NOT NULL DEFAULT 'unknown', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "tasteep_tastings_score_chk" CHECK (score IS NULL OR score BETWEEN 0 AND 100), CONSTRAINT "tasteep_tastings_precision_chk" CHECK (location_precision IN ('exact', 'region', 'country', 'manual', 'unknown')), CONSTRAINT "tasteep_tastings_category_chk" CHECK (category IN ('whisky', 'rum', 'agave', 'other')), CONSTRAINT "PK_8ad3f07e19b7949a7dbfa9c5793" PRIMARY KEY ("id"))`,
  `CREATE INDEX "tasteep_tastings_user_smws_sku_idx" ON "tasteep_tastings" ("user_id", "smws_sku")`,
  `CREATE INDEX "tasteep_tastings_user_category_idx" ON "tasteep_tastings" ("user_id", "category")`,
  `CREATE INDEX "tasteep_tastings_user_date_idx" ON "tasteep_tastings" ("user_id", "date_tasted")`,
  `CREATE TABLE "tasteep_wishlist_folders" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "name" text NOT NULL, "sort_order" smallint NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_34836cf9fab7d2671fa05423df6" PRIMARY KEY ("id"))`,
  `CREATE INDEX "tasteep_wishlist_folders_user_idx" ON "tasteep_wishlist_folders" ("user_id")`,
  `CREATE TABLE "tasteep_wishlist_items" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "folder_id" uuid, "name" text NOT NULL, "distillery" text, "region" text, "region_id" text, "category" text, "target_price" numeric, "why_i_want" text, "where_to_buy" text, "fulfilled_tasting_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "tasteep_wishlist_items_category_chk" CHECK (category IS NULL OR category IN ('whisky', 'rum', 'agave', 'gin', 'cognac', 'other')), CONSTRAINT "PK_1615b324f70f6665ec7947c2059" PRIMARY KEY ("id"))`,
  `CREATE INDEX "tasteep_wishlist_items_user_folder_idx" ON "tasteep_wishlist_items" ("user_id", "folder_id")`,
  `CREATE TABLE "tasteep_smws_scrape_runs" ("id" SERIAL NOT NULL, "trigger" text NOT NULL, "status" text NOT NULL DEFAULT 'running', "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "finished_at" TIMESTAMP WITH TIME ZONE, "sitemap_urls" integer, "discovered" integer, "added" integer, "checked" integer, "relisted" integer, "delisted" integer, "failed" integer, "pages" integer, "listed" integer, "missed" integer, "confirmed" integer, "note" text, "error" text, CONSTRAINT "PK_7298cbc577b92bb1cadba844c57" PRIMARY KEY ("id"))`,
  `CREATE INDEX "tasteep_smws_scrape_runs_started_at_idx" ON "tasteep_smws_scrape_runs" ("started_at")`,
  `CREATE TABLE "tasteep_smws_pages" ("url" text NOT NULL, "kind" text NOT NULL, "sku" text, "rules_version" integer NOT NULL DEFAULT '0', "first_read_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_read_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_60487cb7becbb71ccd02c1423b6" PRIMARY KEY ("url"))`,
  `CREATE INDEX "tasteep_smws_pages_sku_idx" ON "tasteep_smws_pages" ("sku")`,
  `CREATE TABLE "tasteep_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "last_seen_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_7af95fd6d32a484ac5c0ce07f60" PRIMARY KEY ("id"))`,
  `CREATE INDEX "tasteep_sessions_user_idx" ON "tasteep_sessions" ("user_id")`,
  `CREATE TABLE "tasteep_geocode_cache" ("query" text NOT NULL, "lat" double precision, "lon" double precision, "precision" text NOT NULL, "provider" text NOT NULL DEFAULT 'nominatim', "resolved_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_74c01a8c1844d4d35c593447ccc" PRIMARY KEY ("query"))`,
  `CREATE TABLE "tasteep_feedback" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "type" text NOT NULL, "message" text NOT NULL, "app_version" text, "platform" text, "status" text NOT NULL DEFAULT 'new', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6228639d6812d0af77de669befb" PRIMARY KEY ("id"))`,
  `CREATE INDEX "tasteep_feedback_status_created_idx" ON "tasteep_feedback" ("status", "created_at")`,
  `CREATE INDEX "tasteep_feedback_user_idx" ON "tasteep_feedback" ("user_id")`,
  `CREATE TABLE "tasteep_email_otps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" text NOT NULL, "code_hash" text NOT NULL, "attempts" smallint NOT NULL DEFAULT '0', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f8be74397f7efb172a8de33bbb7" PRIMARY KEY ("id"))`,
  `CREATE INDEX "tasteep_email_otps_email_idx" ON "tasteep_email_otps" ("email")`,
  `CREATE TABLE "tasteep_distillery_locations" ("id" text NOT NULL, "name" text NOT NULL, "lat" double precision NOT NULL, "lon" double precision NOT NULL, "precision" text NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5f569ee9de858363b30f1079249" PRIMARY KEY ("id"))`,
  `ALTER TABLE "tasteep_regions" ADD CONSTRAINT "FK_3d0ca15f8a2d5f372142f3c4817" FOREIGN KEY ("parent_id") REFERENCES "tasteep_regions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_smws_codes" ADD CONSTRAINT "FK_58b981f06996a23a37af70c342a" FOREIGN KEY ("region_id") REFERENCES "tasteep_regions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_smws_catalog" ADD CONSTRAINT "FK_4c1028698f7c4849375d4352958" FOREIGN KEY ("region_id") REFERENCES "tasteep_regions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_tastings" ADD CONSTRAINT "FK_e2e6d351699a85d49464b19a428" FOREIGN KEY ("user_id") REFERENCES "tasteep_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_tastings" ADD CONSTRAINT "FK_c7094cf0fd61fee3b5dce52b22a" FOREIGN KEY ("region_id") REFERENCES "tasteep_regions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_tastings" ADD CONSTRAINT "FK_a2dd640a9ed5e5b34c8cf78cd22" FOREIGN KEY ("smws_sku") REFERENCES "tasteep_smws_catalog"("sku") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_wishlist_folders" ADD CONSTRAINT "FK_1daece9b0c9c38fb60512d3f5c8" FOREIGN KEY ("user_id") REFERENCES "tasteep_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_wishlist_items" ADD CONSTRAINT "FK_49ee7991e5479e9fb96a5ef019c" FOREIGN KEY ("user_id") REFERENCES "tasteep_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_wishlist_items" ADD CONSTRAINT "FK_a360561f4127532968745ab1655" FOREIGN KEY ("folder_id") REFERENCES "tasteep_wishlist_folders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_wishlist_items" ADD CONSTRAINT "FK_301dcda4b8dcad7515db3363911" FOREIGN KEY ("region_id") REFERENCES "tasteep_regions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_wishlist_items" ADD CONSTRAINT "FK_8f30fb0eee75182ba5b3d89f495" FOREIGN KEY ("fulfilled_tasting_id") REFERENCES "tasteep_tastings"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_sessions" ADD CONSTRAINT "FK_2904b46490beb95a636ac12f40b" FOREIGN KEY ("user_id") REFERENCES "tasteep_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
  `ALTER TABLE "tasteep_feedback" ADD CONSTRAINT "FK_a41ebb8bb6543cce5ec9b0f98cf" FOREIGN KEY ("user_id") REFERENCES "tasteep_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
];
