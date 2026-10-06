import type { Layout } from './layout.js';
import {
  MCP_EXPOSURES,
  MCP_TYPES,
  mcpFormRows,
  mcpListNames,
  packageListSources,
  type AppState,
  type CreateState,
  type ExtState,
  type McpFormAdd,
  type McpTab,
} from './state.js';
import type { Environment } from './environments.js';
import { filterPackages } from './catalog.js';
import {
  c,
  ANSI,
  padRight,
  listRow,
  truncateName,
  pkgInfoLines,
  pkgMarker,
  formPkgMarker,
  catalogPickerLines,
  PKG_NAME_MAX,
  mcpInfoLines,
} from './render.js';
import { t, type StrKey } from './i18n.js';

/** Контекст рендера: раскладка и параметры кадра, общие для всех секций. */
export interface Ctx {
  state: AppState;
  L: Layout;
  useColor: boolean;
  inner: number;
  contentRows: number;
  twoCol: boolean;
  root: string;
  lang: string;
}

/** Результат секции: колонки и номер курсорной строки в left (−1 — нет списка). */
export interface Section {
  left: string[];
  right: string[];
  cursorRow: number;
}
/** Суб-экран создания/редактирования окружения: диспетчер по view. */
export function renderCreate(cr: CreateState, ctx: Ctx): Section {
  const r =
    cr.view === 'form' ? createForm(cr, ctx)
    : cr.view === 'packages' ? createPackages(cr, ctx)
    : cr.view === 'mcp' ? createMcp(cr, ctx)
    : cr.view === 'install' ? createInstall(cr, ctx)
    : cr.view === 'providers' || cr.view === 'models' || cr.view === 'tools' || cr.view === 'skills'
      ? createSelects(cr, ctx)
      : createBusy(cr, ctx);
  if (!ctx.twoCol) r.left.push(...r.right);
  return r;
}

/** Форма создания: поля и действия. */
function createForm(cr: CreateState, ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const caret = cr.caret < cr.name.length
    ? cr.name.slice(0, cr.caret) + '▌' + cr.name.slice(cr.caret)
    : cr.name + '▌';
  const model = cr.provider && cr.model ? cr.provider + '/' + cr.model : cr.provider ?? '—';
  const rows = [
    t(ctx.lang, 'form.name') + caret,
    t(ctx.lang, 'form.model') + model,
    t(ctx.lang, 'form.tools') + cr.tools.length,
    t(ctx.lang, 'form.packages') + cr.packages.length,
    t(ctx.lang, 'form.skills') + cr.skills.length,
    t(ctx.lang, 'form.mcp') + (cr.mode === 'edit' ? cr.envMcp.length : cr.mcp.length),
    cr.done !== null ? t(ctx.lang, 'form.done') : cr.mode === 'edit' ? t(ctx.lang, 'form.save') : t(ctx.lang, 'form.create'),
  ];
  if (cr.mode === 'edit' && cr.done === null) rows.push(t(ctx.lang, 'form.delete'));
  rows.forEach((t, i) => left.push(listRow(i, cr.cursor, t, ctx.L.leftWidth, ctx.useColor)));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'form.hint.enter') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'form.hint.space') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'form.hint.esc') + c(ANSI.reset, ctx.useColor));
  if (cr.error) right.push(c(ANSI.bold, ctx.useColor) + '⚠ ' + cr.error + c(ANSI.reset, ctx.useColor));
  if (cr.done !== null) right.push(c(ANSI.bold, ctx.useColor) + (cr.mode === 'edit' ? t(ctx.lang, 'form.updated', { v: cr.done }) : t(ctx.lang, 'form.created', { v: cr.done })) + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: cr.cursor };
}

