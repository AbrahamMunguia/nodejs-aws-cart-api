import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { CartModule } from './cart/cart.module';
import { HealthModule } from './health/health.module';

/**
 * Root application module.
 *
 * Merge this into your existing app.module.ts from the base repo.
 * The key additions over the original are:
 *   • DatabaseModule  — TypeORM async factory connecting to RDS via Secrets Manager
 *   • CartModule      — TypeORM-backed cart/cart-items (replaces in-memory store)
 *   • HealthModule    — GET /api/health  (DB ping + deployment metadata)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),

    DatabaseModule,
    CartModule,
    HealthModule,

    // ↓ Keep modules from the original repo (auth, users, orders…)
    // AuthModule,
    // UsersModule,
    // OrdersModule,
  ],
})
export class AppModule { }