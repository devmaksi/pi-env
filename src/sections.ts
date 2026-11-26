import { dirname } from 'node:path';
import type { Layout } from './layout.js';
import {
  enumValues,
  modelRows,
  defaultModelRef,
  mcpFormRows,
  mcpListNames,
  packageListSources,
  TEXT_ROWS,
  type AppState,
  type CreateState,
  type ExtState,
  type McpFormAdd,
  type McpTab,
  type TrashState,
  type CloneState,
  type SelfUpdate,
  type UpdateUi,
  UPDATE_ROW_COMMANDS,
  storeSummaryOf,
} from './state.js';
import type { Environment } from './environments.js';
import type { PkgItem } from './catalog.js';
import { packageConflicts, pkgNameOfSource, storePackageUsage } from './environments.js';
import { filterPackages } from './catalog.js';
import { liveMarker, mergeLive } from './mcp.js';
import { formatTs, trashLabel, type TrashEntry } from './trash.js';
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
  wrapVisible,
} from './render.js';
import { updateCommands } from './selfupdate.js';
import { t, type StrKey } from './i18n.js';

/** Контекст рендера: раскладка и параметры кадра, общие для всех секций. */
export interface Ctx {
  state: AppState;
  /** Снимок окружений — из него вкладка «Расширения» считает, кто использует пакет. */
  envs: Environment[];
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
    : cr.view === 'model-list' ? createModelList(cr, ctx)
    : cr.view === 'providers' || cr.view === 'models' || cr.view === 'tools' || cr.view === 'skills'
      ? createSelects(cr, ctx)
      : busySection(CREATE_BUSY, cr.view, cr, ctx);
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
    t(ctx.lang, cr.main ? 'form.name-main' : 'form.name') + (cr.main ? cr.name : caret),
    t(ctx.lang, 'form.model') + model,
    t(ctx.lang, 'form.models') + modelsSummary(cr, ctx.lang),
    t(ctx.lang, 'form.store') + t(ctx.lang, ('store.' + storeSummaryOf(cr)) as StrKey),
    t(ctx.lang, 'form.tools') + cr.tools.length,
    t(ctx.lang, 'form.packages') + cr.packages.length,
    t(ctx.lang, 'form.skills') + cr.skills.length,
    t(ctx.lang, 'form.mcp') + (cr.mode === 'edit' ? cr.envMcp.length : cr.mcp.length),
    cr.done !== null ? t(ctx.lang, 'form.done') : cr.mode === 'edit' ? t(ctx.lang, 'form.save') : t(ctx.lang, 'form.create'),
  ];
  if (cr.mode === 'edit' && cr.done === null && !cr.main) rows.push(t(ctx.lang, 'form.delete'));
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
  const liveOf = (n: string) => cr.mcpLive?.servers.find((s) => s.name === n) ?? null;
  const liveSuffix = (n: string) => { const l = liveOf(n); return l === null ? '' : ' ' + liveMarker(l, ctx.lang); };
  const inEnv = (n: string) => cr.envMcp.some((s) => s.name === n);
  const inMain = (n: string) => mainMcp.some((s) => s.name === n);
  const title = cr.mode === 'edit' ? t(ctx.lang, 'mcp.env-title', { name: cr.name }) : t(ctx.lang, 'mcp.title');
  left.push(c(ANSI.bold, ctx.useColor) + title + c(ANSI.reset, ctx.useColor));
  if (names.length === 0) left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'empty') + c(ANSI.reset, ctx.useColor));
  names.forEach((n, i) => {
    const checked = cr.mode === 'edit' ? inEnv(n) : cr.mcp.includes(n);
    const marker = cr.mode === 'edit' && inMain(n) && !inEnv(n) ? '  ' + t(ctx.lang, 'mcp.in-main') : '';
    left.push(listRow(i, cr.cursor, (checked ? '✓ ' : '  ') + n + liveSuffix(n) + marker, ctx.L.leftWidth, ctx.useColor));
  });
  if (cr.mode === 'edit') {
    left.push(listRow(names.length, cr.cursor, '＋ ' + t(ctx.lang, 'mcp.add'), ctx.L.leftWidth, ctx.useColor));
  }
  const curName = names[cr.cursor];
  if (curName !== undefined) {
    const cfg = mainMcp.find((s) => s.name === curName) ?? cr.envMcp.find((s) => s.name === curName) ?? null;
    right.push(...mcpInfoLines(cfg, ctx.L, ctx.useColor, ctx.lang, liveOf(curName)));
    if (cr.mode === 'edit') right.push(t(ctx.lang, 'mcp.in-env', { m: inEnv(curName) ? '✓' : '—' }));
  }
  if (curName === undefined && cr.mode === 'edit' && cr.cursor === names.length) {
    right.push(t(ctx.lang, 'mcp.hint.add'));
  }
  if (cr.mcpCheck === 'checking') right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'mcp.live.checking') + elapsedSuffix(ctx) + c(ANSI.reset, ctx.useColor));
  if (cr.mcpCheck === 'error') right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'mcp.live.error') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.select') + c(ANSI.reset, ctx.useColor));
  if (cr.mode === 'edit') right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.delete') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.back') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'mcp.hint.refresh') + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: 1 + cr.cursor };
}

