import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFlavours1795593359952 implements MigrationInterface {
  name = 'AddFlavours1795593359952';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tasteep_flavours" ("id" text NOT NULL, "name_en" text NOT NULL, "name_fr" text NOT NULL, "parent_id" text, "sort_order" smallint NOT NULL DEFAULT '0', "aliases" text array NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_b9bc97f881c7e2bf5897c8cf162" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "tasteep_flavours_parent_idx" ON "tasteep_flavours" ("parent_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "tasteep_tastings" ADD "flavour_ids" text array NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasteep_flavours" ADD CONSTRAINT "FK_645beb8660e52e305bfe0ac3735" FOREIGN KEY ("parent_id") REFERENCES "tasteep_flavours"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasteep_flavours" DROP CONSTRAINT "FK_645beb8660e52e305bfe0ac3735"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasteep_tastings" DROP COLUMN "flavour_ids"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."tasteep_flavours_parent_idx"`,
    );
    await queryRunner.query(`DROP TABLE "tasteep_flavours"`);
  }
}
