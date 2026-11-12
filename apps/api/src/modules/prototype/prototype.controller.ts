import { prototypeWriteSchema, type PrototypeState, type PrototypeWritten } from '@imbc/contracts';
import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { PrototypeService } from './prototype.service.js';

/**
 * Общее состояние прототипа кабинетов ролей: один документ на стенд, только при
 * `PROTOTYPE_CABINETS=true` (иначе маршрутов нет, `common/http.ts`). Нужен сеанс любой роли — права
 * разделов кабинетов сервер не проверяет и документ не разбирает: данные вымышленные, правила и
 * журнал прототипа исполняет web. Тело до 2 МБ (`common/http.ts`).
 */
@ApiTags('prototype')
@Controller('v1/prototype')
export class PrototypeController {
  constructor(private readonly prototype: PrototypeService) {}

  @Get('state')
  async read(): Promise<PrototypeState> {
    return (await this.prototype.read()) as PrototypeState;
  }

  /** Запись поверх `baseVersion`; устарела — 409 с текущими версией и документом. */
  @Put('state')
  @HttpCode(200)
  async write(@Body() body: unknown): Promise<PrototypeWritten> {
    const { baseVersion, state } = parseOrThrow(prototypeWriteSchema, body);
    const result = await this.prototype.write(baseVersion, state);
    if (result.ok) return { version: result.version };
    throw new ProblemException(409, 'version_conflict', 'Состояние прототипа уже изменено', undefined, {
      version: result.version,
      state: result.state,
    });
  }
}
