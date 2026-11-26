import { test } from 'node:test';
import assert from 'node:assert';
import { render, visibleWidth } from '../src/render.js';
import { computeLayout } from '../src/layout.js';
import { initialState } from '../src/state.js';
import { type Environment } from '../src/environments.js';
import { t } from '../src/i18n.js';

// Симуляция терминала из test/render.test.ts: где на кадре стоит последний символ
// и все box-drawing «│», с учётом CUP (\x1b[<row>;<col>H).
const WIDE = ['↑', '↓', '←', '→', '—', '…', '✓', '⚠', '▌', '＋'];
const wide = (ch: string): number => (WIDE.includes(ch) ? 2 : 1);

function walk(line: string, cells: (ch: string) => number, width: number, onChar: (ch: string, col: number) => void): void {
  let col = 1;
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*[a-zA-Z]/.exec(line.slice(i));
      if (m) {
        if (m[0].endsWith('H')) col = Number(m[0].slice(2, -1).split(';')[1] ?? 1);
        i += m[0].length;
        continue;
      }
    }
    if (col > width) col = 1;
    onChar(line[i], col);
    col += cells(line[i]);
    i++;
  }
}

function lastCol(line: string, cells: (ch: string) => number, width: number): number {
  let last = 0;
  walk(line, cells, width, (ch, col) => {
    last = col;
  });
  return last;
}

function borderCols(line: string, cells: (ch: string) => number, width: number): number[] {
  const cols: number[] = [];
  walk(line, cells, width, (ch, col) => {
    if (ch === '│') cols.push(col);
  });
  return cols;
}

const details = (over: Partial<Environment['details']> = {}): Environment['details'] => ({
  hasSettings: true,
  model: null,
  tools: [],
  skills: [],
  packages: [],
  mcp: [],
  settingsError: null,
  mcpError: null,
  mcpSkipped: [],
  modelsLink: 'off' as const,
  rootLinks: { npm: 'off' as const, git: 'off' as const },
  missingPackages: [] as string[],
  ...over,
});

const plain: Environment = { name: 'plain', path: '/root/plain', details: details() };
const brokenSettings: Environment = { name: 'broken', path: '/root/broken', details: details({ settingsError: 'битый JSON' }) };
const brokenMcp: Environment = { name: 'mcpbad', path: '/root/mcpbad', details: details({ mcpError: 'не парсится', mcpSkipped: ['beta'] }) };

const base = { root: '/root', useColor: false, status: null };
const st = { ...initialState(), tab: 'envs' as const, selected: 0 };

test('битый settings.json — ⚠ у имени в списке и текст проблемы в инфо-панели', () => {
  const s = render({ state: st, envs: [brokenSettings], width: 80, height: 16, ...base });
  assert.ok(s.includes('broken ⚠'), s);
  assert.ok(s.includes('settings.json ⚠'), s);
  assert.ok(s.includes(t('ru', 'envs.problem.settings', { v: 'битый JSON' })), s);
});

test('битый mcp.json и битая запись — ⚠ и обе строки проблемы', () => {
  const s = render({ state: st, envs: [brokenMcp], width: 80, height: 16, ...base });
  assert.ok(s.includes('mcpbad ⚠'), s);
  assert.ok(s.includes(t('ru', 'envs.problem.mcp', { v: 'не парсится' })), s);
  assert.ok(s.includes(t('ru', 'envs.problem.mcp-skipped', { v: 'beta' })), s);
});

test('окружение без проблем — ни маркера, ни строк проблемы', () => {
  const s = render({ state: st, envs: [plain], width: 80, height: 16, ...base });
  assert.ok(s.includes('settings.json ✓'), s);
  assert.equal(s.includes('⚠'), false, s);
});

test('маркер не переносит список: ⚠ только у проблемного окружения', () => {
  const s = render({ state: st, envs: [brokenSettings, plain], width: 80, height: 16, ...base });
  const rows = s.split('\n').filter((l) => l.includes('plain'));
  assert.ok(rows.every((l) => !l.includes('plain ⚠')), JSON.stringify(rows));
});

test('кадр с ⚠: ровно height строк и не шире width (1- и 2-клеточный терминал)', () => {
  for (const width of [40, 62, 80]) {
    const height = 16;
    const s = render({ state: st, envs: [brokenSettings, brokenMcp], width, height, ...base });
    const lines = s.split('\n');
    assert.equal(lines.length, height, `width=${width}`);
    for (const line of lines) {
      assert.equal(lastCol(line, () => 1, width), width, `1-клеточный w=${width}: ${JSON.stringify(line)}`);
      assert.equal(lastCol(line, wide, width), width, `2-клеточный w=${width}: ${JSON.stringify(line)}`);
      assert.equal(visibleWidth(line) <= width, true, `видимая ширина w=${width}: ${JSON.stringify(line)}`);
    }
  }
});

test('кадр с ⚠: средняя граница на колонке leftWidth+2 на обеих моделях терминала', () => {
  for (const width of [62, 80]) {
    const L = computeLayout({ width, height: 20 });
    const mid = L.leftWidth + 2;
    const s = render({ state: st, envs: [brokenSettings], width, height: 20, ...base });
    const lines = s.split('\n');
    for (let i = 2; i < 20 - 2; i++) {
      assert.equal(borderCols(lines[i], () => 1, width)[1], mid, `1-клеточный w=${width} r=${i}: ${JSON.stringify(lines[i])}`);
      assert.equal(borderCols(lines[i], wide, width)[1], mid, `2-клеточный w=${width} r=${i}: ${JSON.stringify(lines[i])}`);
    }
  }
});


const linkedEnv: Environment = { name: 'shared', path: '/root/shared', details: details({ modelsLink: 'linked' }) };
const brokenLink: Environment = { name: 'cut', path: '/root/cut', details: details({ modelsLink: 'broken' }) };

