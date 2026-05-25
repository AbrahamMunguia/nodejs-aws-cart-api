/**
 * Lambda entry point.
 * Uses @vendia/serverless-express to bridge API Gateway proxy events
 * with the NestJS/Express application.
 */
import { configure as serverlessExpressConfig } from '@vendia/serverless-express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../app.module';
import express from 'express';

// Cached handler — reused across warm Lambda invocations
let cachedHandler: ReturnType<typeof serverlessExpressConfig>;

async function bootstrap() {
  if (cachedHandler) return cachedHandler;

  const expressApp = express();

  const nestApp = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
    { logger: ['error', 'warn', 'log'] },
  );

  nestApp.setGlobalPrefix('api');
  nestApp.enableCors();

  await nestApp.init();

  cachedHandler = serverlessExpressConfig({ app: expressApp });
  return cachedHandler;
}

export const handler = async (event: any, context: any, callback: any) => {
  // Keep the container alive between invocations
  context.callbackWaitsForEmptyEventLoop = false;
  const server = await bootstrap();
  return server(event, context, callback);
};
