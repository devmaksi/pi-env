import type { Layout } from './layout.js';
import {
  UPDATE_ALL_ROW,
  INSTALL_ROW,
  packageListSources,
  type AppState,
  type CreateState,
  type ExtState,
} from './state.js';
import type { Environment } from './environments.js';
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
} from './render.js';

/** Контекст рендера: раскладка и параметры кадра, общие для всех секций. */
export interface Ctx {
  state: AppState;
  L: Layout;
  useColor: boolean;
  inner: number;
  contentRows: number;
  twoCol: boolean;
  root: string;
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
    'Имя: ' + caret,
    'Модель: ' + model,
    'Свои инструменты: ' + cr.tools.length,
    'Расширения: ' + cr.packages.length,
    'Скиллы: ' + cr.skills.length,
    cr.done !== null ? 'Готово' : cr.mode === 'edit' ? 'Сохранить' : 'Создать',
  ];
  if (cr.mode === 'edit' && cr.done === null) rows.push('Удалить');
  rows.forEach((t, i) => left.push(listRow(i, cr.cursor, t, ctx.L.leftWidth, ctx.useColor)));
  right.push(c(ANSI.dim, ctx.useColor) + 'Enter — открыть список / создать' + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + 'Space — отметить в списке' + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + 'Esc — закрыть' + c(ANSI.reset, ctx.useColor));
  if (cr.error) right.push(c(ANSI.bold, ctx.useColor) + '⚠ ' + cr.error + c(ANSI.reset, ctx.useColor));
  if (cr.done !== null) right.push(c(ANSI.bold, ctx.useColor) + (cr.mode === 'edit' ? '✓ Обновлено: ' : '✓ Создано: ') + cr.done + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: cr.cursor };
}

/** Список пакетов окружения: маркеры, кнопки, инфо-панель. */
function createPackages(cr: CreateState, ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const latest = cr.latest;
  const check = cr.check;
  const sources = packageListSources(cr, ctx.state.catalog);
  left.push(c(ANSI.bold, ctx.useColor) + 'Расширения (пакеты)' + c(ANSI.reset, ctx.useColor));
  if (sources.length === 0) left.push(c(ANSI.dim, ctx.useColor) + '— пусто —' + c(ANSI.reset, ctx.useColor));
  sources.forEach((src, i) => {
    const p = ctx.state.catalog.packages.find((x) => x.source === src);
    const name = p !== undefined ? p.name : src.replace(/^npm:/, '');
    const marker = formPkgMarker(src, name, p !== undefined, check, latest);
    const text = (cr.packages.includes(src) ? '✓ ' : '  ') + truncateName(name, PKG_NAME_MAX) + '  ' + marker;
    left.push(listRow(i, cr.cursor, text, ctx.L.leftWidth, ctx.useColor));
  });
  const buttons: Array<[string, string]> = [['↑', UPDATE_ALL_ROW]];
  if (cr.mode === 'edit') buttons.push(['＋', INSTALL_ROW]);
  buttons.forEach(([icon, label], j) => {
    left.push(listRow(sources.length + j, cr.cursor, icon + ' ' + label, ctx.L.leftWidth, ctx.useColor));
  });
  const curSrc = sources[cr.cursor];
  const cur = curSrc !== undefined ? ctx.state.catalog.packages.find((x) => x.source === curSrc) : undefined;
  if (cur !== undefined) {
    right.push(...pkgInfoLines(cur, check, latest, ctx.L, ctx.useColor));
    right.push('В окружении: ' + (cr.packages.includes(cur.source) ? '✓' : '—'));
  } else if (curSrc !== undefined) {
    right.push(c(ANSI.bold, ctx.useColor) + curSrc.replace(/^npm:/, '') + c(ANSI.reset, ctx.useColor));
    right.push('Установлено только в этом окружении');
    right.push('В окружении: ✓');
  } else if (cr.cursor === sources.length) {
    right.push('Обновить все');
    right.push('pi update --extensions');
    right.push('Enter — выполнить');
  } else if (cr.mode === 'edit') {
    right.push('Установка расширения');
    right.push('Список: pi.dev/packages');
    right.push('Enter — открыть каталог');
  }
  if (cr.error) right.push(c(ANSI.bold, ctx.useColor) + '⚠ ' + cr.error + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + 'Space/Enter — выбрать' + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + 'X — удалить' + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + 'Esc — назад' + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: 1 + cr.cursor };
}