test('окружение из хранилища — строка о каталоге моделей и без маркера ⚠', () => {
  const s = render({ state: st, envs: [linkedEnv], width: 100, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'envs.models', { v: t('ru', 'envs.models-store') })), s);
  assert.ok(!s.includes('shared ⚠'), s);
});

test('связь с хранилищем потеряна — ⚠ у имени и текст проблемы', () => {
  const s = render({ state: st, envs: [brokenLink], width: 100, height: 20, ...base });
  assert.ok(s.includes('cut ⚠'), s);
  assert.ok(s.includes(t('ru', 'envs.problem.models')), s);
  assert.ok(!s.includes(t('ru', 'envs.models', { v: t('ru', 'envs.models-store') })), s);
});

test('свои каталоги моделей не показываются отдельной строкой', () => {
  const s = render({ state: st, envs: [plain], width: 100, height: 20, ...base });
  assert.ok(!s.includes(t('ru', 'envs.models', { v: t('ru', 'envs.models-store') })), s);
});
const brokenPackages: Environment = {
  name: 'nopkgs',
  path: '/root/nopkgs',
  details: details({ rootLinks: { npm: 'broken', git: 'off' } }),
};
const missingPackageEnv: Environment = {
  name: 'stale',
  path: '/root/stale',
  details: details({ rootLinks: { npm: 'linked', git: 'linked' }, missingPackages: ['pi-zentui'] }),
};

test('битая связь пакетного корня — ⚠ у имени и текст проблемы', () => {
  const s = render({ state: st, envs: [brokenPackages], width: 100, height: 20, ...base });
  assert.ok(s.includes('nopkgs ⚠'), s);
  assert.ok(s.includes(t('ru', 'envs.problem.store', { v: 'npm' })), s);
});

test('пакета нет в реестре хранилища — ⚠ и список имён', () => {
  const s = render({ state: st, envs: [missingPackageEnv], width: 100, height: 20, ...base });
  assert.ok(s.includes('stale ⚠'), s);
  assert.ok(s.includes(t('ru', 'envs.problem.missing', { v: 'pi-zentui' })), s);
});

test('инфо-панель окружения: подсказка «C — создать копию»', () => {
  const s = render({ state: st, envs: [plain], width: 100, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'envs.hint.clone')), s);
});

const mainOutside: Environment = { name: 'agent', path: '/elsewhere/agent', main: true, details: details({ model: 'p/m' }) };
const mainInside: Environment = { name: 'dev', path: '/root/dev', main: true, details: details() };

test('основная запись вне корня — в списке ярлык, а не имя каталога', () => {
  const s = render({ state: st, envs: [mainOutside, plain], width: 80, height: 16, ...base });
  assert.ok(s.includes(t('ru', 'envs.main')), s);
  assert.equal(s.includes(' agent'), false, s); // имя каталога в списке не показывается
});

test('основная запись внутри корня — своё имя и пометка «основной»', () => {
  const s = render({ state: st, envs: [mainInside], width: 80, height: 16, ...base });
  assert.ok(s.includes(`dev · ${t('ru', 'envs.row-main')}`), s);
});

test('инфо-панель основной записи — строка о том, что это основной агент', () => {
  const s = render({ state: st, envs: [mainOutside], width: 100, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'envs.main-note')), s);
  assert.ok(s.includes('/elsewhere/agent'), s);
});

test('кадр с основной записью: ровно height строк и не шире width (1- и 2-клеточный терминал)', () => {
  for (const width of [40, 62, 80]) {
    const height = 16;
    const s = render({ state: { ...st, selected: 0 }, envs: [mainOutside, mainInside], width, height, ...base });
    const lines = s.split('\n');
    assert.equal(lines.length, height, `width=${width}`);
    for (const line of lines) {
      assert.equal(lastCol(line, () => 1, width), width, `1-клеточный w=${width}: ${JSON.stringify(line)}`);
      assert.equal(lastCol(line, wide, width), width, `2-клеточный w=${width}: ${JSON.stringify(line)}`);
      assert.equal(visibleWidth(line) <= width, true, `видимая ширина w=${width}: ${JSON.stringify(line)}`);
    }
  }
});

test('кадр с основной записью: средняя граница на колонке leftWidth+2 на обеих моделях терминала', () => {
  for (const width of [62, 80]) {
    const L = computeLayout({ width, height: 20 });
    const mid = L.leftWidth + 2;
    const s = render({ state: { ...st, selected: 0 }, envs: [mainOutside], width, height: 20, ...base });
    const lines = s.split('\n');
    for (let i = 2; i < 20 - 2; i++) {
      assert.equal(borderCols(lines[i], () => 1, width)[1], mid, `1-клеточный w=${width} r=${i}: ${JSON.stringify(lines[i])}`);
      assert.equal(borderCols(lines[i], wide, width)[1], mid, `2-клеточный w=${width} r=${i}: ${JSON.stringify(lines[i])}`);
    }
  }
});

const linkedRoots: Environment = {
  name: 'sharedpkgs',
  path: '/root/sharedpkgs',
  details: details({ rootLinks: { npm: 'linked', git: 'linked' }, modelsLink: 'linked' }),
};

test('инфо-панель: каталог пакетов из хранилища', () => {
  const s = render({ state: st, envs: [linkedRoots], width: 100, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'envs.pkgs', { v: t('ru', 'envs.pkgs-store') })), s);
});

test('инфо-панель: свои пакетные корни строки не показывают', () => {
  const s = render({ state: st, envs: [plain], width: 100, height: 20, ...base });
  assert.equal(s.includes(t('ru', 'envs.pkgs', { v: t('ru', 'envs.pkgs-store') })), false, s);
});
