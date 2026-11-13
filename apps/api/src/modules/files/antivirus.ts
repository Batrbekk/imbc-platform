import type { Readable } from 'node:stream';
import type { Env } from '../../config/env.js';
import { type ScanVerdict, scanStream } from '../../worker/clamd.js';

/**
 * Проверка на вредоносное содержимое (DATA-07). Вызывает только worker: API ставит задание `file-scan`.
 * Ответ clamd, кроме OK и FOUND, — исключение (повтор задания), никогда не «чистый».
 */
export interface Antivirus {
  scan(body: Readable): Promise<ScanVerdict>;
}

export const ANTIVIRUS = Symbol('ANTIVIRUS');

/** clamd по TCP (INSTREAM): `CLAMAV_HOST`, `CLAMAV_PORT`. */
export class ClamdAntivirus implements Antivirus {
  constructor(private readonly env: Env) {}

  scan(body: Readable): Promise<ScanVerdict> {
    return scanStream(this.env.CLAMAV_HOST, this.env.CLAMAV_PORT, body);
  }
}
