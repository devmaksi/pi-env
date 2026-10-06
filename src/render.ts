import { Environment } from './environments.js';
import { computeLayout, NARROW_MIN, LOW_MIN, type Layout } from './layout.js';
import { type AppState, type PkgCheck } from './state.js';
import { renderCreate, renderExtTab, renderEnvList, renderMcpTab, type Ctx, type Section } from './sections.js';
import type { PkgItem, CatalogPkg } from './catalog.js';
import type { McpServer } from './mcp.js';
import { t, nativeName } from './i18n.js';

export const ANSI = {
  bright: '\x1b[96m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  inverse: '\x1b[7m',
  reset: '\x1b[0m',
};

export function c(code: string, on: boolean): string {
  return on ? code : '';
}

// Символы, которые терминал может нарисовать в две клетки (зависит от
// шрифта/локали): стрелки, тире, многоточие, галочка, предупреждение,
// fullwidth-плюс, caret. Box-drawing (─│├┬┤) и «·» не входят: во всех
// терминалах это одна клетка. Для строк с такими символами перед правой
// границей оставляем резерв n клеток, а саму границу дорисовываем по CUP —
// рамка цела и на 1-клеточном, и на 2-клеточном терминале.
const WIDE_CHARS = new Set(['↑', '↓', '←', '→', '—', '…', '✓', '⚠', '▌', '＋']);

/** Число «неопределённых» символов в строке (ANSI-коды не учитываются). */
export function wideCount(s: string): number {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  let n = 0;
  for (const ch of plain) if (WIDE_CHARS.has(ch)) n++;
  return n;
}

/** CUP: курсор на строку row (номер на экране) в колонку width. */
function cupBorder(row: number, width: number): string {
  return `\x1b[${row};${width}H`;
}

/** Видимая ширина строки в символах (ANSI-коды не учитываются). */
export function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

// Обрезка по видимым символам: точка разреза не делит ANSI-последовательность
export function truncateVisible(s: string, w: number): string {
  let visible = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*[a-zA-Z]/.exec(s.slice(i));
      if (m) {
        i += m[0].length - 1;
        continue;
      }
    }
    visible++;
    if (visible === w) return s.slice(0, i + 1);
  }
  return s;
}

