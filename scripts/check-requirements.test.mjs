// Тесты сверки ID требований со спецификацией v1.3 (NFR-12).
// Запуск: node --test scripts/check-requirements.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkMap,
  checkReferences,
  collectReferences,
  expandReferences,
  formatBaseline,
  parseBaseline,
  parseSpecIds,
  parseStageMap,
  scanReferences,
} from './check-requirements.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/check-requirements.mjs');
const spec = readFileSync(join(root, 'docs/analyst/2026-11-11/specification-v1.3.md'), 'utf8');
const ids = (text) => expandReferences(text).map((ref) => ref.id);

const tempDirs = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'imbc-requirements-'));
  tempDirs.push(dir);
  return dir;
}
function writeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test('в спецификации v1.3 ровно 272 требования', () => {
  const specIds = parseSpecIds(spec);
  assert.equal(specIds.length, 272);
  assert.equal(new Set(specIds).size, 272);
  const perPrefix = {};
  for (const id of specIds) {
    const prefix = id.split('-')[0];
    perPrefix[prefix] = (perPrefix[prefix] ?? 0) + 1;
  }
  assert.deepEqual(perPrefix, {
    GEN: 13,
    AUTH: 10,
    MAN: 46,
    FC: 10,
    UPD: 6,
    REV: 10,
    IMBC: 26,
    EXT: 5,
    ADM: 15,
    OPR: 38,
    NOT: 35,
    LANG: 5,
    AUD: 4,
    DATA: 14,
    MIG: 15,
    NFR: 15,
    ACC: 5,
  });
});

test('требования в строках таблицы тоже считаются, упоминания в тексте — нет', () => {
  const text = [
    '- **GEN-01.** Первое. См. GEN-02.',
    '',
    '| ID | Event | Recipient |',
    '|---|---|---|',
    '| NOT-01 | Password link | As NOT-23 to NOT-26 |',
  ].join('\n');
  assert.deepEqual(parseSpecIds(text), ['GEN-01', 'NOT-01']);
});

test('диапазоны разворачиваются', () => {
  assert.deepEqual(ids('OPR-31…35'), ['OPR-31', 'OPR-32', 'OPR-33', 'OPR-34', 'OPR-35']);
  assert.deepEqual(ids('AUTH-01–05, AUTH-08'), ['AUTH-01', 'AUTH-02', 'AUTH-03', 'AUTH-04', 'AUTH-05', 'AUTH-08']);
  assert.deepEqual(ids('см. UPD-04 и NFR-06.'), ['UPD-04', 'NFR-06']);
  assert.deepEqual(ids('GEN-13...15'), ['GEN-13', 'GEN-14', 'GEN-15']);
  assert.deepEqual(ids('IMBC-07…IMBC-09, EXT-01'), ['IMBC-07', 'IMBC-08', 'IMBC-09', 'EXT-01']);
  assert.deepEqual(ids('ADM-10/11 и NOT-12/15/16'), ['ADM-10', 'ADM-11', 'NOT-12', 'NOT-15', 'NOT-16']);
  assert.deepEqual(ids('MAN-01/MAN-03'), ['MAN-01', 'MAN-03']);
});

test('строка и номер строки у каждой ссылки; у ID из диапазона — исходная запись', () => {
  assert.deepEqual(expandReferences('// GEN-08\n\n/* OPR-31…32, ADM-10/11 */'), [
    { id: 'GEN-08', line: 1 },
    { id: 'OPR-31', line: 3, source: 'OPR-31…32', kind: 'диапазона' },
    { id: 'OPR-32', line: 3, source: 'OPR-31…32', kind: 'диапазона' },
    { id: 'ADM-10', line: 3, source: 'ADM-10/11', kind: 'перечня' },
    { id: 'ADM-11', line: 3, source: 'ADM-10/11', kind: 'перечня' },
  ]);
});

