#!/usr/bin/env node
// Сверка ID требований со спецификацией (NFR-12): ID читаются из текста
// спецификации, карта этапов roadmap и ссылки в отслеживаемых файлах
// проверяются по ним. Устаревшие ссылки (нумерация v1.2) перечислены
// в scripts/requirements-baseline.json с числом вхождений; базовый список
// только сокращается.
//
// Скрипт проверяет только то, что ID существует. ID, который есть и в v1.2,
// и в v1.3, но означает в них разное, он не заметит: проверка не заменяет
// чтения требования в тексте спецификации.
//
// node scripts/check-requirements.mjs [--spec <файл>] [--map <roadmap>] [--report] [--update-baseline]
//
// Корень — корень git-репозитория текущего каталога; пути по умолчанию
// берутся от него, пути из аргументов — от текущего каталога.
// Код возврата 1 при любой ошибке. Без зависимостей.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SPEC = 'docs/analyst/2026-11-11/specification-v1.3.md';
export const BASELINE_FILE = 'scripts/requirements-baseline.json';

// Префиксы разделов спецификации v1.3. При запуске скрипта префиксы берутся
// из самой спецификации; этот список — значение по умолчанию для разбора текста.
export const REQUIREMENT_PREFIXES = [
  'GEN',
  'AUTH',
  'MAN',
  'FC',
  'UPD',
  'REV',
  'IMBC',
  'EXT',
  'ADM',
  'OPR',
  'NOT',
  'LANG',
  'AUD',
  'DATA',
  'MIG',
  'NFR',
  'ACC',
];

// Где ищутся ссылки: отслеживаемые git файлы этих путей.
const SCOPE = [
  /^apps\//,
  /^packages\//,
  /^infrastructure\//,
  /^\.github\//,
  /^scripts\//,
  /^README\.md$/,
  /^CLAUDE\.md$/,
  /^AGENTS\.md$/,
  /^docs\/deployment\//,
  /^docs\/handoff\//,
];
const EXCLUDED = [
  /^docs\/analyst\//,
  /^docs\/superpowers\//,
  /^docs\/deployment\/verification-2026-11-10\.md$/,
  /^apps\/api\/drizzle\//,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/,
  // Базовый список и тест скрипта перечисляют несуществующие ID намеренно.
  /^scripts\/requirements-baseline\.json$/,
  /^scripts\/check-requirements\.test\.mjs$/,
];
const BINARY_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp4|webm|mp3|wasm)$/i;
const TEST_FILE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

// Разделители диапазонов: «OPR-31…35», «GEN-11...13», «AUTH-01–05»,
// «IMBC-07…IMBC-14». Через «/» — перечисление: «ADM-10/11», «MAN-01/MAN-03».
const RANGE_SEPARATORS = ['…', '...', '–'];

const FIX_HINT =
  'Что делать: замените ID на ID v1.3 по тексту спецификации; если файл переписывается на своём этапе — ' +
  `перегенерируйте базовый список: node scripts/check-requirements.mjs --update-baseline (${BASELINE_FILE}).`;

export function isInScope(path) {
  return SCOPE.some((re) => re.test(path)) && !EXCLUDED.some((re) => re.test(path));
}

export function isTestFile(path) {
  return TEST_FILE.test(path);
}

const idPattern = /^([A-Z]+)-(\d{2})$/;

export function compareIds(a, b) {
  const [, pa, na] = idPattern.exec(a) ?? [, a, '0'];
  const [, pb, nb] = idPattern.exec(b) ?? [, b, '0'];
  if (pa !== pb) return pa < pb ? -1 : 1;
  return Number(na) - Number(nb);
}

const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const formatId = (prefix, n) => `${prefix}-${String(n).padStart(2, '0')}`;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Определения требований в спецификации: «**GEN-01.**» в начале пункта
// и первая ячейка строки таблицы «| NOT-01 | … |» (уведомления NOT-01–17).
// Упоминания в тексте («см. GEN-08») определениями не считаются.
function specDefinitions(text) {
  const found = [];
  const re = /\*\*([A-Z]+-\d{2})\.\*\*|^\|\s*([A-Z]+-\d{2})\s*\|/gm;
  for (const m of text.matchAll(re)) found.push(m[1] ?? m[2]);
  return found;
}

