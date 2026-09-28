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
  packages: [{ source: 'npm:pkg-a', name: 'pkg-a', path: '/p/a', extensions: ['./index.ts'], skills: [] }],
  skills: [{ name: 'own-skill', path: '/s/own' }],
};

const envs: Environment[] = [
  { name: 'dev', path: '/root/dev', hasSettings: true, hasSkills: true, hasExtensions: false },
];

function createState(over: Partial<AppState['create']> = {}): AppState {
  return { ...initialState(catalog), sub: 'create', create: { ...freshCreate(), ...over } };
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