test('ID рядом с пунктуацией и кириллицей, в адресе и в имени файла распознаются', () => {
  assert.deepEqual(ids('(GEN-99)'), ['GEN-99']);
  assert.deepEqual(ids('«GEN-99»'), ['GEN-99']);
  assert.deepEqual(ids('см.GEN-99'), ['GEN-99']);
  assert.deepEqual(ids('требованиеGEN-99'), ['GEN-99']);
  assert.deepEqual(ids('https://example.local/spec#GEN-99'), ['GEN-99']);
  assert.deepEqual(ids('docs/GEN-99.md, GEN-99_notes.txt'), ['GEN-99', 'GEN-99']);
  assert.deepEqual(ids('GEN-08 — 12 часов'), ['GEN-08']);
});

test('идентификаторы решений и чужие префиксы не считаются требованиями', () => {
  for (const text of [
    'D-51',
    'ISO-9001',
    'UTF-8',
    'tier-2',
    'SHA-256',
    'ADR-04',
    'X-MAN-01',
    'OPR-005',
    'OPR-5',
    'MAN-100',
    'man-50',
    'MPL-2.0, 2026-11-11, px-4, @imbc/contracts',
    'XGEN-01, my_GEN-01',
  ]) {
    assert.deepEqual(scanReferences(text), { refs: [], issues: [] }, text);
  }
});

test('запись, разобранная не полностью, — ошибка, а не потеря', () => {
  const issues = (text) => scanReferences(text).issues.map((i) => i.message);
  assert.match(issues('AUTH-01–05, 08–10').join('\n'), /без префикса/);
  assert.match(issues('AUTH-01-05').join('\n'), /дефис/);
  assert.match(issues('OPR-35…31').join('\n'), /обратный/);
  assert.match(issues('OPR-31…3').join('\n'), /не разворачивается/);
  assert.match(issues('OPR-31…GEN-05').join('\n'), /не разворачивается/);
  assert.deepEqual(scanReferences('OPR-35…31').refs, [
    { id: 'OPR-35', line: 1, source: 'OPR-35…31', kind: 'диапазона' },
  ]);
  for (const text of ['GEN-08…', 'см. GEN-08... и дальше', 'GEN-08, 15 минут', 'MAN-01/GEN-05', 'IMBC-07…IMBC-14']) {
    assert.deepEqual(issues(text), [], text);
  }
});

test('несуществующий ID вне базового списка — ошибка с файлом и строкой', () => {
  const dir = tempDir();
  writeFiles(dir, { 'apps/api/test/example.test.ts': '// GEN-01\nconst x = 1;\n// GEN-99\n// GEN-01…03\n' });
  const { refs } = collectReferences(dir, ['apps/api/test/example.test.ts']);
  const { errors, unknown } = checkReferences(refs, new Set(['GEN-01', 'GEN-02']), {});
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^apps\/api\/test\/example\.test\.ts:3: GEN-99 нет в спецификации$/);
  assert.match(errors[1], /^apps\/api\/test\/example\.test\.ts:4: GEN-03 \(из диапазона GEN-01…03\)/);
  assert.deepEqual(unknown, { 'apps/api/test/example.test.ts': { 'GEN-99': 1, 'GEN-03': 1 } });

  const withBaseline = checkReferences(refs, new Set(['GEN-01', 'GEN-02']), {
    'apps/api/test/example.test.ts': { 'GEN-03': 1, 'GEN-99': 1 },
  });
  assert.deepEqual(withBaseline.errors, []);
});

test('базовый список считает вхождения: новая ссылка на устаревший ID — ошибка, меньше — сократить', () => {
  const dir = tempDir();
  writeFiles(dir, { 'apps/a.ts': '// MAN-50\n// MAN-50\n' });
  const { refs } = collectReferences(dir, ['apps/a.ts']);
  const more = checkReferences(refs, new Set(), { 'apps/a.ts': { 'MAN-50': 1 } });
  assert.equal(more.errors.length, 1);
  assert.match(
    more.errors[0],
    /^apps\/a\.ts:2: MAN-50 нет в спецификации — вхождений 2 \(строки 1, 2\), в базовом списке 1/,
  );
  const fewer = checkReferences(refs, new Set(), { 'apps/a.ts': { 'MAN-50': 3 } });
  assert.equal(fewer.errors.length, 1);
  assert.match(fewer.errors[0], /MAN-50 — вхождений 2, в базовом списке 3: сократите базовый список/);
  assert.deepEqual(checkReferences(refs, new Set(), { 'apps/a.ts': { 'MAN-50': 2 } }).errors, []);
});