export function padRight(s: string, w: number): string {
  const v = visibleWidth(s);
  if (v <= w) return s + ' '.repeat(w - v);
  // Обрезка не срезает завершающие SGR-коды (например, \x1b[0m после инверсии
  // курсорной строки): потерянный сброс уводит активный стиль в правую колонку
  // и в строки ниже.
  const m = /^(.*?)(\x1b\[[0-9;]*m)+$/.exec(s);
  if (m) return truncateVisible(m[1], w) + m[2];
  return truncateVisible(s, w);
}

function center(s: string, w: number): string {
  const v = visibleWidth(s);
  if (v > w) return truncateVisible(s, w);
  if (v >= w) return s;
  const left = Math.floor((w - v) / 2);
  return ' '.repeat(left) + s + ' '.repeat(w - v - left);
}

export interface RenderArgs {
  state: AppState;
  envs: Environment[];
  root: string;
  width: number;
  height: number;
  useColor: boolean;
  status: string | null;
}

const TAB_KEYS = { envs: 'tab.envs', extensions: 'tab.extensions', mcp: 'tab.mcp', settings: 'tab.settings', about: 'tab.about' } as const;

/** Число хромовых строк: таб-бар + разделитель + футер из двух строк. */
const CHROME_ROWS = 4;
/** Минимальная внутренняя ширина для полной легенды статус-строки. */
const LEGEND_WIDE_MIN = 49;
/** Максимальная длина имени пакета в списках (дальше — многоточие). */
export const PKG_NAME_MAX = 22;
/** Максимальная длина имени пакета в пикере каталога (дальше — многоточие). */
const CATALOG_NAME_MAX = 24;

/**
 * Смещение окна для списка длиннее кадра: верх стоит, пока курсор не
 * достигнет последней видимой строки, затем окно скроллится и курсор
 * удерживается на нижней границе. Курсора нет (−1) или список короткий — 0.
 */
export function scrollTop(cursorRow: number, len: number, height: number): number {
  if (cursorRow < 0 || len <= height) return 0;
  return Math.max(0, Math.min(cursorRow - (height - 1), len - height));
}

export function render(a: RenderArgs): string {
  const { state, envs, root, width, height, useColor } = a;

  if (width < NARROW_MIN || height < LOW_MIN) {
    return center(t(state.language, 'terminal.too-small'), width);
  }

  const L = computeLayout({ width, height });
  // «О программе» — центрированный текст на всю ширину, двухколоночная сетка его режет пополам
  const twoCol = L.twoColumns && state.tab !== 'about';
  const inner = width - 2;
  const contentRows = height - CHROME_ROWS; // таб-бар(1) + разделитель(1) + футер(2)
  const ctx: Ctx = { state, L, useColor, inner, contentRows, twoCol, root, lang: state.language };
  const lines: string[] = [];

  // Таб-бар
  const tabs = (Object.keys(TAB_KEYS) as Array<keyof typeof TAB_KEYS>).map((k) => {
    const active = k === state.tab;
    const label = active ? '[' + t(state.language, TAB_KEYS[k]) + ']' : t(state.language, TAB_KEYS[k]);
    if (active) {
      return c(ANSI.bright, useColor) + c(ANSI.bold, useColor) + label + c(ANSI.reset, useColor);
    }
    return c(ANSI.dim, useColor) + label + c(ANSI.reset, useColor);
  });
  lines.push('│' + padRight(tabs.join('    '), inner) + '│');

  // Разделитель под таб-баром
  if (twoCol) {
    lines.push('├' + '─'.repeat(L.leftWidth) + '┬' + '─'.repeat(L.rightWidth) + '┤');
  } else {
    lines.push('├' + '─'.repeat(inner) + '┤');
  }

  const section = state.sub === 'create' && state.create
    ? renderCreate(state.create, ctx)
    : state.tab === 'envs' ? renderEnvList(envs, state, ctx)
    : state.tab === 'extensions' ? renderExtTab(state.ext, ctx)
    : state.tab === 'mcp' ? renderMcpTab(state.mcp, ctx)
    : state.tab === 'settings' ? renderSettings(state, ctx)
    : renderAbout(ctx);
  const { left, right, cursorRow } = section;
  const top = scrollTop(cursorRow, left.length, contentRows);

  for (let i = 0; i < contentRows; i++) {
    const row = i + 3; // таб-бар(1) + разделитель(2) + строка контента
    if (twoCol) {
      const lRaw = left[top + i] ?? '';
      const rRaw = i < right.length ? right[i] : '';
      const dl = wideCount(lRaw);
      const dr = wideCount(rRaw);
      const l = padRight(lRaw, L.leftWidth - dl);
      const r = padRight(rRaw, L.rightWidth - dr);
      const hl = state.tab === 'envs' && state.sub === null && state.focus === 'left' && useColor;
      const hr = state.tab === 'envs' && state.sub === null && state.focus === 'right' && useColor;
      const bl = c(ANSI.bold, hl) + '│' + c(ANSI.reset, hl);
      const bm = c(ANSI.bold, hl || hr) + '│' + c(ANSI.reset, hl || hr);
      const br = c(ANSI.bold, hr) + '│' + c(ANSI.reset, hr);
      const cupM = dl > 0 ? cupBorder(row, L.leftWidth + 2) : '';
      const cupR = dr > 0 ? cupBorder(row, width) : '';
      lines.push(bl + l + cupM + bm + r + cupR + br);
    } else {
      const lRaw = left[top + i] ?? '';
      const d = wideCount(lRaw);
      const l = padRight(lRaw, d > 0 ? inner - d : inner);
      lines.push('│' + l + (d > 0 ? cupBorder(row, width) : '') + '│');
    }
  }

  lines.push(...renderFooter(a, inner, contentRows + 3, contentRows + 4));

  return lines.join('\n');
}

/** Вкладка «Настройки»: корневой каталог и toggle приложения. */
function renderSettings(state: AppState, ctx: Ctx): Section {
  const left: string[] = [];
  const right: string[] = [];
  const items = [
    t(ctx.lang, 'settings.root', { root: ctx.root }),
    t(ctx.lang, 'settings.color', { m: state.colorToggle ? 'x' : ' ' }),
    t(ctx.lang, 'settings.recheck', { m: state.recheckUpdates ? 'x' : ' ' }),
    t(ctx.lang, 'settings.language', { name: nativeName(state.language) }),
  ];
  items.forEach((item, i) => {
    const text = (i === state.selected ? '> ' : '  ') + item;
    if (i === state.selected) {
      left.push(c(ANSI.inverse, ctx.useColor) + padRight(text, ctx.L.leftWidth) + c(ANSI.reset, ctx.useColor));
    } else {
      left.push(text);
    }
  });
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'settings.hint.space') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'settings.hint.recheck') + c(ANSI.reset, ctx.useColor));
  right.push(c(ANSI.dim, ctx.useColor) + t(ctx.lang, 'settings.hint.language') + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: state.selected };
}

