import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectFile } from '../src/modules/files/upload.js';
import { scanStream } from '../src/worker/clamd.js';
import { clamdSettings, repository, serviceBlock } from './support/repository-files.js';

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

// Документ или архив под паролем clamd не проверит (вопрос 54, расхождение 4 плана): с AlertEncryptedDoc и
// AlertEncryptedArchive он отвечает «FOUND Heuristics.Encrypted.…», и worker отклоняет файл с причиной encrypted
// (DATA-07). PDF только с паролем прав clamd расшифровывает сам (пустой пароль пользователя) — это не отказ.
describe('clamd.conf: документ и архив под паролем — отказ (DATA-07)', () => {
  it('clamd.conf: AlertEncryptedDoc yes и AlertEncryptedArchive yes, каждая — один раз', () => {
    const conf = repository('infrastructure/clamav/clamd.conf');
    const settings = clamdSettings(conf);
    expect(settings.get('AlertEncryptedDoc')).toBe('yes');
    expect(settings.get('AlertEncryptedArchive')).toBe('yes');
    for (const key of ['AlertEncryptedDoc', 'AlertEncryptedArchive'])
      expect(
        conf.split('\n').filter((line) => line.trim().split(/\s+/)[0] === key),
        key,
      ).toHaveLength(1);
  });
});

/**
 * Своя база сигнатур clamd (DATA-07): архив ZIP, у записи которого в локальном заголовке сжатый (смещение 18) или
 * несжатый (смещение 22) размер равен 0xFFFFFFFF (ZIP64), clamd 1.4 не разбирает и признаёт чистым на любой
 * глубине — во вложенном пакете, в объекте OLE, во вложении PDF. Сигнатура тела ловит такой заголовок в каждом
 * объекте, который clamd извлёк, и worker отклоняет файл с причиной scan_limits.
 */
const NDB = repository('infrastructure/clamav/imbc.ndb');

/** Сигнатура тела `.ndb` как RegExp по байтам (latin1): пары цифр — байт, `{N}` — ровно N любых байт. */
const bodySignature = (hex: string) =>
  new RegExp(
    hex.replace(/\{(\d+)\}|([0-9a-f]{2})/g, (_, skip?: string, byte?: string) =>
      skip ? `[\\s\\S]{${skip}}` : `\\x${byte}`,
    ),
  );

const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));

/** Локальный заголовок ZIP: сигнатура, 26 байт полей (размеры — по смещениям 18 и 22 от начала заголовка). */
const localHeader = (compressed: number, uncompressed: number) => {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt32LE(compressed, 18);
  header.writeUInt32LE(uncompressed, 22);
  return header;
};

describe('infrastructure/clamav/imbc.ndb: своя база сигнатур (DATA-07)', () => {
  it('ровно две сигнатуры тела: имя IMBC.Unverifiable.…, тип цели 0 (любой файл), смещение *, сигнатура — шестнадцатеричные цифры и {N}; комментариев и пустых строк нет', () => {
    expect(NDB.endsWith('\n')).toBe(true);
    const lines = NDB.slice(0, -1).split('\n');
    expect(lines).toEqual([
      'IMBC.Unverifiable.Zip64LocalHeader-1:0:*:504b0304{14}ffffffff',
      'IMBC.Unverifiable.Zip64LocalHeader-2:0:*:504b0304{18}ffffffff',
    ]);
    for (const line of lines) {
      const fields = line.split(':');
      expect(fields, line).toHaveLength(4);
      const [name, target, offset, signature] = fields as [string, string, string, string];
      expect(name).toMatch(/^IMBC\.Unverifiable\.[A-Za-z0-9.-]+$/);
      expect(target).toBe('0');
      expect(offset).toBe('*');
      expect(signature).toMatch(/^(?:[0-9a-f]{2}|\{\d+\})+$/);
    }
  });

  it('сигнатуры находят ZIP64 в локальном заголовке (сжатый или несжатый размер 0xFFFFFFFF, zip64-local.docx и .xlsx) и не находят в обычном заголовке и в файлах, которые платформа принимает', async () => {
    const [first, second] = NDB.slice(0, -1)
      .split('\n')
      .map((line) => bodySignature(line.split(':')[3]!));
    const text = (bytes: Buffer) => bytes.toString('latin1');
    expect(first!.test(text(localHeader(0xffffffff, 100)))).toBe(true);
    expect(second!.test(text(localHeader(100, 0xffffffff)))).toBe(true);
    expect(first!.test(text(localHeader(100, 0xffffffff)))).toBe(false);
    expect(second!.test(text(localHeader(0xffffffff, 100)))).toBe(false);
    for (const header of [localHeader(100, 200), localHeader(0, 0), localHeader(0xfffffffe, 0xfffffffe)])
      for (const signature of [first!, second!]) expect(signature.test(text(header))).toBe(false);
    for (const name of ['zip64-local.docx', 'zip64-local.xlsx'])
      expect(
        [first!, second!].some((signature) => signature.test(text(fixture(name)))),
        name,
      ).toBe(true);

    const dir = new URL('./fixtures/files/', import.meta.url);
    let accepted = 0;
    for (const name of readdirSync(dir)) {
      const bytes = fixture(name);
      if (!(await inspectFile(bytes, name)).ok) continue;
      accepted++;
      for (const signature of [first!, second!]) expect(signature.test(text(bytes)), name).toBe(false);
    }
    expect(accepted).toBeGreaterThanOrEqual(8);
  });

  it('compose.yaml: imbc.ndb монтируется файлом рядом с clamd.conf и копируется в каталог баз при старте (стартовый скрипт образа делает chown -R /var/lib/clamav: файл только для чтения там уронил бы его); compose.azure.yaml и compose.dev.yaml сервис clamav не переопределяют томами и entrypoint', () => {
    const clamav = serviceBlock(repository('compose.yaml'), 'clamav')!;
    expect(clamav).not.toBeNull();
    expect(clamav).toMatch(/^\s+-\s+"?\.\/infrastructure\/clamav\/imbc\.ndb:\/etc\/clamav\/imbc\.ndb:ro"?\s*$/m);
    expect(clamav).toMatch(/^\s+-\s+"?\.\/infrastructure\/clamav\/clamd\.conf:\/etc\/clamav\/clamd\.conf:ro"?\s*$/m);
    expect(clamav).toMatch(/^\s+-\s+"?clamav-db:\/var\/lib\/clamav"?\s*$/m);
    // В каталог баз файлом ничего не монтируется.
    expect(clamav).not.toMatch(/:\/var\/lib\/clamav\/[^\s"]+/);
    const entrypoint = /^\s+entrypoint:\s*(\[.*\])\s*$/m.exec(clamav);
    expect(entrypoint).not.toBeNull();
    expect(JSON.parse(entrypoint![1]!)).toEqual([
      '/bin/sh',
      '-c',
      'cp /etc/clamav/imbc.ndb /var/lib/clamav/imbc.ndb && exec /init',
    ]);
    for (const overlay of ['compose.azure.yaml', 'compose.dev.yaml']) {
      const block = serviceBlock(repository(overlay), 'clamav');
      if (block) expect(block, overlay).not.toMatch(/^\s+(volumes|entrypoint|command):/m);
    }
  });
});