test('запись базового списка без ссылки в файле — ошибка', () => {
  const dir = tempDir();
  writeFiles(dir, { 'README.md': 'GEN-01\n' });
  const { refs } = collectReferences(dir, ['README.md']);
  const { errors } = checkReferences(refs, new Set(['GEN-01']), {
    'README.md': { 'GEN-01': 1, 'MAN-96': 1 },
    'apps/gone.ts': { 'OPR-80': 1 },
  });
  assert.equal(errors.length, 3);
  assert.ok(errors.some((e) => e.includes('README.md') && e.includes('GEN-01')));
  assert.ok(errors.some((e) => e.includes('README.md') && e.includes('MAN-96')));
  assert.ok(errors.some((e) => e.includes('apps/gone.ts') && e.includes('OPR-80')));
});

test('базовый список: канонический вид, иначе — ошибка с указанием перегенерировать', () => {
  const long = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`MAN-${i + 47}`, 1]));
  const text = formatBaseline({ 'apps/a.ts': { 'NFR-43': 2, 'NFR-32': 1 }, 'README.md': long });
  assert.equal(
    text,
    `{\n  "README.md": {\n${Object.keys(long)
      .map((id) => `    "${id}": 1`)
      .join(',\n')}\n  },\n  "apps/a.ts": { "NFR-32": 1, "NFR-43": 2 }\n}\n`,
  );
  assert.deepEqual(parseBaseline(text).errors, []);
  assert.equal(formatBaseline({}), '{}\n');

  const broken = [
    '{\n  "apps/a.ts": ["NFR-32"]\n}\n',
    '{\n  "apps/a.ts": { "NFR-32": 0 }\n}\n',
    '{\n  "apps/a.ts": { "nfr-32": 1 }\n}\n',
    '{\n  "apps/a.ts": { "NFR-43": 1, "NFR-32": 1 }\n}\n',
    '{\n  "apps/b.ts": { "NFR-32": 1 },\n  "apps/a.ts": { "NFR-32": 1 }\n}\n',
    '{\n  "apps/a.ts": { "NFR-32": 1 },\n  "apps/a.ts": { "NFR-43": 1 }\n}\n',
    '{\n  "apps/a.ts": { "NFR-32": 1, "NFR-32": 1 }\n}\n',
    '{ not json',
  ];
  for (const raw of broken) {
    const { errors } = parseBaseline(raw);
    assert.equal(errors.length, 1, raw);
    assert.match(errors[0], /--update-baseline/, raw);
  }
});

const fakeSpecIds = ['GEN-01', 'GEN-02', 'GEN-03', 'AUTH-01', 'AUTH-02'];
function fakeRoadmap({ rowA, rowB, lineA, lineB, heading = '## 11. Карта требований' }) {
  return [
    '# План',
    '',
    '## 5. Этапы',
    '',
    '### Этап А. Вход',
    '',
    `Требования: ${lineA}`,
    '',
    '### Этап 0. Контракты',
    '',
    `**Требования.** ${lineB}`,
    '',
    heading,
    '',
    '| Этап | Кол-во | Требования |',
    '|---|---|---|',
    rowA,
    rowB,
    '',
  ].join('\n');
}
const goodRoadmap = (heading) =>
  fakeRoadmap({
    rowA: '| А | 3 | AUTH 01–02; GEN 01 |',
    rowB: '| 0 | 2 | GEN 02–03 |',
    lineA: 'AUTH-01–02; GEN-01.',
    lineB: 'GEN-02, GEN-03.',
    heading,
  });

test('карта: согласованная карта проходит, ID разворачиваются по этапам', () => {
  for (const roadmap of [goodRoadmap(), goodRoadmap('## 11. Карта требований (v1.3)')]) {
    assert.deepEqual(checkMap(roadmap, fakeSpecIds), []);
    const map = parseStageMap(roadmap);
    assert.equal(map.size, 5);
    assert.equal(map.get('AUTH-02'), 'А');
    assert.equal(map.get('GEN-03'), '0');
  }
});

