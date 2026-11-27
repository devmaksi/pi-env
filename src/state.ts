import { type EnvSettings } from './create.js';
import type { Catalog, PkgItem, Provider } from './catalog.js';
import { pkgIdentity, type PackageConflict, type RegistryGap } from './environments.js';
import { localeCodes } from './i18n.js';
import type { McpLiveReport, McpServer } from './mcp.js';
import { mcpMachine, freshMcpForm, freshMcpTab, applyMcpLiveMain, onRefreshMcp } from './state-mcp.js';
import { extMachine, freshExt } from './state-ext.js';
import { createReducer } from './state-create.js';
import { freshTrash, applyTrashResult, trashMachine } from './state-trash.js';
import type { TrashState } from './state-trash.js';
import { cloneMachine, applyCloneResult, freshClone } from './state-clone.js';
import type { CloneState } from './state-clone.js';
import { freshCreate, freshEdit } from './state-form.js';
import { applyChangelogResult, applySelfUpdateResult, onRefreshUpdate, tabsOf, updateListLength, updateMachine } from './state-update.js';
import type { UpdateCheck, UpdateUi } from './state-update.js';
import type { ChangelogRow } from './selfupdate.js';
import type { SelfUpdate } from './selfupdate-net.js';
import type { CreateState } from './state-form.js';
import type { ExtState } from './state-ext.js';
import type { McpTab } from './state-mcp.js';

export {
  freshCreate, freshEdit, packageListSources, formRows, modelRows, defaultModelRef, storeSummaryOf, storeEnableIntent,
  ROW_NAME, ROW_MODEL, ROW_MODELS, ROW_STORE, ROW_TOOLS, ROW_PACKAGES, ROW_SKILLS, ROW_MCP, ROW_ACTION, ROW_DELETE,
  FORM_ROWS, MAX_NAME, UPDATE_ALL_ROW, INSTALL_ROW,
} from './state-form.js';
export type { CreateView, CreateState } from './state-form.js';
export { mcpFormRows, mcpFormStep, mcpListNames, freshMcpForm, freshMcpTab, MCP_TYPES, MCP_EXPOSURES, MCP_ENUM_ROWS, enumValues, TEXT_ROWS } from './state-mcp.js';
export type { McpFormAdd, McpTabView, McpTab, McpFormStep, McpExposure } from './state-mcp.js';
export { freshExt, conflictSourcesOf } from './state-ext.js';
export { freshTrash, applyTrashResult, trashMachine } from './state-trash.js';
export type { TrashPending, TrashState } from './state-trash.js';
export { freshClone, cloneMachine, applyCloneResult } from './state-clone.js';
export type { CloneState } from './state-clone.js';
export { freshUpdateUi, tabsOf, updateMachine, applySelfUpdateResult, applyChangelogResult, onRefreshUpdate, selectedCommand, updateListLength, UPDATE_ROW_COMMANDS } from './state-update.js';
export type { UpdateCheck, UpdateUi } from './state-update.js';
export type { SelfUpdate } from './selfupdate-net.js';
export type { InstallKind, ChangelogRow } from './selfupdate.js';
export type { ExtView, ExtState } from './state-ext.js';
export type { PackageConflict, ConflictSource } from './environments.js';

export type Tab = 'envs' | 'extensions' | 'mcp' | 'settings' | 'update' | 'about';
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
  /** Перепроверять живой статус MCP при каждом входе во вкладку «MCP»/в список MCP формы. */
  recheckMcp: boolean;
  /** Язык интерфейса; доступные языки — файлы src/locales/*.json. */
  language: string;
  quit: boolean;
  catalog: Catalog;
  /** Реестр общего хранилища пакетов — список вкладки «Расширения» (форма правки пользуется `catalog`). */
  storePackages: PkgItem[];
  /** Разрыв реестра хранилища: пакет объявлен окружениями, но не установлен в `<store>`. */
  storeGaps: RegistryGap[];
  create: CreateState | null;
  ext: ExtState | null;
  mcp: McpTab | null;
  /** Проверка живого статуса MCP и её результат (вкладка «MCP», main-агент). */
  mcpCheck: PkgCheck;
  mcpLive: McpLiveReport | null;
  /** Суб-экран «Корзина» на вкладке «Окружения» (null — показан список окружений). */
  trash: TrashState | null;
  /** Обновление самого pi-env: null — свеж или проверка не делалась/отключена. */
  selfUpdate: SelfUpdate | null;
  /** Содержимое вкладки «Обновление» (null — вкладки нет). */
  updateUi: UpdateUi | null;
  selfCheck: UpdateCheck;
  /** Прогресс загрузки каталога pi.dev (страницы); null — не грузится. */
  catalogProgress: { loaded: number; total: number } | null;
  /** Секунды идущего процесса/проверки для индикатора «⏳ N с»; null — индикатора нет. */
  opSeconds: number | null;
  /** Суб-экран «Клонирование окружения» на вкладке «Окружения» (null — суб-экрана нет). */
  clone: CloneState | null;
  pkgCheck: PkgCheck;
  pkgLatest: Record<string, string>;
}