/** Пикер каталога pi.dev: установка в окружение. */
function createInstall(cr: CreateState, ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  left.push(c(ANSI.bold, ctx.useColor) + 'Установка в окружение «' + cr.name + '»' + c(ANSI.reset, ctx.useColor));
  const picker = catalogPickerLines(cr.installCatalog, cr.installStatus, cr.cursor, ctx.L, ctx.useColor);
  left.push(...picker.left);
  right.push(...picker.right);
  if (cr.error) right.push(c(ANSI.bold, ctx.useColor) + '⚠ ' + cr.error + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + 'Esc — назад' + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: -1 };
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
    providers: 'Провайдер',
    models: 'Модель' + (cr.provider ? ' (' + cr.provider + ')' : ''),
    tools: 'Свои инструменты',
    skills: 'Скиллы',
  } as const;
  left.push(c(ANSI.bold, ctx.useColor) + titles[cr.view] + c(ANSI.reset, ctx.useColor));
  const current = cr.view === 'providers' ? cr.provider : cr.view === 'models' ? cr.model : null;
  const checked = new Set(cr.view === 'tools' ? cr.tools : cr.skills);
  if (items.length === 0) left.push(c(ANSI.dim, ctx.useColor) + '— пусто —' + c(ANSI.reset, ctx.useColor));
  items.forEach((n, i) => {
    const sel = (current !== null && current === n) || checked.has(n);
    left.push(listRow(i, cr.cursor, (sel ? '✓ ' : '  ') + n, ctx.L.leftWidth, ctx.useColor));
  });
  right.push(c(ANSI.dim, ctx.useColor) + 'Space/Enter — выбрать' + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + 'Esc — назад' + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: 1 + cr.cursor };
}

// Заглушки и подтверждения создания: view → [текст, bold?, подсказки]
const CREATE_BUSY: Record<string, { text: (cr: CreateState) => string; bold?: boolean; hints: string[] }> = {
  'confirm-delete': { text: (cr) => 'Удалить окружение «' + cr.name + '»?', bold: true, hints: ['Enter — подтвердить', 'Esc — отмена'] },
  'deleting': { text: () => 'Удаление…', hints: ['Esc — отмена'] },
  'submitting': { text: () => 'Создание…', hints: ['Esc — отмена'] },
  'confirm-remove': { text: (cr) => 'Удалить расширение «' + (cr.removing ?? '') + '»?', bold: true, hints: ['Enter — подтвердить', 'Esc — отмена'] },
  'removing': { text: () => 'Удаление…', hints: ['Esc — назад'] },
  'updating': { text: () => 'Обновление…', hints: ['Esc — назад'] },
  'installing': { text: (cr) => 'Установка: ' + (cr.installing ?? '') + '…', hints: ['Esc — назад'] },
};