/** Форма добавления MCP (общая для вкладки и формы окружения). */
export function renderMcpForm(f: McpFormAdd, ctx: Ctx, title: string): Section {
  const left: string[] = [];
  const right: string[] = [];
  const rows = mcpFormRows(f.type);
  const textRows = new Set<string>(TEXT_ROWS);
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
        label = t(ctx.lang, 'form.mcp.type');
        value = t(ctx.lang, ('form.mcp.type.' + f.type) as StrKey);
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
      case 'exposure':
        label = t(ctx.lang, 'form.mcp.exposure');
        value = t(ctx.lang, ('form.mcp.exposure.' + (f.exposure ?? 'codemode')) as StrKey);
        break;
      case 'action':
        value = t(ctx.lang, 'form.mcp.action');
        break;
    }
    if (textRows.has(row) && i === f.cursor) {
      value = value.slice(0, f.caret) + '▌' + value.slice(f.caret);
    }
    left.push(listRow(i, f.cursor, label + value, ctx.L.leftWidth, ctx.useColor));
  });
  if (f.error) right.push(c(ANSI.bold, ctx.useColor) + '⚠ ' + f.error + c(ANSI.reset, ctx.useColor));
  if (enumValues(rows[f.cursor]) !== null) {
    right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'mcp.hint.value') + c(ANSI.reset, ctx.useColor));
  }
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'mcp.hint.submit') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'form.hint.esc') + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: 1 + f.cursor };
}

/** Списки выбора: провайдер / модель / инструменты / скиллы. */
/** Значение строки «Модели»: пустой выбор — все модели каталога. */
function modelsSummary(cr: CreateState, lang: string): string {
  if (cr.modelsSel.length === 0) return t(lang, 'form.models-all');
  return `${cr.modelsSel.length}/${modelRows(cr).length}`;
}

/** Пикер моделей, доступных окружению: галки, устаревшие ссылки помечены. */
function createModelList(cr: CreateState, ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const rows = modelRows(cr);
  left.push(c(ANSI.bold, ctx.useColor) + t(ctx.lang, 'sel.models') + c(ANSI.reset, ctx.useColor));
  if (rows.length === 0) left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'empty') + c(ANSI.reset, ctx.useColor));
  const def = defaultModelRef(cr);
  rows.forEach((r, i) => {
    const mark = cr.modelsSel.includes(r.ref) ? '✓ ' : '  ';
    const note = r.missing ? '  ' + t(ctx.lang, 'form.models-missing') : r.ref === def ? '  ' + t(ctx.lang, 'form.models-default') : '';
    left.push(listRow(i, cr.cursor, mark + r.ref + note, ctx.L.leftWidth, ctx.useColor));
  });
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.select') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.back') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'sel.models.none') + c(ANSI.reset, ctx.useColor));
  if (cr.modelsSel.length > 0) {
    right.push(t(ctx.lang, 'sel.models.count', { n: cr.modelsSel.length, m: rows.length }));
  }
  return { left, right, cursorRow: 1 + cr.cursor };
}

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

