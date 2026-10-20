import { test } from 'node:test';
import assert from 'node:assert';
import { initialState, reducer, listLength, emptyCatalog, freshCreate, type AppState, type ReducerCtx, type Catalog, type CatalogPkg, type ExtState } from '../src/state.js';

/** Контекст reducer: имена окружений + раскладка. */
const rc = (names: string[], two = true): ReducerCtx => ({ envNames: names, twoColumns: two });

const envs = (n: number) => Array.from({ length: n }, (_, i) => `env${i}`);

test('initialState', () => {
  assert.deepEqual(initialState(), {
    tab: 'envs', focus: 'left', selected: 0, sub: null, colorToggle: true, recheckUpdates: false, quit: false, language: 'ru',
    catalog: emptyCatalog(), create: null, ext: null, mcp: null, catalogProgress: null, pkgCheck: 'idle', pkgLatest: {},
  });
});

test('listLength', () => {
  assert.equal(listLength('envs', 3), 4);
  assert.equal(listLength('extensions', 0, 3), 5);
  assert.equal(listLength('extensions', 0), 2);
  assert.equal(listLength('settings', 0), 4);
  assert.equal(listLength('about', 5), 0);
});

test('TAB циклически переключает вкладки и сбрасывает состояние', () => {
  let s = { ...initialState(), selected: 2, sub: 'create' };
  s = reducer(s, 'tab', rc(envs(3)));
  assert.equal(s.tab, 'extensions');
  assert.equal(s.selected, 0);
  assert.equal(s.sub, null);
  s = reducer(s, 'tab', rc(envs(3)));
  assert.equal(s.tab, 'mcp');
  s = reducer(s, 'tab', rc(envs(3)));
  assert.equal(s.tab, 'settings');
  s = reducer(s, 'tab', rc(envs(3)));
  assert.equal(s.tab, 'about');
  s = reducer(s, 'tab', rc(envs(3)));
  assert.equal(s.tab, 'envs');
});

test('↑↓ клампируются на границах списка', () => {
  let s = initialState();
  s = reducer(s, 'up', rc(envs(2)));
  assert.equal(s.selected, 0);
  s = reducer(s, 'down', rc(envs(2)));
  assert.equal(s.selected, 1);
  s = reducer(s, 'down', rc(envs(2)));
  assert.equal(s.selected, 2);
  s = reducer(s, 'down', rc(envs(2)));
  assert.equal(s.selected, 2);
  s = reducer(s, 'up', rc(envs(2)));
  assert.equal(s.selected, 1);
});

test('Enter: окружение → run, последний пункт → create', () => {
  assert.equal(reducer(initialState(), 'enter', rc(envs(2))).sub, 'run');
  const s = reducer({ ...initialState(), selected: 2 }, 'enter', rc(envs(2)));
  assert.equal(s.sub, 'create');
  assert.ok(s.create !== null && s.create.view === 'form');
});

test('Enter внутри run-суб-экрана игнорируется', () => {
  const s = { ...initialState(), sub: 'run' as const };
  assert.deepEqual(reducer(s, 'enter', rc(envs(2))), s);
});

test('ESC: назад из суб-экрана, выход на верхнем уровне', () => {
  assert.equal(reducer({ ...initialState(), sub: 'run' }, 'esc', rc(envs(2))).sub, null);
  assert.equal(reducer(initialState(), 'esc', rc(envs(2))).quit, true);
});

test('Space: toggle на пунктах 1 и 2 вкладки settings', () => {
  let s = { ...initialState(), tab: 'settings' as const, selected: 1 };
  s = reducer(s, 'space', rc(envs(0)));
  assert.equal(s.colorToggle, false);
  s = reducer(s, 'space', rc(envs(0)));
  assert.equal(s.colorToggle, true);
  const s2 = { ...initialState(), tab: 'settings' as const, selected: 2 };
  assert.equal(reducer(s2, 'space', rc(envs(0))).recheckUpdates, true);
  const s0 = { ...initialState(), tab: 'settings' as const, selected: 0 };
  assert.deepEqual(reducer(s0, 'space', rc(envs(0))), s0);
});

test('←→: смена фокуса только envs + широкий режим + без суб-экрана', () => {
  let s = reducer(initialState(), 'right', rc(envs(2)));
  assert.equal(s.focus, 'right');
  s = reducer(s, 'left', rc(envs(2)));
  assert.equal(s.focus, 'left');
  assert.deepEqual(reducer(initialState(), 'right', rc(envs(2), false)), initialState());
  const settings = { ...initialState(), tab: 'settings' as const };
  assert.deepEqual(reducer(settings, 'right', rc(envs(2))), settings);
});

test('Ctrl+C — выход', () => {
  assert.equal(reducer(initialState(), 'ctrlc', rc(envs(2))).quit, true);
});

