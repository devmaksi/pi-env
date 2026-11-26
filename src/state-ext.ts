import { filterPackages, type CatalogPkg } from './catalog.js';
import { conflictSources, type ConflictSource, type PackageConflict } from './environments.js';
import { clampToLen } from './state-form.js';
import { isPrintable } from './state-mcp.js';
import type { AppState, Action, ReducerCtx } from './state.js';

/** Подэкраны вкладки «Расширения». */
export type ExtView =
  | 'catalog' | 'installing' | 'updating' | 'confirm-remove' | 'removing'
  | 'resolve' | 'resolving';

export interface ExtState {
  view: ExtView;
  /** Курсор текущего списка: пикер каталога — по пакетам, `resolve` — по источникам. */
  cursor: number;
  updating: string | null;
  installing: string | null;
  removing: string | null;
  /** Идентичность пакета (`pkgIdentity`) конфликта, который разрешает суб-экран. */
  conflictName: string | null;
  /** Выбранный источник-победитель (view `resolving`). */
  resolving: string | null;
  catalog: CatalogPkg[];
  catalogStatus: 'loading' | 'ready' | 'error';
  query: string;
}

/** Пустое состояние вкладки «Расширения» с переопределением полей. */
export function freshExt(partial: Partial<ExtState>): ExtState {
  return {
    view: 'catalog', cursor: 0, updating: null, installing: null, removing: null,
    conflictName: null, resolving: null, catalog: [], catalogStatus: 'loading', query: '',
    ...partial,
  };
}

/**
 * Машина вкладки «Расширения» (вызывается, когда tab === 'extensions' && ext !== null).
 * null — непроцессированные клавиши (такие как tab) падают в общую машину.
 */
export function extMachine(state: AppState, action: Action, ctx: ReducerCtx): AppState | null {
  const ext = state.ext!;
  if (ext.view === 'catalog') return extCatalog(state, ext, action);
  if (ext.view === 'resolve') return extResolve(state, ext, action, ctx);
  if (ext.view === 'confirm-remove') {
    if (action === 'esc') return { ...state, ext: null };
    if (action === 'enter') return { ...state, ext: { ...ext, view: 'removing' } };
    return null; // в общую машину
  }
  // updating/installing/removing/resolving — клавиши процесс не отменяют
  return state;
}

/**
 * Суб-экран «Разрешить конфликт источников»: ↑↓ по уникальным источникам группы,
 * Enter — применить выбранный (выполняет цикл: объявления окружений + хранилище),
 * Esc — закрыть. Варианты берутся из снимка окружений (`ctx.conflicts`), поэтому
 * окружения, объявившие один и тот же источник, не плодят лишних строк.
 */
function extResolve(state: AppState, ext: ExtState, action: Action, ctx: ReducerCtx): AppState | null {
  const sources = conflictSourcesOf(ctx, ext.conflictName);
  if (action === 'up' || action === 'down') {
    if (sources.length === 0) return state;
    const delta = action === 'up' ? -1 : 1;
    return { ...state, ext: { ...ext, cursor: (ext.cursor + delta + sources.length) % sources.length } };
  }
  if (action === 'esc') return { ...state, ext: null };
  if (action === 'enter') {
    const chosen = sources[ext.cursor];
    if (chosen === undefined) return state;
    return { ...state, ext: { ...ext, view: 'resolving', resolving: chosen.source } };
  }
  return null;
}

/** Источники конфликта по имени пакета; конфликта в снимке нет — пустой список. */
export function conflictSourcesOf(ctx: ReducerCtx, name: string | null): ConflictSource[] {
  if (name === null) return [];
  const conf: PackageConflict | undefined = ctx.conflicts?.find((c) => c.name === name);
  return conf === undefined ? [] : conflictSources(conf);
}

function extCatalog(state: AppState, ext: ExtState, action: Action): AppState | null {
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
  return null; // в общую машину
}
