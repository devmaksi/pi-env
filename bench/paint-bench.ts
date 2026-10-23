/**
 * Замер «до/после» отрисовки: сколько байт уходит в терминал на один репок.
 * Режим «full» — как было до диффа (каждый репок = clear + весь кадр),
 * режим «diff» — тот же кадр через построчный дифф (src/diff.ts).
 * Запускается как `npm run bench`, в dist не попадает (tsconfig include — только src).
 */

import { render, type RenderArgs } from '../src/render.js';
import { diffFrames, type FrameKey, type FramePatch, type PrevFrame } from '../src/diff.js';
import { computeLayout } from '../src/layout.js';
import { initialState, emptyCatalog, freshExt, type AppState, type Environment } from '../src/state.js';

const WIDTH = 100;
const HEIGHT = 40;
const CLEAR = '\x1b[2J\x1b[H'.length;
const CUP_K = 3; // \x1b[K

const KEY: FrameKey = (() => {
  const L = computeLayout({ width: WIDTH, height: HEIGHT });
  return { width: WIDTH, height: HEIGHT, twoColumns: L.twoColumns };
})();

/** Счётчик записанного: байты и число репаков. */
function meter() {
  const m = {
    repaints: 0,
    bytes: 0,
    write(patch: FramePatch): void {
      m.repaints++;
      m.bytes += patch.kind === 'full'
        ? CLEAR + patch.lines.join('\n').length
        : patch.rows.reduce((n, r) => n + `\x1b[${r.row};1H`.length + r.text.length + CUP_K, 0);
    },
  };
  return m;
}

const envs: Environment[] = Array.from({ length: 8 }, (_, i) => ({
  name: 'env-' + i,
  path: '/root/env-' + i,
  details: { hasSettings: true, model: 'anthropic:claude-sonnet-4-5', tools: ['read', 'bash'], skills: [], packages: [], mcp: [] },
}));

const frame = (state: AppState): string[] =>
  render({ state, envs, root: '/root', width: WIDTH, height: HEIGHT, useColor: true, status: null }).split('\n');


const base = (): AppState => ({ ...initialState(emptyCatalog()), selected: 0 });
const withCursor = (n: number): AppState => ({ ...base(), selected: n });
const tabExt = (): AppState => ({ ...base(), tab: 'extensions', ext: freshExt({ view: 'catalog', catalogStatus: 'ready', cursor: 3 }) });
const tabMcp = (): AppState => ({ ...base(), tab: 'mcp' });
const progress = (loaded: number): AppState => ({
  ...base(),
  tab: 'extensions',
  ext: freshExt({ view: 'catalog', catalogStatus: 'loading' }),
  catalogProgress: { loaded, total: 20 },
});

const scenarios: Array<{ name: string; frames: () => string[][] }> = [
  { name: 'первый кадр (список окружений)', frames: () => [frame(base())] },
  {
    name: 'сдвиг курсора (↑↓ в списке)', frames: () =>
      [frame(withCursor(0)), frame(withCursor(1)), frame(withCursor(2)), frame(withCursor(3))],
  },
  { name: 'смена вкладок (envs → ext → mcp)', frames: () => [frame(base()), frame(tabExt()), frame(tabMcp())] },
  { name: 'репок идентичного состояния', frames: () => [frame(base()), frame(base()), frame(base())] },
  { name: 'прогресс каталога (20 страниц)', frames: () => Array.from({ length: 20 }, (_, i) => frame(progress(i + 1))) },
];

/** Один кадр целиком (то, что было до диффа). */
function runFull(frames: string[][]): { repaints: number; bytes: number } {
  const m = meter();
  for (const lines of frames) m.write({ kind: 'full', lines });
  return m;
}

/** Только отличающиеся строки (то, что стало). */
function runDiff(frames: string[][]): { repaints: number; bytes: number } {
  const m = meter();
  let prev: PrevFrame | null = null;
  for (const lines of frames) {
    const d = diffFrames(prev, lines, KEY);
    if (!d.full && d.ops.length === 0) continue; // писать нечего — repaint не считается
    m.write(d.full ? { kind: 'full', lines } : { kind: 'rows', rows: d.ops });
    prev = { lines, key: KEY };
  }
  return m;
}

const rows = scenarios.map((s) => {
  const full = runFull(s.frames());
  const diff = runDiff(s.frames());
  const perRepaint = (m: { repaints: number; bytes: number }): string =>
    String(Math.round(m.bytes / Math.max(m.repaints, 1)));
  return {
    сценарий: s.name,
    'кадров': s.frames().length,
    'full: репаков': full.repaints,
    'full: байт': full.bytes,
    'full: байт/репок': perRepaint(full),
    'diff: репаков': diff.repaints,
    'diff: байт': diff.bytes,
    'diff: байт/репок': perRepaint(diff),
    'экономия': full.bytes === 0 ? '—' : Math.round((1 - diff.bytes / full.bytes) * 100) + '%',
  };
});

console.table(rows);
const args: RenderArgs = { state: base(), envs, root: '/root', width: WIDTH, height: HEIGHT, useColor: true, status: null };
console.log(`кадр: ${render(args).split('\n').length} строк, ${WIDTH}×${HEIGHT}, раскладка twoColumns=${KEY.twoColumns}`);