export const TABS: readonly Tab[] = ['envs', 'extensions', 'mcp', 'settings', 'about'];
export const SETTINGS_COUNT = 5;
export const LANGUAGE_ROW = 4; // «Язык» — последняя строка, после переключателей

export function initialState(
  catalog: Catalog = emptyCatalog(), storePackages: PkgItem[] = catalog.packages, storeGaps: RegistryGap[] = [],
): AppState {
  return {
    tab: 'envs', focus: 'left', selected: 0, sub: null, colorToggle: true, recheckUpdates: false, recheckMcp: false, quit: false, language: 'ru',
    catalog, storePackages, storeGaps, create: null, ext: null, mcp: null, trash: null, clone: null, catalogProgress: null, opSeconds: null, pkgCheck: 'idle', pkgLatest: {}, mcpCheck: 'idle', mcpLive: null, selfUpdate: null, updateUi: null, selfCheck: 'idle',
  };
}

export function emptyCatalog(): Catalog {
  return { providers: [], tools: [], packages: [], skills: [], mcp: [] };
}

/** Клавиша или сервисное действие (результат создания). */
export type Action =
  | Key
  | { type: 'create-result'; ok: boolean; message: string }
  | { type: 'edit-start'; name: string; path: string; main: boolean; settings: EnvSettings; mcp?: McpServer[];
      store?: boolean; storeRoots?: boolean; storeBroken?: boolean; enabledModels?: string[]; modelCatalog?: Provider[] }
  | { type: 'store-result'; ok: boolean; message: string; store: boolean; storeRoots: boolean }
  | { type: 'run-result'; ok: boolean }
  | { type: 'delete-result'; ok: boolean; message: string }
  | { type: 'updates-result'; ok: boolean; latest: Record<string, string>; scope: 'main' | 'create' }
  | { type: 'update-result'; ok: boolean; message: string }
  | { type: 'remove-result'; ok: boolean; message: string }
  | { type: 'install-result'; ok: boolean; message: string; sources?: string[] }
  | { type: 'resolve-result'; ok: boolean; message: string }
  | { type: 'mcp-result'; ok: boolean; message: string; scope: 'main' | 'create'; list?: McpServer[] }
  | { type: 'mcp-live-result'; ok: boolean; message: string; scope: 'main' | 'create'; report: McpLiveReport | null }
  | { type: 'trash-result'; ok: boolean; message: string }
  | { type: 'clone-start'; name: string; path: string }
  | { type: 'create-open'; fromMain?: boolean }
  | { type: 'clone-result'; ok: boolean; message: string; name?: string }
  | { type: 'self-update-result'; info: SelfUpdate | null }
  | { type: 'changelog-result'; ok: boolean; rows: ChangelogRow[] };

export function listLength(tab: Tab, envCount: number, pkgCount = 0, mcpCount = 0, state?: AppState): number {
  if (tab === 'envs') return envCount + 2; // окружения + «Создать» + «Корзина»
  if (tab === 'extensions') return pkgCount + 2; // пакеты + «Обновить все» + «Установить»
  if (tab === 'mcp') return mcpCount + 1; // серверы + «Добавить»
  if (tab === 'settings') return SETTINGS_COUNT;
  if (tab === 'update') return state === undefined ? 0 : updateListLength(state);
  return 0;
}

/** Пакеты, которые видит текущая вкладка: «Расширения» — реестр хранилища, форма — каталог агента. */
export function packagesOf(state: AppState, tab: Tab): PkgItem[] {
  return tab === 'extensions' ? state.storePackages : state.catalog.packages;
}

function clampSelected(state: AppState, ctx: ReducerCtx): number {
  const len = listLength(state.tab, ctx.envNames.length, packagesOf(state, state.tab).length, state.catalog.mcp.length, state);
  return Math.max(0, Math.min(state.selected, len - 1));
}