/** ID требований спецификации в порядке появления, без повторов. */
export function parseSpecIds(text) {
  return [...new Set(specDefinitions(text))];
}

/**
 * Ссылки на требования в тексте и записи, разобранные не полностью.
 *
 * ID — префикс раздела спецификации, дефис и ровно две цифры; перед префиксом
 * не стоит латинская буква, цифра, «_» или «-» (так отсекаются «X-MAN-01»,
 * «ADR-04», «D-51», «UTF-8»). Трёхзначные и однозначные номера («OPR-005»,
 * «MAN-100», «OPR-5») и строчные формы («man-50», «tier-2») намеренно
 * не считаются ID: в спецификации их нет, а похожих чужих обозначений много.
 *
 * Продолжения сразу после ID: диапазон («…», «...», «–», правый конец — две
 * цифры или ID того же раздела) и перечисление через «/» (две цифры или ID
 * того же раздела). Перечнем через «/», за которым идёт ещё «/» и три и более
 * цифры, считается дата: из неё берётся только первый ID.
 *
 * Ошибкой («issues») считается запись, которая похожа на продолжение, но
 * не разворачивается:
 * - обратный или пустой диапазон;
 * - после «…», «...», «–» — ровно одна цифра или ID другого раздела, после «/» —
 *   ровно одна цифра (три и более цифр — год или число, не ошибка);
 * - дефис-минус и ровно две цифры вместо тире;
 * - после «,» или «;» — диапазон из двух номеров без префикса, как в нотации
 *   карты, если за ним конец строки, знак препинания или ID (за ним слово —
 *   «15–20 минут» — это обычный текст, не ошибка).
 * Примеры — в scripts/check-requirements.test.mjs (здесь они сработали бы).
 */
export function scanReferences(text, prefixes = REQUIREMENT_PREFIXES) {
  const refs = [];
  const issues = [];
  if (prefixes.length === 0) return { refs, issues };
  const alternatives = [...prefixes]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
  const head = new RegExp(`(?<![A-Za-z0-9_-])(${alternatives})-(\\d{2})(?!\\d)`, 'g');
  const separators = [...RANGE_SEPARATORS, '/'].map(escape).join('|');
  const rangeSeparators = RANGE_SEPARATORS.map(escape).join('|');
  const brokenTail = new RegExp(`^(?:(?:${rangeSeparators})(?=\\d(?!\\d)|[A-Z]+-\\d)|\\/(?=\\d(?!\\d)))`);
  const hyphenTail = /^-\d{2}(?!\d)/;
  const bareNumbers = new RegExp(
    `^\\s*[,;]\\s*\\d{2}(?!\\d)\\s*(?:${rangeSeparators}|-)\\s*\\d{2}(?!\\d)(?=\\s*(?:$|[,;.)\\]|]|[A-Z]+-\\d{2}))`,
  );
  const dateTail = /^\/\d{3,}/;

  text.split('\n').forEach((lineText, index) => {
    const line = index + 1;
    head.lastIndex = 0;
    let m;
    while ((m = head.exec(lineText))) {
      const prefix = m[1];
      const start = m.index;
      let last = Number(m[2]);
      const run = [formatId(prefix, last)];
      let ranged = false;
      let pos = head.lastIndex;
      const tail = new RegExp(`(${separators})(?:${escape(prefix)}-)?(\\d{2})(?!\\d)`, 'y');
      for (;;) {
        tail.lastIndex = pos;
        const t = tail.exec(lineText);
        if (!t) break;
        const n = Number(t[2]);
        if (t[1] !== '/') ranged = true;
        if (t[1] === '/') {
          run.push(formatId(prefix, n));
        } else if (n > last) {
          for (let k = last + 1; k <= n; k++) run.push(formatId(prefix, k));
        } else {
          issues.push({ line, message: `«${lineText.slice(start, tail.lastIndex)}» — обратный диапазон` });
        }
        last = n;
        pos = tail.lastIndex;
      }
      // ID, «/» и дата («/26/2026») — не перечень: остаётся только первый ID.
      if (!ranged && run.length > 1 && dateTail.test(lineText.slice(pos))) {
        run.length = 1;
        pos = head.lastIndex;
      }
      const rest = lineText.slice(pos);
      const snippet = () => `«${lineText.slice(start, pos + 12).trim()}»`;
      if (brokenTail.test(rest)) {
        issues.push({ line, message: `${snippet()} — продолжение после ${run.at(-1)} не разворачивается` });
      } else if (hyphenTail.test(rest)) {
        issues.push({ line, message: `${snippet()} — диапазон через дефис; пишите «${prefix}-NN–NN»` });
      } else if (bareNumbers.test(rest)) {
        issues.push({ line, message: `${snippet()} — номера без префикса; пишите каждый ID или диапазон полностью` });
      }
      const source = pos > head.lastIndex ? lineText.slice(start, pos) : null;
      for (const id of run) {
        refs.push(source ? { id, line, source, kind: ranged ? 'диапазона' : 'перечня' } : { id, line });
      }
      head.lastIndex = pos;
    }
  });
  return { refs, issues };
}