/** Суффикс «⏳ N с» для индикаторов процесса; пусто, когда секунд в состоянии нет. */
function elapsedSuffix(ctx: Ctx): string {
  return ctx.state.opSeconds === null
    ? ''
    : ' ' + t(ctx.lang, 'busy.elapsed', { sec: ctx.state.opSeconds });
}

// Заглушки и подтверждения создания: view → [текст, bold?, подсказки]
const CREATE_BUSY: Record<string, { text: (cr: CreateState, lang: string) => string; bold?: boolean; hints: StrKey[] }> = {
  'store-confirm': { text: (_cr, lang) => t(lang, 'busy.store-confirm'), bold: true, hints: ['hint.confirm', 'hint.cancel'] },
  // Синхронная операция (свои файловые переходы, не дочерний процесс): прерывать нечего.
  'store-op': { text: (_cr, lang) => t(lang, 'busy.store-op'), hints: [] },
  'confirm-delete': { text: (cr, lang) => t(lang, 'busy.delete-env', { name: cr.name }), bold: true, hints: ['hint.confirm', 'hint.cancel'] },
  'deleting': { text: (_cr, lang) => t(lang, 'busy.deleting'), hints: ['hint.cancel'] },
  'submitting': { text: (_cr, lang) => t(lang, 'busy.creating'), hints: ['hint.cancel'] },
  'confirm-remove': { text: (cr, lang) => t(lang, 'busy.delete-ext', { name: cr.removing ?? '' }), bold: true, hints: ['hint.confirm', 'hint.cancel'] },
  'removing': { text: (_cr, lang) => t(lang, 'busy.deleting'), hints: ['hint.kill'] },
  'updating': { text: (_cr, lang) => t(lang, 'busy.updating'), hints: ['hint.kill'] },
  'installing': { text: (cr, lang) => t(lang, 'busy.installing', { name: cr.installing ?? '' }), hints: ['hint.kill'] },
  'mcp-op': {
    text: (cr, lang) => (cr.mcpOp?.kind === 'remove' ? t(lang, 'busy.mcp-deleting') : t(lang, 'busy.mcp-add', { name: cr.mcpOp?.name ?? '' })),
    hints: ['hint.back'],
  },
  'mcp-submitting': { text: (cr, lang) => t(lang, 'busy.mcp-add', { name: cr.mcpAdd?.name ?? '' }), hints: ['hint.kill'] },
  'mcp-confirm-remove': { text: (cr, lang) => t(lang, 'busy.mcp-remove', { name: cr.removingMcp ?? '' }), bold: true, hints: ['hint.confirm', 'hint.cancel'] },
};

