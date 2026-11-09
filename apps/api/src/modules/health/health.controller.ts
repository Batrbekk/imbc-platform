import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { ENV, type Env } from '../../config/env.js';
import { PG_POOL } from '../../database/database.module.js';
import { S3, VALKEY } from '../../infra/infra.module.js';
import { Public } from '../auth/guards.js';

type Check = 'ok' | 'fail';

/** Пробы Kubernetes (архитектура §15): live — процесс жив, ready — зависимости доступны. */
@ApiExcludeController()
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('live')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, cache, storage] = await Promise.all([
      this.probe(() => this.pool.query('select 1')),
      // Кеш не критичен: при его падении API работает медленнее, но работает (ADR-11).
      this.probe(() => this.valkey.ping()),
      this.probe(() => this.s3.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET_FILES }))),
    ]);
    const ready = database === 'ok' && storage === 'ok';
    res.status(ready ? 200 : 503);
    return { status: ready ? 'ok' : 'fail', checks: { database, cache, storage } };
  }

  private async probe(fn: () => Promise<unknown>): Promise<Check> {
    try {
      await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))]);
      return 'ok';
    } catch {
      return 'fail';
    }
  }
}
