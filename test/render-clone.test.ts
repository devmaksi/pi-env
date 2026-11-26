import { test } from 'node:test';
import assert from 'node:assert';
import { render, visibleWidth } from '../src/render.js';
import { computeLayout } from '../src/layout.js';
import { initialState, freshClone, type AppState } from '../src/state.js';
import { type Environment } from '../src/environments.js';
import { t } from '../src/i18n.js';

const WIDE = ['↑', '↓', '←', '→', '—', '…', '✓', '⚠', '▌', '＋'];
const wide = (ch: string): number => (WIDE.includes(ch) ? 2 : 1);

/** Обход кадра с учётом ANSI и CUP: кол-во клеток и колонки рамок. */
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
  model: 'anthropic → opus',
  tools: ['extensions/a.ts'],
  skills: ['skills/one'],
  packages: ['npm:pi-x'],
  mcp: ['srv'],
  settingsError: null,
  mcpError: null,
  mcpSkipped: [],
  modelsLink: 'off',
  rootLinks: { npm: 'off', git: 'off' },
  missingPackages: [],
  ...over,
});

const dev: Environment = { name: 'dev', path: '/root/dev', details: details() };
const test1: Environment = { name: 'test', path: '/root/test', details: details() };
const ENVS = [dev, test1];

/** Суб-экран клонирования окружения «dev». */
const opened = (over: Partial<NonNullable<AppState['clone']>> = {}): AppState => ({
  ...initialState(),
  clone: { ...freshClone('dev', 'ru'), ...over },
});

const base = { root: '/root', status: null };
const frame = (state: AppState, envs: Environment[], width: number, height: number, useColor = false): string[] =>
  render({ state, envs, width, height, useColor, ...base }).split('\n');

test('суб-экран клонирования: заголовок, источник и поле имени с кареткой', () => {
  const f = frame(opened({ name: 'dev-copy', caret: 3 }), ENVS, 80, 16);
  assert.ok(f.some((l) => l.includes(t('ru', 'clone.title'))), f.join('\n'));
  assert.ok(f.some((l) => l.includes(t('ru', 'clone.from', { name: 'dev' }))), f.join('\n'));
  assert.ok(f.some((l) => l.includes('dev▌-copy')), f.join('\n'));
  // это суб-экран, а не список окружений: строк списка нет
  assert.ok(!f.some((l) => l.includes(t('ru', 'form.create'))), f.join('\n'));
});

test('суб-экран клонирования: инфо-панель источника (путь, settings, модель, списки)', () => {
  const s = frame(opened(), ENVS, 100, 20).join('\n');
  assert.ok(s.includes('/root/dev'), s);
  assert.ok(s.includes('settings.json ✓'), s);
  assert.ok(s.includes('anthropic → opus'), s);
  assert.ok(s.includes('skills/one'), s);
  assert.ok(s.includes('pi-x'), s); // как в детализации окружения: префикс npm| в списке снят
  assert.ok(s.includes('srv'), s);
});

test('суб-экран клонирования: подсказки Enter/Esc и проблема конфига источника', () => {
  const s = frame(opened(), ENVS, 100, 20).join('\n');
  assert.ok(s.includes(t('ru', 'clone.hint.enter')), s);
  assert.ok(s.includes(t('ru', 'hint.cancel')), s);
  assert.ok(s.includes(t('ru', 'clone.info')), s);
  const bad = frame(opened(), [{ ...dev, details: details({ settingsError: 'битый JSON' }) }], 100, 20).join('\n');
  assert.ok(bad.includes(t('ru', 'envs.problem.settings', { v: 'битый JSON' })), bad);
});

test('суб-экран клонирования в момент копирования: подсказка Enter заменена на «Копирование…»', () => {
  const s = frame(opened({ pending: true }), ENVS, 100, 20).join('\n');
  assert.ok(s.includes(t('ru', 'clone.copying')), s);
  assert.ok(!s.includes(t('ru', 'clone.hint.enter')), s);
});

test('суб-экран клонирования: ошибка имени попадает в кадр', () => {
  const s = frame(opened({ error: 'Окружение с таким именем уже есть' }), ENVS, 100, 16).join('\n');
  assert.ok(s.includes('⚠'), s);
  assert.ok(s.includes('Окружение с таким именем уже есть'), s);
});

test('суб-экран клонирования: источник исчез из снимка — кадр всё равно полный', () => {
  const lines = frame(opened(), [], 80, 16);
  assert.equal(lines.length, 16);
  for (const line of lines) {
    assert.equal(lastCol(line, wide, 80), 80, JSON.stringify(line));
    assert.equal(visibleWidth(line) <= 80, true, JSON.stringify(line));
  }
});

test('кадр суб-экрана: ровно height строк, последний символ на колонке width (1- и 2-клеточный терминал)', () => {
  for (const width of [62, 80, 100]) {
    for (const useColor of [false, true]) {
      const lines = frame(opened({ error: 'Имя: только латинские буквы, цифры, «_» и «-»' }), ENVS, width, 16, useColor);
      assert.equal(lines.length, 16, `width=${width} color=${useColor}`);
      for (const line of lines) {
        assert.equal(lastCol(line, () => 1, width), width, `1-клеточный w=${width}: ${JSON.stringify(line)}`);
        assert.equal(lastCol(line, wide, width), width, `2-клеточный w=${width}: ${JSON.stringify(line)}`);
        assert.equal(visibleWidth(line) <= width, true, `видимая ширина w=${width}: ${JSON.stringify(line)}`);
      }
    }
  }
});

test('кадр суб-экрана: средняя граница на колонке leftWidth+2 на обеих моделях терминала', () => {
  for (const width of [62, 80]) {
    const L = computeLayout({ width, height: 20 });
    const mid = L.leftWidth + 2;
    const lines = frame(opened(), ENVS, width, 20);
    for (let i = 2; i < 20 - 2; i++) {
      assert.equal(borderCols(lines[i], () => 1, width)[1], mid, `1-клеточный w=${width} r=${i}: ${JSON.stringify(lines[i])}`);
      assert.equal(borderCols(lines[i], wide, width)[1], mid, `2-клеточный w=${width} r=${i}: ${JSON.stringify(lines[i])}`);
    }
  }
});
