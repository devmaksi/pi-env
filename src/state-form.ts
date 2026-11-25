import { validateName, envSkillDirName, type EnvSettings } from './create.js';
import { normalizePkgSource, type Catalog, type CatalogPkg, type Provider } from './catalog.js';
import { isPrintable, type McpFormAdd } from './state-mcp.js';
import type { McpLiveReport, McpServer } from './mcp.js';
import type { Action, PkgCheck } from './state.js';

export type CreateView = 'form' | 'providers' | 'models' | 'model-list' | 'store-confirm' | 'store-op' | 'tools' | 'packages' | 'skills' | 'submitting' | 'updating' | 'confirm-delete' | 'deleting' | 'confirm-remove' | 'removing' | 'install' | 'installing' | 'mcp' | 'mcp-op' | 'mcp-submitting' | 'mcp-confirm-remove';

/** Строка-кнопка в конце списка расширений. */
export const UPDATE_ALL_ROW = 'Обновить все'; // внутренний ID, не отображается — подпись через i18n

/** Кнопка «Установить» в конце списка пакетов. */
export const INSTALL_ROW = 'Установить'; // внутренний ID, не отображается — подпись через i18n

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
  /** Форма основного агента: имя не редактируется, «Удалить» нет, ресурсы не синхронизируются. */
  main: boolean;
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
  /** Ссылки `провайдер/модель`, доступные окружению ([] — все модели каталога). */
  modelsSel: string[];
  /** Каталог моделей правленного окружения: источник пикера. */
  modelCatalog: Provider[];
  /** Пользователь менял пикер — только тогда пишется `enabledModels`. */
  modelsTouched: boolean;
  /** Каталог моделей окружения лежит в хранилище (models.json — симлинк). */
  store: boolean;
  mcpOp: { name: string; kind: 'copy' | 'remove' } | null;
  removingMcp: string | null;
  /** Проверка живого статуса MCP в списке формы и её результат. */
  mcpCheck: PkgCheck;
  mcpLive: McpLiveReport | null;
}

/** Индексы строк формы. */
export const ROW_NAME = 0;
export const ROW_MODEL = 1;
export const ROW_MODELS = 2;
export const ROW_STORE = 3;
export const ROW_TOOLS = 4;
export const ROW_PACKAGES = 5;
export const ROW_SKILLS = 6;
export const ROW_MCP = 7;
export const ROW_ACTION = 8;
export const ROW_DELETE = 9;

export const FORM_ROWS = 9; // имя, модель, модели, хранилище, инструменты, расширения, скиллы, MCP, действие

/** Число строк формы: в edit-режиме добавляется «Удалить», у основного агента — нет. */
export function formRows(mode: 'create' | 'edit', main = false): number {
  return mode === 'edit' && !main ? FORM_ROWS + 1 : FORM_ROWS;
}
export const MAX_NAME = 40;

export function freshCreate(over: Partial<CreateState> = {}): CreateState {
  return {
    name: '', caret: 0, cursor: 0, provider: null, model: null,
    mode: 'create', origName: null, main: false,
    tools: [], packages: [], skills: [], view: 'form', error: null, done: null,
    modelsSel: [], modelCatalog: [], modelsTouched: false, store: true,
    removing: null, installCatalog: [], installStatus: 'idle', installing: null, query: '',
    check: 'idle', latest: {},
    mcpAdd: null, envMcp: [], mcp: [], mcpOp: null, removingMcp: null, mcpCheck: 'idle', mcpLive: null,
    ...over,
  };
}

/** Чистая форма редактирования: предзаполнение из settings окружения. */
export function freshEdit(
  name: string,
  settings: EnvSettings,
  catalog: Catalog,
  envMcp: McpServer[] = [],
  main = false,
  store = false,
  enabledModels: string[] = [],
  modelCatalog: Provider[] = catalog.providers,
): CreateState {
  const ext = settings.extensions ?? [];
  const sk = settings.skills ?? [];
  return {
    mode: 'edit',
    origName: name,
    main,
    name,
    caret: name.length,
    cursor: 0,
    provider: settings.defaultProvider ?? null,
    model: settings.defaultModel ?? null,
    tools: catalog.tools.filter((t) => ext.includes(`extensions/${t.name}`)).map((t) => t.name),
    packages: (settings.packages ?? []).map((s) => normalizePkgSource(s, catalog.packages)),
    skills: catalog.skills.filter((s) => sk.includes(`skills/${envSkillDirName(s)}`)).map((s) => s.name),
    view: 'form',
    error: null,
    done: null,
    modelsSel: [...enabledModels], modelCatalog, modelsTouched: false, store,
    removing: null, installCatalog: [], installStatus: 'idle', installing: null, query: '',
    check: 'idle', latest: {},
    mcpAdd: null, envMcp, mcp: [], mcpOp: null, removingMcp: null, mcpCheck: 'idle', mcpLive: null,
  };
}

/** Кламп курсора к длине списка: пусто — 0. Двигает курсор только вниз. */
export function clampToLen(cursor: number, len: number): number {
  return len === 0 ? 0 : Math.min(cursor, len - 1);
}

/** Строки пакета в форме: каталог main-агента + только-в-окружении. */
export function packageListSources(c: CreateState, catalog: Catalog): string[] {
  const sources = catalog.packages.map((p) => p.source);
  for (const s of c.packages) if (!sources.includes(s)) sources.push(s);
  return sources;
}

/** Строки пикера моделей: ссылки каталога + сохранённые ссылки, которых в каталоге нет. */
export function modelRows(c: CreateState, providers: Provider[] = c.modelCatalog): Array<{ ref: string; missing: boolean }> {
  const rows: Array<{ ref: string; missing: boolean }> = [];
  for (const p of providers) for (const m of p.models) rows.push({ ref: `${p.name}/${m.id}`, missing: false });
  for (const ref of c.modelsSel) if (!rows.some((r) => r.ref === ref)) rows.push({ ref, missing: true });
  return rows;
}

/** Ссылка модели по умолчанию в форме (или null — модель не выбрана). */
export function defaultModelRef(c: CreateState): string | null {
  if (c.model === null) return null;
  return c.provider !== null ? `${c.provider}/${c.model}` : c.model;
}

export function formReducer(c: CreateState, action: Action, envNames: string[], language: string): CreateState | null {
  if (action === 'esc') return null;
  if (action === 'up' || action === 'down') {
    const delta = action === 'up' ? -1 : 1;
    return { ...c, cursor: (c.cursor + delta + formRows(c.mode, c.main)) % formRows(c.mode, c.main) };
  }
  if (c.cursor === ROW_NAME) {
    if (action === 'left') return { ...c, caret: Math.max(0, c.caret - 1) };
    if (action === 'right') return { ...c, caret: Math.min(c.name.length, c.caret + 1) };
    // Имя основного агента — имя его каталога: оно не редактируется (каретка ходит).
    if (c.main) return c;
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
    if (c.cursor === ROW_MODELS) return { ...c, view: 'model-list', cursor: 0 };
    // Хранилище: включение — разрушительная операция (копия уходит в корзину), нужно
    // подтверждение; выключение — обычная, делаем сразу.
    if (c.cursor === ROW_STORE) return { ...c, view: c.store ? 'store-op' : 'store-confirm' };
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
export function listViewReducer(
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
