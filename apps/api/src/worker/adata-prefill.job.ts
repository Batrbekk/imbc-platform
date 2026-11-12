import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { AuditService } from '../common/audit.service.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database } from '../database/database.module.js';
import { externalCheck, externalCheckAttempt, prefilledValue } from '../database/schema/index.js';
import type { AdataPrefillJob as AdataPrefillJobData } from '../jobs/queues.js';
import {
  ADATA_BASE_URL,
  AdataCallError,
  AdataClient,
  pollCompanyInfo,
  redactToken,
  type AdataFailure,
  type AdataTiming,
} from '../modules/adata/adata.client.js';
import { allowancePeriodStart, reserveAllowance } from '../modules/adata/allowance.js';
import { extractPrefill } from '../modules/adata/company-info.js';

export const ADATA_CLIENT_FACTORY = Symbol('ADATA_CLIENT_FACTORY');
export const ADATA_TIMING = Symbol('ADATA_TIMING');
export type AdataClientFactory = (token: string, timing: AdataTiming) => AdataClient;

/** Настоящий адрес Adata — только в worker; тесты передают адрес заглушки. */
export const defaultAdataClientFactory: AdataClientFactory = (token, timing) =>
  new AdataClient({ baseUrl: ADATA_BASE_URL, token, requestTimeoutMs: timing.requestTimeoutMs });

type Final = 'received' | 'unavailable' | 'not_configured' | 'quota_exhausted';
const FINAL: ReadonlySet<string> = new Set<Final>(['received', 'unavailable', 'not_configured', 'quota_exhausted']);

interface Attempt {
  id: string;
  state: string;
  bin: string;
  requestSentAt: Date | null;
  pollToken: string | null;
  profileId: string;
  organizationId: string;
}

type Ready = { ready: true; data: Record<string, unknown> } | { ready: false; failure: AdataFailure };

