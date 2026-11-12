import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ProblemException } from '../../common/problem.js';
import { DB, type Database } from '../../database/database.module.js';
import { authRateLimits } from '../../database/schema/index.js';
import { sha256 } from './crypto.js';

@Injectable()
export class AuthRateLimitService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async allow(scope: string, identity: string, limit: number, windowSeconds: number): Promise<boolean> {
    const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
    const [row] = await this.db
      .insert(authRateLimits)
      .values({
        key: sha256(`${scope}:${identity}`),
        windowStart,
        attempts: 1,
      })
      .onConflictDoUpdate({
        target: authRateLimits.key,
        set: {
          windowStart,
          attempts: sql`case when ${authRateLimits.windowStart} = ${windowStart.toISOString()}::timestamptz
          then ${authRateLimits.attempts} + 1 else 1 end`,
        },
      })
      .returning({ attempts: authRateLimits.attempts });
    return row!.attempts <= limit;
  }

  async enforce(scope: string, identity: string, limit: number, windowSeconds: number): Promise<void> {
    if (await this.allow(scope, identity, limit, windowSeconds)) return;
    const retryAfter = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
    throw new ProblemException(429, 'rate_limited', 'Слишком много запросов. Попробуйте позже.', undefined, {
      retryAfter,
    });
  }
}
