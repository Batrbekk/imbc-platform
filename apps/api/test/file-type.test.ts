import { readFileSync } from 'node:fs';
import { ALLOWED_FILE_TYPES, type AllowedMediaType, fileExtensionMatches } from '@imbc/contracts';
import { describe, expect, it } from 'vitest';
import { detectMediaType } from '../src/modules/files/file-type.js';

// Тип файла — по содержимому, а не по имени; расширение имени обязано ему соответствовать (DATA-06).
const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));

const PDF = 'application/pdf';
const JPG = 'image/jpeg';
const PNG = 'image/png';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('тип файла по содержимому (DATA-06)', () => {
  it('PDF, JPG, PNG, DOCX, XLSX определяются по содержимому; ZIP без word/ и xl/, exe и текст — null', async () => {
    expect(Object.keys(ALLOWED_FILE_TYPES).sort()).toEqual([PDF, JPG, PNG, DOCX, XLSX].sort());
    expect(await detectMediaType(fixture('sample.pdf'))).toBe(PDF);
    expect(await detectMediaType(fixture('sample.jpg'))).toBe(JPG);
    expect(await detectMediaType(fixture('sample.png'))).toBe(PNG);
    expect(await detectMediaType(fixture('sample.docx'))).toBe(DOCX);
    expect(await detectMediaType(fixture('sample.xlsx'))).toBe(XLSX);

    expect(await detectMediaType(fixture('plain.zip'))).toBeNull();
    expect(await detectMediaType(fixture('program.exe'))).toBeNull();
    expect(await detectMediaType(Buffer.from('Құрылым IMBC — простой текст, не файл платформы\n'))).toBeNull();
    expect(await detectMediaType(Buffer.alloc(0))).toBeNull();
  });

  it('расширение: .JPEG и .jpg — jpg; PNG с именем .pdf и файл без расширения — не совпадает', () => {
    const matches = (name: string, type: AllowedMediaType) => fileExtensionMatches(name, type);
    expect(matches('фото.JPEG', JPG)).toBe(true);
    expect(matches('фото.jpeg', JPG)).toBe(true);
    expect(matches('фото.jpg', JPG)).toBe(true);
    expect(matches('ФОТО.JPG', JPG)).toBe(true);
    expect(matches('Құрылым "IMBC"; v1.pdf', PDF)).toBe(true);
    expect(matches('report.PDF', PDF)).toBe(true);
    expect(matches('схема.png', PNG)).toBe(true);
    expect(matches('устав.DOCX', DOCX)).toBe(true);
    expect(matches('мощности.xlsx', XLSX)).toBe(true);

    expect(matches('схема.pdf', PNG)).toBe(false);
    expect(matches('схема', PNG)).toBe(false);
    expect(matches('', PDF)).toBe(false);
    expect(matches('report.pdf.exe', PDF)).toBe(false);
    expect(matches('report.', PDF)).toBe(false);
    expect(matches('report.jpeg', PNG)).toBe(false);
    expect(matches('table.xls', XLSX)).toBe(false);
    expect(matches('letter.doc', DOCX)).toBe(false);
  });
});