/** Список пакетов окружения: маркеры, кнопки, инфо-панель. */
function createPackages(cr: CreateState, ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const latest = cr.latest;
  const check = cr.check;
  const sources = packageListSources(cr, ctx.state.catalog);
  left.push(c(ANSI.bold, ctx.useColor) + t(ctx.lang, 'pkgs.title') + c(ANSI.reset, ctx.useColor));
  if (sources.length === 0) left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'empty') + c(ANSI.reset, ctx.useColor));
  sources.forEach((src, i) => {
    const p = ctx.state.catalog.packages.find((x) => x.source === src);
    const name = p !== undefined ? p.name : src.replace(/^npm:/, '');
    const marker = formPkgMarker(src, name, p !== undefined, check, latest, ctx.lang);
    const text = (cr.packages.includes(src) ? '✓ ' : '  ') + truncateName(name, PKG_NAME_MAX) + '  ' + marker;
    left.push(listRow(i, cr.cursor, text, ctx.L.leftWidth, ctx.useColor));
  });
  const buttons: Array<[string, string]> = [['↑', t(ctx.lang, 'btn.update-all')]];
  if (cr.mode === 'edit') buttons.push(['＋', t(ctx.lang, 'btn.install')]);
  buttons.forEach(([icon, label], j) => {
    left.push(listRow(sources.length + j, cr.cursor, icon + ' ' + label, ctx.L.leftWidth, ctx.useColor));
  });
  const curSrc = sources[cr.cursor];
  const cur = curSrc !== undefined ? ctx.state.catalog.packages.find((x) => x.source === curSrc) : undefined;
  if (cur !== undefined) {
    right.push(...pkgInfoLines(cur, check, latest, ctx.L, ctx.useColor, ctx.lang));
    right.push(t(ctx.lang, 'pkgs.in-env', { m: cr.packages.includes(cur.source) ? '✓' : '—' }));
  } else if (curSrc !== undefined) {
    right.push(c(ANSI.bold, ctx.useColor) + curSrc.replace(/^npm:/, '') + c(ANSI.reset, ctx.useColor));
    right.push(t(ctx.lang, 'pkgs.env-only'));
    right.push(t(ctx.lang, 'pkgs.in-env', { m: '✓' }));
  } else if (cr.cursor === sources.length) {
    right.push(t(ctx.lang, 'btn.update-all'));
    right.push('pi update --extensions');
    right.push(t(ctx.lang, 'pkgs.hint.run'));
  } else if (cr.mode === 'edit') {
    right.push(t(ctx.lang, 'install.title'));
    right.push(t(ctx.lang, 'install.catalog'));
    right.push(t(ctx.lang, 'install.hint.open'));
  }
  if (cr.error) right.push(c(ANSI.bold, ctx.useColor) + '⚠ ' + cr.error + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.select') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.delete') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.back') + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: 1 + cr.cursor };
}

