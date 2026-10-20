import { filterPackages, type Catalog } from './catalog.js';
import { freshMcpForm, mcpFormStep, mcpListNames, isPrintable } from './state-mcp.js';
import {
  clampToLen, formRows, packageListSources, formReducer, listViewReducer,
  UPDATE_ALL_ROW, INSTALL_ROW,
  ROW_NAME, ROW_MODEL, ROW_TOOLS, ROW_PACKAGES, ROW_SKILLS, ROW_MCP,
  type CreateState, type CreateView,
} from './state-form.js';
import { isResultAction, type Action } from './state.js';

type ViewHandler = (c: CreateState, action: Action, catalog: Catalog, envNames: string[], language: string) => CreateState | null;

const passThrough: ViewHandler = (c) => c; // клавиши процесс не отменяют — ждём результат

/** Результаты pi-команд в форме; c — action не результат. null — закрыть форму. */
function createResultReducer(c: CreateState, action: Action, catalog: Catalog): CreateState | null {
  if (typeof action !== 'object') return c;
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
  // Живой статус: успех — по содержимому stdout (pi mcp list выходит 1 при неподключённых).
  if (action.type === 'mcp-live-result') {
    if (action.report === null) return { ...c, mcpCheck: 'error' };
    return { ...c, mcpCheck: 'done', mcpLive: action.report };
  }
  return c;
}

const viewProviders: ViewHandler = (c, action, catalog) =>
  listViewReducer(c, action, catalog.providers.map((p) => p.name), 'form', ROW_MODEL, (name) => {
    if (name === c.provider) return { ...c, provider: null, model: null, view: 'form', cursor: ROW_MODEL };
    return { ...c, provider: name, view: 'models', cursor: ROW_NAME };
  });

const viewModels: ViewHandler = (c, action, catalog) => {
  const provider = catalog.providers.find((p) => p.name === c.provider);
  return listViewReducer(c, action, (provider?.models ?? []).map((m) => m.id), 'providers', ROW_NAME, (id) => ({
    ...c, model: c.model === id ? null : id, view: 'form', cursor: ROW_MODEL,
  }));
};

const viewToolsSkills: ViewHandler = (c, action, catalog) => {
  const field = c.view as 'tools' | 'skills';
  const row = field === 'tools' ? ROW_TOOLS : ROW_SKILLS;
  const items =
    field === 'tools' ? catalog.tools.map((t) => t.name)
    : catalog.skills.map((s) => s.name);
  return listViewReducer(c, action, items, 'form', row, (name) => {
    const sel = c[field];
    const next = sel.includes(name) ? sel.filter((x) => x !== name) : [...sel, name];
    return { ...c, [field]: next };
  });
};

const viewPackages: ViewHandler = (c, action, catalog) => {
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
};

const viewInstall: ViewHandler = (c, action) => {
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
};

const viewMcpAddStep: ViewHandler = (c, action, _catalog, _envNames, language) => {
  const step = mcpFormStep(c.mcpAdd!, action, language);
  if (step === null) return c;
  if (step.kind === 'form') return { ...c, mcpAdd: step.form };
  if (step.kind === 'close') return { ...c, mcpAdd: null };
  return { ...c, view: 'mcp-submitting' };
};

function mcpEditPick(c: CreateState, name: string | undefined, catalog: Catalog, inEnv: (n: string) => boolean): CreateState {
  if (name === undefined) return c;
  const inMain = catalog.mcp.some((s) => s.name === name);
  if (inMain && !inEnv(name)) return { ...c, view: 'mcp-op', mcpOp: { name, kind: 'copy' } };
  if (inEnv(name)) return { ...c, view: 'mcp-op', mcpOp: { name, kind: 'remove' } };
  return c;
}

function viewMcp(c: CreateState, action: Action, catalog: Catalog): CreateState {
  if (action === 'R') return c.mcpCheck === 'checking' ? c : { ...c, mcpCheck: 'checking' };
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
    const name = names[c.cursor];
    if (c.mode === 'edit') {
      if (c.cursor === names.length) return { ...c, mcpAdd: freshMcpForm() };
      return mcpEditPick(c, name, catalog, inEnv);
    }
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

const CREATE_VIEWS: Record<CreateView, ViewHandler> = {
  form: (c, action, _catalog, envNames, language) => formReducer(c, action, envNames, language),
  providers: viewProviders,
  models: viewModels,
  tools: viewToolsSkills,
  skills: viewToolsSkills,
  packages: viewPackages,
  submitting: (c, action) => (c.view === 'submitting' && action === 'esc' ? { ...c, view: 'form' } : c),
  'confirm-delete': (c, action) => {
    if (action === 'esc') return { ...c, view: 'form', cursor: formRows(c.mode) - 1 };
    if (action === 'enter') return { ...c, view: 'deleting' };
    return c;
  },
  deleting: (c, action) => (action === 'esc' ? { ...c, view: 'form' } : c),
  updating: (c, action) => (action === 'esc' ? { ...c, view: 'packages', cursor: 0 } : c),
  'confirm-remove': (c, action) => {
    if (action === 'esc') return { ...c, view: 'packages', removing: null };
    if (action === 'enter') return { ...c, view: 'removing' };
    return c;
  },
  removing: (c, action) => {
    // Esc не отменяет процесс — имя храним до прихода remove-result
    return action === 'esc' ? { ...c, view: 'packages' } : c;
  },
  install: viewInstall,
  installing: passThrough,
  mcp: (c, action, catalog, envNames, language) =>
    c.mcpAdd !== null ? viewMcpAddStep(c, action, catalog, envNames, language) : viewMcp(c, action, catalog),
  'mcp-confirm-remove': (c, action) => {
    if (action === 'esc') return { ...c, view: 'mcp', removingMcp: null };
    if (action === 'enter') {
      const name = c.removingMcp;
      return name === null ? c : { ...c, view: 'mcp-op', mcpOp: { name, kind: 'remove' }, removingMcp: null };
    }
    return c;
  },
  'mcp-op': passThrough,
  'mcp-submitting': passThrough,
};

/**
 * Машина создания окружения. Возвращает null — закрыть суб-экран.
 * null из createReducer обрабатывает внешний reducer.
 */
export function createReducer(
  c: CreateState,
  action: Action,
  catalog: Catalog,
  envNames: string[],
  language: string,
): CreateState | null {
  if (isResultAction(action)) return createResultReducer(c, action, catalog);
  return CREATE_VIEWS[c.view](c, action, catalog, envNames, language);
}
