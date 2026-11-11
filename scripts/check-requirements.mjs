#!/usr/bin/env node
// Сверка ID требований со спецификацией (NFR-12): ID читаются из текста
// спецификации, карта этапов roadmap и ссылки в отслеживаемых файлах
// проверяются по ним. Устаревшие ссылки (нумерация v1.2) перечислены
// в scripts/requirements-baseline.json; базовый список только сокращается.
//
// node scripts/check-requirements.mjs [--spec <файл>] [--map <roadmap>] [--report] [--update-baseline]
//
// Код возврата 1 при любой ошибке. Без зависимостей.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

const formatId = (prefix, n) => `${prefix}-${String(n).padStart(2, '0')}`;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

/** Ссылки на требования в тексте; диапазоны и перечисления разворачиваются в отдельные ID. */
export function expandReferences(text, prefixes = REQUIREMENT_PREFIXES) {
  if (prefixes.length === 0) return [];
  const alternatives = [...prefixes]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
  const head = new RegExp(`(?<![A-Za-z0-9_-])(${alternatives})-(\\d{2})(?!\\d)`, 'g');
  const separators = [...RANGE_SEPARATORS, '/'].map(escape).join('|');
  const refs = [];
  text.split('\n').forEach((lineText, index) => {
    const line = index + 1;
    head.lastIndex = 0;
    let m;
    while ((m = head.exec(lineText))) {
      const prefix = m[1];
      let last = Number(m[2]);
      refs.push({ id: formatId(prefix, last), line });
      const tail = new RegExp(`(${separators})(?:${escape(prefix)}-)?(\\d{2})(?!\\d)`, 'y');
      tail.lastIndex = head.lastIndex;
      let t;
      while ((t = tail.exec(lineText))) {
        const n = Number(t[2]);
        if (t[1] !== '/' && n > last) {
          for (let k = last + 1; k <= n; k++) refs.push({ id: formatId(prefix, k), line });
        } else {
          refs.push({ id: formatId(prefix, n), line });
        }
        last = n;
        head.lastIndex = tail.lastIndex;
      }
    }
  });
  return refs;
}

// --- Карта требований в roadmap ---------------------------------------------

function lines(text) {
  return text.split('\n');
}

function mapSectionLines(roadmap) {
  const all = lines(roadmap);
  const start = all.findIndex((l) => /^#{2,3}\s+(?:\d+\.\s*)?Карта требований\s*$/.test(l));
  if (start < 0) return null;
  const rest = all.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,3}\s/.test(l));
  return { lines: end < 0 ? rest : rest.slice(0, end), offset: start + 2 };
}

export function hasStageMap(roadmap) {
  return mapSectionLines(roadmap) !== null;
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
      stages.set(current, { ids: expandReferences(req[1], prefixesOf([req[1]])).map((r) => r.id), line: i + 1 });
    }
  });
  return stages;
}

function prefixesOf(texts) {
  const set = new Set(REQUIREMENT_PREFIXES);
  for (const t of texts) for (const m of t.matchAll(/(?<![A-Za-z0-9_-])([A-Z]{2,})-\d{2}(?!\d)/g)) set.add(m[1]);
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

export function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean).filter(isInScope);
}

/** Ссылки по файлам: Map<путь, { id, line }[]>. Двоичные и отсутствующие файлы пропускаются. */
export function collectReferences(root, files, prefixes = REQUIREMENT_PREFIXES) {
  const refs = new Map();
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
    const found = expandReferences(buffer.toString('utf8'), prefixes);
    if (found.length) refs.set(file, found);
  }
  return refs;
}

/**
 * Неизвестные ID вне базового списка и записи базового списка, которым
 * в файле больше не соответствует неизвестная ссылка, — ошибки.
 */
export function checkReferences(refs, specIds, baseline) {
  const errors = [];
  const unknownSets = new Map();
  for (const [file, list] of refs) {
    const allowed = new Set(baseline[file] ?? []);
    for (const { id, line } of list) {
      if (specIds.has(id)) continue;
      if (!unknownSets.has(file)) unknownSets.set(file, new Set());
      unknownSets.get(file).add(id);
      if (!allowed.has(id)) errors.push(`${file}:${line}: ${id} нет в спецификации`);
    }
  }
  for (const file of Object.keys(baseline).sort()) {
    for (const id of baseline[file]) {
      if (!unknownSets.get(file)?.has(id)) {
        errors.push(`${BASELINE_FILE}: ${file}: ${id} — такой устаревшей ссылки в файле больше нет, уберите запись`);
      }
    }
  }
  const unknown = {};
  for (const file of [...unknownSets.keys()].sort()) unknown[file] = [...unknownSets.get(file)].sort(compareIds);
  return { errors, unknown };
}