/** Пикер каталога pi.dev: установка в окружение. */
function createInstall(cr: CreateState, ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  left.push(c(ANSI.bold, ctx.useColor) + t(ctx.lang, 'install.env', { name: cr.name }) + c(ANSI.reset, ctx.useColor));
  const pkgs = filterPackages(cr.installCatalog, cr.query);
  const picker = catalogPickerLines(pkgs, cr.query, cr.installStatus, cr.cursor, ctx.L, ctx.useColor, ctx.state.catalogProgress, ctx.lang);
  left.push(...picker.left);
  right.push(...picker.right);
  if (cr.error) right.push(c(ANSI.bold, ctx.useColor) + '⚠ ' + cr.error + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.back') + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: cr.installStatus === 'ready' ? 2 + cr.cursor : -1 };
}

/** Список MCP в форме окружения: create — отметки, edit — union + copy/remove. */
function createMcp(cr: CreateState, ctx: Ctx): Section {
  if (cr.mcpAdd !== null) {
    return renderMcpForm(cr.mcpAdd, ctx, t(ctx.lang, 'mcp.form.title-env', { name: cr.name }));
  }
  const left: string[] = [];
  const right: string[] = [];
  const mainMcp = ctx.state.catalog.mcp;
  const names = cr.mode === 'edit' ? mcpListNames(cr.envMcp, mainMcp) : mainMcp.map((s) => s.name);
  const inEnv = (n: string) => cr.envMcp.some((s) => s.name === n);
  const inMain = (n: string) => mainMcp.some((s) => s.name === n);
  const title = cr.mode === 'edit' ? t(ctx.lang, 'mcp.env-title', { name: cr.name }) : t(ctx.lang, 'mcp.title');
  left.push(c(ANSI.bold, ctx.useColor) + title + c(ANSI.reset, ctx.useColor));
  if (names.length === 0) left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'empty') + c(ANSI.reset, ctx.useColor));
  names.forEach((n, i) => {
    const checked = cr.mode === 'edit' ? inEnv(n) : cr.mcp.includes(n);
    const marker = cr.mode === 'edit' && inMain(n) && !inEnv(n) ? '  ' + t(ctx.lang, 'mcp.in-main') : '';
    left.push(listRow(i, cr.cursor, (checked ? '✓ ' : '  ') + n + marker, ctx.L.leftWidth, ctx.useColor));
  });
  if (cr.mode === 'edit') {
    left.push(listRow(names.length, cr.cursor, '＋ ' + t(ctx.lang, 'mcp.add'), ctx.L.leftWidth, ctx.useColor));
  }
  const curName = names[cr.cursor];
  if (curName !== undefined) {
    const main = mainMcp.find((s) => s.name === curName);
    if (main !== undefined) {
      right.push(...mcpInfoLines(main, ctx.L, ctx.useColor, ctx.lang));
      if (cr.mode === 'edit') right.push(t(ctx.lang, 'mcp.in-env', { m: inEnv(curName) ? '✓' : '—' }));
    } else {
      right.push(c(ANSI.bold, ctx.useColor) + curName + c(ANSI.reset, ctx.useColor));
      right.push(t(ctx.lang, 'mcp.in-env', { m: '✓' }));
    }
  } else if (cr.mode === 'edit' && cr.cursor === names.length) {
    right.push(t(ctx.lang, 'mcp.hint.add'));
  }
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.select') + c(ANSI.reset, ctx.useColor));
  if (cr.mode === 'edit') right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.delete') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.back') + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: 1 + cr.cursor };
}

/** Форма добавления MCP (общая для вкладки и формы окружения). */
export function renderMcpForm(f: McpFormAdd, ctx: Ctx, title: string): Section {
  const left: string[] = [];
  const right: string[] = [];
  const rows = mcpFormRows(f.type);
  const textRows = new Set(['name', 'command', 'args', 'env', 'cwd', 'description', 'url']);
  const selRow = f.select === 'type' ? rows.indexOf('type') : f.select === 'exposure' ? rows.indexOf('exposure') : f.cursor;
  left.push(c(ANSI.bold, ctx.useColor) + title + c(ANSI.reset, ctx.useColor));
  rows.forEach((row, i) => {
    let label = '';
    let value = '';
    switch (row) {
      case 'name':
        label = t(ctx.lang, 'form.mcp.name');
        value = f.name;
        break;
      case 'type':
        if (f.select === 'type') {
          value = t(ctx.lang, ('form.mcp.type.' + MCP_TYPES[f.cursor]) as StrKey);
        } else {
          label = t(ctx.lang, 'form.mcp.type');
          value = t(ctx.lang, ('form.mcp.type.' + f.type) as StrKey);
        }
        break;
      case 'command':
        label = t(ctx.lang, 'form.mcp.command');
        value = f.command;
        break;
      case 'args':
        label = t(ctx.lang, 'form.mcp.args');
        value = f.args;
        break;
      case 'url':
        label = t(ctx.lang, 'form.mcp.url');
        value = f.url;
        break;
      case 'env':
        label = t(ctx.lang, 'form.mcp.env');
        value = f.env;
        break;
      case 'cwd':
        label = t(ctx.lang, 'form.mcp.cwd');
        value = f.cwd;
        break;
      case 'description':
        label = t(ctx.lang, 'form.mcp.description');
        value = f.description;
        break;
      case 'exposure': {
        const opt = f.select === 'exposure' ? MCP_EXPOSURES[f.cursor] : (f.exposure ?? 'codemode');
        if (f.select !== 'exposure') label = t(ctx.lang, 'form.mcp.exposure');
        value = t(ctx.lang, ('form.mcp.exposure.' + opt) as StrKey);
        break;
      }
      case 'action':
        value = t(ctx.lang, 'form.mcp.action');
        break;
    }
    if (textRows.has(row) && i === f.cursor && f.select === null) {
      value = value.slice(0, f.caret) + '▌' + value.slice(f.caret);
    }
    left.push(listRow(i, selRow, label + value, ctx.L.leftWidth, ctx.useColor));
  });
  if (f.error) right.push(c(ANSI.bold, ctx.useColor) + '⚠ ' + f.error + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'form.hint.enter') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'form.hint.esc') + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: 1 + selRow };
}