function createBusy(cr: CreateState, ctx: Ctx): Section {
  const b = CREATE_BUSY[cr.view];
  const left = [c(b.bold ? ANSI.bold : ANSI.dim, ctx.useColor) + b.text(cr) + c(ANSI.reset, ctx.useColor)];
  const right = b.hints.map((h) => c(ANSI.dim, ctx.useColor) + h + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: -1 };
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
  rows.push({ text: (state.selected === envs.length ? '> ' : '  ') + 'Создать', selected: state.selected === envs.length, isSep: false });

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
    right.push(c(ANSI.bold, ctx.useColor) + e.name + c(ANSI.reset, ctx.useColor));
    right.push('Путь: ' + e.path);
    right.push('settings.json ' + (e.hasSettings ? '✓' : '—'));
    right.push('skills ' + (e.hasSkills ? '✓' : '—'));
    right.push('extensions ' + (e.hasExtensions ? '✓' : '—'));
    right.push(c(ANSI.dim, ctx.useColor) + 'E — редактировать' + c(ANSI.reset, ctx.useColor));
    right.push(c(ANSI.dim, ctx.useColor) + 'Детализация — этап 2' + c(ANSI.reset, ctx.useColor));
  } else {
    right.push(c(ANSI.dim, ctx.useColor) + 'Выберите окружение' + c(ANSI.reset, ctx.useColor));
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

// Вкладка «Расширения»: список пакетов main-агента + кнопки
function extList(ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const pkgs = ctx.state.catalog.packages;
  left.push(c(ANSI.bold, ctx.useColor) + 'Расширения (основной агент)' + c(ANSI.reset, ctx.useColor));
  if (pkgs.length === 0) left.push(c(ANSI.dim, ctx.useColor) + '— пусто —' + c(ANSI.reset, ctx.useColor));
  pkgs.forEach((p, i) => {
    const text = truncateName(p.name, PKG_NAME_MAX) + '  ' + pkgMarker(p, ctx.state.pkgCheck, ctx.state.pkgLatest);
    left.push(listRow(i, ctx.state.selected, text, ctx.L.leftWidth, ctx.useColor));
  });
  if (pkgs.length > 0) left.push(c(ANSI.dim, ctx.useColor) + '─'.repeat(ctx.L.leftWidth - 2) + c(ANSI.reset, ctx.useColor));
  const buttons: Array<[string, string]> = [['↑', 'Обновить все'], ['＋', 'Установить']];
  buttons.forEach(([icon, label], j) => {
    left.push(listRow(pkgs.length + j, ctx.state.selected, icon + ' ' + label, ctx.L.leftWidth, ctx.useColor));
  });
  const p = pkgs[ctx.state.selected];
  if (p !== undefined) {
    right.push(...pkgInfoLines(p, ctx.state.pkgCheck, ctx.state.pkgLatest, ctx.L, ctx.useColor));
  } else if (ctx.state.selected === pkgs.length) {
    right.push('Обновить все');
    right.push('pi update --extensions');
    right.push('Enter — выполнить');
  } else {
    right.push('Установка расширения');
    right.push('Список: pi.dev/packages');
    right.push('Enter — открыть каталог');
  }
  right.push(c(ANSI.dim, ctx.useColor) + 'Enter — обновить пакет / выбрать' + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + 'X — удалить' + c(ANSI.reset, ctx.useColor));
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
  left.push(c(ANSI.bold, ctx.useColor) + 'Установка расширения' + c(ANSI.reset, ctx.useColor));
  const picker = catalogPickerLines(ext.catalog, ext.catalogStatus, ext.cursor, ctx.L, ctx.useColor);
  left.push(...picker.left);
  right.push(...picker.right);
  right.push(c(ANSI.dim, ctx.useColor) + 'Esc — назад' + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: ext.catalogStatus === 'ready' ? 1 + ext.cursor : -1 };
}

// Вкладка «Расширения»: состояния установки/обновления/удаления
const EXT_BUSY: Record<string, { text: (ext: ExtState) => string; bold?: boolean; hints: string[] }> = {
  'installing': { text: (ext) => 'Установка: ' + (ext.installing ?? '') + '…', hints: ['Esc — назад'] },
  'updating': { text: (ext) => ext.updating === null ? 'Обновление…' : 'Обновление: ' + ext.updating + '…', hints: ['Esc — назад'] },
  'removing': { text: () => 'Удаление…', hints: ['Esc — назад'] },
  'confirm-remove': { text: (ext) => 'Удалить расширение «' + (ext.removing ?? '') + '»?', bold: true, hints: ['Enter — подтвердить', 'Esc — отмена'] },
};

function extBusy(ext: ExtState, ctx: Ctx): Section {
  const b = EXT_BUSY[ext.view];
  const left = [c(b.bold ? ANSI.bold : ANSI.dim, ctx.useColor) + b.text(ext) + c(ANSI.reset, ctx.useColor)];
  const right = b.hints.map((h) => c(ANSI.dim, ctx.useColor) + h + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: -1 };
}
