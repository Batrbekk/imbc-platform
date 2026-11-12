import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from '../../database/database.module.js';
import {
  type PrototypeStored,
  type PrototypeWriteResult,
  readPrototypeState,
  writePrototypeState,
} from '../../database/prototype-store.js';

/** Документ прототипа кабинетов в `prototype_state` (`database/prototype-store.ts`). */
@Injectable()
export class PrototypeService {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  read(): Promise<PrototypeStored> {
    return readPrototypeState(this.pool);
  }

  write(baseVersion: number, state: object): Promise<PrototypeWriteResult> {
    return writePrototypeState(this.pool, baseVersion, state);
  }
}
