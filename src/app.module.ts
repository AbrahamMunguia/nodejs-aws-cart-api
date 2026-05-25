import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { CartModule } from './cart/cart.module';

/**
 * Root application module.
 *
 * Merge this into your existing app.module.ts from the base repo,
 * adding DatabaseModule and making sure CartModule uses the TypeORM
 * repositories defined here instead of the in-memory store.
 */
@Module({
  imports: [
    // Load .env file for local development; in Lambda env vars come from CDK
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),

    // Establishes the TypeORM PostgreSQL connection
    DatabaseModule,

    // Cart feature (controller + service + TypeORM repos)
    CartModule,

    // ↓ Keep all other modules from the original repo (auth, users, orders…)
    // AuthModule,
    // UsersModule,
    // OrdersModule,
  ],
})
export class AppModule {}