/** Списки выбора: провайдер / модель / инструменты / скиллы. */
function createSelects(cr: CreateState, ctx: Ctx): Section {
  // вызывается диспетчером только для четырёх списочных view
  if (cr.view !== 'providers' && cr.view !== 'models' && cr.view !== 'tools' && cr.view !== 'skills') {
    return { left: [], right: [], cursorRow: -1 };
  }
  const left: string[] = [];
  const right: string[] = [];
  const items: string[] =
    cr.view === 'providers' ? ctx.state.catalog.providers.map((p) => p.name)
    : cr.view === 'models' ? (ctx.state.catalog.providers.find((p) => p.name === cr.provider)?.models ?? []).map((m) => m.id)
    : cr.view === 'tools' ? ctx.state.catalog.tools.map((t) => t.name)
    : ctx.state.catalog.skills.map((sk) => sk.name);
  const titles = {
    providers: t(ctx.lang, 'sel.providers'),
    models: cr.provider ? t(ctx.lang, 'sel.model', { p: cr.provider }) : t(ctx.lang, 'sel.model.plain'),
    tools: t(ctx.lang, 'sel.tools'),
    skills: t(ctx.lang, 'sel.skills'),
  } as const;
  left.push(c(ANSI.bold, ctx.useColor) + titles[cr.view] + c(ANSI.reset, ctx.useColor));
  const current = cr.view === 'providers' ? cr.provider : cr.view === 'models' ? cr.model : null;
  const checked = new Set(cr.view === 'tools' ? cr.tools : cr.skills);
  if (items.length === 0) left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'empty') + c(ANSI.reset, ctx.useColor));
  items.forEach((n, i) => {
    const sel = (current !== null && current === n) || checked.has(n);
    left.push(listRow(i, cr.cursor, (sel ? '✓ ' : '  ') + n, ctx.L.leftWidth, ctx.useColor));
  });
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.select') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.back') + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: 1 + cr.cursor };
}

// Заглушки и подтверждения создания: view → [текст, bold?, подсказки]
const CREATE_BUSY: Record<string, { text: (cr: CreateState, lang: string) => string; bold?: boolean; hints: StrKey[] }> = {
  'confirm-delete': { text: (cr, lang) => t(lang, 'busy.delete-env', { name: cr.name }), bold: true, hints: ['hint.confirm', 'hint.cancel'] },
  'deleting': { text: (_cr, lang) => t(lang, 'busy.deleting'), hints: ['hint.cancel'] },
  'submitting': { text: (_cr, lang) => t(lang, 'busy.creating'), hints: ['hint.cancel'] },
  'confirm-remove': { text: (cr, lang) => t(lang, 'busy.delete-ext', { name: cr.removing ?? '' }), bold: true, hints: ['hint.confirm', 'hint.cancel'] },
  'removing': { text: (_cr, lang) => t(lang, 'busy.deleting'), hints: ['hint.back'] },
  'updating': { text: (_cr, lang) => t(lang, 'busy.updating'), hints: ['hint.back'] },
  'installing': { text: (cr, lang) => t(lang, 'busy.installing', { name: cr.installing ?? '' }), hints: ['hint.back'] },
  'mcp-op': {
    text: (cr, lang) => (cr.mcpOp?.kind === 'remove' ? t(lang, 'busy.mcp-deleting') : t(lang, 'busy.mcp-add', { name: cr.mcpOp?.name ?? '' })),
    hints: ['hint.back'],
  },
  'mcp-submitting': { text: (cr, lang) => t(lang, 'busy.mcp-add', { name: cr.mcpAdd?.name ?? '' }), hints: ['hint.back'] },
  'mcp-confirm-remove': { text: (cr, lang) => t(lang, 'busy.mcp-remove', { name: cr.removingMcp ?? '' }), bold: true, hints: ['hint.confirm', 'hint.cancel'] },
};

