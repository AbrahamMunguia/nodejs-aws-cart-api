import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';
import express from 'express';
import { configure as serverlessExpress } from '@vendia/serverless-express';
import { Handler, Context, Callback } from 'aws-lambda';

let cachedHandler: Handler;

/**
 * Idempotent schema bootstrap – runs raw SQL so it never depends on
 * TypeORM decorator metadata (which esbuild does not emit reliably).
 */
async function ensureSchema(dataSource: DataSource): Promise<void> {
  const runner = dataSource.createQueryRunner();
  try {
    await runner.connect();
    await runner.startTransaction();

    // cart_status enum
    await runner.query(`
      DO $$ BEGIN
        CREATE TYPE cart_status AS ENUM ('OPEN', 'ORDERED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // carts table
    await runner.query(`
      CREATE TABLE IF NOT EXISTS carts (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    VARCHAR     NOT NULL,
        status     cart_status NOT NULL DEFAULT 'OPEN',
        created_at TIMESTAMP   NOT NULL DEFAULT now(),
        updated_at TIMESTAMP   NOT NULL DEFAULT now()
      );
    `);

    await runner.query(`
      CREATE INDEX IF NOT EXISTS idx_carts_user_id_status ON carts (user_id, status);
    `);

    // cart_items table
    await runner.query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        cart_id    UUID    NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
        product_id VARCHAR NOT NULL,
        count      INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (cart_id, product_id)
      );
    `);

    await runner.commitTransaction();
    console.log('[bootstrap] schema ready');
  } catch (err) {
    await runner.rollbackTransaction();
    console.error('[bootstrap] schema migration failed', err);
    throw err;
  } finally {
    await runner.release();
  }
}

async function bootstrap(): Promise<Handler> {
  const expressApp = express();
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
    { logger: ['error', 'warn', 'log'] },
  );

  app.setGlobalPrefix('api');
  app.enableCors();
  await app.init();

  // Run schema bootstrap after the app (and DataSource) are fully initialised
  const dataSource = app.get(DataSource);
  await ensureSchema(dataSource);

  return serverlessExpress({ app: expressApp });
}

export const handler: Handler = async (
  event: unknown,
  context: Context,
  callback: Callback,
) => {
  if (!cachedHandler) {
    cachedHandler = await bootstrap();
  }
  return cachedHandler(event, context, callback);
};