test('карта: нет раздела «Карта требований» — ошибка', () => {
  const errors = checkMap(goodRoadmap('## 11. Сводка'), fakeSpecIds);
  assert.deepEqual(errors, ['карта: нет раздела «Карта требований»']);
});

test('карта: ID в двух этапах и пропущенный ID — ошибки', () => {
  const roadmap = fakeRoadmap({
    rowA: '| А | 3 | AUTH 01; GEN 01–02 |',
    rowB: '| 0 | 1 | GEN 02 |',
    lineA: 'AUTH-01; GEN-01–02.',
    lineB: 'GEN-02.',
  });
  const errors = checkMap(roadmap, fakeSpecIds);
  assert.ok(
    errors.some((e) => e.includes('GEN-02') && /нескольк/.test(e)),
    errors.join('\n'),
  );
  assert.ok(
    errors.some((e) => e.includes('GEN-03')),
    errors.join('\n'),
  );
  assert.ok(
    errors.some((e) => e.includes('AUTH-02')),
    errors.join('\n'),
  );
});

test('карта: неизвестный ID, неверное число и расхождение со строкой этапа — ошибки', () => {
  const roadmap = fakeRoadmap({
    rowA: '| А | 4 | AUTH 01–02; GEN 01 |',
    rowB: '| 0 | 3 | GEN 02–03; MAN 01 |',
    lineA: 'AUTH-01; GEN-01.',
    lineB: 'GEN-02, GEN-03, MAN-01.',
  });
  const errors = checkMap(roadmap, fakeSpecIds);
  assert.ok(
    errors.some((e) => e.includes('MAN-01')),
    errors.join('\n'),
  );
  assert.ok(
    errors.some((e) => e.includes('А') && e.includes('4')),
    errors.join('\n'),
  );
  assert.ok(
    errors.some((e) => e.includes('А') && e.includes('AUTH-02')),
    errors.join('\n'),
  );
});

// Временный git-репозиторий: файлы попадают в индекс, коммит не нужен.
function tempRepo(files, tracked) {
  const dir = tempDir();
  writeFiles(dir, files);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', ...tracked], { cwd: dir });
  return dir;
}
const runIn = (cwd, ...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });

test('скрипт: код возврата 1 на несуществующем ID, 0 после --update-baseline', () => {
  const dir = tempRepo(
    {
      'spec.md': '- **GEN-01.** Первое.\n- **GEN-02.** Второе.\n',
      'apps/api/src/a.ts': '// GEN-01, GEN-99\n',
      'docs/analyst/old.md': 'GEN-98\n',
      'apps/api/drizzle/0000.sql': '-- GEN-97\n',
      'untracked.md': 'GEN-96\n',
    },
    ['spec.md', 'apps', 'docs'],
  );
  const run = (...args) => runIn(dir, '--spec', 'spec.md', ...args);

  const failed = run();
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /apps\/api\/src\/a\.ts:1: GEN-99 нет в спецификации/);
  assert.doesNotMatch(failed.stdout + failed.stderr, /GEN-9[678]/);
  assert.match(failed.stderr.trim().split('\n').at(-1), /^Что делать: .*--update-baseline/);

  const updated = run('--update-baseline');
  assert.equal(updated.status, 0, updated.stdout + updated.stderr);
  const baselinePath = join(dir, 'scripts/requirements-baseline.json');
  const baseline = readFileSync(baselinePath, 'utf8');
  assert.deepEqual(JSON.parse(baseline), { 'apps/api/src/a.ts': { 'GEN-99': 1 } });
  assert.equal(run('--update-baseline').status, 0);
  assert.equal(readFileSync(baselinePath, 'utf8'), baseline);

  const passed = run();
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);

  writeFiles(dir, { 'apps/api/src/a.ts': '// GEN-01, GEN-99\n// GEN-99\n' });
  const added = run();
  assert.equal(added.status, 1, added.stdout + added.stderr);
  assert.match(added.stderr, /apps\/api\/src\/a\.ts:2: GEN-99 .*вхождений 2/);

  writeFiles(dir, { 'apps/api/src/a.ts': '// GEN-01\n' });
  const shrunk = run();
  assert.equal(shrunk.status, 1, shrunk.stdout + shrunk.stderr);
  assert.match(shrunk.stderr, /GEN-99/);
});

