import { validateName, baseName, type EnvSettings } from './create.js';
import type { Catalog, CatalogPkg } from './catalog.js';
import { normalizePkgSource, filterPackages } from './catalog.js';
import { localeCodes } from './i18n.js';
import { validateMcpForm, type McpFormFields, type McpServer, type McpType } from './mcp.js';

export type Tab = 'envs' | 'extensions' | 'mcp' | 'settings' | 'about';
export type Sub = 'create' | 'run' | null;

export type ControlKey =
  | 'up' | 'down' | 'left' | 'right'
  | 'tab' | 'enter' | 'space' | 'esc' | 'ctrlc' | 'backspace';

/** Управление (ControlKey) или любой одиночный печатный символ. */
export type Key = ControlKey | (string & {});

export type CreateView = 'form' | 'providers' | 'models' | 'tools' | 'packages' | 'skills' | 'submitting' | 'updating' | 'confirm-delete' | 'deleting' | 'confirm-remove' | 'removing' | 'install' | 'installing' | 'mcp' | 'mcp-op' | 'mcp-submitting' | 'mcp-confirm-remove';

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

/** Поля окна добавления MCP (данные) + UI-состояние формы. */
export type McpFormAdd = McpFormFields & {
  cursor: number;
  caret: number;
  error: string | null;
  select: 'type' | 'exposure' | null;
};

/** Подэкраны вкладки «MCP». */
export type McpTabView = 'add' | 'submitting' | 'confirm-remove' | 'removing';

export interface McpTab {
  view: McpTabView;
  form: McpFormAdd | null;
  removing: string | null;
}

/** Строки формы добавления по типу сервера. */
export function mcpFormRows(type: McpType): string[] {
  return type === 'stdio'
    ? ['name', 'type', 'command', 'args', 'env', 'cwd', 'description', 'exposure', 'action']
    : ['name', 'type', 'url', 'description', 'exposure', 'action'];
}

/** Результат шага формы добавления: обновлённая форма / закрыть / отправить. */
export type McpFormStep =
  | { kind: 'form'; form: McpFormAdd }
  | { kind: 'close' }
  | { kind: 'submit' };

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
  mcpAdd: McpFormAdd | null;
  envMcp: McpServer[];
  /** Имена MCP, отмеченные для окружения в режиме создания. */
  mcp: string[];
  mcpOp: { name: string; kind: 'copy' | 'remove' } | null;
  removingMcp: string | null;
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
  mcp: McpTab | null;
  /** Прогресс загрузки каталога pi.dev (страницы); null — не грузится. */
  catalogProgress: { loaded: number; total: number } | null;
  pkgCheck: PkgCheck;
  pkgLatest: Record<string, string>;
}

export const TABS: readonly Tab[] = ['envs', 'extensions', 'mcp', 'settings', 'about'];
export const SETTINGS_COUNT = 4;
export const LANGUAGE_ROW = 3; // «Язык» — после «Перепроверка обновлений»

/** Индексы строк формы. */
export const ROW_NAME = 0;
export const ROW_MODEL = 1;
export const ROW_TOOLS = 2;
export const ROW_PACKAGES = 3;
export const ROW_SKILLS = 4;
export const ROW_MCP = 5;
export const ROW_ACTION = 6;
export const ROW_DELETE = 7;

export const FORM_ROWS = 7; // имя, модель, инструменты, расширения, скиллы, MCP, действие

/** Число строк формы: в edit-режиме добавляется «Удалить». */
export function formRows(mode: 'create' | 'edit'): number {
  return mode === 'edit' ? FORM_ROWS + 1 : FORM_ROWS;
}
export const MAX_NAME = 40;

export function initialState(catalog: Catalog = emptyCatalog()): AppState {
  return {
    tab: 'envs', focus: 'left', selected: 0, sub: null, colorToggle: true, recheckUpdates: false, quit: false, language: 'ru',
    catalog, create: null, ext: null, mcp: null, catalogProgress: null, pkgCheck: 'idle', pkgLatest: {},
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
    mcpAdd: null, envMcp: [], mcp: [], mcpOp: null, removingMcp: null,
  };
}

