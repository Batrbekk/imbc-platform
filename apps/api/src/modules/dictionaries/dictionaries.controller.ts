import {
  createDictionaryEntrySchema,
  dictionaryChoicesQuerySchema,
  dictionaryEntriesQuerySchema,
  entryMandatorySchema,
  updateDictionaryEntrySchema,
} from '@imbc/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import { parseOrThrow } from '../../common/problem.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { DictionariesService } from './dictionaries.service.js';

/**
 * Справочники (ADM-08, ADM-09, DATA-04): список с выведенными значениями и обязательностью —
 * `reference.read`, изменения — `reference.manage`, выбор действующих значений — любой вошедший
 * пользователь (расхождение 3 плана этапа 2). Права проверяет сервер (GEN-08).
 */
@ApiTags('dictionaries')
@Controller('v1/dictionaries')
export class DictionariesController {
  constructor(private readonly dictionaries: DictionariesService) {}

  @Get()
  @Can('reference.read')
  list() {
    return this.dictionaries.list();
  }

  @Get(':code/entries')
  @Can('reference.read')
  entries(@Param('code') code: string, @Query() query: Record<string, unknown>) {
    return this.dictionaries.entries(code, parseOrThrow(dictionaryEntriesQuerySchema, query));
  }

  /** Без действия матрицы: выбирают значения производитель, SME, оператор (MAN-10, MAN-23, OPR-02). */
  @Get(':code/choices')
  choices(@Param('code') code: string, @Query() query: Record<string, unknown>) {
    return this.dictionaries.choices(code, parseOrThrow(dictionaryChoicesQuerySchema, query));
  }

  @Post(':code/entries')
  @HttpCode(201)
  @Can('reference.manage')
  create(@Auth() auth: AuthContext, @Param('code') code: string, @Body() body: unknown, @Req() req: Request) {
    return this.dictionaries.create(auth.user, code, parseOrThrow(createDictionaryEntrySchema, body), auditIp(req));
  }

  @Put(':code/entries/:id')
  @Can('reference.manage')
  update(
    @Auth() auth: AuthContext,
    @Param('code') code: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.dictionaries.update(auth.user, code, id, parseOrThrow(updateDictionaryEntrySchema, body), auditIp(req));
  }

  @Put(':code/entries/:id/mandatory')
  @Can('reference.manage')
  setMandatory(
    @Auth() auth: AuthContext,
    @Param('code') code: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const { mandatory } = parseOrThrow(entryMandatorySchema, body);
    return this.dictionaries.setMandatory(auth.user, code, id, mandatory, auditIp(req));
  }

  @Post(':code/entries/:id/retire')
  @HttpCode(200)
  @Can('reference.manage')
  retire(@Auth() auth: AuthContext, @Param('code') code: string, @Param('id') id: string, @Req() req: Request) {
    return this.dictionaries.retire(auth.user, code, id, auditIp(req));
  }

  @Post(':code/entries/:id/restore')
  @HttpCode(200)
  @Can('reference.manage')
  restore(@Auth() auth: AuthContext, @Param('code') code: string, @Param('id') id: string, @Req() req: Request) {
    return this.dictionaries.restore(auth.user, code, id, auditIp(req));
  }

  /** Используемое или обязательное значение не удаляется — 409; его выводят из оборота (DATA-04). */
  @Delete(':code/entries/:id')
  @HttpCode(204)
  @Can('reference.manage')
  async remove(@Auth() auth: AuthContext, @Param('code') code: string, @Param('id') id: string, @Req() req: Request) {
    await this.dictionaries.remove(auth.user, code, id, auditIp(req));
  }
}
