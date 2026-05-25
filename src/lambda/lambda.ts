/**
 * Lambda entry point.
 *
 * Bridges API Gateway proxy events with the NestJS/Express application
 * using @vendia/serverless-express.  The NestJS app is initialised once
 * on the first (cold) invocation and then reused across warm ones.
 *
 * Route layout expected by API Gateway (defined in cart-api-stack.ts):
 *   GET  /health          → answered directly here (no NestJS overhead)
 *   ANY  /api/{proxy+}   → forwarded to NestJS
 */
import { configure as serverlessExpressConfig } from '@vendia/serverless-express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../app.module';
import express from 'express';

type ServerlessHandler = ReturnType<typeof serverlessExpressConfig>;

// Module-level cache — survives across warm Lambda invocations
let cachedHandler: ServerlessHandler | null = null;

async function bootstrap(): Promise<ServerlessHandler> {
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

export const handler = async (event: any, context: any, callback?: any): Promise<any> => {
  // Prevent Lambda from waiting for the event loop to drain — critical for
  // database connection reuse across warm invocations.
  context.callbackWaitsForEmptyEventLoop = false;

  // ── Health check: answered before NestJS initialises to keep latency low ──
  if (event?.path === '/health' || event?.rawPath === '/health') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        region: process.env.AWS_REGION,
        deploymentBucket: process.env.S3_DEPLOYMENT_BUCKET,
      }),
    };
  }

  const server = await bootstrap();
  return server(event, context, callback);
};