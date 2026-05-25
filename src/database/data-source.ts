/**
 * data-source.ts
 *
 * Used exclusively by the TypeORM CLI for running/generating migrations.
 * Not imported at runtime by the NestJS app.
 *
 * Usage:
 *   npx typeorm migration:run -d src/database/data-source.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { CartEntity } from '../cart/entities/cart.entity';
import { CartItemEntity } from '../cart/entities/cart-item.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'cartdb',
  entities: [CartEntity, CartItemEntity],
  migrations: [__dirname + '/migrations/**/*.ts'],
  synchronize: false,
  logging: true,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});
