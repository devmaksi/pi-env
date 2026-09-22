import { test } from 'node:test';
import assert from 'node:assert';
import { render } from '../src/render.js';
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

test('выбранный пункт подсвечивается цветом', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, root: '/root', useColor: true, status: null });
  assert.ok(s.includes('\x1b[7m'));
});

test('статус-строка показывает ошибку', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, root: '/root', useColor: false, status: 'Окружения не найдены в /root' });
  assert.ok(s.includes('Окружения не найдены в /root'));
});