function busySection<S>(
  busy: Record<string, { text: (s: S, lang: string) => string; bold?: boolean; hints: StrKey[]; extra?: (s: S, ctx: Ctx) => string[] }>,
  view: string,
  s: S,
  ctx: Ctx,
): Section {
  const b = busy[view];
  const left = [c(b.bold ? ANSI.bold : ANSI.dim, ctx.useColor) + b.text(s, ctx.lang) + elapsedSuffix(ctx) + c(ANSI.reset, ctx.useColor)];
  left.push(...(b.extra?.(s, ctx) ?? []));
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

/**
 * Проблемы конфигурации окружения (битые settings.json/mcp.json, неразобранные записи):
 * тексты для инфо-панели; непустой список даёт маркер `⚠` у имени в списке.
 */
function envProblems(d: Environment['details'], lang: string): string[] {
  const out: string[] = [];
  if (d.settingsError) out.push(t(lang, 'envs.problem.settings', { v: d.settingsError }));
  if (d.mcpError) out.push(t(lang, 'envs.problem.mcp', { v: d.mcpError }));
  if (d.mcpSkipped.length > 0) out.push(t(lang, 'envs.problem.mcp-skipped', { v: d.mcpSkipped.join(', ') }));
  if (d.modelsLink === 'broken') out.push(t(lang, 'envs.problem.models'));
  const brokenRoots = Object.entries(d.rootLinks).filter(([, s]) => s === 'broken').map(([r]) => r);
  if (brokenRoots.length > 0) out.push(t(lang, 'envs.problem.store', { v: brokenRoots.join(', ') }));
  if (d.missingPackages.length > 0) out.push(t(lang, 'envs.problem.missing', { v: d.missingPackages.join(', ') }));
  return out;
}

/**
 * Подпись строки окружения: обычно — имя каталога; основной агент вне `<root>` —
 * ярлык; основной агент, который и так лежит в `<root>`, — своё имя и пометка.
 */
function envRowLabel(e: Environment, ctx: Ctx): string {
  if (e.main !== true) return e.name;
  return dirname(e.path) === ctx.root ? `${e.name} · ${t(ctx.lang, 'envs.row-main')}` : t(ctx.lang, 'envs.main');
}

/** Вкладка «Окружения»: список + инфо-панель выбранного (без слияния в узком режиме). */
export function renderEnvList(envs: Environment[], state: AppState, ctx: Ctx, trashCount: number): Section {
  const left: string[] = [];
  const right: string[] = [];
  interface Row { text: string; selected: boolean; isSep: boolean }
  const rows: Row[] = [];
  envs.forEach((e, i) => {
    rows.push({ text: (i === state.selected ? '> ' : '  ') + envRowLabel(e, ctx) + (envProblems(e.details, ctx.lang).length > 0 ? ' ⚠' : ''), selected: i === state.selected, isSep: false });
    if (i === envs.length - 1) {
      rows.push({ text: '─'.repeat(ctx.L.leftWidth - 2), selected: false, isSep: true });
    }
  });
  rows.push({ text: (state.selected === envs.length ? '> ' : '  ') + t(ctx.lang, 'form.create'), selected: state.selected === envs.length, isSep: false });
  rows.push({
    text: (state.selected === envs.length + 1 ? '> ' : '  ') + t(ctx.lang, 'envs.trash', { n: trashCount }),
    selected: state.selected === envs.length + 1,
    isSep: false,
  });

  for (const r of rows) {
    if (r.isSep) {
      left.push(c(ANSI.dim, ctx.useColor) + r.text + c(ANSI.reset, ctx.useColor));
    } else if (r.selected) {
      left.push(c(ANSI.inverse, ctx.useColor) + padRight(r.text, ctx.L.leftWidth) + c(ANSI.reset, ctx.useColor));
    } else {
      left.push(r.text);
    }
  }

  if (state.selected === envs.length + 1) {
    right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'envs.trash', { n: trashCount }) + c(ANSI.reset, ctx.useColor));
    right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'envs.trash.pick') + c(ANSI.reset, ctx.useColor));
  } else if (state.selected < envs.length) {
    const e = envs[state.selected];
    const d = e.details;
    right.push(c(ANSI.bold, ctx.useColor) + envRowLabel(e, ctx) + c(ANSI.reset, ctx.useColor));
    right.push(t(ctx.lang, 'envs.path', { v: e.path }));
    if (e.main === true) right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'envs.main-note') + c(ANSI.reset, ctx.useColor));
    right.push('settings.json ' + (d.settingsError ? '⚠' : d.hasSettings ? '✓' : '—'));
    right.push(t(ctx.lang, 'form.model') + (d.model ?? '—'));
    if (d.modelsLink === 'linked') {
      right.push(t(ctx.lang, 'envs.models', { v: t(ctx.lang, 'envs.models-store') }));
    }
    if (d.rootLinks.npm === 'linked' || d.rootLinks.git === 'linked') {
      right.push(t(ctx.lang, 'envs.pkgs', { v: t(ctx.lang, 'envs.pkgs-store') }));
    }
    for (const problem of envProblems(d, ctx.lang)) {
      right.push(c(ANSI.dim, ctx.useColor) + problem + c(ANSI.reset, ctx.useColor));
    }
    detailSection(t(ctx.lang, 'envs.tools'), d.tools, right, ctx.L.rightWidth, ctx.lang);
    detailSection(t(ctx.lang, 'envs.skills'), d.skills, right, ctx.L.rightWidth, ctx.lang);
    detailSection(t(ctx.lang, 'envs.extensions'), d.packages.map((s) => s.replace(/^npm:/, '')), right, ctx.L.rightWidth, ctx.lang);
    detailSection(t(ctx.lang, 'envs.mcp'), d.mcp, right, ctx.L.rightWidth, ctx.lang);
    right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'envs.hint.edit') + c(ANSI.reset, ctx.useColor));
    right.push(c(ANSI.dim, ctx.useColor)
      + t(ctx.lang, e.main === true ? 'envs.hint.clone-main' : 'envs.hint.clone') + c(ANSI.reset, ctx.useColor));
  } else {
    right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'envs.pick') + c(ANSI.reset, ctx.useColor));
  }
  const cursorRow = state.selected < envs.length
    ? state.selected
    : envs.length === 0 ? state.selected          // сепаратора нет: 0 → «Создать», 1 → «Корзина»
    : state.selected + 1;                         // сепаратор сдвигает «Создать» и «Корзина»
  return { left, right, cursorRow };
}

