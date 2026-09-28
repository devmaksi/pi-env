import { validateName, baseName, type EnvSettings } from './create.js';
import type { Catalog } from './catalog.js';

export type Tab = 'envs' | 'settings' | 'about';
export type Sub = 'create' | 'run' | null;

export type ControlKey =
  | 'up' | 'down' | 'left' | 'right'
  | 'tab' | 'enter' | 'space' | 'esc' | 'ctrlc' | 'backspace';

/** Управление (ControlKey) или любой одиночный печатный символ. */
export type Key = ControlKey | (string & {});

export type CreateView = 'form' | 'providers' | 'models' | 'tools' | 'packages' | 'skills' | 'submitting' | 'confirm-delete' | 'deleting';

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
}

export interface AppState {
  tab: Tab;
  focus: 'left' | 'right';
  selected: number;
  sub: Sub;
  colorToggle: boolean;
  quit: boolean;
  catalog: Catalog;
  create: CreateState | null;
}

export const TABS: readonly Tab[] = ['envs', 'settings', 'about'];
export const SETTINGS_COUNT = 2;
export const FORM_ROWS = 6; // имя, модель, инструменты, расширения, скиллы, действие

/** Число строк формы: в edit-режиме добавляется «Удалить». */
export function formRows(mode: 'create' | 'edit'): number {
  return mode === 'edit' ? FORM_ROWS + 1 : FORM_ROWS;
}
export const MAX_NAME = 40;

export function initialState(catalog: Catalog = emptyCatalog()): AppState {
  return {
    tab: 'envs', focus: 'left', selected: 0, sub: null, colorToggle: true, quit: false,
    catalog, create: null,
  };
}

export function emptyCatalog(): Catalog {
  return { providers: [], tools: [], packages: [], skills: [] };
}

export function freshCreate(): CreateState {
  return {
    name: '', caret: 0, cursor: 0, provider: null, model: null,
    mode: 'create', origName: null,
    tools: [], packages: [], skills: [], view: 'form', error: null, done: null,
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
    packages: catalog.packages.filter((p) => (settings.packages ?? []).includes(p.name)).map((p) => p.name),
    skills: catalog.skills.filter((s) => {
      const base = baseName(s.path);
      return sk.includes(`skills/${base}`) || sk.includes(`skills/${s.name}`);
    }).map((s) => s.name),
    view: 'form',
    error: null,
    done: null,
  };
}

/** Клавиша или сервисное действие (результат создания). */
export type Action =
  | Key
  | { type: 'create-result'; ok: boolean; message: string }
  | { type: 'edit-start'; name: string; settings: EnvSettings }
  | { type: 'run-result'; ok: boolean }
  | { type: 'delete-result'; ok: boolean; message: string };

export function listLength(tab: Tab, envCount: number): number {
  if (tab === 'envs') return envCount + 1; // окружения + «Создать»
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
  }

  if (state.sub === 'create' && state.create !== null) {
    const next = createReducer(state.create, action, state.catalog, envNames);
    if (next === null) return { ...state, sub: null, create: null };
    return { ...state, create: next };
  }

  if (action === 'esc') {
    if (state.sub !== null) return { ...state, sub: null };
    return { ...state, quit: true };
  }
  if (action === 'tab') {
    const idx = TABS.indexOf(state.tab);
    const next = TABS[(idx + 1) % TABS.length];
    return { ...state, tab: next, focus: 'left', selected: 0, sub: null };
  }
  if (action === 'up' || action === 'down') {
    if (state.sub !== null) return state;
    const len = listLength(state.tab, envNames.length);
    if (len === 0) return state;
    const delta = action === 'up' ? -1 : 1;
    const selected = Math.min(len - 1, Math.max(0, state.selected + delta));
    return { ...state, selected };
  }
  if (action === 'left' || action === 'right') {
    if (state.tab !== 'envs' || state.sub !== null || !twoColumns) return state;
    return { ...state, focus: state.focus === 'left' ? 'right' : 'left' };
  }
  if (action === 'enter') {
    if (state.sub !== null || state.tab !== 'envs') return state;
    if (state.selected < envNames.length) return { ...state, sub: 'run' };
    return { ...state, sub: 'create', create: freshCreate() };
  }
  if (action === 'space') {
    if (state.tab !== 'settings' || state.sub !== null || state.selected !== 1) return state;
    return { ...state, colorToggle: !state.colorToggle };
  }
  return state;
}

function isPrintable(a: Action): a is string {
  return typeof a === 'string' && a.length === 1 && a.charCodeAt(0) >= 0x21 && a.charCodeAt(0) <= 0x7e;
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
  }

  switch (c.view) {
    case 'form':
      return formReducer(c, action, envNames);
    case 'providers':
      return listViewReducer(c, action, catalog.providers.map((p) => p.name), 'form', 1, (name) => {
        if (name === c.provider) return { ...c, provider: null, model: null, view: 'form', cursor: 1 };
        return { ...c, provider: name, view: 'models', cursor: 0 };
      });
    case 'models': {
      const provider = catalog.providers.find((p) => p.name === c.provider);
      return listViewReducer(c, action, (provider?.models ?? []).map((m) => m.id), 'providers', 0, (id) => ({
        ...c, model: c.model === id ? null : id, view: 'form', cursor: 1,
      }));
    }
    case 'tools':
    case 'packages':
    case 'skills': {
      const field = c.view;
      const row = field === 'tools' ? 2 : field === 'packages' ? 3 : 4;
      const items =
        field === 'tools' ? catalog.tools.map((t) => t.name)
        : field === 'packages' ? catalog.packages.map((p) => p.name)
        : catalog.skills.map((s) => s.name);
      return listViewReducer(c, action, items, 'form', row, (name) => {
        const sel = c[field];
        const next = sel.includes(name) ? sel.filter((x) => x !== name) : [...sel, name];
        return { ...c, [field]: next };
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
  }
}

function formReducer(c: CreateState, action: Action, envNames: string[]): CreateState | null {
  if (action === 'esc') return null;
  if (action === 'up' || action === 'down') {
    const delta = action === 'up' ? -1 : 1;
    return { ...c, cursor: (c.cursor + delta + formRows(c.mode)) % formRows(c.mode) };
  }
  if (c.cursor === 0) {
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
    if (c.cursor === 1) return { ...c, view: 'providers', cursor: 0 };
    if (c.cursor === 2) return { ...c, view: 'tools', cursor: 0 };
    if (c.cursor === 3) return { ...c, view: 'packages', cursor: 0 };
    if (c.cursor === 4) return { ...c, view: 'skills', cursor: 0 };
    if (c.cursor === 5) {
      const others = c.mode === 'edit' ? envNames.filter((n) => n !== c.origName) : envNames;
      const err = validateName(c.name, others);
      if (err !== null) return { ...c, error: err };
      return { ...c, view: 'submitting' };
    }
    if (c.cursor === 6 && c.mode === 'edit') return { ...c, view: 'confirm-delete' };
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