/**
 * Контекст reducer: список окружений + записи корзины + вариант раскладки.
 *
 * `envNames` — строки списка окружений в порядке экрана, включая основную запись:
 * `renderEnvList` нумерует строки по `envs` целиком, поэтому это и есть пространство
 * индексов курсора (`listLength`, Enter по «Создать»/«Корзина», курсор на копии).
 * `realNames` — имена обычных окружений (без основной записи): по ним проверяется
 * уникальность имени в форме и при клонировании. Без `realNames` берутся строки целиком.
 */
export interface ReducerCtx {
  envNames: string[];
  realNames?: string[];
  twoColumns: boolean;
  /** Имена записей корзины (`dirName` из `.trash`) — Enter/X в суб-экране корзины. */
  trashNames?: string[];
  /**
   * Конфликты источников пакетов из того же снимка окружений: суб-экран «Разрешить
   * конфликт» выбирает источник, а не имя — без снимка reducer не знает, есть ли конфликт.
   */
  conflicts?: PackageConflict[];
  /**
   * Разрывы реестра хранилища из того же снимка: `S` без конфликта на строке открывает
   * суб-экран приведения хранилища, только если они есть.
   */
  gaps?: RegistryGap[];
}

/** Имена для проверки уникальности: обычное окружение, основная запись вне списка имён. */
export function realNamesOf(ctx: ReducerCtx): string[] {
  return ctx.realNames ?? ctx.envNames;
}

/** View, за которыми стоит дочерний процесс (его и отменяет Esc); файловые view формы — вне списка. */
const PROCESS_VIEWS: Record<'ext' | 'create' | 'mcp', readonly string[]> = {
  ext: ['installing', 'updating', 'removing', 'resolving'],
  create: ['installing', 'updating', 'removing', 'mcp-submitting'],
  mcp: ['submitting', 'removing'],
};

/** Показан ли экран процесса: единственный источник правды для заявки на отмену. */
export function busyProcessView(state: AppState): boolean {
  if (state.ext !== null && PROCESS_VIEWS.ext.includes(state.ext.view)) return true;
  if (state.create !== null && PROCESS_VIEWS.create.includes(state.create.view)) return true;
  if (state.mcp !== null && PROCESS_VIEWS.mcp.includes(state.mcp.view)) return true;
  return false;
}

/**
 * Общий конструктор контекста для run.ts и run-side.ts.
 * `envNames` — строки списка окружений (с основной записью), `realNames` — имена обычных
 * окружений для проверки уникальности; по умолчанию совпадают.
 */
export function makeCtx(
  envNames: string[], twoColumns: boolean, trashNames: string[] = [], realNames: string[] = envNames,
  conflicts: PackageConflict[] = [], gaps: RegistryGap[] = [],
): ReducerCtx {
  return { envNames, realNames, twoColumns, trashNames, conflicts, gaps };
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
    const next = createReducer(state.create, action, state.catalog, realNamesOf(ctx), state.language);
    if (next === null) return { ...state, sub: null, create: null };
    return { ...state, create: next };
  }
  if (state.tab === 'extensions' && state.ext !== null) {
    const next = extMachine(state, action, ctx);
    if (next !== null) return next;
  }
  if (state.tab === 'mcp' && state.mcp !== null) {
    const next = mcpMachine(state, action);
    if (next !== null) return next;
  }
  if (state.tab === 'envs' && state.trash !== null) {
    const next = trashMachine(state, action, ctx);
    if (next !== null) return next;
  }
  if (state.tab === 'envs' && state.clone !== null) {
    const next = cloneMachine(state, action, ctx);
    if (next !== null) return next;
  }
  if (state.tab === 'update' && state.updateUi !== null) {
    const next = updateMachine(state, action);
    if (next !== null) return next;
  }
  return reducerMain(state, action, ctx);
}

