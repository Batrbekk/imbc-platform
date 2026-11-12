import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Таблицы попыток и предзаполненных значений: в них ответ Adata с ФИО руководителя и учредителями. */
const IDENTIFIERS = /\b(prefilledValue|externalCheckAttempt|prefilled_value|external_check_attempt)\b/;

/** Кто вправе их читать: схема, модуль Adata, задание worker и чтение своего профиля. */
const ALLOWED = [
  /^database\/schema\//,
  /^modules\/adata\//,
  /^worker\/adata-prefill\.job\.ts$/,
  /^modules\/profiles\/profiles\.service\.ts$/,
];

// Значения Adata не попадают в каталог, страницу компании, выгрузки и ответы администратора (GEN-11, ADM-06):
// ни один другой модуль не называет их таблиц.
describe('граница модулей', () => {
  it('таблицы Adata называют только схема, модуль adata, задание worker и ProfilesService (GEN-11, ADM-06)', () => {
    const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .map((file) => file.split('\\').join('/'))
      .filter((file) => file.endsWith('.ts'));
    expect(files).toContain('modules/catalog/catalog.service.ts');

    const offenders = files.filter(
      (file) => IDENTIFIERS.test(readFileSync(`${SRC}${file}`, 'utf8')) && !ALLOWED.some((rule) => rule.test(file)),
    );
    expect(offenders).toEqual([]);
  });
});
