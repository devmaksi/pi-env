import { type EnvSettings } from './create.js';
import type { Catalog } from './catalog.js';
import { localeCodes } from './i18n.js';
import type { McpServer } from './mcp.js';
import { mcpMachine, freshMcpForm, freshMcpTab } from './state-mcp.js';
import { extMachine, freshExt } from './state-ext.js';
import { createReducer } from './state-create.js';
import { freshCreate, freshEdit } from './state-form.js';
import type { CreateState } from './state-form.js';
import type { ExtState } from './state-ext.js';
import type { McpTab } from './state-mcp.js';

export { freshCreate, freshEdit, packageListSources, formRows, ROW_NAME, ROW_MODEL, ROW_TOOLS, ROW_PACKAGES, ROW_SKILLS, ROW_MCP, ROW_ACTION, ROW_DELETE, FORM_ROWS, MAX_NAME, UPDATE_ALL_ROW, INSTALL_ROW } from './state-form.js';
export type { CreateView, CreateState } from './state-form.js';
export { mcpFormRows, mcpFormStep, mcpListNames, freshMcpForm, freshMcpTab, MCP_TYPES, MCP_EXPOSURES, TEXT_ROWS } from './state-mcp.js';
export type { McpFormAdd, McpTabView, McpTab, McpFormStep, McpExposure } from './state-mcp.js';
export { freshExt } from './state-ext.js';
export type { ExtView, ExtState } from './state-ext.js';

export type Tab = 'envs' | 'extensions' | 'mcp' | 'settings' | 'about';
export type Sub = 'create' | 'run' | null;

export type ControlKey =
  | 'up' | 'down' | 'left' | 'right'
  | 'tab' | 'enter' | 'space' | 'esc' | 'ctrlc' | 'backspace';

/** Управление (ControlKey) или любой одиночный печатный символ. */
export type Key = ControlKey | (string & {});

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

function clampSelected(state: AppState, ctx: ReducerCtx): number {
  const len = listLength(state.tab, ctx.envNames.length, state.catalog.packages.length, state.catalog.mcp.length);
  return Math.max(0, Math.min(state.selected, len - 1));
}

/** Контекст reducer: имена окружений + вариант раскладки. */
export interface ReducerCtx {
  envNames: string[];
  twoColumns: boolean;
}

/** Общий конструктор контекста для run.ts и run-side.ts. */
export function makeCtx(envNames: string[], twoColumns: boolean): ReducerCtx {
  return { envNames, twoColumns };
}

/** Действие — результат сервисной команды (не клавиша): явная проверка для createReducer. */
export function isResultAction(action: Action): action is Extract<Action, { type: `${string}-result` }> {
  return typeof action !== 'string' && action.type.endsWith('-result');
}

/** Переход состояния по действию. Чистая функция. Порядок веток 1-в-1 с прежним reducer. */
export function reducer(state: AppState, action: Action, ctx: ReducerCtx): AppState {
  if (action === 'ctrlc') return { ...state, quit: true };
  const applied = applyResults(state, action, ctx);
  if (applied !== null) return applied;
  if (state.sub === 'create' && state.create !== null) {
    const next = createReducer(state.create, action, state.catalog, ctx.envNames, state.language);
    if (next === null) return { ...state, sub: null, create: null };
    return { ...state, create: next };
  }
  if (state.tab === 'extensions' && state.ext !== null) {
    const next = extMachine(state, action);
    if (next !== null) return next;
  }
  if (state.tab === 'mcp' && state.mcp !== null) {
    const next = mcpMachine(state, action);
    if (next !== null) return next;
  }
  return reducerMain(state, action, ctx);
}

/** Результаты сервисных действий; null — действие не обработано (продолжаем машинами). */
function applyResults(state: AppState, action: Action, ctx: ReducerCtx): AppState | null {
  if (typeof action !== 'object') return null;
  if (action.type === 'edit-start') {
    if (state.sub !== null || state.tab !== 'envs') return state;
    return { ...state, sub: 'create', create: freshEdit(action.name, action.settings, state.catalog, action.mcp ?? []) };
  }
  if (action.type === 'run-result') return { ...state, sub: null };
  if (action.type === 'updates-result') return applyUpdatesResult(state, action);
  if (action.type === 'mcp-result' && action.scope === 'main') return applyMcpResultMain(state, action);
  // scope 'create' — проходит в createReducer
  if (state.sub === null && state.ext !== null) return applyExtResult(state, action, ctx);
  return null;
}