/** Ссылки на требования в тексте; диапазоны и перечисления разворачиваются в отдельные ID. */
export function expandReferences(text, prefixes = REQUIREMENT_PREFIXES) {
  return scanReferences(text, prefixes).refs;
}

// --- Карта требований в roadmap ---------------------------------------------

function lines(text) {
  return text.split('\n');
}

// Заголовок раздела узнаётся по тексту: «## 11. Карта требований (v1.3)» тоже подходит.
function mapSectionLines(roadmap) {
  const all = lines(roadmap);
  const start = all.findIndex((l) => /^#{1,6}\s+.*Карта требований/.test(l));
  if (start < 0) return null;
  const level = /^#+/.exec(all[start])[0].length;
  const rest = all.slice(start + 1);
  const end = rest.findIndex((l) => new RegExp(`^#{1,${level}}\\s`).test(l));
  return { lines: end < 0 ? rest : rest.slice(0, end), offset: start + 2 };
}

// «GEN 03–04, 07; UPD 06» → GEN-03, GEN-04, GEN-07, UPD-06.
function expandMapCell(cell) {
  const ids = [];
  const errors = [];
  for (const group of cell.split(';')) {
    const g = /^\s*([A-Z]+)\s+(.+?)\s*$/.exec(group);
    if (!g) {
      errors.push(`не разобрана группа «${group.trim()}»`);
      continue;
    }
    for (const part of g[2].split(',')) {
      const p = new RegExp(`^\\s*(\\d{2})(?:(?:${RANGE_SEPARATORS.map(escape).join('|')})(\\d{2}))?\\s*$`).exec(part);
      if (!p) {
        errors.push(`не разобрано «${g[1]} ${part.trim()}»`);
        continue;
      }
      const from = Number(p[1]);
      const to = Number(p[2] ?? p[1]);
      if (to < from) errors.push(`обратный диапазон «${g[1]} ${part.trim()}»`);
      for (let n = from; n <= to; n++) ids.push(formatId(g[1], n));
    }
  }
  return { ids, errors };
}

function parseMapRows(roadmap) {
  const section = mapSectionLines(roadmap);
  if (!section) return [];
  const rows = [];
  section.lines.forEach((l, i) => {
    const r = /^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|\s*$/.exec(l);
    if (r) rows.push({ stage: r[1], count: Number(r[2]), line: section.offset + i, ...expandMapCell(r[3]) });
  });
  return rows;
}

// Строка «Требования.» (или «Требования:») в разделе «### Этап X. …».
function parseStageLines(roadmap) {
  const stages = new Map();
  let current = null;
  lines(roadmap).forEach((l, i) => {
    const h = /^###\s+Этап\s+([^.\s]+)\./.exec(l);
    if (h) {
      current = h[1];
      if (!stages.has(current)) stages.set(current, null);
      return;
    }
    if (/^#{1,3}\s/.test(l)) {
      current = null;
      return;
    }
    const req = /^(?:\*\*Требования\.\*\*|Требования:)\s*(.*)$/.exec(l);
    if (current && req && stages.get(current) === null) {
      const { refs, issues } = scanReferences(req[1], prefixesOf(req[1]));
      stages.set(current, { ids: refs.map((r) => r.id), issues, line: i + 1 });
    }
  });
  return stages;
}

function prefixesOf(text) {
  const set = new Set(REQUIREMENT_PREFIXES);
  for (const m of text.matchAll(/(?<![A-Za-z0-9_-])([A-Z]{2,})-\d{2}(?!\d)/g)) set.add(m[1]);
  return [...set];
}

/** ID → этап по таблице раздела «Карта требований». */
export function parseStageMap(roadmap) {
  const map = new Map();
  for (const row of parseMapRows(roadmap)) for (const id of row.ids) if (!map.has(id)) map.set(id, row.stage);
  return map;
}

/** Ошибки карты требований относительно списка ID спецификации. */
export function checkMap(roadmap, specIds) {
  if (!mapSectionLines(roadmap)) return ['карта: нет раздела «Карта требований»'];
  const errors = [];
  const known = new Set(specIds);
  const rows = parseMapRows(roadmap);
  if (rows.length === 0) return ['карта: в разделе «Карта требований» нет строк таблицы «Этап | Кол-во | Требования»'];
  const stages = parseStageLines(roadmap);
  const placed = new Map();
  for (const row of rows) {
    const where = `карта, строка ${row.line}, этап ${row.stage}`;
    for (const e of row.errors) errors.push(`${where}: ${e}`);
    const unique = [...new Set(row.ids)];
    if (unique.length !== row.ids.length) errors.push(`${where}: ID повторяются в строке`);
    if (row.count !== unique.length) {
      errors.push(`${where}: в столбце «Кол-во» ${row.count}, в списке ${unique.length}`);
    }
    for (const id of unique) {
      if (!known.has(id)) errors.push(`${where}: ${id} нет в спецификации`);
      placed.set(id, [...(placed.get(id) ?? []), row.stage]);
    }
    const section = stages.get(row.stage);
    if (section === undefined) {
      errors.push(`${where}: нет раздела «### Этап ${row.stage}.»`);
    } else if (section === null) {
      errors.push(`${where}: в разделе этапа нет строки «Требования.»`);
    } else {
      for (const issue of section.issues)
        errors.push(`${where}: строка «Требования.» (строка ${section.line}): ${issue.message}`);
      const inLine = new Set(section.ids);
      const onlyLine = [...inLine].filter((id) => !unique.includes(id)).sort(compareIds);
      const onlyMap = unique.filter((id) => !inLine.has(id)).sort(compareIds);
      if (onlyLine.length || onlyMap.length) {
        errors.push(
          `${where}: строка «Требования.» (строка ${section.line}) расходится с картой:` +
            (onlyLine.length ? ` только в строке этапа ${onlyLine.join(', ')};` : '') +
            (onlyMap.length ? ` только в карте ${onlyMap.join(', ')};` : ''),
        );
      }
    }
  }
  const rowStages = new Set(rows.map((r) => r.stage));
  for (const [stage, section] of stages) {
    if (section && !rowStages.has(stage)) errors.push(`карта: этапа ${stage} нет в таблице карты`);
  }
  for (const [id, where] of [...placed].sort(([a], [b]) => compareIds(a, b))) {
    if (where.length > 1) errors.push(`карта: ${id} стоит в нескольких этапах: ${where.join(', ')}`);
  }
  const missing = specIds.filter((id) => !placed.has(id)).sort(compareIds);
  if (missing.length) errors.push(`карта: ни в одном этапе нет ${missing.join(', ')}`);
  return errors;
}

// --- Ссылки в файлах ----------------------------------------------------------

/** Корень git-репозитория, в котором лежит каталог cwd. */
export function repositoryRoot(cwd) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** Отслеживаемые файлы в области проверки; пути от корня репозитория. */
export function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z', '--full-name'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean).filter(isInScope);
}

