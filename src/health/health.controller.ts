import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async check() {
    let dbStatus = 'ok';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      dbStatus = 'error';
    }

    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbStatus,
        lambda: 'ok',
      },
      deployment: {
        bucket: process.env.S3_DEPLOYMENT_BUCKET ?? 'n/a',
        region: process.env.AWS_REGION ?? 'n/a',
        env: process.env.NODE_ENV ?? 'n/a',
      },
    };
  }
}