function applyUpdatesResult(
  state: AppState,
  action: { ok: boolean; latest: Record<string, string>; scope: 'main' | 'create' },
): AppState {
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

function applyMcpResultMain(
  state: AppState,
  action: { list?: McpServer[] },
): AppState {
  if (state.mcp === null) return state;
  const servers = action.list ?? state.catalog.mcp;
  const len = listLength('mcp', 0, 0, servers.length);
  return { ...state, catalog: { ...state.catalog, mcp: servers }, mcp: null, selected: Math.max(0, Math.min(state.selected, len - 1)) };
}

function applyExtResult(state: AppState, action: Action, ctx: ReducerCtx): AppState | null {
  if (typeof action !== 'object') return null;
  const extView = state.ext!.view;
  const matches =
    (action.type === 'update-result' && extView === 'updating') ||
    (action.type === 'remove-result' && extView === 'removing') ||
    (action.type === 'install-result' && extView === 'installing');
  return matches ? { ...state, ext: null, selected: clampSelected(state, ctx) } : null;
}

/** Общие клавиши tab-машин и суб-экранов (после делегирований). */
function reducerMain(state: AppState, action: Action, ctx: ReducerCtx): AppState {
  if (action === 'esc') return onEsc(state);
  if (action === 'tab') return onTab(state);
  if (action === 'up' || action === 'down') return onUpDown(state, action === 'up' ? -1 : 1, ctx);
  if (action === 'left' || action === 'right') return onLeftRight(state, action === 'left' ? -1 : 1, ctx);
  if (action === 'enter') return onEnter(state, ctx);
  if (action === 'space') return onSpace(state);
  if ((action === 'x' || action === 'X') && state.sub === null && state.ext === null && state.mcp === null &&
      (state.tab === 'extensions' || state.tab === 'mcp')) return onX(state);
  return state;
}

function onEsc(state: AppState): AppState {
  if (state.sub !== null) return { ...state, sub: null };
  return { ...state, quit: true };
}

function onTab(state: AppState): AppState {
  const idx = TABS.indexOf(state.tab);
  const next = TABS[(idx + 1) % TABS.length];
  return { ...state, tab: next, focus: 'left', selected: 0, sub: null, ext: null, mcp: null };
}

function onUpDown(state: AppState, delta: number, ctx: ReducerCtx): AppState {
  if (state.sub !== null) return state;
  const len = listLength(state.tab, ctx.envNames.length, state.catalog.packages.length, state.catalog.mcp.length);
  if (len === 0) return state;
  const selected = Math.min(len - 1, Math.max(0, state.selected + delta));
  return { ...state, selected };
}

function onLeftRight(state: AppState, delta: number, ctx: ReducerCtx): AppState {
  if (state.tab === 'settings' && state.sub === null && state.selected === LANGUAGE_ROW) return cycleLanguage(state, delta);
  if (state.tab !== 'envs' || state.sub !== null || !ctx.twoColumns) return state;
  return { ...state, focus: state.focus === 'left' ? 'right' : 'left' };
}

function cycleLanguage(state: AppState, delta: number): AppState {
  const codes = localeCodes();
  if (codes.length === 0) return state;
  const i = codes.indexOf(state.language);
  const next = i === -1
    ? (delta === 1 ? codes[0] : codes[codes.length - 1])
    : codes[(i + delta + codes.length) % codes.length];
  return { ...state, language: next };
}

function onEnter(state: AppState, ctx: ReducerCtx): AppState {
  if (state.sub !== null) return state;
  if (state.tab === 'envs') return enterEnvs(state, ctx.envNames);
  if (state.tab === 'extensions' && state.ext === null) return enterExtensions(state);
  if (state.tab === 'mcp' && state.mcp === null) return enterMcp(state);
  return state;
}

function enterEnvs(state: AppState, envNames: string[]): AppState {
  if (state.selected < envNames.length) return { ...state, sub: 'run' };
  return { ...state, sub: 'create', create: freshCreate() };
}

function enterExtensions(state: AppState): AppState {
  const n = state.catalog.packages.length;
  if (state.selected < n) {
    return { ...state, ext: freshExt({ view: 'updating', updating: state.catalog.packages[state.selected].name }) };
  }
  if (state.selected === n) return { ...state, ext: freshExt({ view: 'updating', updating: null }) };
  return { ...state, ext: freshExt({ view: 'catalog', catalogStatus: 'loading' }) };
}

function enterMcp(state: AppState): AppState {
  const n = state.catalog.mcp.length;
  if (state.selected < n) return state; // server — selection only (info panel)
  return { ...state, mcp: freshMcpTab({ view: 'add', form: freshMcpForm() }) };
}

function onSpace(state: AppState): AppState {
  if (state.tab !== 'settings' || state.sub !== null) return state;
  if (state.selected === 1) return { ...state, colorToggle: !state.colorToggle };
  if (state.selected === 2) return { ...state, recheckUpdates: !state.recheckUpdates };
  return state;
}

function onX(state: AppState): AppState {
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
  return state;
}