/**
 * Ссылки по файлам: refs — Map<путь, { id, line, source? }[]>; issues — записи,
 * разобранные не полностью: { file, line, message }. Двоичные и отсутствующие
 * файлы пропускаются.
 */
export function collectReferences(root, files, prefixes = REQUIREMENT_PREFIXES) {
  const refs = new Map();
  const issues = [];
  for (const file of files) {
    if (BINARY_EXTENSIONS.test(file)) continue;
    let buffer;
    try {
      buffer = readFileSync(join(root, file));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') continue;
      throw error;
    }
    if (buffer.includes(0)) continue;
    const found = scanReferences(buffer.toString('utf8'), prefixes);
    if (found.refs.length) refs.set(file, found.refs);
    for (const issue of found.issues) issues.push({ file, ...issue });
  }
  return { refs, issues };
}

const label = (ref) => (ref.source ? `${ref.id} (из ${ref.kind} ${ref.source})` : ref.id);

/**
 * Несуществующие ID сверяются с базовым списком «файл → { ID: число вхождений }».
 * Ошибки: ID вне списка; вхождений больше записанного (новая ссылка на
 * устаревший ID); вхождений меньше записанного или ни одного (список
 * нужно сократить).
 */
export function checkReferences(refs, specIds, baseline) {
  const errors = [];
  const unknownRefs = new Map();
  for (const [file, list] of refs) {
    for (const ref of list) {
      if (specIds.has(ref.id)) continue;
      if (!unknownRefs.has(file)) unknownRefs.set(file, new Map());
      const byId = unknownRefs.get(file);
      if (!byId.has(ref.id)) byId.set(ref.id, []);
      byId.get(ref.id).push(ref);
    }
  }
  for (const [file, byId] of unknownRefs) {
    for (const [id, list] of byId) {
      const allowed = baseline[file]?.[id] ?? 0;
      if (allowed === 0) {
        for (const ref of list) errors.push(`${file}:${ref.line}: ${label(ref)} нет в спецификации`);
      } else if (list.length > allowed) {
        const extra = list[allowed];
        errors.push(
          `${file}:${extra.line}: ${label(extra)} нет в спецификации — вхождений ${list.length} ` +
            `(строки ${list.map((r) => r.line).join(', ')}), в базовом списке ${allowed}: новые ссылки на него не допускаются`,
        );
      } else if (list.length < allowed) {
        errors.push(
          `${BASELINE_FILE}: ${file}: ${id} — вхождений ${list.length}, в базовом списке ${allowed}: сократите базовый список`,
        );
      }
    }
  }
  for (const file of Object.keys(baseline).sort(compareStrings)) {
    for (const id of Object.keys(baseline[file])) {
      if (!unknownRefs.get(file)?.has(id)) {
        errors.push(`${BASELINE_FILE}: ${file}: ${id} — такой устаревшей ссылки в файле больше нет, уберите запись`);
      }
    }
  }
  const unknown = {};
  for (const file of [...unknownRefs.keys()].sort(compareStrings)) {
    unknown[file] = {};
    for (const id of [...unknownRefs.get(file).keys()].sort(compareIds))
      unknown[file][id] = unknownRefs.get(file).get(id).length;
  }
  return { errors, unknown };
}