/**
 * Суб-экран «Корзина»: список перенесённых окружений. Правки содержимого нет —
 * только восстановить (Enter) и удалить совсем (X + подтверждение в инфо-панели).
 */
export function renderTrashTab(tr: TrashState, entries: TrashEntry[], ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const dim = (s: string): string => c(ANSI.dim, ctx.useColor) + s + c(ANSI.reset, ctx.useColor);
  const bold = (s: string): string => c(ANSI.bold, ctx.useColor) + s + c(ANSI.reset, ctx.useColor);
  left.push(dim(t(ctx.lang, 'trash.title')));
  if (entries.length === 0) left.push(dim(t(ctx.lang, 'empty')));
  entries.forEach((e, i) => {
    left.push(listRow(i, tr.cursor, trashLabel({ ...e, name: truncateName(e.name, PKG_NAME_MAX) }), ctx.L.leftWidth, ctx.useColor));
  });
  if (entries.length > 0) left.push(dim('─'.repeat(ctx.L.leftWidth - 2)));

  const asked = tr.confirm === null ? undefined : entries.find((e) => e.dirName === tr.confirm);
  const cur = entries[tr.cursor];
  if (tr.confirm !== null) {
    const name = asked !== undefined ? asked.name : (tr.confirm.split('@')[0] ?? tr.confirm);
    right.push(bold(t(ctx.lang, 'busy.trash-delete', { name })));
    right.push(dim(t(ctx.lang, 'hint.confirm')));
    right.push(dim(t(ctx.lang, 'hint.cancel')));
  } else if (cur !== undefined) {
    right.push(bold(cur.kind === 'file' && cur.fileName ? `${cur.name} · ${cur.fileName}` : cur.name));
    if (cur.kind === 'file' && cur.fileName) right.push(t(ctx.lang, 'trash.file', { v: cur.fileName }));
    right.push(t(ctx.lang, 'trash.deleted-at', { v: cur.ts === null ? '—' : formatTs(cur.ts) }));
    right.push(t(ctx.lang, 'envs.path', { v: cur.path }));
    right.push(dim(t(ctx.lang, 'hint.trash-restore')));
    right.push(dim(t(ctx.lang, 'hint.trash-delete')));
  } else {
    right.push(dim(t(ctx.lang, 'hint.back')));
  }
  const cursorRow = entries.length === 0 ? -1 : 1 + Math.min(tr.cursor, entries.length - 1);
  return { left, right, cursorRow };
}

