/**
 * Standalone DataSource used by the TypeORM CLI for generating and running
 * migrations outside of NestJS (e.g. in CI or a one-off Lambda invocation).
 *
 *   npm run migration:generate -- src/migrations/InitSchema
 *   npm run migration:run
 */
import { DataSource } from 'typeorm';
import { Cart } from '../cart/entities/cart.entity';
import { CartItem } from '../cart/entities/cart-item.entity';
import * as dotenv from 'dotenv';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME     ?? 'cartapi',
  entities: [Cart, CartItem],
  migrations: ['src/migrations/**/*.ts'],
  synchronize: false,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  logging: true,
});