function createBusy(cr: CreateState, ctx: Ctx): Section {
  const b = CREATE_BUSY[cr.view];
  const left = [c(b.bold ? ANSI.bold : ANSI.dim, ctx.useColor) + b.text(cr, ctx.lang) + c(ANSI.reset, ctx.useColor)];
  const right = b.hints.map((h) => c(ANSI.dim, ctx.useColor) + t(ctx.lang, h) + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: -1 };
}

/** Число позиций секции детализации, показываемых в инфо-панели. */
const MAX_DETAIL_ITEMS = 4;

/** Секция детализации: счётчик + до MAX_DETAIL_ITEMS позиций, дальше «+N ещё». */
function detailSection(title: string, items: string[], lines: string[], w: number, lang: string): void {
  lines.push(title + ': ' + items.length);
  for (const it of items.slice(0, MAX_DETAIL_ITEMS)) {
    lines.push('  ' + truncateName(it, Math.max(8, w - 4)));
  }
  if (items.length > MAX_DETAIL_ITEMS) {
    lines.push('  ' + t(lang, 'detail.more', { n: items.length - MAX_DETAIL_ITEMS }));
  }
}

/** Вкладка «Окружения»: список + инфо-панель выбранного (без слияния в узком режиме). */
export function renderEnvList(envs: Environment[], state: AppState, ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  interface Row { text: string; selected: boolean; isSep: boolean }
  const rows: Row[] = [];
  envs.forEach((e, i) => {
    rows.push({ text: (i === state.selected ? '> ' : '  ') + e.name, selected: i === state.selected, isSep: false });
    if (i === envs.length - 1) {
      rows.push({ text: '─'.repeat(ctx.L.leftWidth - 2), selected: false, isSep: true });
    }
  });
  rows.push({ text: (state.selected === envs.length ? '> ' : '  ') + t(ctx.lang, 'form.create'), selected: state.selected === envs.length, isSep: false });

  for (const r of rows) {
    if (r.isSep) {
      left.push(c(ANSI.dim, ctx.useColor) + r.text + c(ANSI.reset, ctx.useColor));
    } else if (r.selected) {
      left.push(c(ANSI.inverse, ctx.useColor) + padRight(r.text, ctx.L.leftWidth) + c(ANSI.reset, ctx.useColor));
    } else {
      left.push(r.text);
    }
  }

  if (state.selected < envs.length) {
    const e = envs[state.selected];
    const d = e.details;
    right.push(c(ANSI.bold, ctx.useColor) + e.name + c(ANSI.reset, ctx.useColor));
    right.push(t(ctx.lang, 'envs.path', { v: e.path }));
    right.push('settings.json ' + (d.hasSettings ? '✓' : '—'));
    right.push(t(ctx.lang, 'form.model') + (d.model ?? '—'));
    detailSection(t(ctx.lang, 'envs.tools'), d.tools, right, ctx.L.rightWidth, ctx.lang);
    detailSection(t(ctx.lang, 'envs.skills'), d.skills, right, ctx.L.rightWidth, ctx.lang);
    detailSection(t(ctx.lang, 'envs.extensions'), d.packages.map((s) => s.replace(/^npm:/, '')), right, ctx.L.rightWidth, ctx.lang);
    detailSection(t(ctx.lang, 'envs.mcp'), d.mcp, right, ctx.L.rightWidth, ctx.lang);
    right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'envs.hint.edit') + c(ANSI.reset, ctx.useColor));
  } else {
    right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'envs.pick') + c(ANSI.reset, ctx.useColor));
  }
  const cursorRow = state.selected < envs.length
    ? state.selected
    : envs.length === 0 ? 0 : envs.length + 1; // разделитель сдвигает «Создать»
  return { left, right, cursorRow };
}