/**
 * Суб-экран «Клонирование окружения»: имя копии слева, инфо-панель источника справа.
 * Содержимое источника показывается как есть (оно и копируется как есть), списки
 * обрезаны по 4 позиции — как в детализации окружения.
 */
export function renderCloneTab(cl: CloneState, source: Environment | undefined, ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const dim = (s: string): string => c(ANSI.dim, ctx.useColor) + s + c(ANSI.reset, ctx.useColor);
  const bold = (s: string): string => c(ANSI.bold, ctx.useColor) + s + c(ANSI.reset, ctx.useColor);
  const caret = cl.caret < cl.name.length
    ? cl.name.slice(0, cl.caret) + '▌' + cl.name.slice(cl.caret)
    : cl.name + '▌';
  left.push(dim(t(ctx.lang, 'clone.title')));
  left.push(dim(t(ctx.lang, 'clone.from', { name: cl.srcName })));
  left.push(dim('─'.repeat(ctx.L.leftWidth - 2)));
  left.push(listRow(0, 0, t(ctx.lang, 'form.name') + caret, ctx.L.leftWidth, ctx.useColor));
  if (cl.error !== null) left.push(dim('⚠ ' + cl.error));

  if (source !== undefined) {
    const d = source.details;
    right.push(bold(source.name));
    right.push(t(ctx.lang, 'envs.path', { v: source.path }));
    right.push('settings.json ' + (d.settingsError ? '⚠' : d.hasSettings ? '✓' : '—'));
    right.push(t(ctx.lang, 'form.model') + (d.model ?? '—'));
    if (d.modelsLink === 'linked') {
      right.push(t(ctx.lang, 'envs.models', { v: t(ctx.lang, 'envs.models-store') }));
    }
    if (d.rootLinks.npm === 'linked' || d.rootLinks.git === 'linked') {
      right.push(t(ctx.lang, 'envs.pkgs', { v: t(ctx.lang, 'envs.pkgs-store') }));
    }
    for (const problem of envProblems(d, ctx.lang)) right.push(dim(problem));
    detailSection(t(ctx.lang, 'envs.tools'), d.tools, right, ctx.L.rightWidth, ctx.lang);
    detailSection(t(ctx.lang, 'envs.skills'), d.skills, right, ctx.L.rightWidth, ctx.lang);
    detailSection(t(ctx.lang, 'envs.extensions'), d.packages.map((s) => s.replace(/^npm:/, '')), right, ctx.L.rightWidth, ctx.lang);
    detailSection(t(ctx.lang, 'envs.mcp'), d.mcp, right, ctx.L.rightWidth, ctx.lang);
  }
  right.push(dim(t(ctx.lang, 'clone.info')));
  right.push(dim(t(ctx.lang, cl.pending ? 'clone.copying' : 'clone.hint.enter')));
  right.push(dim(t(ctx.lang, 'hint.cancel')));
  return { left, right, cursorRow: 3 };
}

/** Вкладка «Расширения»: диспетчер по состоянию ext. */
export function renderExtTab(ext: ExtState | null, ctx: Ctx): Section {
  const r =
    ext === null ? extList(ctx)
    : ext.view === 'catalog' ? extCatalogView(ext, ctx)
    : busySection(EXT_BUSY, ext.view, ext, ctx);
  if (!ctx.twoCol) r.left.push(...r.right);
  return r;
}

/** Вкладка «MCP»: диспетчер по состоянию mcp. */
export function renderMcpTab(mt: McpTab | null, ctx: Ctx): Section {
  const r =
    mt === null ? mcpList(ctx)
    : mt.view === 'add' && mt.form !== null
      ? renderMcpForm(mt.form, ctx, t(ctx.lang, 'mcp.form.title-main'))
      : busySection(MCP_TAB_BUSY, mt.view, mt, ctx);
  if (!ctx.twoCol) r.left.push(...r.right);
  return r;
}

