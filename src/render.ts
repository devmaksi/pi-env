import { Environment } from './environments.js';
import { computeLayout, NARROW_MIN, LOW_MIN, type Layout } from './layout.js';
import { type AppState, type PkgCheck } from './state.js';
import { renderCreate, type Ctx } from './sections.js';
import type { PkgItem, CatalogPkg } from './catalog.js';

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

function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

// Обрезка по видимым символам: точка разреза не делит ANSI-последовательность
function truncateVisible(s: string, w: number): string {
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

function padRight(s: string, w: number): string {
  const v = visibleWidth(s);
  if (v > w) return truncateVisible(s, w);
  return s + ' '.repeat(w - v);
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

const TAB_NAMES = { envs: 'Окружения', extensions: 'Расширения', settings: 'Настройки', about: 'О программе' } as const;

/** Число хромовых строк: таб-бар + разделитель + футер из двух строк. */
const CHROME_ROWS = 4;
/** Минимальная внутренняя ширина для полной легенды статус-строки. */
const LEGEND_WIDE_MIN = 49;
/** Максимальная длина имени пакета в списках (дальше — многоточие). */
export const PKG_NAME_MAX = 22;
/** Максимальная длина имени пакета в пикере каталога (дальше — многоточие). */
const CATALOG_NAME_MAX = 24;

export function render(a: RenderArgs): string {
  const { state, envs, root, width, height, useColor } = a;

  if (width < NARROW_MIN || height < LOW_MIN) {
    return center('Терминал слишком мал', width);
  }

  const L = computeLayout({ width, height });
  // «О программе» — центрированный текст на всю ширину, двухколоночная сетка его режет пополам
  const twoCol = L.twoColumns && state.tab !== 'about';
  const inner = width - 2;
  const contentRows = height - CHROME_ROWS; // таб-бар(1) + разделитель(1) + футер(2)
  const ctx: Ctx = { state, L, useColor, inner, contentRows, twoCol, root };
  const lines: string[] = [];

  // Таб-бар
  const tabs = (Object.keys(TAB_NAMES) as Array<keyof typeof TAB_NAMES>).map((t) => {
    const active = t === state.tab;
    const label = active ? '[' + TAB_NAMES[t] + ']' : TAB_NAMES[t];
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

    let left: string[] = [];
    let right: string[] = [];

    if (state.sub === 'create' && state.create) {
      ({ left, right } = renderCreate(state.create, ctx));
    } else if (state.tab === 'envs') {
      interface Row { text: string; selected: boolean; isSep: boolean }
      const rows: Row[] = [];
      envs.forEach((e, i) => {
        rows.push({ text: (i === state.selected ? '> ' : '  ') + e.name, selected: i === state.selected, isSep: false });
        if (i === envs.length - 1) {
          rows.push({ text: '─'.repeat(L.leftWidth - 2), selected: false, isSep: true });
        }
      });
      rows.push({ text: (state.selected === envs.length ? '> ' : '  ') + 'Создать', selected: state.selected === envs.length, isSep: false });

      for (const r of rows) {
        if (r.isSep) {
          left.push(c(ANSI.dim, useColor) + r.text + c(ANSI.reset, useColor));
        } else if (r.selected) {
          left.push(c(ANSI.inverse, useColor) + padRight(r.text, L.leftWidth) + c(ANSI.reset, useColor));
        } else {
          left.push(r.text);
        }
      }

      if (state.selected < envs.length) {
        const e = envs[state.selected];
        right.push(c(ANSI.bold, useColor) + e.name + c(ANSI.reset, useColor));
        right.push('Путь: ' + e.path);
        right.push('settings.json ' + (e.hasSettings ? '✓' : '—'));
        right.push('skills ' + (e.hasSkills ? '✓' : '—'));
        right.push('extensions ' + (e.hasExtensions ? '✓' : '—'));
        right.push(c(ANSI.dim, useColor) + 'E — редактировать' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Детализация — этап 2' + c(ANSI.reset, useColor));
      } else {
        right.push(c(ANSI.dim, useColor) + 'Выберите окружение' + c(ANSI.reset, useColor));
      }
    } else if (state.tab === 'extensions') {
      const ext = state.ext;
      const pkgs = state.catalog.packages;
      if (ext === null) {
        left.push(c(ANSI.bold, useColor) + 'Расширения (основной агент)' + c(ANSI.reset, useColor));
        if (pkgs.length === 0) left.push(c(ANSI.dim, useColor) + '— пусто —' + c(ANSI.reset, useColor));
        pkgs.forEach((p, i) => {
          const text = truncateName(p.name, PKG_NAME_MAX) + '  ' + pkgMarker(p, state.pkgCheck, state.pkgLatest);
          left.push(listRow(i, state.selected, text, L.leftWidth, useColor));
        });
        if (pkgs.length > 0) left.push(c(ANSI.dim, useColor) + '─'.repeat(L.leftWidth - 2) + c(ANSI.reset, useColor));
        const buttons: Array<[string, string]> = [['↑', 'Обновить все'], ['＋', 'Установить']];
        buttons.forEach(([icon, label], j) => {
          left.push(listRow(pkgs.length + j, state.selected, icon + ' ' + label, L.leftWidth, useColor));
        });
        const p = pkgs[state.selected];
        if (p !== undefined) {
          right.push(...pkgInfoLines(p, state.pkgCheck, state.pkgLatest, L, useColor));
        } else if (state.selected === pkgs.length) {
          right.push('Обновить все');
          right.push('pi update --extensions');
          right.push('Enter — выполнить');
        } else {
          right.push('Установка расширения');
          right.push('Список: pi.dev/packages');
          right.push('Enter — открыть каталог');
        }
        right.push(c(ANSI.dim, useColor) + 'Enter — обновить пакет / выбрать' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'X — удалить' + c(ANSI.reset, useColor));
      } else if (ext.view === 'catalog') {
        left.push(c(ANSI.bold, useColor) + 'Установка расширения' + c(ANSI.reset, useColor));
        const picker = catalogPickerLines(ext.catalog, ext.catalogStatus, ext.cursor, L, useColor);
        left.push(...picker.left);
        right.push(...picker.right);
        right.push(c(ANSI.dim, useColor) + 'Esc — назад' + c(ANSI.reset, useColor));
      } else if (ext.view === 'installing') {
        left.push(c(ANSI.dim, useColor) + 'Установка: ' + (ext.installing ?? '') + '…' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Esc — назад' + c(ANSI.reset, useColor));
      } else if (ext.view === 'updating') {
        left.push(c(ANSI.dim, useColor) + (ext.updating === null ? 'Обновление…' : 'Обновление: ' + ext.updating + '…') + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Esc — назад' + c(ANSI.reset, useColor));
      } else if (ext.view === 'removing') {
        left.push(c(ANSI.dim, useColor) + 'Удаление…' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Esc — назад' + c(ANSI.reset, useColor));
      } else if (ext.view === 'confirm-remove') {
        left.push(c(ANSI.bold, useColor) + 'Удалить расширение «' + (ext.removing ?? '') + '»?' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Enter — подтвердить' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Esc — отмена' + c(ANSI.reset, useColor));
      }
      if (!twoCol) for (const h of right) left.push(h);
    } else if (state.tab === 'settings') {
      const items = [
        'Корневой каталог: ' + root,
        'Цветной вывод: [' + (state.colorToggle ? 'x' : ' ') + ']',
      ];
      items.forEach((t, i) => {
        const text = (i === state.selected ? '> ' : '  ') + t;
        if (i === state.selected) {
          left.push(c(ANSI.inverse, useColor) + padRight(text, L.leftWidth) + c(ANSI.reset, useColor));
        } else {
          left.push(text);
        }
      });
      right.push(c(ANSI.dim, useColor) + 'Подробные настройки — этап 2' + c(ANSI.reset, useColor));
    } else {
      const block = [
        c(ANSI.bold, useColor) + 'pi-env 0.1.0' + c(ANSI.reset, useColor),
        'CLI для управления окружениями pi',
        '',
        '↑↓ перемещение  TAB вкладки  Enter ОК  Space toggle  Esc назад/выход',
      ];
      const top = Math.max(0, Math.floor((contentRows - block.length) / 2));
      for (let i = 0; i < contentRows; i++) {
        left.push(i - top >= 0 && i - top < block.length ? center(block[i - top], inner) : '');
      }
    }

    for (let i = 0; i < contentRows; i++) {
      if (twoCol) {
        const l = i < left.length ? padRight(left[i], L.leftWidth) : ' '.repeat(L.leftWidth);
        const r = i < right.length ? padRight(right[i], L.rightWidth) : ' '.repeat(L.rightWidth);
        const hl = state.tab === 'envs' && state.sub === null && state.focus === 'left' && useColor;
        const hr = state.tab === 'envs' && state.sub === null && state.focus === 'right' && useColor;
        const bl = c(ANSI.bold, hl) + '│' + c(ANSI.reset, hl);
        const bm = c(ANSI.bold, hl || hr) + '│' + c(ANSI.reset, hl || hr);
        const br = c(ANSI.bold, hr) + '│' + c(ANSI.reset, hr);
        lines.push(bl + l + bm + r + br);
      } else {
        const l = i < left.length ? padRight(left[i], inner) : ' '.repeat(inner);
        lines.push('│' + l + '│');
      }
    }

  // Статус-строка
  const legend1 = inner >= LEGEND_WIDE_MIN ? '↑↓ перемещение  ←→ колонки  TAB вкладки  Enter ОК' : '↑↓ TAB Enter Space Esc';
  const legend2 = 'Space toggle  E — правка  Esc назад/выход';
  const f1 = c(ANSI.dim, useColor) + legend1 + c(ANSI.reset, useColor);
  const f2 = a.status !== null
    ? c(ANSI.bold, useColor) + a.status + c(ANSI.reset, useColor)
    : c(ANSI.dim, useColor) + legend2 + c(ANSI.reset, useColor);
  lines.push('│' + padRight(f1, inner) + '│');
  lines.push('│' + padRight(f2, inner) + '│');

  return lines.join('\n');
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
export function pkgInfoLines(p: PkgItem, check: PkgCheck, latest: Record<string, string>, L: Layout, useColor: boolean): string[] {
  const lines = [
    c(ANSI.bold, useColor) + p.name + c(ANSI.reset, useColor),
    'Источник: ' + p.source,
    'Версия: ' + (p.version ?? '—'),
    updateLine(p, check, latest),
    'Расширений: ' + p.extensions.length + '  Скиллов: ' + p.skills.length,
  ];
  if (p.description) lines.push(truncateVisible(p.description, L.rightWidth - 1));
  return lines;
}

/** Пикер каталога pi.dev: список слева и инфо-панель справа (общий для вкладки и формы). */
export function catalogPickerLines(
  pkgs: CatalogPkg[],
  status: 'idle' | 'loading' | 'ready' | 'error',
  cursor: number,
  L: Layout,
  useColor: boolean,
): { left: string[]; right: string[] } {
  const left: string[] = [];
  const right: string[] = [];
  if (status === 'loading') {
    left.push(c(ANSI.dim, useColor) + 'Загрузка каталога…' + c(ANSI.reset, useColor));
  } else if (status === 'error') {
    left.push(c(ANSI.bold, useColor) + '⚠ Не удалось загрузить каталог' + c(ANSI.reset, useColor));
  } else {
    if (pkgs.length === 0) left.push(c(ANSI.dim, useColor) + '— пусто —' + c(ANSI.reset, useColor));
    pkgs.forEach((p, i) => left.push(listRow(i, cursor, truncateName(p.name, CATALOG_NAME_MAX), L.leftWidth, useColor)));
    const cur = pkgs[cursor];
    if (cur !== undefined) {
      right.push(c(ANSI.bold, useColor) + cur.name + c(ANSI.reset, useColor));
      if (cur.types.length > 0) right.push('Типы: ' + cur.types.join(', '));
      right.push('Загрузок: ' + cur.downloads);
      if (cur.author !== null) right.push('Автор: ' + cur.author);
      if (cur.description !== null) right.push(truncateVisible(cur.description, L.rightWidth - 1));
      right.push('pi install npm:' + cur.name);
      right.push(c(ANSI.dim, useColor) + 'Enter — установить' + c(ANSI.reset, useColor));
    }
  }
  return { left, right };
}

function isPinned(source: string): boolean {
  // npm:name@ver или npm:@scope/name@ver; скоуп без версии — не pinned
  return new RegExp('^npm:(?:@[^/]+/)?[^@]+@[^@/]+$').test(source);
}

export function pkgMarker(p: PkgItem, check: PkgCheck, latest: Record<string, string>): string {
  if (isPinned(p.source)) return 'закреплено';
  if (!p.source.startsWith('npm:')) return 'локальный';
  if (check === 'checking') return '…';
  if (check === 'error') return '?';
  const latestVer = latest[p.name];
  return latestVer !== undefined && latestVer !== p.version ? '↑ ' + latestVer : '·';
}

function updateLine(p: PkgItem, check: PkgCheck, latest: Record<string, string>): string {
  if (isPinned(p.source)) return 'закреплено';
  if (!p.source.startsWith('npm:')) return 'локальный';
  if (check === 'checking') return '…';
  if (check === 'error') return '? проверка не удалась';
  const latestVer = latest[p.name];
  if (latestVer !== undefined && latestVer !== p.version) return '↑ ' + latestVer + ', установлена ' + (p.version ?? '?');
  return 'актуально';
}
