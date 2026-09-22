import { Environment } from './environments.js';
import { computeLayout, NARROW_MIN, LOW_MIN } from './layout.js';
import { AppState } from './state.js';

const ANSI = {
  bright: '\x1b[96m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  inverse: '\x1b[7m',
  reset: '\x1b[0m',
};

function c(code: string, on: boolean): string {
  return on ? code : '';
}

function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padRight(s: string, w: number): string {
  const v = visibleWidth(s);
  if (v > w) return s.slice(0, w);
  return s + ' '.repeat(w - v);
}

function center(s: string, w: number): string {
  const v = visibleWidth(s);
  if (v > w) return s.slice(0, w);
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

const TAB_NAMES = { envs: 'Окружения', settings: 'Настройки', about: 'О программе' } as const;

export function render(a: RenderArgs): string {
  const { state, envs, root, width, height, useColor } = a;

  if (width < NARROW_MIN || height < LOW_MIN) {
    return center('Терминал слишком мал', width);
  }

  const L = computeLayout({ width, height });
  const inner = width - 2;
  const contentRows = height - 4; // таб-бар(1) + разделитель(1) + футер(2)
  const lines: string[] = [];

  // Таб-бар
  const tabs = (Object.keys(TAB_NAMES) as Array<keyof typeof TAB_NAMES>).map((t) => {
    const active = t === state.tab;
    if (active) {
      return c(ANSI.bright, useColor) + c(ANSI.bold, useColor) + TAB_NAMES[t] + c(ANSI.reset, useColor);
    }
    return c(ANSI.dim, useColor) + TAB_NAMES[t] + c(ANSI.reset, useColor);
  });
  lines.push('│' + padRight(tabs.join('    '), inner) + '│');

  // Разделитель под таб-баром
  if (L.twoColumns && !state.sub) {
    lines.push('├' + '─'.repeat(L.leftWidth) + '┬' + '─'.repeat(L.rightWidth) + '┤');
  } else {
    lines.push('├' + '─'.repeat(inner) + '┤');
  }

  if (state.sub) {
    // Суб-экран: центрированная рамка на всю ширину
    const title =
      state.sub === 'run'
        ? 'Запуск окружения ' + (envs[state.selected]?.name ?? '') + ' — этап 2'
        : 'Создание окружения — этап 2';
    const hint = 'Esc — назад';
    const boxW = Math.min(inner - 2, Math.max(visibleWidth(title), visibleWidth(hint)) + 6);
    const box = [
      '╭' + '─'.repeat(boxW) + '╮',
      '│' + center(title, boxW) + '│',
      '│' + center(hint, boxW) + '│',
      '╰' + '─'.repeat(boxW) + '╯',
    ];
    const top = Math.max(0, Math.floor((contentRows - box.length) / 2));
    for (let i = 0; i < contentRows; i++) {
      const row = i - top >= 0 && i - top < box.length ? box[i - top] : '';
      lines.push('│' + center(row, inner) + '│');
    }
  } else {
    const left: string[] = [];
    const right: string[] = [];

    if (state.tab === 'envs') {
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
        right.push(c(ANSI.dim, useColor) + 'Детализация — этап 2' + c(ANSI.reset, useColor));
      } else {
        right.push(c(ANSI.dim, useColor) + 'Выберите окружение' + c(ANSI.reset, useColor));
      }
    } else if (state.tab === 'settings') {
      const items = [
        'Корневой каталог: ' + root,
        'Цветной вывод: [' + (state.colorToggle ? 'x' : ' ') + ']',
      ];
      items.forEach((t, i) => {
        if (i === state.selected) {
          left.push(c(ANSI.inverse, useColor) + padRight(t, L.leftWidth) + c(ANSI.reset, useColor));
        } else {
          left.push(t);
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
      if (L.twoColumns) {
        const l = i < left.length ? padRight(left[i], L.leftWidth) : ' '.repeat(L.leftWidth);
        const r = i < right.length ? padRight(right[i], L.rightWidth) : ' '.repeat(L.rightWidth);
        const hl = state.tab === 'envs' && state.focus === 'left' && useColor;
        const hr = state.tab === 'envs' && state.focus === 'right' && useColor;
        const bl = c(ANSI.bold, hl) + '│' + c(ANSI.reset, hl);
        const bm = c(ANSI.bold, hl) + '│' + c(ANSI.reset, hl);
        const br = c(ANSI.bold, hr) + '│' + c(ANSI.reset, hr);
        lines.push(bl + l + bm + r + br);
      } else {
        const l = i < left.length ? padRight(left[i], inner) : ' '.repeat(inner);
        lines.push('│' + l + '│');
      }
    }
  }

  // Статус-строка
  const legend1 = inner >= 49 ? '↑↓ перемещение  ←→ колонки  TAB вкладки  Enter ОК' : '↑↓ TAB Enter Space Esc';
  const legend2 = 'Space toggle  Esc назад/выход';
  const f1 = c(ANSI.dim, useColor) + legend1 + c(ANSI.reset, useColor);
  const f2 = a.status !== null
    ? c(ANSI.bold, useColor) + a.status + c(ANSI.reset, useColor)
    : c(ANSI.dim, useColor) + legend2 + c(ANSI.reset, useColor);
  lines.push('│' + padRight(f1, inner) + '│');
  lines.push('│' + padRight(f2, inner) + '│');

  return lines.join('\n');
}