/** Вкладка «О программе»: центрированный блок на всю ширину. */
function renderAbout(ctx: Ctx): Section {
  const block = [
    c(ANSI.bold, ctx.useColor) + 'pi-env 0.1.0' + c(ANSI.reset, ctx.useColor),
    t(ctx.lang, 'about.subtitle'),
    '',
    t(ctx.lang, 'about.keys'),
  ];
  const top = Math.max(0, Math.floor((ctx.contentRows - block.length) / 2));
  const left: string[] = [];
  for (let i = 0; i < ctx.contentRows; i++) {
    left.push(i - top >= 0 && i - top < block.length ? center(block[i - top], ctx.inner) : '');
  }
  return { left, right: [], cursorRow: -1 };
}

/** Статус-строка: легенда (или статус) + вторая легенда. */
function renderFooter(a: RenderArgs, inner: number, row1: number, row2: number): string[] {
  const legend1 = inner >= LEGEND_WIDE_MIN ? t(a.state.language, 'footer.legend1') : t(a.state.language, 'footer.legend1.narrow');
  const legend2 = t(a.state.language, 'footer.legend2');
  const f2text = a.status !== null ? a.status : legend2;
  const f1 = c(ANSI.dim, a.useColor) + legend1 + c(ANSI.reset, a.useColor);
  const f2 = (a.status !== null ? c(ANSI.bold, a.useColor) : c(ANSI.dim, a.useColor)) + f2text + c(ANSI.reset, a.useColor);
  const line = (text: string, styled: string, row: number): string => {
    const d = wideCount(text);
    if (d === 0) return '│' + padRight(styled, inner) + '│';
    return '│' + padRight(styled, inner - d) + cupBorder(row, a.width) + '│';
  };
  return [line(legend1, f1, row1), line(f2text, f2, row2)];
}