/**
 * Базовый список в том виде, в каком его оставляет Prettier (printWidth 120):
 * список ID в одну строку, если помещается, иначе по ID на строку.
 */
export function formatBaseline(unknown) {
  const entries = Object.entries(unknown);
  if (entries.length === 0) return '{}\n';
  const body = entries.map(([file, ids], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    const key = JSON.stringify(file);
    const inline = `  ${key}: [${ids.map((id) => JSON.stringify(id)).join(', ')}]${comma}`;
    if (inline.length <= 120) return inline;
    return `  ${key}: [\n${ids.map((id) => `    ${JSON.stringify(id)}`).join(',\n')}\n  ]${comma}`;
  });
  return `{\n${body.join('\n')}\n}\n`;
}

// --- Запуск --------------------------------------------------------------------

function parseArgs(argv) {
  const options = { spec: DEFAULT_SPEC, map: null, report: false, updateBaseline: false };
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
    const files = [...tests.get(id)].sort();
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

export function main(argv, { root = process.cwd(), log = console.log, error = console.error } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    error(`check-requirements: ${e.message}`);
    return 1;
  }
  const errors = [];

  const specText = readFileSync(resolve(root, options.spec), 'utf8');
  const definitions = specDefinitions(specText);
  const specIds = parseSpecIds(specText);
  if (specIds.length === 0) errors.push(`${options.spec}: не найдено ни одного ID требования`);
  const repeated = [...new Set(definitions.filter((id, i) => definitions.indexOf(id) !== i))];
  for (const id of repeated) errors.push(`${options.spec}: ${id} определён больше одного раза`);
  log(`Спецификация ${options.spec}: ${specIds.length} требований (${countByPrefix(specIds)})`);
  const known = new Set(specIds);
  const prefixes = [...new Set(specIds.map((id) => id.split('-')[0]))];

  let stageMap = null;
  if (options.map) {
    const roadmap = readFileSync(resolve(root, options.map), 'utf8');
    if (hasStageMap(roadmap)) {
      const mapErrors = checkMap(roadmap, specIds);
      errors.push(...mapErrors.map((e) => `${options.map}: ${e}`));
      stageMap = parseStageMap(roadmap);
      log(`Карта ${options.map}: ${stageMap.size} ID${mapErrors.length ? '' : ', каждый ровно в одном этапе'}`);
    } else {
      log(`Карта ${options.map}: раздела «Карта требований» нет, сверка карты пропущена`);
    }
  }

  // Без ID спецификации сверять ссылки не с чем: ошибка уже записана выше.
  const files = specIds.length ? trackedFiles(root) : [];
  const refs = collectReferences(root, files, prefixes);
  const baselinePath = join(root, BASELINE_FILE);
  let baseline = {};
  if (existsSync(baselinePath)) {
    try {
      baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    } catch (e) {
      errors.push(`${BASELINE_FILE}: не разобран JSON: ${e.message}`);
    }
    const valid =
      baseline !== null &&
      typeof baseline === 'object' &&
      !Array.isArray(baseline) &&
      Object.values(baseline).every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'));
    if (!valid) {
      errors.push(`${BASELINE_FILE}: ожидается объект «файл → список ID»`);
      baseline = {};
    }
  }
  const total = [...refs.values()].reduce((sum, list) => sum + list.length, 0);
  if (options.updateBaseline) {
    const { unknown } = checkReferences(refs, known, {});
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, formatBaseline(unknown));
    const count = Object.values(unknown).reduce((sum, ids) => sum + ids.length, 0);
    log(`Базовый список ${BASELINE_FILE} записан: ${count} ID в ${Object.keys(unknown).length} файлах`);
  } else {
    const result = checkReferences(refs, known, baseline);
    errors.push(...result.errors);
    const count = Object.values(result.unknown).reduce((sum, ids) => sum + ids.length, 0);
    log(
      `Ссылки: ${total} в ${refs.size} из ${files.length} файлов; ` +
        `несуществующих ID (по базовому списку): ${count} в ${Object.keys(result.unknown).length} файлах`,
    );
  }

  if (options.report) printReport(specIds, refs, stageMap, log);

  for (const e of errors) error(e);
  if (errors.length) {
    error(`check-requirements: ошибок ${errors.length}`);
    return 1;
  }
  log('check-requirements: OK');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
