import { test } from 'node:test';
import assert from 'node:assert';
import { render } from '../src/render.js';
import { computeLayout } from '../src/layout.js';
import { initialState } from '../src/state.js';
import { Environment } from '../src/environments.js';

const envs: Environment[] = [
  { name: 'dev', path: '/root/dev', hasSettings: true, hasSkills: true, hasExtensions: false },
  { name: 'prod', path: '/root/prod', hasSettings: false, hasSkills: false, hasExtensions: false },
];

const base = { root: '/root', useColor: false, status: null };

test('слишком малый терминал — предупреждение', () => {
  const s = render({ state: initialState(), envs, width: 20, height: 4, ...base });
  assert.equal(s, 'Терминал слишком мал');
});

test('широкий режим: рамка, таб-бар, разделитель', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, ...base });
  const lines = s.split('\n');
  assert.equal(lines.length, 10);
  for (const line of lines) assert.equal(line.length, 62);
  assert.ok(lines[0].includes('Окружения'));
  assert.ok(lines[0].includes('Настройки'));
  assert.ok(lines[0].includes('О программе'));
  assert.ok(lines[1].includes('┬'));
});

test('широкий режим: список, курсор, инфо-панель', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('> dev'));
  assert.ok(s.includes('  prod'));
  assert.ok(s.includes('Создать'));
  assert.ok(s.includes('Путь: /root/dev'));
  assert.ok(s.includes('settings.json ✓'));
  assert.ok(s.includes('Детализация — этап 2'));
});

test('узкий режим: нет правого столбца', () => {
  const s = render({ state: initialState(), envs, width: 40, height: 10, ...base });
  const lines = s.split('\n');
  assert.equal(lines.length, 10);
  assert.ok(!lines[1].includes('┬'));
  assert.ok(!s.includes('Путь:'));
  assert.ok(s.includes('> dev'));
});

test('суб-экран запуска', () => {
  const s = render({ state: { ...initialState(), sub: 'run' }, envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('Запуск окружения dev — этап 2'));
  assert.ok(s.includes('Esc — назад'));
});

test('вкладка настроек: каталог и toggle', () => {
  const s = render({ state: { ...initialState(), tab: 'settings', selected: 1 }, envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('Корневой каталог: /root'));
  assert.ok(s.includes('Цветной вывод: [x]'));
  assert.ok(s.includes('Подробные настройки — этап 2'));
});

test('без цвета: активная вкладка помечается [..]', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, ...base });
  const tabLine = s.split('\n')[0];
  assert.ok(tabLine.includes('[Окружения]'));
  assert.ok(tabLine.includes('Настройки'));
  assert.ok(!s.includes('\x1b'));
});

test('без цвета: выбранный пункт настроек помечается >', () => {
  const s = render({ state: { ...initialState(), tab: 'settings', selected: 1 }, envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('> Цветной вывод'));
  assert.ok(!s.includes('> Корневой каталог'));
});

test('выбранный пункт подсвечивается цветом', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, root: '/root', useColor: true, status: null });
  assert.ok(s.includes('\x1b[7m'));
});

test('статус-строка показывает ошибку', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, root: '/root', useColor: false, status: 'Окружения не найдены в /root' });
  assert.ok(s.includes('Окружения не найдены в /root'));
});

// Каждый \x1b в строке должен начинать полную CSI-последовательность
function assertNoDanglingAnsi(line: string): void {
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '\x1b') {
      i++;
      continue;
    }
    const m = /^\x1b\[[0-9;]*[a-zA-Z]/.exec(line.slice(i));
    assert.ok(m, `обрыв ANSI-последовательности: ${JSON.stringify(line)}`);
    i += m[0].length;
  }
}

test('узкий цветной вывод: ANSI не обрывается, рамка цела', () => {
  const s = render({ state: initialState(), envs, width: 30, height: 8, root: '/root', useColor: true, status: null });
  const lines = s.split('\n');
  assert.equal(lines.length, 8);
  for (const line of lines) {
    assertNoDanglingAnsi(line);
    // видимая ширина каждой строки равна ширине кадра
    assert.equal(line.replace(/\x1b\[[0-9;]*m/g, '').length, 30);
  }
});

// Позиция символа по видимому индексу (ANSI-последовательности не учитываются)
function visibleIndex(line: string, v: number): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*[a-zA-Z]/.exec(line.slice(i));
      if (m) {
        i += m[0].length - 1;
        continue;
      }
    }
    count++;
    if (count === v) return i;
  }
  return -1;
}

test('средняя граница подсвечивается при фокусе правой колонки', () => {
  const L = computeLayout({ width: 80, height: 10 });
  const s = render({ state: { ...initialState(), focus: 'right' }, envs, width: 80, height: 10, root: '/root', useColor: true, status: null });
  const line = s.split('\n').find((l) => l.includes('> dev'));
  assert.ok(line);
  const mid = visibleIndex(line, 2 + L.leftWidth); // видимая позиция средней границы (левая граница + левая колонка)
  assert.equal(line[mid], '│');
  assert.equal(line.slice(mid - 4, mid), '\x1b[1m');
});

test('вкладка «О программе» в широком режиме не делится на две колонки', () => {
  const s = render({ state: { ...initialState(), tab: 'about' }, envs, width: 62, height: 10, ...base });
  const lines = s.split('\n');
  assert.equal(lines.length, 10);
  assert.ok(!lines[1].includes('┬')); // разделитель не делит экран пополам
  const strip = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, '');
  for (let i = 2; i < lines.length - 2; i++) {
    // ровно две границы: средней перегородки нет
    assert.equal(strip(lines[i]).split('│').length - 1, 2);
  }
  // строка не обрезана на половине ширины
  assert.ok(s.includes('CLI для управления окружениями pi'));
});