/**
 * Базовый список в каноническом виде: файлы и ID по порядку, по строке на файл,
 * если она помещается в 120 символов, иначе по ID на строку — как оставляет Prettier.
 */
export function formatBaseline(unknown) {
  const files = Object.keys(unknown).sort(compareStrings);
  if (files.length === 0) return '{}\n';
  const body = files.map((file, i) => {
    const comma = i < files.length - 1 ? ',' : '';
    const key = JSON.stringify(file);
    const pairs = Object.keys(unknown[file])
      .sort(compareIds)
      .map((id) => `${JSON.stringify(id)}: ${unknown[file][id]}`);
    const inline = `  ${key}: { ${pairs.join(', ')} }${comma}`;
    if (inline.length <= 120) return inline;
    return `  ${key}: {\n${pairs.map((p) => `    ${p}`).join(',\n')}\n  }${comma}`;
  });
  return `{\n${body.join('\n')}\n}\n`;
}

/**
 * Разбор базового списка: форма «файл → { ID: целое > 0 }» и канонический вид
 * (без повторов, по порядку). baseline — null, если файл не разобран или форма неверна.
 */
export function parseBaseline(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      baseline: null,
      errors: [`${BASELINE_FILE}: не разобран JSON (${e.message}); перегенерируйте его: --update-baseline`],
    };
  }
  const valid =
    isPlainObject(parsed) &&
    Object.values(parsed).every(
      (ids) =>
        isPlainObject(ids) &&
        Object.keys(ids).length > 0 &&
        Object.entries(ids).every(([id, n]) => idPattern.test(id) && Number.isInteger(n) && n > 0),
    );
  if (!valid) {
    return {
      baseline: null,
      errors: [
        `${BASELINE_FILE}: ожидается объект «файл → { ID: число вхождений }»; перегенерируйте его: --update-baseline`,
      ],
    };
  }
  // Сравнение без учёта окончаний строк: checkout с CRLF канонический вид не нарушает.
  if (formatBaseline(parsed) !== raw.replace(/\r\n/g, '\n')) {
    return {
      baseline: parsed,
      errors: [
        `${BASELINE_FILE}: не в каноническом виде (повторы, порядок файлов или ID, формат); перегенерируйте его: --update-baseline`,
      ],
    };
  }
  return { baseline: parsed, errors: [] };
}

