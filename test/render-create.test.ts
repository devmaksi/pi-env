import { test } from 'node:test';
import assert from 'node:assert';
import { render } from '../src/render.js';
import { initialState, freshCreate, type AppState, type Catalog } from '../src/state.js';
import type { Environment } from '../src/environments.js';

const catalog: Catalog = {
  providers: [
    { name: 'cpp', models: [{ id: 'Bonsai-2' }, { id: 'Zed-1' }] },
    { name: 'openai', models: [{ id: 'gpt-4o' }] },
  ],
  tools: [{ name: 'searxng-search.ts', path: '/x/searxng.ts' }],
  packages: [{ source: 'npm:pkg-a', name: 'pkg-a', path: '/p/a', version: '1.2.3', description: 'Тестовый пакет', extensions: ['./index.ts'], skills: [] }],
  skills: [{ name: 'own-skill', path: '/s/own' }],
};

const envs: Environment[] = [
  { name: 'dev', path: '/root/dev', hasSettings: true, hasSkills: true, hasExtensions: false },
];

function createState(over: Partial<AppState['create']> = {}, app: Partial<AppState> = {}): AppState {
  return { ...initialState(catalog), ...app, sub: 'create', create: { ...freshCreate(), ...over } };
}

test('форма создания: все пять пунктов + действие', () => {
  const s = render({ state: createState({ tools: ['searxng-search.ts'], skills: ['own-skill'] }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Имя:'));
  assert.ok(s.includes('Модель:'));
  assert.ok(s.includes('Свои инструменты: 1'));
  assert.ok(s.includes('Расширения: 0'));
  assert.ok(s.includes('Скиллы: 1'));
  assert.ok(s.includes('Создать'));
});

test('форма: курсор на имени, caret в имени', () => {
  const s = render({ state: createState({ name: 'prod', caret: 2 }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Имя: pr▌od'));
  assert.ok(s.includes('> Имя:'));
});

test('форма: выбранная модель показана провайдер/модель', () => {
  const s = render({ state: createState({ provider: 'cpp', model: 'Bonsai-2' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Модель: cpp/Bonsai-2'));
});

test('форма: ошибка валидации видна', () => {
  const s = render({ state: createState({ error: 'Введите имя окружения' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Введите имя окружения'));
});

test('форма: после создания — Готово и сообщение', () => {
  const s = render({ state: createState({ name: 'prod', done: '/root/prod' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Готово'));
  assert.ok(s.includes('Создано: /root/prod'));
});

test('список провайдеров: курсор и отметка выбранного', () => {
  const s = render({ state: createState({ view: 'providers', cursor: 0 }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Провайдер'));
  assert.ok(s.includes('>   cpp'));
  assert.ok(s.includes('openai'));
});

test('список моделей: подзаголовок с провайдером', () => {
  const s = render({ state: createState({ provider: 'cpp', view: 'models', cursor: 1, model: 'Zed-1' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Модель (cpp)'));
  assert.ok(s.includes('Zed-1'));
  assert.ok(s.includes('Bonsai-2'));
});

test('список скиллов: отметка выбранного', () => {
  const s = render({ state: createState({ view: 'skills', cursor: 0, skills: ['own-skill'] }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Скиллы'));
  assert.ok(s.includes('✓ own-skill'));
});

test('пустой список — пометка', () => {
  const s = render({ state: { ...initialState({ ...catalog, packages: [] }), sub: 'create', create: { ...freshCreate(), view: 'packages' } }, envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('— пусто —'));
});

test('submitting — пометка процесса', () => {
  const s = render({ state: createState({ view: 'submitting' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Создание…'));
});

test('узкий режим: форма рендерится одной колонкой', () => {
  const s = render({ state: createState({ name: 'prod', caret: 4 }), envs, width: 40, height: 10, root: '/root', useColor: false, status: null });
  const lines = s.split('\n');
  assert.equal(lines.length, 10);
  assert.ok(lines[1].includes('─'));
  assert.ok(!lines[1].includes('┬'));
  assert.ok(s.includes('Имя: prod▌'));
  assert.ok(s.includes('Создать'));
});

function editState(over: Partial<AppState['create']> = {}): AppState {
  return { ...initialState(catalog), sub: 'create', create: { ...freshCreate(), mode: 'edit' as const, origName: 'dev', name: 'dev', ...over } };
}

test('форма edit: 7 строк — Сохранить и Удалить', () => {
  const s = render({ state: editState(), envs, width: 62, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Сохранить'));
  assert.ok(s.includes('Удалить'));
  assert.ok(!s.includes('Создать'));
});

test('форма create: строки Удалить/Сохранить нет', () => {
  const s = render({ state: createState(), envs, width: 62, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(!s.includes('Удалить'));
  assert.ok(!s.includes('Сохранить'));
  assert.ok(s.includes('Создать'));
});

test('confirm-delete: вопрос и подсказки', () => {
  const s = render({ state: editState({ view: 'confirm-delete' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Удалить окружение «dev»?'));
  assert.ok(s.includes('Enter — подтвердить'));
  assert.ok(s.includes('Esc — отмена'));
});

test('deleting: пометка процесса', () => {
  const s = render({ state: editState({ view: 'deleting' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Удаление…'));
});

test('edit: после сохранения — Обновлено, не Создано', () => {
  const s = render({ state: editState({ done: '/root/dev' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Обновлено: /root/dev'));
  assert.ok(!s.includes('Создано'));
});

test('статус-строка: подсказка E — правка', () => {
  const s = render({ state: initialState(catalog), envs, width: 80, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('E — правка'));
});

test('инфо-панель окружения: подсказка E — редактировать', () => {
  const s = render({ state: initialState(catalog), envs, width: 80, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('E — редактировать'));
});

test('суб-экран запуска больше не рендерится', () => {
  const s = render({ state: { ...initialState(catalog), sub: 'run' as const }, envs, width: 80, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(!s.includes('Запуск окружения'));
});

test('список расширений: ↑ latest у устаревшего', () => {
  const s = render({ state: createState({ view: 'packages' }, { pkgCheck: 'done', pkgLatest: { 'pkg-a': '2.0.0' } }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('↑ 2.0.0'));
});

test('список расширений: · у актуального, … при проверке, ? при ошибке', () => {
  const done = render({ state: createState({ view: 'packages' }, { pkgCheck: 'done', pkgLatest: {} }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(done.includes('·'));
  const checking = render({ state: createState({ view: 'packages' }, { pkgCheck: 'checking' }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(checking.includes('…'));
  const err = render({ state: createState({ view: 'packages' }, { pkgCheck: 'error' }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(err.includes('?'));
});

test('список расширений: строка кнопки, панель справа, легенда X', () => {
  const s = render({ state: createState({ view: 'packages' }), envs, width: 100, height: 14, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Обновить все'));
  assert.ok(s.includes('Источник: npm:pkg-a'));
  assert.ok(s.includes('Версия: 1.2.3'));
  assert.ok(s.includes('Расширений: 1  Скиллов: 0'));
  assert.ok(s.includes('X — удалить'));
});

test('список расширений: панель — описание, отметка «в окружении», статус обновления', () => {
  const s = render({ state: createState({ view: 'packages', packages: ['npm:pkg-a'] }, { pkgCheck: 'done', pkgLatest: { 'pkg-a': '2.0.0' } }), envs, width: 100, height: 14, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Тестовый пакет'));
  assert.ok(s.includes('В окружении: ✓'));
  assert.ok(s.includes('установлена 1.2.3'));
});

test('список расширений: курсор на кнопке — описание действия', () => {
  const s = render({ state: createState({ view: 'packages', cursor: 1 }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('pi update --extensions'));
});

test('список расширений: pinned и локальные маркеры', () => {
  const catalog2: Catalog = {
    ...catalog,
    packages: [
      { source: 'npm:pkg-a@1.2.3', name: 'pkg-a', path: '/p/a', version: '1.2.3', description: null, extensions: [], skills: [] },
      { source: '/local/p', name: 'local-p', path: '/local/p', version: null, description: null, extensions: [], skills: [] },
    ],
  };
  const s = render({ state: { ...initialState(catalog2), sub: 'create', create: { ...freshCreate(), view: 'packages' } }, envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('закреплено'));
  assert.ok(s.includes('локальный'));
});

test('confirm-remove: вопрос и подсказки', () => {
  const s = render({ state: createState({ view: 'confirm-remove', removing: 'pkg-a' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Удалить расширение «pkg-a»?'));
  assert.ok(s.includes('Enter — подтвердить'));
  assert.ok(s.includes('Esc — отмена'));
});

test('removing/updating: пометки процесса', () => {
  const s1 = render({ state: createState({ view: 'removing' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s1.includes('Удаление…'));
  const s2 = render({ state: createState({ view: 'updating' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s2.includes('Обновление…'));
});

test('список расширений: ошибка visible в правой колонке', () => {
  const s = render({ state: createState({ view: 'packages', error: 'нет сети' }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('⚠ нет сети'));
});

test('edit packages: env-only строка с меткой и кнопка «Установить»', () => {
  const s = render({ state: editState({ view: 'packages', packages: ['npm:env-only'], cursor: 1 }), envs, width: 100, height: 14, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('env-only'));
  assert.ok(s.includes('в окружении'));
  assert.ok(s.includes('Обновить все'));
  assert.ok(s.includes('Установить'));
  assert.ok(s.includes('только в этом окружении'));
});

test('create packages: без кнопки «Установить»', () => {
  const s = render({ state: createState({ view: 'packages' }), envs, width: 100, height: 14, root: '/root', useColor: false, status: null });
  assert.ok(!s.includes('Установить'));
});

test('install: список каталога, команда установки, метка процесса', () => {
  const items = [{ name: 'pi-a', types: ['extension'], downloads: 100, description: 'Описание A', author: null }];
  const s = render({ state: editState({ view: 'install', installStatus: 'ready' as const, installCatalog: items }), envs, width: 100, height: 14, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Установка в окружение'));
  assert.ok(s.includes('pi-a'));
  assert.ok(s.includes('pi install npm:pi-a'));
  const busy = render({ state: editState({ view: 'installing', installing: 'pi-a' }), envs, width: 100, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(busy.includes('Установка: pi-a…'));
});