/** Результаты сервисных действий; null — действие не обработано (продолжаем машинами). */
function applyResults(state: AppState, action: Action, ctx: ReducerCtx): AppState | null {
  if (typeof action !== 'object') return null;
  if (action.type === 'edit-start') {
    if (state.sub !== null || state.tab !== 'envs') return state;
    return {
      ...state,
      sub: 'create',
      create: freshEdit(
        action.name, action.settings, state.catalog, action.mcp ?? [], action.main,
        action.store ?? false, action.storeRoots ?? false, action.storeBroken ?? false,
        action.enabledModels ?? [], action.modelCatalog ?? state.catalog.providers,
      ),
    };
  }
  if (action.type === 'run-result') return { ...state, sub: null };
  if (action.type === 'updates-result') return applyUpdatesResult(state, action);
  if (action.type === 'mcp-result' && action.scope === 'main') return applyMcpResultMain(state, action);
  if (action.type === 'mcp-live-result' && action.scope === 'main') return applyMcpLiveMain(state, action);
  if (action.type === 'trash-result') return applyTrashResult(state, action, ctx);
  if (action.type === 'create-open') {
    if (state.sub !== null || state.tab !== 'envs') return state;
    // Созданное «из основного» получает хранилище выключенным: копия каталога main-агента
    // ожидаема, а основная запись остаётся обычной, пока пользователь не включит сам.
    // Пикер «Модели» в создании читает каталог того агента, из которого создаётся окружение.
    return {
      ...state,
      sub: 'create',
      create: freshCreate({ store: action.fromMain !== true, modelCatalog: state.catalog.providers }),
    };
  }
  if (action.type === 'clone-start') {
    if (state.tab !== 'envs' || state.sub !== null || state.trash !== null || state.clone !== null) return state;
    return { ...state, clone: freshClone(action.name, action.path, state.language) };
  }
  if (action.type === 'clone-result') return applyCloneResult(state, action, ctx);
  if (action.type === 'self-update-result') return applySelfUpdateResult(state, action.info);
  if (action.type === 'changelog-result') return applyChangelogResult(state, action.ok, action.rows);
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
    (action.type === 'install-result' && extView === 'installing') ||
    (action.type === 'resolve-result' && extView === 'resolving');
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
  // `S` — разрешить конфликт источников пакета (только на списке вкладки «Расширения»).
  if (action === 'S' && state.sub === null && state.ext === null && state.mcp === null &&
      state.tab === 'extensions') return onS(state, ctx);
  if (action === 'R') return state.tab === 'update' ? onRefreshUpdate(state) : onRefreshMcp(state);
  return state;
}

function onEsc(state: AppState): AppState {
  if (state.sub !== null) return { ...state, sub: null };
  return { ...state, quit: true };
}

function onTab(state: AppState): AppState {
  const tabs = tabsOf(state);
  const next = tabs[(tabs.indexOf(state.tab) + 1) % tabs.length];
  return { ...state, tab: next, focus: 'left', selected: 0, sub: null, ext: null, mcp: null, trash: null, clone: null };
}

function onUpDown(state: AppState, delta: number, ctx: ReducerCtx): AppState {
  if (state.sub !== null) return state;
  const len = listLength(state.tab, ctx.envNames.length, packagesOf(state, state.tab).length, state.catalog.mcp.length);
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
  if (state.selected === envNames.length) return { ...state, sub: 'create', create: freshCreate() };
  return { ...state, trash: freshTrash() }; // строка «Корзина (N)»
}

function enterExtensions(state: AppState): AppState {
  const pkgs = packagesOf(state, 'extensions');
  const n = pkgs.length;
  if (state.selected < n) {
    return { ...state, ext: freshExt({ view: 'updating', updating: pkgs[state.selected].name }) };
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
  if (state.selected === 3) return { ...state, recheckMcp: !state.recheckMcp };
  return state;
}

/**
 * `S` на вкладке «Расширения»: (а) на строке пакета с конфликтом источников — суб-экран
 * выбора победителя; (б) если конфликта на строке нет, но реестр хранилища отстал от
 * объявлений окружений (`ctx.gaps`) — суб-экран приведения хранилища. Ключ строки —
 * идентичность её источника (`pkgIdentity`), поэтому пакет с другим scope (другой пакет по
 * меркам pi) конфликта не имеет и разрешение на нём не открывается.
 *
 * (б) — это и точка повтора после провала шага в хранилище: объявления уже переписаны,
 * `packageConflicts` пуст, и без этого входа привести реестр к победителю было нечем.
 */
function onS(state: AppState, ctx: ReducerCtx): AppState {
  const p = packagesOf(state, 'extensions')[state.selected];
  if (p !== undefined) {
    const key = pkgIdentity(p.source);
    if (ctx.conflicts?.some((c) => c.name === key) === true) {
      return { ...state, ext: freshExt({ view: 'resolve', conflictName: key, cursor: 0 }) };
    }
  }
  if ((ctx.gaps?.length ?? 0) === 0) return state;
  return { ...state, ext: freshExt({ view: 'gap', cursor: 0 }) };
}

function onX(state: AppState): AppState {
  if (state.tab === 'extensions') {
    const pkgs = packagesOf(state, 'extensions');
    const n = pkgs.length;
    if (state.selected < n) {
      return { ...state, ext: freshExt({ view: 'confirm-remove', removing: pkgs[state.selected].name }) };
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

