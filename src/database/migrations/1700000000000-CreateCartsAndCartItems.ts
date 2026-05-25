import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CreateCartsAndCartItems1700000000000
 *
 * Creates the carts and cart_items tables with the required schema.
 * Run with: npx typeorm migration:run -d src/database/data-source.ts
 */
export class CreateCartsAndCartItems1700000000000
  implements MigrationInterface
{
  name = 'CreateCartsAndCartItems1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── cart_status enum ────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE cart_status_enum AS ENUM ('OPEN', 'ORDERED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // ── carts ───────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "carts" (
        "id"         UUID                  NOT NULL DEFAULT gen_random_uuid(),
        "user_id"    VARCHAR               NOT NULL,
        "status"     cart_status_enum      NOT NULL DEFAULT 'OPEN',
        "created_at" TIMESTAMP             NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP             NOT NULL DEFAULT now(),
        CONSTRAINT "PK_carts_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_carts_user_id_status"
        ON "carts" ("user_id", "status");
    `);

    // ── cart_items ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cart_items" (
        "cart_id"    UUID    NOT NULL,
        "product_id" VARCHAR NOT NULL,
        "count"      INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT "PK_cart_items" PRIMARY KEY ("cart_id", "product_id"),
        CONSTRAINT "FK_cart_items_cart_id"
          FOREIGN KEY ("cart_id")
          REFERENCES "carts"("id")
          ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cart_items";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "carts";`);
    await queryRunner.query(`DROP TYPE IF EXISTS cart_status_enum;`);
  }
}