/** Вкладка «Расширения»: диспетчер по состоянию ext. */
export function renderExtTab(ext: ExtState | null, ctx: Ctx): Section {
  const r =
    ext === null ? extList(ctx)
    : ext.view === 'catalog' ? extCatalogView(ext, ctx)
    : extBusy(ext, ctx);
  if (!ctx.twoCol) r.left.push(...r.right);
  return r;
}

/** Вкладка «MCP»: диспетчер по состоянию mcp. */
export function renderMcpTab(mt: McpTab | null, ctx: Ctx): Section {
  const r =
    mt === null ? mcpList(ctx)
    : mt.view === 'add' && mt.form !== null
      ? renderMcpForm(mt.form, ctx, t(ctx.lang, 'mcp.form.title-main'))
      : mcpTabBusy(mt, ctx);
  if (!ctx.twoCol) r.left.push(...r.right);
  return r;
}

// Вкладка «MCP»: список серверов main-агента + кнопка «Добавить»
function mcpList(ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const servers = ctx.state.catalog.mcp;
  left.push(c(ANSI.bold, ctx.useColor) + t(ctx.lang, 'mcp.title') + c(ANSI.reset, ctx.useColor));
  if (servers.length === 0) left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'empty') + c(ANSI.reset, ctx.useColor));
  servers.forEach((s, i) => {
    left.push(listRow(i, ctx.state.selected, s.name, ctx.L.leftWidth, ctx.useColor));
  });
  if (servers.length > 0) left.push(c(ANSI.dim, ctx.useColor) + '─'.repeat(ctx.L.leftWidth - 2) + c(ANSI.reset, ctx.useColor));
  left.push(listRow(servers.length, ctx.state.selected, '＋ ' + t(ctx.lang, 'mcp.add'), ctx.L.leftWidth, ctx.useColor));
  const cur = servers[ctx.state.selected];
  if (cur !== undefined) {
    right.push(...mcpInfoLines(cur, ctx.L, ctx.useColor, ctx.lang));
  } else {
    right.push(t(ctx.lang, 'mcp.hint.add'));
  }
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.delete') + c(ANSI.reset, ctx.useColor));
  const n = servers.length;
  const sel = ctx.state.selected;
  const cursorRow = sel < n ? 1 + sel : n === 0 ? 1 : n + 2;
  return { left, right, cursorRow };
}

// Вкладка «MCP»: состояния добавления/удаления
const MCP_TAB_BUSY: Record<string, { text: (mt: McpTab, lang: string) => string; bold?: boolean; hints: StrKey[] }> = {
  'submitting': { text: (mt, lang) => t(lang, 'busy.mcp-add', { name: mt.form?.name ?? '' }), hints: ['hint.back'] },
  'removing': { text: (_mt, lang) => t(lang, 'busy.mcp-deleting'), hints: ['hint.back'] },
  'confirm-remove': { text: (mt, lang) => t(lang, 'busy.mcp-remove', { name: mt.removing ?? '' }), bold: true, hints: ['hint.confirm', 'hint.cancel'] },
};

function mcpTabBusy(mt: McpTab, ctx: Ctx): Section {
  const b = MCP_TAB_BUSY[mt.view];
  const left = [c(b.bold ? ANSI.bold : ANSI.dim, ctx.useColor) + b.text(mt, ctx.lang) + c(ANSI.reset, ctx.useColor)];
  const right = b.hints.map((h) => c(ANSI.dim, ctx.useColor) + t(ctx.lang, h) + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: -1 };
}

