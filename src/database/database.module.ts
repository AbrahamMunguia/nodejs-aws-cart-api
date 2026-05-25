/**
 * database/database.module.ts
 *
 * Provides a TypeORM connection to PostgreSQL.
 * Credentials can come from:
 *   a) plain env vars  DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
 *   b) AWS Secrets Manager secret ARN in DB_SECRET_ARN  (preferred in Lambda)
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { CartEntity } from '../cart/entities/cart.entity';
import { CartItemEntity } from '../cart/entities/cart-item.entity';

async function resolveDbCredentials(config: ConfigService) {
  const secretArn = config.get<string>('DB_SECRET_ARN');

  if (secretArn) {
    try {
      const client = new SecretsManagerClient({
        region: process.env.AWS_REGION ?? 'us-east-1',
      });
      const { SecretString } = await client.send(
        new GetSecretValueCommand({ SecretId: secretArn }),
      );
      if (SecretString) {
        const secret = JSON.parse(SecretString) as {
          username: string;
          password: string;
          host: string;
          port: number;
          dbname: string;
        };
        return {
          host: secret.host,
          port: secret.port,
          username: secret.username,
          password: secret.password,
          database: secret.dbname,
        };
      }
    } catch (err) {
      console.error('Failed to fetch DB secret from Secrets Manager:', err);
    }
  }

  // Fallback to plain env vars (local dev / non-Lambda)
  return {
    host: config.get<string>('DB_HOST', 'localhost'),
    port: config.get<number>('DB_PORT', 5432),
    username: config.get<string>('DB_USER', 'postgres'),
    password: config.get<string>('DB_PASSWORD', 'postgres'),
    database: config.get<string>('DB_NAME', 'cartdb'),
  };
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const creds = await resolveDbCredentials(config);

        return {
          type: 'postgres',
          ...creds,
          entities: [CartEntity, CartItemEntity],
          synchronize: config.get<string>('NODE_ENV') !== 'production',
          // For production run migrations instead:
          // migrationsRun: true,
          // migrations: [__dirname + '/migrations/**/*.js'],
          ssl:
            config.get<string>('NODE_ENV') === 'production'
              ? { rejectUnauthorized: false }
              : false,
          logging: config.get<string>('NODE_ENV') !== 'production',
          // Connection pool tuned for Lambda's concurrency model
          extra: {
            max: 5,
            min: 1,
            idleTimeoutMillis: 10000,
            connectionTimeoutMillis: 5000,
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
