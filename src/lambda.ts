/**
 * reflect-metadata MUST be the first import in the entire bundle.
 * TypeORM's decorator metadata (column types, relations) depends on it.
 * esbuild does not guarantee import order so we force it here at the top.
 */
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import express from 'express';
import { configure as serverlessExpress } from '@vendia/serverless-express';
import { Handler, Context, Callback } from 'aws-lambda';

let cachedHandler: Handler;

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

  return serverlessExpress({ app: expressApp });
}

export const handler: Handler = async (
  event: unknown,
  context: Context,
  callback: Callback,
) => {
  if (!cachedHandler) {
    // Re-use the same NestJS app across warm Lambda invocations
    cachedHandler = await bootstrap();
  }
  return cachedHandler(event, context, callback);
};