// Вкладка «MCP»: список серверов main-агента + кнопка «Добавить»
function mcpList(ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const state = ctx.state;
  const entries = mergeLive(state.catalog.mcp, state.mcpLive);
  left.push(c(ANSI.bold, ctx.useColor) + t(ctx.lang, 'mcp.title') + c(ANSI.reset, ctx.useColor));
  if (entries.length === 0) left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'empty') + c(ANSI.reset, ctx.useColor));
  entries.forEach((e, i) => {
    const marker = e.live === null ? '' : ' ' + liveMarker(e.live, ctx.lang);
    left.push(listRow(i, state.selected, e.name + marker, ctx.L.leftWidth, ctx.useColor));
  });
  if (entries.length > 0) left.push(c(ANSI.dim, ctx.useColor) + '─'.repeat(ctx.L.leftWidth - 2) + c(ANSI.reset, ctx.useColor));
  left.push(listRow(entries.length, state.selected, '＋ ' + t(ctx.lang, 'mcp.add'), ctx.L.leftWidth, ctx.useColor));
  const cur = entries[state.selected];
  if (cur !== undefined) {
    right.push(...mcpInfoLines(cur.config, ctx.L, ctx.useColor, ctx.lang, cur.live));
  } else {
    right.push(t(ctx.lang, 'mcp.hint.add'));
  }
  if (state.mcpCheck === 'checking') right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'mcp.live.checking') + elapsedSuffix(ctx) + c(ANSI.reset, ctx.useColor));
  if (state.mcpCheck === 'error') right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'mcp.live.error') + c(ANSI.reset, ctx.useColor));
  for (const err of state.mcpLive?.errors ?? []) {
    right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'mcp.config.error', { v: err }) + c(ANSI.reset, ctx.useColor));
  }
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.delete') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'mcp.hint.refresh') + c(ANSI.reset, ctx.useColor));
  const n = entries.length;
  const sel = state.selected;
  const cursorRow = sel < n ? 1 + sel : n === 0 ? 1 : n + 2;
  return { left, right, cursorRow };
}

// Вкладка «MCP»: состояния добавления/удаления
const MCP_TAB_BUSY: Record<string, { text: (mt: McpTab, lang: string) => string; bold?: boolean; hints: StrKey[] }> = {
  'submitting': { text: (mt, lang) => t(lang, 'busy.mcp-add', { name: mt.form?.name ?? '' }), hints: ['hint.kill'] },
  'removing': { text: (_mt, lang) => t(lang, 'busy.mcp-deleting'), hints: ['hint.kill'] },
  'confirm-remove': { text: (mt, lang) => t(lang, 'busy.mcp-remove', { name: mt.removing ?? '' }), bold: true, hints: ['hint.confirm', 'hint.cancel'] },
};

