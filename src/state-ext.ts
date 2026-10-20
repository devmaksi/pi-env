import { filterPackages, type CatalogPkg } from './catalog.js';
import { clampToLen } from './state-form.js';
import { isPrintable } from './state-mcp.js';
import type { AppState, Action } from './state.js';

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

/** Пустое состояние вкладки «Расширения» с переопределением полей. */
export function freshExt(partial: Partial<ExtState>): ExtState {
  return { view: 'catalog', cursor: 0, updating: null, installing: null, removing: null, catalog: [], catalogStatus: 'loading', query: '', ...partial };
}

/**
 * Машина вкладки «Расширения» (вызывается, когда tab === 'extensions' && ext !== null).
 * null — непроцессированные клавиши (такие как tab) падают в общую машину.
 */
export function extMachine(state: AppState, action: Action): AppState | null {
  const ext = state.ext!;
  if (ext.view === 'catalog') return extCatalog(state, ext, action);
  if (ext.view === 'confirm-remove') {
    if (action === 'esc') return { ...state, ext: null };
    if (action === 'enter') return { ...state, ext: { ...ext, view: 'removing' } };
    return null; // в общую машину
  }
  // updating/installing/removing — клавиши процесс не отменяют
  return state;
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
