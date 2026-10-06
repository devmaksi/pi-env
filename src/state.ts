import { validateName, baseName, type EnvSettings } from './create.js';
import type { Catalog, CatalogPkg } from './catalog.js';
import { normalizePkgSource, filterPackages } from './catalog.js';
import { localeCodes } from './i18n.js';

export type Tab = 'envs' | 'extensions' | 'settings' | 'about';
export type Sub = 'create' | 'run' | null;

export type ControlKey =
  | 'up' | 'down' | 'left' | 'right'
  | 'tab' | 'enter' | 'space' | 'esc' | 'ctrlc' | 'backspace';

/** Управление (ControlKey) или любой одиночный печатный символ. */
export type Key = ControlKey | (string & {});

export type CreateView = 'form' | 'providers' | 'models' | 'tools' | 'packages' | 'skills' | 'submitting' | 'updating' | 'confirm-delete' | 'deleting' | 'confirm-remove' | 'removing' | 'install' | 'installing';

/** Подэкраны вкладки «Расширения». */
export type ExtView = 'catalog' | 'installing' | 'updating' | 'confirm-remove' | 'removing';

export interface ExtState {
  view: ExtView;
  cursor: number;
  updating: string | null;
  installing: string | null;
  removing: string | null;
  catalog: CatalogPkg[];
  catalogStatus: 'loading' | 'ready' | 'error';
  query: string;
}

/** Строка-кнопка в конце списка расширений. */
export const UPDATE_ALL_ROW = 'Обновить все'; // внутренний ID, не отображается — подпись через i18n

/** Кнопка «Установить» в конце списка пакетов. */
export const INSTALL_ROW = 'Установить'; // внутренний ID, не отображается — подпись через i18n

/** Статус проверки расширений на обновления. */
export type PkgCheck = 'idle' | 'checking' | 'done' | 'error';
export interface CreateState {
  name: string;
  caret: number;
  cursor: number;
  provider: string | null;
  model: string | null;
  tools: string[];
  packages: string[];
  skills: string[];
  view: CreateView;
  error: string | null;
  done: string | null;
  mode: 'create' | 'edit';
  origName: string | null;
  installCatalog: CatalogPkg[];
  installStatus: 'idle' | 'loading' | 'ready' | 'error';
  query: string;
  installing: string | null;
  removing: string | null;
  check: PkgCheck;
  latest: Record<string, string>;
}

export interface AppState {
  tab: Tab;
  focus: 'left' | 'right';
  selected: number;
  sub: Sub;
  colorToggle: boolean;
  recheckUpdates: boolean;
  /** Язык интерфейса; доступные языки — файлы src/locales/*.json. */
  language: string;
  quit: boolean;
  catalog: Catalog;
  create: CreateState | null;
  ext: ExtState | null;
  /** Прогресс загрузки каталога pi.dev (страницы); null — не грузится. */
  catalogProgress: { loaded: number; total: number } | null;
  pkgCheck: PkgCheck;
  pkgLatest: Record<string, string>;
}

export const TABS: readonly Tab[] = ['envs', 'extensions', 'settings', 'about'];
export const SETTINGS_COUNT = 4;
export const LANGUAGE_ROW = 3; // «Язык» — после «Перепроверка обновлений»

/** Индексы строк формы. */
export const ROW_NAME = 0;
export const ROW_MODEL = 1;
export const ROW_TOOLS = 2;
export const ROW_PACKAGES = 3;
export const ROW_SKILLS = 4;
export const ROW_ACTION = 5;
export const ROW_DELETE = 6;

export const FORM_ROWS = 6; // имя, модель, инструменты, расширения, скиллы, действие

/** Число строк формы: в edit-режиме добавляется «Удалить». */
export function formRows(mode: 'create' | 'edit'): number {
  return mode === 'edit' ? FORM_ROWS + 1 : FORM_ROWS;
}
export const MAX_NAME = 40;

export function initialState(catalog: Catalog = emptyCatalog()): AppState {
  return {
    tab: 'envs', focus: 'left', selected: 0, sub: null, colorToggle: true, recheckUpdates: false, quit: false, language: 'ru',
    catalog, create: null, ext: null, catalogProgress: null, pkgCheck: 'idle', pkgLatest: {},
  };
}

export function emptyCatalog(): Catalog {
  return { providers: [], tools: [], packages: [], skills: [], mcp: [] };
}