// --- Запуск --------------------------------------------------------------------

function parseArgs(argv) {
  const options = { spec: null, map: null, report: false, updateBaseline: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--spec' || arg === '--map') {
      const value = argv[++i];
      if (!value) throw new Error(`после ${arg} нужен путь к файлу`);
      options[arg.slice(2)] = value;
    } else if (arg === '--report') options.report = true;
    else if (arg === '--update-baseline') options.updateBaseline = true;
    else throw new Error(`неизвестный аргумент ${arg}`);
  }
  return options;
}

function countByPrefix(ids) {
  const counts = new Map();
  for (const id of ids) {
    const prefix = id.split('-')[0];
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts].map(([p, n]) => `${p} ${n}`).join(', ');
}

function printReport(specIds, refs, stageMap, log) {
  const tests = new Map(specIds.map((id) => [id, new Set()]));
  for (const [file, list] of refs) {
    if (!isTestFile(file)) continue;
    for (const { id } of list) tests.get(id)?.add(file);
  }
  log('');
  log('Отчёт: ID → этап → файлы тестов, где он упомянут');
  log('| ID | Этап | Тесты |');
  log('|---|---|---|');
  for (const id of specIds) {
    const files = [...tests.get(id)].sort(compareStrings);
    log(`| ${id} | ${stageMap?.get(id) ?? '—'} | ${files.length ? files.join(', ') : '—'} |`);
  }
  if (!stageMap) {
    log('Этапы не известны: карта не задана (--map).');
    return;
  }
  for (const stage of ['А', '0']) {
    const untested = specIds.filter((id) => stageMap.get(id) === stage && tests.get(id).size === 0);
    log(`Этап ${stage}: без единого теста — ${untested.length ? untested.join(', ') : 'нет'}`);
  }
}

function readText(path, what) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`${what} ${path} не прочитан: ${e.code ?? e.message}`);
  }
}