// Вкладка «Расширения»: список пакетов main-агента + кнопки
function extList(ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const pkgs = ctx.state.catalog.packages;
  left.push(c(ANSI.bold, ctx.useColor) + t(ctx.lang, 'ext.title') + c(ANSI.reset, ctx.useColor));
  if (pkgs.length === 0) left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'empty') + c(ANSI.reset, ctx.useColor));
  pkgs.forEach((p, i) => {
    const text = truncateName(p.name, PKG_NAME_MAX) + '  ' + pkgMarker(p, ctx.state.pkgCheck, ctx.state.pkgLatest, ctx.lang);
    left.push(listRow(i, ctx.state.selected, text, ctx.L.leftWidth, ctx.useColor));
  });
  if (pkgs.length > 0) left.push(c(ANSI.dim, ctx.useColor) + '─'.repeat(ctx.L.leftWidth - 2) + c(ANSI.reset, ctx.useColor));
  const buttons: Array<[string, string]> = [['↑', t(ctx.lang, 'btn.update-all')], ['＋', t(ctx.lang, 'btn.install')]];
  buttons.forEach(([icon, label], j) => {
    left.push(listRow(pkgs.length + j, ctx.state.selected, icon + ' ' + label, ctx.L.leftWidth, ctx.useColor));
  });
  const p = pkgs[ctx.state.selected];
  if (p !== undefined) {
    right.push(...pkgInfoLines(p, ctx.state.pkgCheck, ctx.state.pkgLatest, ctx.L, ctx.useColor, ctx.lang));
  } else if (ctx.state.selected === pkgs.length) {
    right.push(t(ctx.lang, 'btn.update-all'));
    right.push('pi update --extensions');
    right.push(t(ctx.lang, 'pkgs.hint.run'));
  } else {
    right.push(t(ctx.lang, 'install.title'));
    right.push(t(ctx.lang, 'install.catalog'));
    right.push(t(ctx.lang, 'install.hint.open'));
  }
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'ext.hint.enter') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.delete') + c(ANSI.reset, ctx.useColor));
  const n = pkgs.length;
  const s = ctx.state.selected;
  const cursorRow =
    s < n ? 1 + s
    : s === n ? (n === 0 ? 1 : n + 2)
    : (n === 0 ? 2 : n + 3);
  return { left, right, cursorRow };
}

// Вкладка «Расширения»: пикер каталога pi.dev
function extCatalogView(ext: ExtState, ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  left.push(c(ANSI.bold, ctx.useColor) + t(ctx.lang, 'install.title') + c(ANSI.reset, ctx.useColor));
  const pkgs = filterPackages(ext.catalog, ext.query);
  const picker = catalogPickerLines(pkgs, ext.query, ext.catalogStatus, ext.cursor, ctx.L, ctx.useColor, ctx.state.catalogProgress, ctx.lang);
  left.push(...picker.left);
  right.push(...picker.right);
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.back') + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: ext.catalogStatus === 'ready' ? 2 + ext.cursor : -1 };
}

// Вкладка «Расширения»: состояния установки/обновления/удаления
const EXT_BUSY: Record<string, { text: (ext: ExtState, lang: string) => string; bold?: boolean; hints: StrKey[] }> = {
  'installing': { text: (ext, lang) => t(lang, 'busy.installing', { name: ext.installing ?? '' }), hints: ['hint.back'] },
  'updating': { text: (ext, lang) => ext.updating === null ? t(lang, 'busy.updating') : t(lang, 'busy.updating.named', { name: ext.updating }), hints: ['hint.back'] },
  'removing': { text: (_ext, lang) => t(lang, 'busy.deleting'), hints: ['hint.back'] },
  'confirm-remove': { text: (ext, lang) => t(lang, 'busy.delete-ext', { name: ext.removing ?? '' }), bold: true, hints: ['hint.confirm', 'hint.cancel'] },
};

function extBusy(ext: ExtState, ctx: Ctx): Section {
  const b = EXT_BUSY[ext.view];
  const left = [c(b.bold ? ANSI.bold : ANSI.dim, ctx.useColor) + b.text(ext, ctx.lang) + c(ANSI.reset, ctx.useColor)];
  const right = b.hints.map((h) => c(ANSI.dim, ctx.useColor) + t(ctx.lang, h) + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: -1 };
}