export function freshCreate(): CreateState {
  return {
    name: '', caret: 0, cursor: 0, provider: null, model: null,
    mode: 'create', origName: null,
    tools: [], packages: [], skills: [], view: 'form', error: null, done: null,
    removing: null, installCatalog: [], installStatus: 'idle', installing: null, query: '',
    check: 'idle', latest: {},
  };
}

/** Чистая форма редактирования: предзаполнение из settings окружения. */
export function freshEdit(name: string, settings: EnvSettings, catalog: Catalog): CreateState {
  const ext = settings.extensions ?? [];
  const sk = settings.skills ?? [];
  return {
    mode: 'edit',
    origName: name,
    name,
    caret: name.length,
    cursor: 0,
    provider: settings.defaultProvider ?? null,
    model: settings.defaultModel ?? null,
    tools: catalog.tools.filter((t) => ext.includes(`extensions/${t.name}`)).map((t) => t.name),
    packages: (settings.packages ?? []).map((s) => normalizePkgSource(s, catalog.packages)),
    skills: catalog.skills.filter((s) => {
      const base = baseName(s.path);
      return sk.includes(`skills/${base}`) || sk.includes(`skills/${s.name}`);
    }).map((s) => s.name),
    view: 'form',
    error: null,
    done: null,
    removing: null, installCatalog: [], installStatus: 'idle', installing: null, query: '',
    check: 'idle', latest: {},
  };
}

/** Клавиша или сервисное действие (результат создания). */
export type Action =
  | Key
  | { type: 'create-result'; ok: boolean; message: string }
  | { type: 'edit-start'; name: string; settings: EnvSettings }
  | { type: 'run-result'; ok: boolean }
  | { type: 'delete-result'; ok: boolean; message: string }
  | { type: 'updates-result'; ok: boolean; latest: Record<string, string>; scope: 'main' | 'create' }
  | { type: 'update-result'; ok: boolean; message: string }
  | { type: 'remove-result'; ok: boolean; message: string }
  | { type: 'install-result'; ok: boolean; message: string; sources?: string[] };

export function listLength(tab: Tab, envCount: number, pkgCount = 0): number {
  if (tab === 'envs') return envCount + 1; // окружения + «Создать»
  if (tab === 'extensions') return pkgCount + 2; // пакеты + «Обновить все» + «Установить»
  if (tab === 'settings') return SETTINGS_COUNT;
  return 0;
}