/** Имя с многоточием при превышении длины. */
export function truncateName(name: string, max: number): string {
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

/** Строка списка: «> » у курсорной, «  » у остальных; курсорная строка инвертируется. */
export function listRow(i: number, cursor: number, text: string, w: number, useColor: boolean): string {
  const line = (i === cursor ? '> ' : '  ') + text;
  return i === cursor ? c(ANSI.inverse, useColor) + padRight(line, w) + c(ANSI.reset, useColor) : line;
}

/** Инфо-панель пакета для правой колонки. */
/** Инфо-панель MCP-сервера для правой колонки. */
export function mcpInfoLines(s: McpServer, L: Layout, useColor: boolean, lang: string = 'ru'): string[] {
  const lines = [
    c(ANSI.bold, useColor) + s.name + c(ANSI.reset, useColor),
    t(lang, 'mcp.info.type', { v: s.type }),
  ];
  if (s.type === 'stdio') {
    const cmd = [s.command ?? '', ...s.args].filter((x) => x !== '').join(' ');
    if (cmd !== '') lines.push(t(lang, 'mcp.info.command', { v: cmd }));
    for (const [k, v] of Object.entries(s.env)) lines.push(t(lang, 'mcp.info.env', { v: k + '=' + v }));
    if (s.cwd !== undefined) lines.push(t(lang, 'mcp.info.cwd', { v: s.cwd }));
  } else if (s.url !== undefined) {
    lines.push(t(lang, 'mcp.info.url', { v: s.url }));
  }
  if (s.exposure !== undefined) lines.push(t(lang, 'mcp.info.exposure', { v: s.exposure }));
  if (s.enabled !== undefined) lines.push(t(lang, 'mcp.info.enabled', { m: s.enabled ? '✓' : '—' }));
  if (s.description !== undefined) lines.push(truncateVisible(s.description, L.rightWidth - 1));
  return lines;
}

export function pkgInfoLines(p: PkgItem, check: PkgCheck, latest: Record<string, string>, L: Layout, useColor: boolean, lang: string = 'ru'): string[] {
  const lines = [
    c(ANSI.bold, useColor) + p.name + c(ANSI.reset, useColor),
    t(lang, 'pkg.source', { v: p.source }),
    t(lang, 'pkg.version', { v: p.version ?? '—' }),
    updateLine(p, check, latest, lang),
    t(lang, 'pkg.extensions', { n: p.extensions.length }) + '  ' + t(lang, 'pkg.skills', { n: p.skills.length }),
  ];
  if (p.description) lines.push(truncateVisible(p.description, L.rightWidth - 1));
  return lines;
}

/** Пикер каталога pi.dev: список слева и инфо-панель справа (общий для вкладки и формы). */
export function catalogPickerLines(
  pkgs: CatalogPkg[],
  query: string,
  status: 'idle' | 'loading' | 'ready' | 'error',
  cursor: number,
  L: Layout,
  useColor: boolean,
  progress: { loaded: number; total: number } | null,
  lang: string = 'ru',
): { left: string[]; right: string[] } {
  const left: string[] = [];
  const right: string[] = [];
  left.push(t(lang, 'picker.search', { q: query }));
  if (query.trim() !== '') right.push(t(lang, 'picker.found', { n: pkgs.length }));
  if (status === 'loading') {
    const text = progress !== null
      ? t(lang, 'picker.loading.progress', { loaded: progress.loaded, total: progress.total })
      : t(lang, 'picker.loading');
    left.push(c(ANSI.dim, useColor) + text + c(ANSI.reset, useColor));
  } else if (status === 'error') {
    left.push(c(ANSI.bold, useColor) + t(lang, 'picker.error') + c(ANSI.reset, useColor));
  } else {
    if (pkgs.length === 0) {
      const empty = query.trim() !== '' ? t(lang, 'picker.nothing') : t(lang, 'empty');
      left.push(c(ANSI.dim, useColor) + empty + c(ANSI.reset, useColor));
    }
    pkgs.forEach((p, i) => left.push(listRow(i, cursor, truncateName(p.name, CATALOG_NAME_MAX), L.leftWidth, useColor)));
    const cur = pkgs[cursor];
    if (cur !== undefined) {
      right.push(c(ANSI.bold, useColor) + cur.name + c(ANSI.reset, useColor));
      if (cur.types.length > 0) right.push(t(lang, 'picker.types', { v: cur.types.join(', ') }));
      right.push(t(lang, 'picker.downloads', { n: cur.downloads }));
      if (cur.author !== null) right.push(t(lang, 'picker.author', { v: cur.author }));
      if (cur.description !== null) right.push(truncateVisible(cur.description, L.rightWidth - 1));
      right.push('pi install npm:' + cur.name);
      right.push(c(ANSI.dim, useColor) + t(lang, 'picker.hint.install') + c(ANSI.reset, useColor));
    }
  }
  return { left, right };
}

function isPinned(source: string): boolean {
  // npm:name@ver или npm:@scope/name@ver; скоуп без версии — не pinned
  return new RegExp('^npm:(?:@[^/]+/)?[^@]+@[^@/]+$').test(source);
}

export function pkgMarker(p: PkgItem, check: PkgCheck, latest: Record<string, string>, lang: string = 'ru'): string {
  if (isPinned(p.source)) return t(lang, 'pkg.pinned');
  if (!p.source.startsWith('npm:')) return t(lang, 'pkg.local');
  if (check === 'checking') return '…';
  if (check === 'error') return '?';
  const latestVer = latest[p.name];
  return latestVer !== undefined && latestVer !== p.version ? '↑ ' + latestVer : '·';
}

/**
 * Маркер пакета в форме окружения: карта outdated строится по npm-каталогу
 * самого окружения, поэтому наличие имени в карте = обновление доступно
 * (версию каталога main-агента сравнивать нельзя).
 * Актуальны: «·» у пакета каталога, «в окружении» у env-only.
 */
export function formPkgMarker(
  source: string,
  name: string,
  inCatalog: boolean,
  check: PkgCheck,
  latest: Record<string, string>,
  lang: string = 'ru',
): string {
  if (isPinned(source)) return t(lang, 'pkg.pinned');
  if (!source.startsWith('npm:')) return t(lang, 'pkg.local');
  if (check === 'checking') return '…';
  if (check === 'error') return '?';
  const latestVer = latest[name];
  return latestVer !== undefined ? '↑ ' + latestVer : inCatalog ? '·' : t(lang, 'pkg.in-env');
}

function updateLine(p: PkgItem, check: PkgCheck, latest: Record<string, string>, lang: string = 'ru'): string {
  if (isPinned(p.source)) return t(lang, 'pkg.pinned');
  if (!p.source.startsWith('npm:')) return t(lang, 'pkg.local');
  if (check === 'checking') return '…';
  if (check === 'error') return t(lang, 'pkg.check-failed');
  const latestVer = latest[p.name];
  if (latestVer !== undefined && latestVer !== p.version) return t(lang, 'pkg.update', { latest: latestVer, version: p.version ?? '?' });
  return t(lang, 'pkg.up-to-date');
}
