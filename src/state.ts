import { type EnvSettings } from './create.js';
import type { Catalog, CatalogPkg } from './catalog.js';
import { filterPackages } from './catalog.js';
import { localeCodes } from './i18n.js';
import type { McpServer } from './mcp.js';
import { mcpMachine, freshMcpForm, freshMcpTab, isPrintable } from './state-mcp.js';
import { createReducer } from './state-create.js';
import { freshCreate, freshEdit, clampToLen } from './state-form.js';
import type { CreateState } from './state-form.js';
import type { McpTab } from './state-mcp.js';

export { freshCreate, freshEdit, packageListSources, formRows, ROW_NAME, ROW_MODEL, ROW_TOOLS, ROW_PACKAGES, ROW_SKILLS, ROW_MCP, ROW_ACTION, ROW_DELETE, FORM_ROWS, MAX_NAME, UPDATE_ALL_ROW, INSTALL_ROW } from './state-form.js';
export type { CreateView, CreateState } from './state-form.js';

export { mcpFormRows, mcpFormStep, mcpListNames, freshMcpForm, freshMcpTab, MCP_TYPES, MCP_EXPOSURES, TEXT_ROWS } from './state-mcp.js';
export type { McpFormAdd, McpTabView, McpTab, McpFormStep, McpExposure } from './state-mcp.js';

export type Tab = 'envs' | 'extensions' | 'mcp' | 'settings' | 'about';
export type Sub = 'create' | 'run' | null;

export type ControlKey =
  | 'up' | 'down' | 'left' | 'right'
  | 'tab' | 'enter' | 'space' | 'esc' | 'ctrlc' | 'backspace';

/** Управление (ControlKey) или любой одиночный печатный символ. */
export type Key = ControlKey | (string & {});

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

/** Статус проверки расширений на обновления. */
export type PkgCheck = 'idle' | 'checking' | 'done' | 'error';

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

export function initialState(catalog: Catalog = emptyCatalog()): AppState {
  return {
    tab: 'envs', focus: 'left', selected: 0, sub: null, colorToggle: true, recheckUpdates: false, quit: false, language: 'ru',
    catalog, create: null, ext: null, mcp: null, catalogProgress: null, pkgCheck: 'idle', pkgLatest: {},
  };
}

export function emptyCatalog(): Catalog {
  return { providers: [], tools: [], packages: [], skills: [], mcp: [] };
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
    const next = mcpMachine(state, action);
    if (next !== null) return next;
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

/** Пустое состояние вкладки «Расширения» с переопределением полей. */
export function freshExt(partial: Partial<ExtState>): ExtState {
  return { view: 'catalog', cursor: 0, updating: null, installing: null, removing: null, catalog: [], catalogStatus: 'loading', query: '', ...partial };
}

function clampSelected(state: AppState, envNames: string[]): number {
  const len = listLength(state.tab, envNames.length, state.catalog.packages.length, state.catalog.mcp.length);
  return Math.max(0, Math.min(state.selected, len - 1));
}