/** Переход состояния по действию. Чистая функция. */
export function reducer(state: AppState, action: Action, envNames: string[], twoColumns: boolean): AppState {
  if (action === 'ctrlc') return { ...state, quit: true };

  if (typeof action === 'object') {
    if (action.type === 'edit-start') {
      if (state.sub !== null || state.tab !== 'envs') return state;
      return { ...state, sub: 'create', create: freshEdit(action.name, action.settings, state.catalog) };
    }
    if (action.type === 'run-result') return { ...state, sub: null };
    if (action.type === 'updates-result') {
      if (action.scope === 'create') {
        if (state.create === null) return state; // форма уже закрыта — результат устарел
        return {
          ...state,
          create: { ...state.create, check: action.ok ? 'done' : 'error', latest: action.ok ? action.latest : state.create.latest },
        };
      }
      return {
        ...state,
        pkgCheck: action.ok ? 'done' : 'error',
        pkgLatest: action.ok ? action.latest : state.pkgLatest,
      };
    }
    if (state.sub === null && state.ext !== null) {
      const extView = state.ext.view;
      const matches =
        (action.type === 'update-result' && extView === 'updating') ||
        (action.type === 'remove-result' && extView === 'removing') ||
        (action.type === 'install-result' && extView === 'installing');
      if (matches) return { ...state, ext: null, selected: clampSelected(state, envNames) };
    }
  }

  if (state.sub === 'create' && state.create !== null) {
    const next = createReducer(state.create, action, state.catalog, envNames, state.language);
    if (next === null) return { ...state, sub: null, create: null };
    return { ...state, create: next };
  }

  if (state.tab === 'extensions' && state.ext !== null) {
    const ext = state.ext;
    if (ext.view === 'catalog') {
      const pkgs = filterPackages(ext.catalog, ext.query);
      const n = pkgs.length;
      if (action === 'up' || action === 'down') {
        if (n === 0) return state;
        const delta = action === 'up' ? -1 : 1;
        return { ...state, ext: { ...ext, cursor: (ext.cursor + delta + n) % n } };
      }
      if (action === 'backspace') {
        const query = ext.query.slice(0, -1);
        return { ...state, ext: { ...ext, query, cursor: clampToLen(ext.cursor, filterPackages(ext.catalog, query).length) } };
      }
      if (action === 'esc') return { ...state, ext: null };
      if ((action === 'enter' || action === 'space') && n > 0) {
        return { ...state, ext: { ...ext, view: 'installing', installing: pkgs[ext.cursor].name } };
      }
      if (isPrintable(action)) {
        const query = ext.query + action;
        return { ...state, ext: { ...ext, query, cursor: clampToLen(ext.cursor, filterPackages(ext.catalog, query).length) } };
      }
    } else if (ext.view === 'confirm-remove') {
      if (action === 'esc') return { ...state, ext: null };
      if (action === 'enter') return { ...state, ext: { ...ext, view: 'removing' } };
    } else {
      // updating/installing/removing — клавиши процесс не отменяют
      return state;
    }
  }
  if (action === 'esc') {
    if (state.sub !== null) return { ...state, sub: null };
    return { ...state, quit: true };
  }
  if (action === 'tab') {
    const idx = TABS.indexOf(state.tab);
    const next = TABS[(idx + 1) % TABS.length];
    return { ...state, tab: next, focus: 'left', selected: 0, sub: null, ext: null };
  }
  if (action === 'up' || action === 'down') {
    if (state.sub !== null) return state;
    const len = listLength(state.tab, envNames.length, state.catalog.packages.length);
    if (len === 0) return state;
    const delta = action === 'up' ? -1 : 1;
    const selected = Math.min(len - 1, Math.max(0, state.selected + delta));
    return { ...state, selected };
  }
  if (action === 'left' || action === 'right') {
    if (state.tab === 'settings' && state.sub === null && state.selected === LANGUAGE_ROW) {
      const codes = localeCodes();
      if (codes.length === 0) return state;
      const delta = action === 'left' ? -1 : 1;
      const i = codes.indexOf(state.language);
      const next = i === -1
        ? (delta === 1 ? codes[0] : codes[codes.length - 1])
        : codes[(i + delta + codes.length) % codes.length];
      return { ...state, language: next };
    }
    if (state.tab !== 'envs' || state.sub !== null || !twoColumns) return state;
    return { ...state, focus: state.focus === 'left' ? 'right' : 'left' };
  }
  if (action === 'enter') {
    if (state.sub !== null) return state;
    if (state.tab === 'envs') {
      if (state.selected < envNames.length) return { ...state, sub: 'run' };
      return { ...state, sub: 'create', create: freshCreate() };
    }
    if (state.tab === 'extensions' && state.ext === null) {
      const n = state.catalog.packages.length;
      if (state.selected < n) {
        return { ...state, ext: freshExt({ view: 'updating', updating: state.catalog.packages[state.selected].name }) };
      }
      if (state.selected === n) return { ...state, ext: freshExt({ view: 'updating', updating: null }) };
      return { ...state, ext: freshExt({ view: 'catalog', catalogStatus: 'loading' }) };
    }
    return state;
  }
  if (action === 'space') {
    if (state.tab !== 'settings' || state.sub !== null) return state;
    if (state.selected === 1) return { ...state, colorToggle: !state.colorToggle };
    if (state.selected === 2) return { ...state, recheckUpdates: !state.recheckUpdates };
    return state;
  }
  if ((action === 'x' || action === 'X') && state.tab === 'extensions' && state.sub === null && state.ext === null) {
    const n = state.catalog.packages.length;
    if (state.selected < n) {
      return { ...state, ext: freshExt({ view: 'confirm-remove', removing: state.catalog.packages[state.selected].name }) };
    }
  }
  return state;
}

function isPrintable(a: Action): a is string {
  return typeof a === 'string' && a.length === 1 && a.charCodeAt(0) >= 0x21 && a.charCodeAt(0) <= 0x7e;
}

/** Кламп курсора к длине списка: пусто — 0. Двигает курсор только вниз. */
function clampToLen(cursor: number, len: number): number {
  return len === 0 ? 0 : Math.min(cursor, len - 1);
}

/**
 * Машина создания окружения. Возвращает null — закрыть суб-экран.
 * null из createReducer обрабатывает внешний reducer.
 */