const catalog2 = {
  providers: [{ name: 'cpp', models: [{ id: 'Bonsai-2' }] }],
  tools: [{ name: 'searxng.ts', path: '/a/extensions/searxng.ts' }],
  packages: [{ source: 'npm:pkg-a', name: 'pkg-a', path: '/p/a', version: '1.0.0', description: null, extensions: [], skills: [] }],
  skills: [
    { name: 'own-skill', path: '/s/own-skill' },
    { name: 'zzz', path: '/s/zzz' },
  ],
  mcp: [],
};

test('edit-start: форма предзаполняется из settings', () => {
  const s = { ...initialState(catalog2), selected: 0 };
  const next = reducer(s, {
    type: 'edit-start',
    name: 'dev',
    settings: {
      defaultProvider: 'cpp',
      defaultModel: 'Bonsai-2',
      extensions: ['extensions/searxng.ts'],
      packages: ['pkg-a'],
      skills: ['skills/own-skill'],
    },
    mcp: [],
  }, rc(envs(1)));
  assert.equal(next.sub, 'create');
  const c = next.create!;
  assert.equal(c.mode, 'edit');
  assert.equal(c.name, 'dev');
  assert.equal(c.origName, 'dev');
  assert.equal(c.caret, 3);
  assert.equal(c.provider, 'cpp');
  assert.equal(c.model, 'Bonsai-2');
  assert.deepEqual(c.tools, ['searxng.ts']);
  assert.deepEqual(c.packages, ['npm:pkg-a']);
  assert.deepEqual(c.skills, ['own-skill']);
  assert.equal(c.view, 'form');
});

test('edit-start: collision-суффикс скилла не отмечается', () => {
  const s = { ...initialState(catalog2), selected: 0 };
  const next = reducer(s, {
    type: 'edit-start',
    name: 'dev',
    settings: { skills: ['skills/own-skill-2'] },
    mcp: [],
  }, rc(envs(1)));
  assert.deepEqual(next.create!.skills, []);
});

test('edit-start: игнорируется при открытом суб-экране', () => {
  const s = { ...initialState(catalog2), sub: 'create' as const, create: freshCreate() };
  const next = reducer(s, { type: 'edit-start', name: 'dev', settings: {}, mcp: [] }, rc(envs(1)));
  assert.deepEqual(next, s);
});

function editState(name = 'env0', cursor = 5): AppState {
  let s = { ...initialState(catalog2), selected: 0 };
  s = reducer(s, { type: 'edit-start', name, settings: {}, mcp: [] }, rc(envs(2)));
  for (let i = 0; i < cursor; i++) s = reducer(s, 'down', rc(envs(2)));
  return s;
}

test('edit: сохранение с неизменённым именем — без коллизии с собой', () => {
  const s = editState('env0', 6);
  const next = reducer(s, 'enter', rc(envs(2)));
  assert.equal(next.create!.view, 'submitting');
});

test('edit: переименование в занятое имя — ошибка', () => {
  const s = editState('env0', 0);
  const b = reducer(s, 'backspace', rc(envs(2))); // env
  const t = reducer(b, '1', rc(envs(2))); // env1
  assert.equal(t.create!.name, 'env1');
  let s2 = t;
  for (let i = 0; i < 6; i++) s2 = reducer(s2, 'down', rc(envs(2)));
  s2 = reducer(s2, 'enter', rc(envs(2)));
  assert.equal(s2.create!.error, 'Окружение с таким именем уже есть');
});

test('edit: курсор 7 — Удалить → confirm-delete, Esc — в форму, Enter → deleting', () => {
  let s = editState('env0', 7);
  s = reducer(s, 'enter', rc(envs(2)));
  assert.equal(s.create!.view, 'confirm-delete');
  s = reducer(s, 'esc', rc(envs(2)));
  assert.equal(s.create!.view, 'form');
  assert.equal(s.create!.cursor, 7);
  s = reducer(s, 'enter', rc(envs(2)));
  assert.equal(s.create!.view, 'confirm-delete');
  s = reducer(s, 'enter', rc(envs(2)));
  assert.equal(s.create!.view, 'deleting');
});

test('delete-result: ok — форма закрывается, ошибка — в форму', () => {
  const s = editState('env0', 7);
  const del = reducer(reducer(s, 'enter', rc(envs(2))), 'enter', rc(envs(2)));
  assert.equal(del.create!.view, 'deleting');
  const ok = reducer(del, { type: 'delete-result', ok: true, message: 'env0' }, rc(envs(2)));
  assert.equal(ok.sub, null);
  assert.equal(ok.create, null);
  const fail = reducer(del, { type: 'delete-result', ok: false, message: 'Не удалось удалить окружение env0' }, rc(envs(2)));
  assert.equal(fail.create!.view, 'form');
  assert.equal(fail.create!.error, 'Не удалось удалить окружение env0');
});