/** Чистая форма редактирования: предзаполнение из settings окружения. */
export function freshEdit(name: string, settings: EnvSettings, catalog: Catalog, envMcp: McpServer[] = []): CreateState {
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
    mcpAdd: null, envMcp, mcp: [], mcpOp: null, removingMcp: null,
  };
}
/** Имена MCP для списка формы: окружение (сортированы) + только-в-main (сортированы). */
export function mcpListNames(envMcp: McpServer[], mainMcp: McpServer[]): string[] {
  const names = [...envMcp.map((s) => s.name)].sort();
  const inEnv = new Set(names);
  for (const n of [...mainMcp.map((s) => s.name)].sort()) if (!inEnv.has(n)) names.push(n);
  return names;
}


/** Клавиша или сервисное действие (результат создания). */
export type Action =
  | Key
  | { type: 'create-result'; ok: boolean; message: string }
  | { type: 'edit-start'; name: string; settings: EnvSettings; mcp?: McpServer[] }
  | { type: 'run-result'; ok: boolean }
  | { type: 'delete-result'; ok: boolean; message: string }
  | { type: 'updates-result'; ok: boolean; latest: Record<string, string>; scope: 'main' | 'create' }
  | { type: 'update-result'; ok: boolean; message: string }
  | { type: 'remove-result'; ok: boolean; message: string }
  | { type: 'install-result'; ok: boolean; message: string; sources?: string[] }
  | { type: 'mcp-result'; ok: boolean; message: string; scope: 'main' | 'create'; list?: McpServer[] };

export function listLength(tab: Tab, envCount: number, pkgCount = 0, mcpCount = 0): number {
  if (tab === 'envs') return envCount + 1; // окружения + «Создать»
  if (tab === 'extensions') return pkgCount + 2; // пакеты + «Обновить все» + «Установить»
  if (tab === 'mcp') return mcpCount + 1; // серверы + «Добавить»
  if (tab === 'settings') return SETTINGS_COUNT;
  return 0;
}