function createReducer(
  c: CreateState,
  action: Action,
  catalog: Catalog,
  envNames: string[],
  language: string,
): CreateState | null {
  if (action !== 'ctrlc' && typeof action === 'object') {
    if (action.type === 'create-result') {
      if (action.ok) return { ...c, view: 'form', cursor: formRows(c.mode) - 1, done: action.message, error: null };
      return { ...c, view: 'form', error: action.message };
    }
    if (action.type === 'delete-result') {
      if (action.ok) return null; // закрыть форму — назад к списку
      return { ...c, view: 'form', cursor: formRows(c.mode) - 1, error: action.message };
    }
    if (action.type === 'update-result') {
      return { ...c, view: 'packages', cursor: 0, error: action.ok ? null : action.message };
    }
    if (action.type === 'remove-result') {
      if (!action.ok) return { ...c, view: 'packages', removing: null, error: action.message };
      // removing хранит имя, а packages — источники: переводим
      const src = c.removing !== null ? catalog.packages.find((p) => p.name === c.removing)?.source ?? null : null;
      return {
        ...c,
        view: 'packages',
        cursor: 0,
        removing: null,
        error: null,
        packages: src !== null ? c.packages.filter((n) => n !== src) : c.packages,
      };
    }
    if (action.type === 'install-result') {
      if (!action.ok) return { ...c, view: 'install', installing: null, error: action.message };
      return { ...c, view: 'packages', cursor: 0, installing: null, error: null, packages: action.sources ?? c.packages };
    }
  }

  switch (c.view) {
    case 'form':
      return formReducer(c, action, envNames, language);
    case 'providers':
      return listViewReducer(c, action, catalog.providers.map((p) => p.name), 'form', ROW_MODEL, (name) => {
        if (name === c.provider) return { ...c, provider: null, model: null, view: 'form', cursor: ROW_MODEL };
        return { ...c, provider: name, view: 'models', cursor: ROW_NAME };
      });
    case 'models': {
      const provider = catalog.providers.find((p) => p.name === c.provider);
      return listViewReducer(c, action, (provider?.models ?? []).map((m) => m.id), 'providers', ROW_NAME, (id) => ({
        ...c, model: c.model === id ? null : id, view: 'form', cursor: ROW_MODEL,
      }));
    }
    case 'tools':
    case 'skills': {
      const field = c.view;
      const row = field === 'tools' ? ROW_TOOLS : ROW_SKILLS;
      const items =
        field === 'tools' ? catalog.tools.map((t) => t.name)
        : catalog.skills.map((s) => s.name);
      return listViewReducer(c, action, items, 'form', row, (name) => {
        const sel = c[field];
        const next = sel.includes(name) ? sel.filter((x) => x !== name) : [...sel, name];
        return { ...c, [field]: next };
      });
    }
    case 'packages': {
      const sources = packageListSources(c, catalog);
      if ((action === 'x' || action === 'X') && c.cursor < sources.length) {
        const p = catalog.packages.find((x) => x.source === sources[c.cursor]);
        if (p !== undefined) return { ...c, view: 'confirm-remove', removing: p.name };
        return c; // env-only: удаление из main-агента не применимо
      }
      const items = [...sources, UPDATE_ALL_ROW, ...(c.mode === 'edit' ? [INSTALL_ROW] : [])];
      return listViewReducer(c, action, items, 'form', ROW_PACKAGES, (item) => {
        if (item === UPDATE_ALL_ROW) return { ...c, view: 'updating' };
        if (item === INSTALL_ROW) return { ...c, view: 'install', cursor: 0, installStatus: 'loading' };
        const sel = c.packages;
        const next = sel.includes(item) ? sel.filter((x) => x !== item) : [...sel, item];
        return { ...c, packages: next };
      });
    }
    case 'submitting':
      return c.view === 'submitting' && action === 'esc' ? { ...c, view: 'form' } : c;
    case 'confirm-delete':
      if (action === 'esc') return { ...c, view: 'form', cursor: formRows(c.mode) - 1 };
      if (action === 'enter') return { ...c, view: 'deleting' };
      return c;
    case 'deleting':
      return action === 'esc' ? { ...c, view: 'form' } : c;
    case 'updating':
      return action === 'esc' ? { ...c, view: 'packages', cursor: 0 } : c;
    case 'confirm-remove':
      if (action === 'esc') return { ...c, view: 'packages', removing: null };
      if (action === 'enter') return { ...c, view: 'removing' };
      return c;
    case 'removing':
      // Esc не отменяет процесс — имя храним до прихода remove-result
      return action === 'esc' ? { ...c, view: 'packages' } : c;
    case 'install':
      if (action === 'backspace') {
        const query = c.query.slice(0, -1);
        return { ...c, query, cursor: clampToLen(c.cursor, filterPackages(c.installCatalog, query).length) };
      }
      const pkgs = filterPackages(c.installCatalog, c.query);
      if (isPrintable(action)) {
        const query = c.query + action;
        return { ...c, query, cursor: clampToLen(c.cursor, filterPackages(c.installCatalog, query).length) };
      }
      return listViewReducer(c, action, pkgs.map((p) => p.name), 'packages', ROW_NAME, (name) => ({
        ...c, view: 'installing', installing: name,
      }));
    case 'installing':
      return c;
  }
}