test('скрипт: из подкаталога — тот же корень, те же ошибки', () => {
  const dir = tempRepo(
    {
      'docs/analyst/2026-11-11/specification-v1.3.md': '- **GEN-01.** Первое.\n',
      'apps/api/src/a.ts': '// GEN-01\n// GEN-99\n',
    },
    ['docs', 'apps'],
  );
  const fromRoot = runIn(dir);
  const fromSub = runIn(join(dir, 'apps/api'));
  assert.equal(fromRoot.status, 1, fromRoot.stdout + fromRoot.stderr);
  assert.equal(fromSub.status, 1, fromSub.stdout + fromSub.stderr);
  assert.match(fromSub.stderr, /^apps\/api\/src\/a\.ts:2: GEN-99 нет в спецификации$/m);
  assert.equal(fromSub.stderr, fromRoot.stderr);
  assert.equal(fromSub.stdout, fromRoot.stdout);
});

test('скрипт: ни одного файла для проверки — ошибка', () => {
  const dir = tempRepo({ 'spec.md': '- **GEN-01.** Первое.\n', 'other/a.ts': '// GEN-01\n' }, ['spec.md', 'other']);
  const result = runIn(dir, '--spec', 'spec.md');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /ни одного отслеживаемого файла/);
});

test('скрипт: ID определён в спецификации больше одного раза — ошибка', () => {
  const dir = tempRepo({ 'spec.md': '- **GEN-01.** Первое.\n- **GEN-01.** Снова.\n', 'apps/a.ts': '// GEN-01\n' }, [
    'spec.md',
    'apps',
  ]);
  const result = runIn(dir, '--spec', 'spec.md');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /GEN-01 определён больше одного раза/);
});

test('скрипт: нет файла --spec или --map, нет раздела карты — одна строка и код 1', () => {
  const dir = tempRepo({ 'spec.md': '- **GEN-01.** Первое.\n', 'apps/a.ts': '// GEN-01\n', 'plan.md': '# План\n' }, [
    'spec.md',
    'apps',
    'plan.md',
  ]);
  for (const args of [
    ['--spec', 'missing.md'],
    ['--spec', 'spec.md', '--map', 'missing.md'],
  ]) {
    const result = runIn(dir, ...args);
    assert.equal(result.status, 1, args.join(' '));
    assert.equal(result.stderr.trim().split('\n').length, 1, result.stderr);
    assert.match(result.stderr, /^check-requirements: .*missing\.md не прочитан/);
  }
  const noMap = runIn(dir, '--spec', 'spec.md', '--map', 'plan.md');
  assert.equal(noMap.status, 1, noMap.stdout + noMap.stderr);
  assert.match(noMap.stderr, /нет раздела «Карта требований»/);
});

test('скрипт: --report — таблица по ID и ID этапов А и 0 без тестов', () => {
  const roadmap = fakeRoadmap({
    rowA: '| А | 2 | GEN 01–02 |',
    rowB: '| 0 | 2 | AUTH 01–02 |',
    lineA: 'GEN-01–02.',
    lineB: 'AUTH-01, AUTH-02.',
  });
  const dir = tempRepo(
    {
      'spec.md': '- **GEN-01.** А.\n- **GEN-02.** Б.\n- **AUTH-01.** В.\n- **AUTH-02.** Г.\n',
      'plan.md': roadmap,
      'apps/api/test/x.test.ts': "it('вход (GEN-01, AUTH-02)', () => {});\n",
      'apps/api/src/y.ts': '// GEN-02\n',
    },
    ['spec.md', 'plan.md', 'apps'],
  );
  const result = runIn(dir, '--spec', 'spec.md', '--map', 'plan.md', '--report');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^\| GEN-01 \| А \| apps\/api\/test\/x\.test\.ts \|$/m);
  assert.match(result.stdout, /^\| GEN-02 \| А \| — \|$/m);
  assert.match(result.stdout, /^\| AUTH-01 \| 0 \| — \|$/m);
  assert.match(result.stdout, /^Этап А: без единого теста — GEN-02$/m);
  assert.match(result.stdout, /^Этап 0: без единого теста — AUTH-01$/m);
});
