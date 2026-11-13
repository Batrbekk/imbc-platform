import type { Readable } from 'node:stream';
import type { Antivirus } from '../../src/modules/files/antivirus.js';
import type { ScanVerdict } from '../../src/worker/clamd.js';

/**
 * Антивирус для тестов (без clamd): читает поток до конца, как clamd, и возвращает `verdict` или бросает его,
 * если это Error (clamd недоступен, неожиданный ответ). `calls` — число проверок, `scanned` — байты последней.
 */
export class StubAntivirus implements Antivirus {
  verdict: ScanVerdict | Error = { clean: true };
  calls = 0;
  scanned: Buffer | null = null;

  async scan(body: Readable): Promise<ScanVerdict> {
    this.calls++;
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    this.scanned = Buffer.concat(chunks);
    if (this.verdict instanceof Error) throw this.verdict;
    return this.verdict;
  }
}