test('run-result: sub сбрасывается в null', () => {
  const s = { ...initialState(), sub: 'run' as const };
  assert.equal(reducer(s, { type: 'run-result', ok: true }, rc(envs(2))).sub, null);
});

test('edit: курсор цикла на 8 строках', () => {
  const s = editState('env0', 7);
  assert.equal(reducer(s, 'down', rc(envs(2))).create!.cursor, 0);
  assert.equal(reducer(s, 'up', rc(envs(2))).create!.cursor, 6);
});

function extCatalog(n: number): Catalog {
  return {
    providers: [],
    tools: [],
    packages: Array.from({ length: n }, (_, i) => ({
      source: `npm:pkg-${i}`,
      name: `pkg-${i}`,
      path: `/p/${i}`,
      version: '1.0.0',
      description: null,
      extensions: [],
      skills: [],
    })),
    skills: [],
    mcp: [],
  };
}

function extTabState(n = 2, over: Partial<AppState> = {}): AppState {
  return { ...initialState(extCatalog(n)), tab: 'extensions' as const, ...over };
}

function extOver(partial: Partial<ExtState>): ExtState {
  return { view: 'catalog', cursor: 0, updating: null, installing: null, removing: null, catalog: [], catalogStatus: 'loading', query: '', ...partial };
}

test('вкладка extensions: ↑↓ по пакетам и двум кнопкам с клампом', () => {
  let s = extTabState(2);
  s = reducer(s, 'down', rc(envs(0)));
  assert.equal(s.selected, 1);
  s = reducer(s, 'down', rc(envs(0)));
  assert.equal(s.selected, 2); // «Обновить все»
  s = reducer(s, 'down', rc(envs(0)));
  assert.equal(s.selected, 3); // «Установить»
  s = reducer(s, 'down', rc(envs(0)));
  assert.equal(s.selected, 3);
  s = reducer(s, 'up', rc(envs(0)));
  assert.equal(s.selected, 2);
});

test('вкладка extensions: Enter — пакет → updating(имя), кнопка → updating(null), каталог', () => {
  let s = extTabState(2);
  s = reducer(s, 'enter', rc(envs(0)));
  assert.equal(s.ext!.view, 'updating');
  assert.equal(s.ext!.updating, 'pkg-0');
  s = reducer({ ...extTabState(2), selected: 2 }, 'enter', rc(envs(0)));
  assert.equal(s.ext!.view, 'updating');
  assert.equal(s.ext!.updating, null);
  s = reducer({ ...extTabState(2), selected: 3 }, 'enter', rc(envs(0)));
  assert.equal(s.ext!.view, 'catalog');
  assert.equal(s.ext!.catalogStatus, 'loading');
});

test('вкладка extensions: X по пакету → confirm-remove, Esc отмена, Enter → removing', () => {
  let s = reducer({ ...extTabState(2), selected: 1 }, 'x', rc(envs(0)));
  assert.equal(s.ext!.view, 'confirm-remove');
  assert.equal(s.ext!.removing, 'pkg-1');
  s = reducer(s, 'esc', rc(envs(0)));
  assert.equal(s.ext, null);
  s = reducer({ ...extTabState(2), selected: 1 }, 'X', rc(envs(0)));
  s = reducer(s, 'enter', rc(envs(0)));
  assert.equal(s.ext!.view, 'removing');
  assert.equal(s.ext!.removing, 'pkg-1');
});

test('вкладка extensions: X на строках кнопок ничего не делает', () => {
  assert.equal(reducer({ ...extTabState(2), selected: 3 }, 'x', rc(envs(0))).ext, null);
  assert.equal(reducer({ ...extTabState(2), selected: 2 }, 'X', rc(envs(0))).ext, null);
});

test('вкладка extensions: каталог — навигация по кругу, Enter → installing, Esc назад', () => {
  const items: CatalogPkg[] = [
    { name: 'pi-a', types: [], downloads: 0, description: null, author: null },
    { name: 'pi-b', types: [], downloads: 0, description: null, author: null },
  ];
  let s = extTabState(0, { ext: extOver({ view: 'catalog', catalogStatus: 'ready', catalog: items }) });
  s = reducer(s, 'down', rc(envs(0)));
  assert.equal(s.ext!.cursor, 1);
  s = reducer(s, 'down', rc(envs(0)));
  assert.equal(s.ext!.cursor, 0); // зациклен
  s = reducer(s, 'enter', rc(envs(0)));
  assert.equal(s.ext!.view, 'installing');
  assert.equal(s.ext!.installing, 'pi-a');
  s = reducer(s, 'esc', rc(envs(0)));
  assert.equal(s.ext!.view, 'installing'); // Esc процесс не отменяет
});

