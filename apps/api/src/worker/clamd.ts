import { connect } from 'node:net';
import type { Readable } from 'node:stream';

export type ScanVerdict = { clean: true } | { clean: false; signature: string };

/**
 * Минимальный клиент clamd (протокол INSTREAM): файл передаётся кусками
 * «4 байта длины + данные», нулевой кусок завершает поток.
 */
export function scanStream(host: string, port: number, body: Readable, timeoutMs = 120_000): Promise<ScanVerdict> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('clamd: тайм-аут')));
    socket.on('error', reject);
    socket.on('data', (d) => chunks.push(d));
    socket.on('end', () => {
      const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
      if (/:\s*OK$/.test(reply)) return resolve({ clean: true });
      const found = /:\s*(.+)\s+FOUND$/.exec(reply);
      if (found?.[1]) return resolve({ clean: false, signature: found[1] });
      reject(new Error(`clamd: неожиданный ответ «${reply}»`));
    });
    socket.on('connect', async () => {
      try {
        socket.write('zINSTREAM\0');
        for await (const chunk of body) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(buf.length);
          socket.write(len);
          socket.write(buf);
        }
        socket.write(Buffer.alloc(4));
      } catch (error) {
        socket.destroy(error as Error);
      }
    });
  });
}
