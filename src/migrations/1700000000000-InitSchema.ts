import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

/**
 * Initial schema migration.
 * Creates:  carts, cart_items (with FK + indexes)
 *
 * Run with:  npm run migration:run
 * Revert:    npm run migration:revert
 */
export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable uuid-ossp so uuid_generate_v4() works
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── carts ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."carts_status_enum" AS ENUM ('OPEN', 'ORDERED')
    `);

    await queryRunner.createTable(
      new Table({
        name: 'carts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'user_id',    type: 'varchar',                             isNullable: false },
          { name: 'status',     type: 'enum', enum: ['OPEN', 'ORDERED'],
                                enumName: 'carts_status_enum', default: "'OPEN'" },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
          { name: 'updated_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    // ── cart_items ────────────────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'cart_items',
        columns: [
          { name: 'cart_id',    type: 'uuid',    isPrimary: true },
          { name: 'product_id', type: 'varchar', isPrimary: true, isNullable: false },
          { name: 'count',      type: 'integer', default: 1 },
        ],
      }),
      true,
    );

    // FK: cart_items.cart_id → carts.id (CASCADE on delete)
    await queryRunner.createForeignKey(
      'cart_items',
      new TableForeignKey({
        columnNames: ['cart_id'],
        referencedTableName: 'carts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      }),
    );

    // Index to speed up "find open cart by userId"
    await queryRunner.query(
      `CREATE INDEX "IDX_carts_user_id_status" ON "carts" ("user_id", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_carts_user_id_status"`);
    await queryRunner.dropTable('cart_items', true);
    await queryRunner.dropTable('carts', true);
    await queryRunner.query(`DROP TYPE "public"."carts_status_enum"`);
  }
}
