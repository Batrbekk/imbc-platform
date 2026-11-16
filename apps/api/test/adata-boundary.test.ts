import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Таблицы попыток и предзаполненных значений: в них ответ Adata с ФИО руководителя и учредителями. */
const IDENTIFIERS = /\b(prefilledValue|externalCheckAttempt|prefilled_value|external_check_attempt)\b/;

/** Reviewed exact readers: Main source/COW and Class C DD use normalized snapshots or attempt metadata. */
const ALLOWED = [
  /^database\/schema\//,
  /^modules\/adata\//,
  /^worker\/adata-prefill\.job\.ts$/,
  /^modules\/profiles\/profiles\.service\.ts$/,
  /^modules\/profiles\/main-source\.ts$/,
  /^modules\/profiles\/main-source-materializer\.ts$/,
  /^modules\/profiles\/main-source-refresh\.service\.ts$/,
  /^modules\/due-diligence\/diligence-run\.service\.ts$/,
  /^modules\/due-diligence\/diligence\.service\.ts$/,
  /^modules\/due-diligence\/source-snapshot-store\.ts$/,
];

// Raw source/attempt tables cannot be referenced by catalog, public company, export or administrator modules.
// Their views receive only explicitly permitted checked projections (GEN-11, ADM-06), never raw reports.
describe('граница модулей', () => {
  it('таблицы Adata называют только точные разрешённые source/DD readers, worker и схема (GEN-11, ADM-06)', () => {
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