function countValues(unknown) {
  return Object.values(unknown).reduce((sum, ids) => sum + Object.keys(ids).length, 0);
}

export function main(argv, { cwd = process.cwd(), log = console.log, error = console.error } = {}) {
  let options;
  let root;
  let specText;
  let roadmap = null;
  try {
    options = parseArgs(argv);
    try {
      root = repositoryRoot(cwd);
    } catch {
      throw new Error(`${cwd} не внутри git-репозитория`);
    }
    const specPath = options.spec ? resolve(cwd, options.spec) : resolve(root, DEFAULT_SPEC);
    specText = readText(specPath, 'файл спецификации');
    options.specName = relative(root, specPath);
    if (options.map) roadmap = readText(resolve(cwd, options.map), 'файл roadmap');
  } catch (e) {
    error(`check-requirements: ${e.message}`);
    return 1;
  }
  const errors = [];
  let referenceErrors = 0;

  const definitions = specDefinitions(specText);
  const specIds = parseSpecIds(specText);
  if (specIds.length === 0) errors.push(`${options.specName}: не найдено ни одного ID требования`);
  const repeated = [...new Set(definitions.filter((id, i) => definitions.indexOf(id) !== i))];
  for (const id of repeated) errors.push(`${options.specName}: ${id} определён больше одного раза`);
  log(`Спецификация ${options.specName}: ${specIds.length} требований (${countByPrefix(specIds)})`);
  const known = new Set(specIds);
  const prefixes = [...new Set(specIds.map((id) => id.split('-')[0]))];

  let stageMap = null;
  if (roadmap !== null) {
    const mapErrors = checkMap(roadmap, specIds);
    errors.push(...mapErrors.map((e) => `${options.map}: ${e}`));
    stageMap = parseStageMap(roadmap);
    log(`Карта ${options.map}: ${stageMap.size} ID${mapErrors.length ? '' : ', каждый ровно в одном этапе'}`);
  }

  // Без ID спецификации сверять ссылки не с чем: ошибка уже записана выше.
  let refs = new Map();
  if (specIds.length) {
    const files = trackedFiles(root);
    if (files.length === 0) errors.push(`в ${root} не найдено ни одного отслеживаемого файла для проверки`);
    const collected = collectReferences(root, files, prefixes);
    refs = collected.refs;
    for (const issue of collected.issues) errors.push(`${issue.file}:${issue.line}: ${issue.message}`);
    referenceErrors += collected.issues.length;
    const total = [...refs.values()].reduce((sum, list) => sum + list.length, 0);
    const baselinePath = join(root, BASELINE_FILE);
    if (options.updateBaseline) {
      const { unknown } = checkReferences(refs, known, {});
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, formatBaseline(unknown));
      log(
        `Базовый список ${BASELINE_FILE} записан: ${countValues(unknown)} ID в ${Object.keys(unknown).length} файлах`,
      );
    } else {
      const parsed = existsSync(baselinePath)
        ? parseBaseline(readFileSync(baselinePath, 'utf8'))
        : { baseline: {}, errors: [] };
      errors.push(...parsed.errors);
      referenceErrors += parsed.errors.length;
      // Без разобранного базового списка каждая устаревшая ссылка стала бы ошибкой: останавливаемся на его ошибке.
      if (parsed.baseline !== null) {
        const result = checkReferences(refs, known, parsed.baseline);
        errors.push(...result.errors);
        referenceErrors += result.errors.length;
        log(
          `Ссылки: ${total} в ${refs.size} из ${files.length} файлов; ` +
            `несуществующих ID (по базовому списку): ${countValues(result.unknown)} в ${Object.keys(result.unknown).length} файлах`,
        );
      }
    }
  }

  if (options.report) printReport(specIds, refs, stageMap, log);

  for (const e of errors) error(e);
  if (errors.length) {
    error(`check-requirements: ошибок ${errors.length}`);
    if (referenceErrors) error(FIX_HINT);
    return 1;
  }
  log('check-requirements: OK');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