/** Переход состояния по действию. Чистая функция. */
export function reducer(state: AppState, action: Action, envNames: string[], twoColumns: boolean): AppState {
  if (action === 'ctrlc') return { ...state, quit: true };

  if (typeof action === 'object') {
    if (action.type === 'edit-start') {
      if (state.sub !== null || state.tab !== 'envs') return state;
      return { ...state, sub: 'create', create: freshEdit(action.name, action.settings, state.catalog, action.mcp ?? []) };
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

    if (action.type === 'mcp-result' && action.scope === 'main') {
      if (state.mcp === null) return state;
      const servers = action.list ?? state.catalog.mcp;
      const len = listLength('mcp', 0, 0, servers.length);
      return { ...state, catalog: { ...state.catalog, mcp: servers }, mcp: null, selected: Math.max(0, Math.min(state.selected, len - 1)) };
      // scope 'create' — проходит в createReducer
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
  if (state.tab === 'mcp' && state.mcp !== null) {
    const mcp = state.mcp;
    if (mcp.view === 'add' && mcp.form !== null) {
      const step = mcpFormStep(mcp.form, action, state.language);
      if (step !== null) {
        if (step.kind === 'form') return { ...state, mcp: { ...mcp, form: step.form } };
        if (step.kind === 'close') return { ...state, mcp: null };
        return { ...state, mcp: { ...mcp, view: 'submitting' } };
      }
      // Непроцессированные клавиши (такие как tab) падают в общую машину
    } else if (mcp.view === 'confirm-remove') {
      if (action === 'esc') return { ...state, mcp: null };
      if (action === 'enter') return { ...state, mcp: { ...mcp, view: 'removing' } };
    } else {
      // submitting/removing — клавиши процесс не отменяют
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
    return { ...state, tab: next, focus: 'left', selected: 0, sub: null, ext: null, mcp: null };
  }
  if (action === 'up' || action === 'down') {
    if (state.sub !== null) return state;
    const len = listLength(state.tab, envNames.length, state.catalog.packages.length, state.catalog.mcp.length);
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

    if (state.tab === 'mcp' && state.mcp === null) {
      const n = state.catalog.mcp.length;
      if (state.selected < n) return state; // server — selection only (info panel)
      return { ...state, mcp: freshMcpTab({ view: 'add', form: freshMcpForm() }) };
    }
    return state;
  }
  if (action === 'space') {
    if (state.tab !== 'settings' || state.sub !== null) return state;
    if (state.selected === 1) return { ...state, colorToggle: !state.colorToggle };
    if (state.selected === 2) return { ...state, recheckUpdates: !state.recheckUpdates };
    return state;
  }
  if ((action === 'x' || action === 'X') && state.sub === null && state.ext === null && state.mcp === null &&
      (state.tab === 'extensions' || state.tab === 'mcp')) {
    if (state.tab === 'extensions') {
      const n = state.catalog.packages.length;
      if (state.selected < n) {
        return { ...state, ext: freshExt({ view: 'confirm-remove', removing: state.catalog.packages[state.selected].name }) };
      }
    }
    if (state.tab === 'mcp') {
      const n = state.catalog.mcp.length;
      if (state.selected < n) {
        return { ...state, mcp: freshMcpTab({ view: 'confirm-remove', removing: state.catalog.mcp[state.selected].name }) };
      }
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
    if (action.type === 'mcp-result') {
      return {
        ...c,
        view: 'mcp',
        mcpAdd: null,
        mcpOp: null,
        removingMcp: null,
        envMcp: action.list ?? c.envMcp,
        cursor: 0,
        error: action.ok ? null : action.message,
      };
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
    case 'mcp': {
      if (c.mcpAdd !== null) {
        const step = mcpFormStep(c.mcpAdd, action, language);
        if (step === null) return c;
        if (step.kind === 'form') return { ...c, mcpAdd: step.form };
        if (step.kind === 'close') return { ...c, mcpAdd: null };
        return { ...c, view: 'mcp-submitting' };
      }
      const names = c.mode === 'edit' ? mcpListNames(c.envMcp, catalog.mcp) : catalog.mcp.map((s) => s.name);
      const inEnv = (n: string) => c.envMcp.some((s) => s.name === n);
      const total = c.mode === 'edit' ? names.length + 1 : names.length;
      if (action === 'up' || action === 'down') {
        if (total === 0) return c;
        const delta = action === 'up' ? -1 : 1;
        return { ...c, cursor: (c.cursor + delta + total) % total };
      }
      if (action === 'esc') return { ...c, view: 'form', cursor: ROW_MCP };
      if (action === 'enter' || action === 'space') {
        if (c.mode === 'edit') {
          if (c.cursor === names.length) return { ...c, mcpAdd: freshMcpForm() };
          const name = names[c.cursor];
          if (name === undefined) return c;
          const inMain = catalog.mcp.some((s) => s.name === name);
          if (inMain && !inEnv(name)) return { ...c, view: 'mcp-op', mcpOp: { name, kind: 'copy' } };
          if (inEnv(name)) return { ...c, view: 'mcp-op', mcpOp: { name, kind: 'remove' } };
          return c;
        }
        const name = names[c.cursor];
        if (name === undefined) return c;
        const sel = c.mcp;
        return { ...c, mcp: sel.includes(name) ? sel.filter((x) => x !== name) : [...sel, name] };
      }
      if ((action === 'x' || action === 'X') && c.mode === 'edit') {
        if (c.cursor >= names.length) return c;
        const name = names[c.cursor];
        if (name !== undefined && inEnv(name)) return { ...c, view: 'mcp-confirm-remove', removingMcp: name };
      }
      return c;
    }
    case 'mcp-confirm-remove':
      if (action === 'esc') return { ...c, view: 'mcp', removingMcp: null };
      if (action === 'enter') {
        const name = c.removingMcp;
        return name === null ? c : { ...c, view: 'mcp-op', mcpOp: { name, kind: 'remove' }, removingMcp: null };
      }
      return c;
    case 'mcp-op':
    case 'mcp-submitting':
      // процесс не отменяется — ждём mcp-result
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
    if (c.cursor === ROW_MCP) return { ...c, view: 'mcp', cursor: 0 };
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
  const len = listLength(state.tab, envNames.length, state.catalog.packages.length, state.catalog.mcp.length);
  return Math.max(0, Math.min(state.selected, len - 1));
}
export type McpExposure = 'codemode' | 'deferred' | 'direct' | 'hidden';
export const MCP_TYPES: readonly McpType[] = ['stdio', 'http'];
export const MCP_EXPOSURES: readonly McpExposure[] = ['codemode', 'deferred', 'direct', 'hidden'];

/** Текстовые строки формы (редактируются вводом). */
const TEXT_ROWS = ['name', 'command', 'args', 'env', 'cwd', 'description', 'url'] as const;
type TextField = (typeof TEXT_ROWS)[number];

/** Чистая форма добавления MCP. */
export function freshMcpForm(): McpFormAdd {
  return {
    name: '', type: 'stdio', command: '', args: '', url: '', env: '', cwd: '', description: '', exposure: 'codemode',
    cursor: 0, caret: 0, error: null, select: null,
  };
}

/** Пустое состояние вкладки «MCP» с переопределением полей. */
export function freshMcpTab(partial: Partial<McpTab>): McpTab {
  return { view: 'add', form: null, removing: null, ...partial };
}

/**
 * Шаг формы добавления MCP. null — клавиша не относится к форме
 * (управляющие — обрабатываются общей машиной).
 */
export function mcpFormStep(form: McpFormAdd, action: Action, language: string): McpFormStep | null {
  const rows = mcpFormRows(form.type);
  const row = rows[form.cursor];
  const textRow = TEXT_ROWS.includes(row as TextField);
  if (action === 'up' || action === 'down') {
    if (form.select === 'type') {
      const delta = action === 'up' ? -1 : 1;
      return { kind: 'form', form: { ...form, cursor: (form.cursor + delta + MCP_TYPES.length) % MCP_TYPES.length } };
    }
    if (form.select === 'exposure') {
      const delta = action === 'up' ? -1 : 1;
      return { kind: 'form', form: { ...form, cursor: (form.cursor + delta + MCP_EXPOSURES.length) % MCP_EXPOSURES.length } };
    }
    const delta = action === 'up' ? -1 : 1;
    return { kind: 'form', form: { ...form, cursor: Math.min(rows.length - 1, Math.max(0, form.cursor + delta)) } };
  }
  if (action === 'left' || action === 'right') {
    if (form.select !== null) {
      const n = form.select === 'type' ? MCP_TYPES.length : MCP_EXPOSURES.length;
      const delta = action === 'left' ? -1 : 1;
      return { kind: 'form', form: { ...form, cursor: (form.cursor + delta + n) % n } };
    }
    if (!textRow) return { kind: 'form', form };
    const v = form[row as TextField];
    const caret = Math.min(v.length, Math.max(0, form.caret + (action === 'left' ? -1 : 1)));
    return { kind: 'form', form: { ...form, caret } };
  }
  if (action === 'enter') {
    if (form.select === 'type') return { kind: 'form', form: { ...form, type: MCP_TYPES[form.cursor], select: null, cursor: rows.indexOf('type') } };
    if (form.select === 'exposure') return { kind: 'form', form: { ...form, exposure: MCP_EXPOSURES[form.cursor], select: null, cursor: rows.indexOf('exposure') } };
    if (row === 'type') return { kind: 'form', form: { ...form, select: 'type', cursor: form.type === 'http' ? 1 : 0 } };
    if (row === 'exposure') {
      const i = MCP_EXPOSURES.indexOf((form.exposure ?? '') as McpExposure);
      return { kind: 'form', form: { ...form, select: 'exposure', cursor: i === -1 ? 0 : i } };
    }
    if (row === 'action') {
      const error = validateMcpForm(form, language);
      if (error !== null) return { kind: 'form', form: { ...form, error } };
      return { kind: 'submit' };
    }
    return { kind: 'form', form };
  }
  if (action === 'backspace') {
    if (!textRow) return { kind: 'form', form };
    const v = form[row as TextField];
    return { kind: 'form', form: { ...form, [row]: v.slice(0, -1), caret: Math.max(0, form.caret - 1) } as McpFormAdd };
  }
  if (action === 'esc') {
    if (form.select !== null) return { kind: 'form', form: { ...form, select: null } };
    return { kind: 'close' };
  }
  if (typeof action === 'string' && action.length === 1 && action.charCodeAt(0) >= 0x21 && action.charCodeAt(0) <= 0x7e) {
    if (!textRow) return { kind: 'form', form };
    const v = form[row as TextField];
    const caret = Math.min(v.length, form.caret);
    return { kind: 'form', form: { ...form, [row]: v.slice(0, caret) + action + v.slice(caret), caret: caret + 1 } as McpFormAdd };
  }
  return null;
}