test('вкладка extensions: Esc из каталога — в список', () => {
  const s = extTabState(2, { ext: extOver({ view: 'catalog', catalogStatus: 'ready' }) });
  assert.equal(reducer(s, 'esc', rc(envs(0))).ext, null);
});

test('вкладка extensions: результаты действий сбрасывают ext', () => {
  let s = extTabState(2, { ext: extOver({ view: 'updating', updating: 'pkg-0' }) });
  s = reducer(s, { type: 'update-result', ok: true, message: 'npm:pkg-0' }, rc(envs(0)));
  assert.equal(s.ext, null);
  s = extTabState(2, { ext: extOver({ view: 'removing', removing: 'pkg-1' }) });
  s = reducer(s, { type: 'remove-result', ok: true, message: 'npm:pkg-1' }, rc(envs(0)));
  assert.equal(s.ext, null);
  s = extTabState(2, { ext: extOver({ view: 'installing', installing: 'pi-a' }) });
  s = reducer(s, { type: 'install-result', ok: true, message: 'npm:pi-a' }, rc(envs(0)));
  assert.equal(s.ext, null);
});

test('вкладка extensions: Esc во время процесса ничего не меняет', () => {
  for (const view of ['updating', 'installing', 'removing'] as const) {
    const s = extTabState(2, { ext: extOver({ view }) });
    assert.deepEqual(reducer(s, 'esc', rc(envs(0))), s);
  }
});

test('вкладка extensions: TAB из подэкрана сбрасывает ext', () => {
  const s = extTabState(2, { ext: extOver({ view: 'catalog', catalogStatus: 'ready' }) });
  const t = reducer(s, 'tab', rc(envs(0)));
  assert.equal(t.ext, null);
  assert.equal(t.tab, 'mcp');
});

test('каталог: ввод фильтрует список, Backspace стирает, курсор кламнится, Enter — отфильтрованное', () => {
  const items: CatalogPkg[] = [
    { name: 'obsidian', types: [], downloads: 0, description: null, author: null },
    { name: 'pi-a', types: [], downloads: 0, description: null, author: null },
    { name: 'pi-b', types: [], downloads: 0, description: null, author: null },
  ];
  let s = extTabState(0, { ext: extOver({ view: 'catalog', catalogStatus: 'ready', catalog: items }) });
  s = reducer(s, 'down', rc(envs(0)));
  s = reducer(s, 'down', rc(envs(0))); // курсор 2 (pi-b)
  s = reducer(s, 'p', rc(envs(0))); // 'p' → [pi-a, pi-b]
  assert.equal(s.ext!.query, 'p');
  assert.equal(s.ext!.cursor, 1); // кламп с 2 до 1
  s = reducer(s, 'backspace', rc(envs(0)));
  assert.equal(s.ext!.query, '');
  assert.equal(s.ext!.cursor, 1); // кламп не двигает курсор вверх
  s = reducer(s, 'backspace', rc(envs(0))); // пустой поиск — ничего не делает
  assert.equal(s.ext!.query, '');
  s = reducer(s, 'o', rc(envs(0))); // 'o' → [obsidian]
  s = reducer(s, 'b', rc(envs(0)));
  s = reducer(s, 'enter', rc(envs(0)));
  assert.equal(s.ext!.view, 'installing');
  assert.equal(s.ext!.installing, 'obsidian');
});

test('каталог: Enter при пустом результате фильтра — ничего не делает', () => {
  const items: CatalogPkg[] = [{ name: 'pi-a', types: [], downloads: 0, description: null, author: null }];
  let s = extTabState(0, { ext: extOver({ view: 'catalog', catalogStatus: 'ready', catalog: items }) });
  s = reducer(s, 'z', rc(envs(0)));
  assert.equal(s.ext!.view, 'catalog');
  s = reducer(s, 'enter', rc(envs(0)));
  assert.equal(s.ext!.view, 'catalog');
  assert.equal(s.ext!.installing, null);
});

test('←/→: на строке «Язык» цикл по языкам с wrap', () => {
  let s = { ...initialState(), tab: 'settings' as const, selected: 3, language: 'ru' };
  s = reducer(s, 'right', rc(envs(1)));
  assert.equal(s.language, 'en');
  s = reducer(s, 'right', rc(envs(1))); // en → ru (wrap, 2 языка)
  assert.equal(s.language, 'ru');
  s = reducer(s, 'left', rc(envs(1))); // ru → en
  assert.equal(s.language, 'en');
});

test('←/→: не на строке «Язык» — без действия', () => {
  const s = { ...initialState(), tab: 'settings' as const, selected: 1, language: 'ru' };
  assert.deepEqual(reducer(s, 'right', rc(envs(1))), s);
});

test('←/→: язык без файла — right к первому известному', () => {
  const s = { ...initialState(), tab: 'settings' as const, selected: 3, language: 'de' };
  assert.equal(reducer(s, 'right', rc(envs(1))).language, 'en');
});
