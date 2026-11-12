import { LEGAL_PLACEHOLDER_MARKER } from '@imbc/contracts';
import { describe, expect, it } from 'vitest';

import { NDA_PLACEHOLDER_BODY } from '../src/database/seed.js';

// Без базы: seed при импорте ничего не запускает (main — только при прямом запуске файла).
describe('заглушка NDA в seed стенда', () => {
  it('каждый абзац заглушки NDA в seed начинается с маркера временного текста (FC-02)', () => {
    // По маркеру форма регистрации показывает отметку «Заглушка» над текстом NDA.
    expect(LEGAL_PLACEHOLDER_MARKER).toBeInstanceOf(RegExp);
    const paragraphs = NDA_PLACEHOLDER_BODY.split('\n\n');
    expect(paragraphs).toHaveLength(3);
    for (const paragraph of paragraphs) expect(paragraph).toMatch(LEGAL_PLACEHOLDER_MARKER);
  });
});
