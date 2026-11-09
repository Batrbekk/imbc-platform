/**
 * Нормализация названий компаний для поиска (OPR-07, архитектура §10):
 * «ҚазМұнайГаз» должен находить «КазМунайГаз». Та же функция применяется
 * к данным при записи в проекцию каталога и к запросу пользователя.
 */
const KAZAKH_FOLD: Record<string, string> = {
  ә: 'а',
  ғ: 'г',
  қ: 'к',
  ң: 'н',
  ө: 'о',
  ұ: 'у',
  ү: 'у',
  і: 'и',
  һ: 'х',
  ё: 'е',
};

/** Организационно-правовые формы, которые не участвуют в поиске. */
const LEGAL_FORMS = ['тоо', 'ао', 'ип', 'зао', 'оао', 'жшс', 'ақ', 'ак', 'llp', 'llc', 'jsc', 'ltd', 'inc'];

export function foldKazakh(value: string): string {
  return value
    .toLowerCase()
    .split('')
    .map((ch) => KAZAKH_FOLD[ch] ?? ch)
    .join('');
}

export function normalizeCompanyName(value: string): string {
  const folded = foldKazakh(value.normalize('NFC'))
    .replace(/[«»"'“”„`]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const words = folded.split(' ').filter((word) => word.length > 0);
  // ОПФ убирается только с краёв: «Ақ» в середине названия — обычное слово («белый»).
  // По одной ОПФ с каждого края: в «ТОО Ақ Бұлақ» второе слово — часть названия.
  if (words.length > 1 && LEGAL_FORMS.includes(words[0]!)) words.shift();
  if (words.length > 1 && LEGAL_FORMS.includes(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}
