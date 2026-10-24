import { test } from 'node:test';
import assert from 'node:assert';
import { render } from '../src/render.js';
import { initialState, emptyCatalog, freshTrash, type AppState, type TrashEntry } from '../src/state.js';
import { formatTs } from '../src/trash.js';
import { visibleWidth, wideCount } from '../src/render.js';
import type { Environment } from '../src/environments.js';

const env = (name: string): Environment =>
  ({ name, path: '/root/' + name, details: { hasSettings: true, model: null, tools: [], skills: [], packages: [], mcp: [] } });

const entry = (name: string, ts: number | null): TrashEntry => {
  const dirName = ts === null ? name : `${name}@${ts}`;
  return { dirName, name, ts, path: '/root/.trash/' + dirName };
};

const ENVS = [env('dev'), env('test')];
const ENTRIES = [entry('old', 3000), entry('e1', 2000), entry('no-ts', null)];

/** Видимая ширина кадра: SGR-коды и CUP (дорисовка границ колонок) — не видимые символы. */
function frameWidth(l: string): number {
  return visibleWidth(l.replace(/\x1b\[\d+;\d+H/g, ''));
}

function frame(state: AppState, envs: Environment[], trashEntries: TrashEntry[], width = 80, height = 12): string[] {
  return render({ state, envs, trashEntries, root: '/root', width, height, useColor: false, status: null }).split('\n');
}

/** Список окружений с суб-экраном корзины, открытым на выбранной строке «Корзина». */
const opened = (over: Parameters<typeof freshTrash>[0] = {}): AppState =>
  ({ ...initialState(emptyCatalog()), selected: ENVS.length + 1, trash: freshTrash(over) });

test('список окружений: «Корзина (2)» после «Создать», курсор «Создать» не сдвинут', () => {
  const s = frame({ ...initialState(emptyCatalog()), selected: ENVS.length }, ENVS, ENTRIES.slice(0, 2));
  assert.ok(s.some((l) => l.includes('Корзина (2)')));
  const rows = s.findIndex((l) => l.includes('> Создать'));
  const trash = s.findIndex((l) => l.includes('Корзина (2)'));
  assert.ok(rows >= 0 && trash > rows, 'строка «Корзина» стоит после «Создать»');
});

test('список окружений: пустой — «Создать» на нуле и «Корзина (0)» без разделителя', () => {
  const s = frame({ ...initialState(emptyCatalog()), selected: 0 }, [], []);
  assert.ok(s[2]!.includes('> Создать'));
  assert.ok(s.some((l) => l.includes('Корзина (0)')));
  assert.ok(s[3]!.includes('Корзина (0)'), 'сразу под «Создать» — «Корзина», без строки-разделителя');
});

test('суб-экран корзины: заголовок + строки записей (<имя> · дата), инфо-панель выбранной', () => {
  const s = frame(opened(), ENVS, ENTRIES);
  assert.ok(s.some((l) => l.includes('Корзина')));
  assert.ok(s.some((l) => l.includes('old') && l.includes(formatTs(3000))));
  assert.ok(s.some((l) => l.includes('no-ts')));
  assert.ok(s.some((l) => l.includes('Путь: /root/.trash/old@3000')));
  assert.ok(s.some((l) => l.includes('Enter — восстановить')));
  assert.ok(s.some((l) => l.includes('X — удалить совсем')));
});

test('суб-экран корзины: пусто — «пусто», cursorRow -1, кадр ровно height строк', () => {
  const s = frame(opened(), ENVS, [], 80, 12);
  assert.ok(s.some((l) => l.includes('пусто')));
  assert.equal(s.length, 12);
  // курсорной инверсии нет: ни одна строка не помечена как курсорная
  assert.ok(!s.some((l) => l.includes('> ')));
});

test('суб-экран корзины: confirm — в инфо-панели «Удалить «old» совсем?» + подсказки подтвердить/отмена', () => {
  const s = frame(opened({ confirm: 'old@3000' }), ENVS, ENTRIES);
  assert.ok(s.some((l) => l.includes('Удалить «old» совсем?')));
  assert.ok(s.some((l) => l.includes('Enter — подтвердить')));
  assert.ok(s.some((l) => l.includes('Esc — отмена')));
  assert.ok(s.some((l) => l.includes('no-ts')), 'список записей слева остаётся видимым');
});

test('суб-экран корзины: список длиннее кадра — курсор удерживается на нижней границе (scrollTop)', () => {
  const many = Array.from({ length: 9 }, (_, i) => entry(`e${i}`, 9000 - i * 100));
  const s = frame(opened({ cursor: 8 }), ENVS, many, 80, 8);
  assert.equal(s.length, 8);
  assert.ok(s[5]!.includes('> e8'), 'курсорная строка — последняя видимая строка контента');
  assert.ok(!s.some((l) => l.includes('e0')), 'самая верхняя запись ушла за верх кадра');
});

test('кадр любого суб-экрана корзины — ровно height строк фиксированной ширины', () => {
  for (const entries of [[], ENTRIES, Array.from({ length: 9 }, (_, i) => entry(`e${i}`, i))]) {
    for (const [w, h] of [[62, 10], [80, 12], [100, 16]] as const) {
      const s = frame(opened(), ENVS, entries, w, h);
      assert.equal(s.length, h, `rows ${entries.length} @ ${w}x${h}`);
      for (const l of s) assert.equal(frameWidth(l) + wideCount(l), w, `клеток на строке @ ${w}x${h}: ${JSON.stringify(l)}`);
    }
  }
});

test('суб-экран корзины: метка записи — «<имя> · <дата>» (тот же разделитель, что и в модуле корзины)', () => {
  const s = frame(opened(), ENVS, ENTRIES);
  assert.ok(s.some((l) => l.includes('old · ' + formatTs(3000))), JSON.stringify(s[3]));
});