// Вкладка «Расширения»: список пакетов main-агента + кнопки
function extList(ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const pkgs = ctx.state.storePackages;
  const conflicts = new Map(packageConflicts(ctx.envs).map((k) => [k.name, k]));
  const pkey = (p: PkgItem): string => pkgNameOfSource(p.name); // имя из package.json со scope — тот же ключ, что у объявления
  left.push(c(ANSI.bold, ctx.useColor) + t(ctx.lang, 'ext.title.store') + c(ANSI.reset, ctx.useColor));
  if (pkgs.length === 0) left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'ext.store.empty') + c(ANSI.reset, ctx.useColor));
  pkgs.forEach((p, i) => {
    const users = storePackageUsage(ctx.envs, p.name);
    const text = truncateName(p.name, PKG_NAME_MAX) + '  '
      + t(ctx.lang, 'ext.store.usage', { n: users.length }) + (conflicts.has(pkey(p)) ? ' ⚠' : '') + '  '
      + pkgMarker(p, ctx.state.pkgCheck, ctx.state.pkgLatest, ctx.lang);
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
  const selectedPkg = pkgs[ctx.state.selected];
  if (selectedPkg !== undefined) {
    const conf = conflicts.get(pkey(selectedPkg));
    if (conf !== undefined) {
      right.push(c(ANSI.bold, ctx.useColor) + '⚠ ' + t(ctx.lang, 'ext.store.conflict', { name: conf.name }) + c(ANSI.reset, ctx.useColor));
      for (const d of conf.declarations) right.push('  ' + d.env + ': ' + d.source);
    }
    for (const u of storePackageUsage(ctx.envs, selectedPkg.name)) right.push('  ' + u);
  }
  if (pkgs.length === 0) {
    right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'ext.hint.store-off') + c(ANSI.reset, ctx.useColor));
  } else {
    right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'ext.hint.enter') + c(ANSI.reset, ctx.useColor));
    right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'hint.delete') + c(ANSI.reset, ctx.useColor));
  }
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
const EXT_BUSY: Record<string, { text: (ext: ExtState, lang: string) => string; bold?: boolean; hints: StrKey[]; extra?: (ext: ExtState, ctx: Ctx) => string[] }> = {
  'installing': { text: (ext, lang) => t(lang, 'busy.installing', { name: ext.installing ?? '' }), hints: ['hint.kill'] },
  'updating': { text: (ext, lang) => ext.updating === null ? t(lang, 'busy.updating') : t(lang, 'busy.updating.named', { name: ext.updating }), hints: ['hint.kill'] },
  'removing': { text: (_ext, lang) => t(lang, 'busy.deleting'), hints: ['hint.kill'] },
  'confirm-remove': {
    text: (ext, lang) => t(lang, 'busy.delete-ext', { name: ext.removing ?? '' }),
    bold: true,
    hints: ['hint.confirm', 'hint.cancel'],
    extra: (ext, ctx) => {
      const users = storePackageUsage(ctx.envs, ext.removing ?? '');
      return users.length === 0 ? [] : [c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'ext.store.used-by', { v: users.join(', ') }) + c(ANSI.reset, ctx.useColor)];
    },
  },
};

/**
 * Вкладка «Обновление»: версии, способ установки, команды и чейнджлог пропущенных
 * релизов — одна колонка на всю ширину (тексту чейнджлога не делить себя пополам).
 */
export function renderUpdateTab(info: SelfUpdate, ui: UpdateUi, ctx: Ctx): Section {
  const left: string[] = [];
  const commands = updateCommands(info.kind);
  left.push(t(ctx.lang, 'update.title', { installed: info.installed, latest: info.latest }));
  left.push(t(ctx.lang, ('update.kind.' + info.kind) as StrKey));
  left.push(t(ctx.lang, 'update.command-hint'));
  left.push('');
  commands.forEach((cmd, i) =>
    left.push(listRow(UPDATE_ROW_COMMANDS + i, ui.cursor, cmd, ctx.inner, ctx.useColor)));
  left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'update.changelog') + c(ANSI.reset, ctx.useColor));
  if (ui.check === 'loading') {
    left.push(t(ctx.lang, 'update.changelog.loading'));
  } else if (ui.check === 'error') {
    left.push(t(ctx.lang, 'update.changelog.error'));
  } else if (ui.rows.length === 0) {
    left.push(t(ctx.lang, 'update.changelog.empty', { latest: info.latest }));
  } else {
    for (const row of ui.rows) {
      if (row.kind === 'version') {
        left.push(c(ANSI.bold, ctx.useColor) + row.text + c(ANSI.reset, ctx.useColor));
      } else if (row.kind === 'section') {
        left.push(c(ANSI.dim, ctx.useColor) + row.text + c(ANSI.reset, ctx.useColor));
      } else {
        for (const piece of wrapVisible(row.text, ctx.inner - 4)) left.push('  • ' + piece);
      }
    }
  }
  left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'update.checked', { time: formatTs(info.checkedAt) }) + c(ANSI.reset, ctx.useColor));
  left.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'update.hint.keys') + c(ANSI.reset, ctx.useColor));
  return { left, right: [], cursorRow: ui.cursor };
}
