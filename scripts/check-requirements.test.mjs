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
  parseSpecIds,
  parseStageMap,
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

test('строка и номер строки у каждой ссылки', () => {
  assert.deepEqual(expandReferences('// GEN-08\n\n/* OPR-31…32 */'), [
    { id: 'GEN-08', line: 1 },
    { id: 'OPR-31', line: 3 },
    { id: 'OPR-32', line: 3 },
  ]);
});

test('идентификаторы решений и чужие префиксы не считаются требованиями', () => {
  assert.deepEqual(ids('D-51'), []);
  assert.deepEqual(ids('ISO-9001'), []);
  assert.deepEqual(ids('UTF-8'), []);
  assert.deepEqual(ids('tier-2'), []);
  assert.deepEqual(ids('ADR-06, MPL-2.0, SHA-256, 2026-11-11, px-4, @imbc/contracts'), []);
  assert.deepEqual(ids('GEN-012, XGEN-01, gen-01, my_GEN-01'), []);
  assert.deepEqual(ids('GEN-08 — 12 часов'), ['GEN-08']);
});

test('несуществующий ID вне базового списка — ошибка с файлом и строкой', () => {
  const dir = tempDir();
  writeFiles(dir, { 'apps/api/test/example.test.ts': '// GEN-01\nconst x = 1;\n// GEN-99\n' });
  const refs = collectReferences(dir, ['apps/api/test/example.test.ts']);
  const { errors, unknown } = checkReferences(refs, new Set(['GEN-01']), {});
  assert.equal(errors.length, 1);
  assert.match(errors[0], /apps\/api\/test\/example\.test\.ts:3/);
  assert.match(errors[0], /GEN-99/);
  assert.deepEqual(unknown, { 'apps/api/test/example.test.ts': ['GEN-99'] });

  const withBaseline = checkReferences(refs, new Set(['GEN-01']), { 'apps/api/test/example.test.ts': ['GEN-99'] });
  assert.deepEqual(withBaseline.errors, []);
});

test('запись базового списка без ссылки в файле — ошибка', () => {
  const dir = tempDir();
  writeFiles(dir, { 'README.md': 'GEN-01\n' });
  const refs = collectReferences(dir, ['README.md']);
  const { errors } = checkReferences(refs, new Set(['GEN-01']), {
    'README.md': ['GEN-01', 'MAN-96'],
    'apps/gone.ts': ['OPR-80'],
  });
  assert.equal(errors.length, 3);
  assert.ok(errors.some((e) => e.includes('README.md') && e.includes('GEN-01')));
  assert.ok(errors.some((e) => e.includes('README.md') && e.includes('MAN-96')));
  assert.ok(errors.some((e) => e.includes('apps/gone.ts') && e.includes('OPR-80')));
});

const fakeSpecIds = ['GEN-01', 'GEN-02', 'GEN-03', 'AUTH-01', 'AUTH-02'];
function fakeRoadmap({ rowA, rowB, lineA, lineB }) {
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
    '## 11. Карта требований',
    '',
    '| Этап | Кол-во | Требования |',
    '|---|---|---|',
    rowA,
    rowB,
    '',
  ].join('\n');
}

test('карта: согласованная карта проходит, ID разворачиваются по этапам', () => {
  const roadmap = fakeRoadmap({
    rowA: '| А | 3 | AUTH 01–02; GEN 01 |',
    rowB: '| 0 | 2 | GEN 02–03 |',
    lineA: 'AUTH-01–02; GEN-01.',
    lineB: 'GEN-02, GEN-03.',
  });
  assert.deepEqual(checkMap(roadmap, fakeSpecIds), []);
  const map = parseStageMap(roadmap);
  assert.equal(map.size, 5);
  assert.equal(map.get('AUTH-02'), 'А');
  assert.equal(map.get('GEN-03'), '0');
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
    errors.some((e) => e.includes('GEN-02') && /двух|нескольк/.test(e)),
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

test('скрипт: код возврата 1 на несуществующем ID, 0 после --update-baseline', () => {
  const dir = tempDir();
  writeFiles(dir, {
    'spec.md': '- **GEN-01.** Первое.\n- **GEN-02.** Второе.\n',
    'apps/api/src/a.ts': '// GEN-01, GEN-99\n',
    'docs/analyst/old.md': 'GEN-98\n',
    'apps/api/drizzle/0000.sql': '-- GEN-97\n',
    'untracked.md': 'GEN-96\n',
  });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', 'spec.md', 'apps', 'docs'], { cwd: dir });
  const run = (...args) =>
    spawnSync(process.execPath, [script, '--spec', 'spec.md', ...args], { cwd: dir, encoding: 'utf8' });

  const failed = run();
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stdout + failed.stderr, /apps\/api\/src\/a\.ts:1.*GEN-99/);
  assert.doesNotMatch(failed.stdout + failed.stderr, /GEN-9[678]/);

  const updated = run('--update-baseline');
  assert.equal(updated.status, 0, updated.stdout + updated.stderr);
  const baselinePath = join(dir, 'scripts/requirements-baseline.json');
  const baseline = readFileSync(baselinePath, 'utf8');
  assert.deepEqual(JSON.parse(baseline), { 'apps/api/src/a.ts': ['GEN-99'] });
  assert.equal(run('--update-baseline').status, 0);
  assert.equal(readFileSync(baselinePath, 'utf8'), baseline);

  const passed = run();
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);

  writeFiles(dir, { 'apps/api/src/a.ts': '// GEN-01\n' });
  const shrunk = run();
  assert.equal(shrunk.status, 1, shrunk.stdout + shrunk.stderr);
  assert.match(shrunk.stdout + shrunk.stderr, /GEN-99/);
});

test('базовый список: короткий список ID в строку, длинный — по ID на строку, как у Prettier', () => {
  const long = Array.from({ length: 20 }, (_, i) => `MAN-${String(i + 47).padStart(2, '0')}`);
  const text = formatBaseline({ 'README.md': long, 'apps/a.ts': ['NFR-32', 'NFR-43'] });
  assert.equal(
    text,
    `{\n  "README.md": [\n${long.map((id) => `    "${id}"`).join(',\n')}\n  ],\n  "apps/a.ts": ["NFR-32", "NFR-43"]\n}\n`,
  );
  assert.deepEqual(JSON.parse(text), { 'README.md': long, 'apps/a.ts': ['NFR-32', 'NFR-43'] });
  assert.equal(formatBaseline({}), '{}\n');
});