function formReducer(c: CreateState, action: Action, envNames: string[], language: string): CreateState | null {
  if (action === 'esc') return null;
  if (action === 'up' || action === 'down') {
    const delta = action === 'up' ? -1 : 1;
    return { ...c, cursor: (c.cursor + delta + formRows(c.mode)) % formRows(c.mode) };
  }
  if (c.cursor === ROW_NAME) {
    if (action === 'left') return { ...c, caret: Math.max(0, c.caret - 1) };
    if (action === 'right') return { ...c, caret: Math.min(c.name.length, c.caret + 1) };
    if (action === 'backspace') {
      if (c.caret === 0) return c;
      return { ...c, name: c.name.slice(0, c.caret - 1) + c.name.slice(c.caret), caret: c.caret - 1, error: null };
    }
    if (isPrintable(action)) {
      if (c.name.length >= MAX_NAME) return c;
      return {
        ...c,
        name: c.name.slice(0, c.caret) + action + c.name.slice(c.caret),
        caret: c.caret + 1,
        error: null,
      };
    }
    return c;
  }
  if (action === 'enter') {
    if (c.done !== null) return null; // «Готово»
    if (c.cursor === ROW_MODEL) return { ...c, view: 'providers', cursor: ROW_NAME };
    if (c.cursor === ROW_TOOLS) return { ...c, view: 'tools', cursor: ROW_NAME };
    if (c.cursor === ROW_PACKAGES) return { ...c, view: 'packages', cursor: ROW_NAME };
    if (c.cursor === ROW_SKILLS) return { ...c, view: 'skills', cursor: ROW_NAME };
    if (c.cursor === ROW_ACTION) {
      const others = c.mode === 'edit' ? envNames.filter((n) => n !== c.origName) : envNames;
      const err = validateName(c.name, others, language);
      if (err !== null) return { ...c, error: err };
      return { ...c, view: 'submitting' };
    }
    if (c.cursor === ROW_DELETE && c.mode === 'edit') return { ...c, view: 'confirm-delete' };
  }
  return c;
}

/**
 * Общий обработчик спискового представления: ↑↓ по кругу, ESC — назад,
 * Enter/Space — onPick(item).
 */
function listViewReducer(
  c: CreateState,
  action: Action,
  items: string[],
  backView: CreateView,
  backCursor: number,
  onPick: (item: string) => CreateState,
): CreateState {
  if (action === 'up' || action === 'down') {
    if (items.length === 0) return c;
    const delta = action === 'up' ? -1 : 1;
    return { ...c, cursor: (c.cursor + delta + items.length) % items.length };
  }
  if (action === 'esc') return { ...c, view: backView, cursor: backCursor };
  if ((action === 'enter' || action === 'space') && items.length > 0) {
    return onPick(items[c.cursor]);
  }
  return c;
}

/** Пустое состояние вкладки «Расширения» с переопределением полей. */
export function freshExt(partial: Partial<ExtState>): ExtState {
  return { view: 'catalog', cursor: 0, updating: null, installing: null, removing: null, catalog: [], catalogStatus: 'loading', query: '', ...partial };
}

/** Строки пакета в форме: каталог main-агента + только-в-окружении. */
export function packageListSources(c: CreateState, catalog: Catalog): string[] {
  const sources = catalog.packages.map((p) => p.source);
  for (const s of c.packages) if (!sources.includes(s)) sources.push(s);
  return sources;
}

function clampSelected(state: AppState, envNames: string[]): number {
  const len = listLength(state.tab, envNames.length, state.catalog.packages.length);
  return Math.max(0, Math.min(state.selected, len - 1));
}