/** Код SQLSTATE из ошибки pg или из её обёртки Drizzle; иное — null. */
function sqlState(error: unknown): string | null {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/**
 * Классы 22 (данные), 23 (ограничения) и 54 (предел сложности, например глубина jsonb): БД отвергла
 * сам ответ, повтор дал бы то же самое.
 */
const isDataError = (error: unknown) => /^(22|23|54)/.test(sqlState(error) ?? '');

const failureOf = (error: unknown): AdataFailure => (error instanceof AdataCallError ? error.failure : 'malformed');

/**
 * Сбой своей БД. Текст исходной ошибки Drizzle несёт параметры запроса — в них ответ Adata
 * с персональными данными, — поэтому наружу (и в output задания pg-boss) идёт только SQLSTATE.
 */
class AdataJobDatabaseError extends Error {
  constructor(attemptId: string, step: string, code: string | null) {
    super(`adata attempt ${attemptId}: database ${step} failed${code ? ` (${code})` : ''}`);
    this.name = 'AdataJobDatabaseError';
  }
}

/**
 * Чтение «Полной информации» Adata для попытки profile_created (IMBC-07, MAN-07, EXT-02).
 * Один БИН — один Get Request: единица квоты резервируется и polling фиксируется до вызова; повтор
 * задания продолжает опрос по сохранённому токену проверки, но Get Request не повторяет.
 * Ответы и сбои Adata — состояние попытки, а не исключение: исключение pg-boss записал бы в output
 * задания. Бросает только на сбоях своей БД — их повторяет pg-boss. due_diligence_record не пишется.
 */
@Injectable()
export class AdataPrefillJob {
  private readonly logger = new Logger(AdataPrefillJob.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    @Inject(ADATA_CLIENT_FACTORY) private readonly clientFor: AdataClientFactory,
    @Inject(ADATA_TIMING) private readonly timing: AdataTiming,
  ) {}

  async run({ attemptId }: AdataPrefillJobData): Promise<void> {
    const attempt = await this.guard(attemptId, 'read', () => this.load(attemptId));
    if (!attempt || FINAL.has(attempt.state)) return;
    const token = this.env.ADATA_API_TOKEN;

    if (attempt.state === 'queued') {
      const claimed = await this.guard(attemptId, 'claim', () => this.claim(attempt, token));
      if (claimed === null) return;
      if (typeof claimed === 'string') return this.log(attemptId, claimed);
      return this.request(claimed, token!);
    }

    // polling: повтор задания после сбоя или рестарта worker.
    if (!attempt.pollToken) {
      // Get Request мог ещё не закончиться у другого исполнителя: его ограничивает requestTimeoutMs.
      const sentAt = attempt.requestSentAt?.getTime() ?? 0;
      if (Date.now() - sentAt < this.timing.requestTimeoutMs + 1_000) return;
      // Квота израсходована, ответа нет — второго Get Request по тому же БИН не будет (IMBC-07).
      return this.unavailable(attempt, 'interrupted');
    }
    if (!token) return this.unavailable(attempt, 'interrupted');
    return this.poll(attempt, this.clientFor(token, this.timing), attempt.pollToken, token);
  }

  private async load(attemptId: string): Promise<Attempt | undefined> {
    const [row] = await this.db
      .select({
        id: externalCheckAttempt.id,
        state: externalCheckAttempt.state,
        bin: externalCheckAttempt.bin,
        requestSentAt: externalCheckAttempt.requestSentAt,
        pollToken: externalCheckAttempt.pollToken,
        profileId: externalCheck.profileId,
        organizationId: externalCheck.organizationId,
      })
      .from(externalCheckAttempt)
      .innerJoin(externalCheck, eq(externalCheck.id, externalCheckAttempt.externalCheckId))
      .where(eq(externalCheckAttempt.id, attemptId));
    return row;
  }

  /**
   * queued → polling (квота взята, коммит до вызова), not_configured или quota_exhausted.
   * null — попытку уже взял другой исполнитель.
   */
  private async claim(attempt: Attempt, token: string | undefined): Promise<Attempt | Final | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ state: externalCheckAttempt.state, requestSentAt: externalCheckAttempt.requestSentAt })
        .from(externalCheckAttempt)
        .where(eq(externalCheckAttempt.id, attempt.id))
        .for('update');
      if (!row || row.state !== 'queued' || row.requestSentAt !== null) return null;

      const closed = async (state: 'not_configured' | 'quota_exhausted') => {
        await tx
          .update(externalCheckAttempt)
          .set({ state, completedAt: sql`now()`, failure: null })
          .where(eq(externalCheckAttempt.id, attempt.id));
        await this.audit.record(
          {
            organizationId: attempt.organizationId,
            action: 'adata.read_completed',
            objectType: 'external_check_attempt',
            objectId: attempt.id,
            outcome: 'failed',
            diff: { state },
          },
          tx,
        );
        return state;
      };
      // EXT-02: без ADATA_API_TOKEN коннектор выключен; следующий вход поставит попытку снова.
      if (!token) return closed('not_configured');
      const period = allowancePeriodStart(new Date());
      if (!(await reserveAllowance(tx, period, this.env.ADATA_MONTHLY_LIMIT))) return closed('quota_exhausted');
      const [polling] = await tx
        .update(externalCheckAttempt)
        .set({ state: 'polling', requestSentAt: sql`now()`, allowancePeriod: period })
        .where(eq(externalCheckAttempt.id, attempt.id))
        .returning({ requestSentAt: externalCheckAttempt.requestSentAt });
      return { ...attempt, state: 'polling', requestSentAt: polling!.requestSentAt, pollToken: null };
    });
  }

  /** Единственный Get Request попытки. */
  private async request(attempt: Attempt, token: string): Promise<void> {
    const client = this.clientFor(token, this.timing);
    let pollToken: string;
    try {
      ({ pollToken } = await client.startCompanyInfo(attempt.bin));
    } catch (error) {
      return this.unavailable(attempt, failureOf(error));
    }
    const saved = await this.guard(attempt.id, 'poll token', () =>
      this.db
        .update(externalCheckAttempt)
        .set({ pollToken })
        .where(and(eq(externalCheckAttempt.id, attempt.id), eq(externalCheckAttempt.state, 'polling')))
        .returning({ id: externalCheckAttempt.id }),
    );
    // Попытку закрыл другой исполнитель (interrupted): ответ ему уже не нужен.
    if (!saved.length) return;
    return this.poll(attempt, client, pollToken, token);
  }

  /** Опрос до request_sent_at + deadlineMs; срок уже прошёл (рестарт) — одна проверка. */
  private async poll(attempt: Attempt, client: AdataClient, pollToken: string, token: string): Promise<void> {
    const deadlineAt = attempt.requestSentAt!.getTime() + this.timing.deadlineMs;
    let result: Ready;
    if (deadlineAt > Date.now()) {
      result = await pollCompanyInfo(client, pollToken, { deadlineAt, timing: this.timing });
    } else {
      try {
        const reply = await client.checkCompanyInfo(pollToken);
        result = reply.ready ? reply : { ready: false, failure: 'timeout' };
      } catch (error) {
        result = { ready: false, failure: failureOf(error) };
      }
    }
    if (!result.ready) return this.unavailable(attempt, result.failure);
    return this.received(attempt, result.data, token);
  }

  /**
   * Ответ и девять значений — одной транзакцией; value и prefilled_value — из копии без токена.
   * Ответ разбирается до транзакции: любое исключение разбора (например, RangeError глубокой
   * вложенности) — ответ непригоден, попытка закрывается malformed. В транзакции ответ уже только
   * строки, поэтому исключение там — сбой своей БД либо отказ БД принять данные.
   */
  private async received(attempt: Attempt, data: Record<string, unknown>, token: string): Promise<void> {
    let json: string;
    let rows: ReturnType<typeof extractPrefill>;
    try {
      const value = redactToken(data, token);
      json = JSON.stringify(value);
      rows = extractPrefill(value);
    } catch {
      // Текст исключения не пишется: в нём может быть фрагмент ответа.
      return this.unavailable(attempt, 'malformed');
    }
    let done: boolean;
    try {
      done = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(externalCheckAttempt)
          .set({
            state: 'received',
            completedAt: sql`now()`,
            value: sql`${json}::jsonb`,
            source: 'adata.companyInfo',
            failure: null,
          })
          .where(and(eq(externalCheckAttempt.id, attempt.id), eq(externalCheckAttempt.state, 'polling')))
          .returning({ completedAt: externalCheckAttempt.completedAt });
        if (!row) return false;
        if (rows.length)
          await tx
            .insert(prefilledValue)
            .values(
              rows.map((r) => ({
                profileId: attempt.profileId,
                organizationId: attempt.organizationId,
                attemptId: attempt.id,
                source: 'adata' as const,
                field: r.field,
                position: r.position,
                value: r.value,
                label: r.label,
                readAt: row.completedAt!,
              })),
            )
            .onConflictDoNothing();
        await this.audit.record(
          {
            organizationId: attempt.organizationId,
            action: 'adata.read_completed',
            objectType: 'external_check_attempt',
            objectId: attempt.id,
            diff: { state: 'received', fields: new Set(rows.map((r) => r.field)).size },
          },
          tx,
        );
        return true;
      });
    } catch (error) {
      // БД не принимает сам ответ: повтор дал бы то же, попытка закрывается отдельной транзакцией.
      if (isDataError(error)) return this.unavailable(attempt, 'malformed');
      throw new AdataJobDatabaseError(attempt.id, 'received', sqlState(error));
    }
    if (done) this.log(attempt.id, 'received');
  }

  /** polling → unavailable: сбой источника — не находка (EXT-04). */
  private async unavailable(attempt: Attempt, failure: AdataFailure): Promise<void> {
    const done = await this.guard(attempt.id, 'unavailable', () =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(externalCheckAttempt)
          .set({ state: 'unavailable', failure, completedAt: sql`now()` })
          .where(and(eq(externalCheckAttempt.id, attempt.id), eq(externalCheckAttempt.state, 'polling')))
          .returning({ id: externalCheckAttempt.id });
        if (!row) return false;
        await this.audit.record(
          {
            organizationId: attempt.organizationId,
            action: 'adata.read_completed',
            objectType: 'external_check_attempt',
            objectId: attempt.id,
            outcome: 'failed',
            diff: { state: 'unavailable', failure },
          },
          tx,
        );
        return true;
      }),
    );
    if (done) this.log(attempt.id, 'unavailable', failure);
  }

  /** Одна строка на конечное состояние; БИН, значения, ответ и URL не логируются. */
  private log(attemptId: string, state: Final, failure?: AdataFailure): void {
    this.logger.log(`adata attempt ${attemptId}: ${state}${failure ? ` (${failure})` : ''}`);
  }

  private async guard<T>(attemptId: string, step: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw new AdataJobDatabaseError(attemptId, step, sqlState(error));
    }
  }
}
