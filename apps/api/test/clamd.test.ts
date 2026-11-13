import { createServer, type AddressInfo, type Server } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { scanStream } from '../src/worker/clamd.js';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Поддельный clamd: собирает INSTREAM и отвечает FOUND, если в данных тестовая строка EICAR. */
function fakeClamd(): Promise<Server> {
  const server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const cmd = 'zINSTREAM\0';
      if (buf.length < cmd.length + 4 || !buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) return;
      let off = cmd.length;
      const parts: Buffer[] = [];
      while (off + 4 <= buf.length) {
        const len = buf.readUInt32BE(off);
        if (len === 0) break;
        parts.push(buf.subarray(off + 4, off + 4 + len));
        off += 4 + len;
      }
      const body = Buffer.concat(parts).toString();
      socket.end(body.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let server: Server | undefined;
afterEach(() => server?.close());

describe('clamd INSTREAM', () => {
  it('чистый файл', async () => {
    server = await fakeClamd();
    const { port } = server.address() as AddressInfo;
    expect(await scanStream('127.0.0.1', port, Readable.from([Buffer.from('%PDF-1.7 hello')]))).toEqual({
      clean: true,
    });
  });

  it('заражённый файл', async () => {
    server = await fakeClamd();
    const { port } = server.address() as AddressInfo;
    expect(await scanStream('127.0.0.1', port, Readable.from([Buffer.from(EICAR)]))).toEqual({
      clean: false,
      signature: 'Eicar-Test-Signature',
    });
  });

  // Ответ clamd, кроме OK и FOUND, — ошибка задания, никогда не «прошёл» (DATA-07).
  it.each([
    'INSTREAM size limit exceeded. ERROR\0',
    "stream: Can't allocate memory ERROR\0",
    'UNKNOWN COMMAND\0',
    '\0',
    '',
  ])('ответ %j — ошибка, не «чистый»', async (reply) => {
    server = createServer((socket) => socket.end(reply));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await expect(scanStream('127.0.0.1', port, Readable.from([Buffer.from('%PDF-1.7')]))).rejects.toThrow();
  });

  it('clamd недоступен — ошибка', async () => {
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    await expect(scanStream('127.0.0.1', port, Readable.from([Buffer.from('%PDF-1.7')]))).rejects.toThrow();
  });
});
